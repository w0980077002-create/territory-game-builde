// An ephemeral local database. This module has no Supabase URL or credentials.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

export const PLAYER = '10000000-0000-4000-8000-000000000001';
export const OTHER = '10000000-0000-4000-8000-000000000002';
export async function createCaveRuntimeFixture() {
  const compiled = await build({ stdin: { contents: `export {executeCombatCommand} from './src/game/combatV1/service.ts'; export {createInitialGame} from './src/game/engine.ts';`, resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', define: { 'import.meta.env.BASE_URL': '"/"' } });
  const { executeCombatCommand, createInitialGame } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rpc = async (name, args) => (await q(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args))[0].r;
  const repo = { context: (player, command) => rpc('territory_combat_context_v1', [player, command]),
    commit: (player, command, context, result) => rpc('territory_combat_commit_v1', [player, command, context, result]) };
  const exec = (command, player = PLAYER) => executeCombatCommand(repo, player, command, () => 12);
  const save = createInitialGame();
  save.player.name = 'Рагнар'; save.player.gold = 50; save.player.gems = 9; save.battleStones = 37;
  save.followers[0].unlocked = true; save.activeFollowerId = save.followers[0].id;
  save.belt = [{ id: 'belt_0', type: 'potion', name: 'Настой жизни', rarity: 'common', qty: 5,
    description: '+50 HP', icon: '🧪', effect: { stat: 'hp', value: 50, duration: 'instant' } },
    ...Array(5).fill(null), { id: 'belt_6', type: 'elixir', name: 'Сила', rarity: 'rare', qty: 1,
      description: '+10 атаки', icon: '🧪', effect: { stat: 'attack', value: 10, duration: 'battle' } }];
  const fighter = { stats: { hp: 1000, maxHp: 1000, attack: 100, defense: 4, critChance: 0, dodgeChance: 0, blockChance: 0 },
    ownership: { heroLevel: 1, skills: {}, runes: {}, passives: {} }, loadout: { skills: [], passives: [] } };
  const enemy = { ...fighter, stats: { ...fighter.stats, hp: 1300, maxHp: 1300, attack: 35 } };
  const rules = { caveActiveClock: true, stepMs: 10, maxDurationMs: 600000, approachMs: 1000,
    attackIntervalMs: 800, basicWindupMs: 220, basicMultiplier: 1, defenseFactor: .5, magicDefenseFactor: .2,
    minimumDamage: 1, critMultiplier: 2, blockMultiplier: .4, maxEnergy: 100, initialEnergy: 60,
    energyPerSecond: 3, modeDamageMultiplier: { pve: 1, boss: 1, pvp: 1 } };
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE public.players(id uuid PRIMARY KEY,banned bool DEFAULT false,game_state jsonb,gold int,gems int,xp int,level int,max_energy int,
      arena_wins integer DEFAULT 0,updated_at timestamptz DEFAULT clock_timestamp());
    GRANT SELECT,UPDATE ON public.players TO service_role;`);
  for (const player of [PLAYER, OTHER]) await q('INSERT INTO players(id,game_state,gold,gems,xp,level,max_energy) VALUES($1,$2,50,9,0,1,20)', [player, save]);
  for (const name of ['territory_v1_combat_completion.sql', 'territory_v1_adventure_settlement.sql',
    'territory_v1_combat_profiles_reconciliation.sql', 'territory_dark_stones_20261030.sql',
    'territory_cave_belt_attestation_v1.sql', 'territory_cave_runtime_belt_v1.sql']) await db.exec(readFileSync('supabase/staged/' + name, 'utf8'));
  for (const player of [PLAYER, OTHER]) {
    await q(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,legacy_equipped_ids,evidence_reference,reviewed_by)
      VALUES($1,$2,1,$3,'{}',territory_private.combat_legacy_equipped_ids_v1($2),'isolated synthetic fixture','test fixture')`, [player, save, fighter]);
    await q('SELECT territory_private.prepare_combat_profile_v1($1)', [player]);
  }
  for (const slot of [0, 6]) await q(`INSERT INTO territory_private.cave_belt_attestations_v1(player_id,slot,source_reference,reviewed_by,slot_snapshot,expires_at)
    VALUES($1,$2,$3,'isolated fixture',$4,'2099-01-01')`, [PLAYER, slot, `synthetic-dose-${slot}`, save.belt[slot]]);
  for (let stage = 1; stage <= 2; stage++) {
    await q(`INSERT INTO territory_private.combat_encounters_v1(encounter_id,mode,stage,enemy,enabled,approval_reference) VALUES($1,'pve',$2,$3,true,'isolated fixture')`, ['adventure_v1_stage_' + stage, stage, enemy]);
    await q(`INSERT INTO territory_private.adventure_rewards_v1(stage,encounter_id,enabled,gold,xp,approval_reference) VALUES($1,$2,true,15,20,'isolated fixture')`, [stage, 'adventure_v1_stage_' + stage]);
  }
  await q(`UPDATE territory_private.combat_config_v1 SET catalog=$1,rules=$2,enabled=true,settlement_ready=true,
    starts_enabled=true,canary_only=false,approval_reference='isolated synthetic fixture'`, [{ skills: [], runes: [], passives: [] }, rules]);
  return { db, q, rpc, exec, save, rules, fighter, repo };
}
