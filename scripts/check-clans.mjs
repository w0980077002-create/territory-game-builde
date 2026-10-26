import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

// Clan system anti-cheat verification:
// - wallet gates, duplicate creation, contribution atomicity (CAS)
// - single membership, role permission matrix, duplicate claims blocked
// - chat rate limit, RLS denies non-members and direct table writes
const db = new PGlite();
const A = '10000000-0000-0000-0000-000000000001';
const B = '10000000-0000-0000-0000-000000000002';
const C = '10000000-0000-0000-0000-000000000003';

const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const as = async (id) => { await q("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]); };
const rpc = async (name, args = [], casts = []) => {
  const params = args.map((_, i) => '$' + (i + 1) + (casts[i] ? '::' + casts[i] : '')).join(',');
  await q('BEGIN');
  try {
    await q('SET LOCAL ROLE authenticated');
    const result = (await q('SELECT public.' + name + '(' + params + ') AS result', args))[0].result;
    await q('COMMIT');
    return result;
  } catch (error) { await q('ROLLBACK'); throw error; }
};
const wallet = (gold) => JSON.stringify({ player: { name: 'Hero', gold, gems: 0, redGems: 60, level: 30, xp: 0, xpToNext: 1, energy: 0, maxEnergy: 0, stats: {}, equipped: {} }, inventory: [], forgeMaterials: 5, battleStones: 0 });

try {
  await db.exec([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
    'CREATE SCHEMA auth;',
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';",
    `CREATE TABLE public.players(
      id uuid PRIMARY KEY, telegram_id bigint DEFAULT 1, display_name text NOT NULL DEFAULT 'Hero', level integer NOT NULL DEFAULT 30,
      gold integer NOT NULL DEFAULT 0, gems integer NOT NULL DEFAULT 0, forge_materials integer NOT NULL DEFAULT 0,
      attack integer NOT NULL DEFAULT 100, defense integer NOT NULL DEFAULT 100,
      banned boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), game_state jsonb,
      last_seen_at timestamptz NOT NULL DEFAULT now());`,
    "CREATE FUNCTION public.fixture_revision() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF OLD.game_state IS DISTINCT FROM NEW.game_state THEN NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond''); END IF; RETURN NEW; END';",
    'CREATE TRIGGER clan_fixture_revision BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.fixture_revision();',
  ].join('\n'));
  await q('INSERT INTO public.players(id,gold,forge_materials,game_state) VALUES ($1,150000,5,$2)', [A, wallet(150000)]);
  await q('INSERT INTO public.players(id,gold,forge_materials,game_state) VALUES ($1,5000,5,$2)', [B, wallet(5000)]);
  await q('INSERT INTO public.players(id,gold,forge_materials,game_state) VALUES ($1,0,5,$2)', [C, wallet(0)]);

  const installation = readFileSync('supabase/staged/territory_stage1_clans_install.sql', 'utf8');
  assert(installation.includes(readFileSync('supabase/migrations/20261017_clans_schema_v1.sql', 'utf8')), 'installer matches source schema');
  assert(installation.includes(readFileSync('supabase/migrations/20261017_clans_functions_snapshot.sql', 'utf8')), 'installer matches source functions; regenerate with scripts/clans/build-install.mjs after edits');
  await db.exec(installation);

  await as(A);
  const missingWalletRevision = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await assert.rejects(rpc('clan_create', ['No Wallet', 'NOW', 1, '#eab308', '#1e293b', '', 'open', 1, missingWalletRevision], ['text','text','integer','text','text','text','text','integer','timestamptz']), /clan_red_wallet_unavailable/, 'missing trusted wallet fails closed');
  // Install the actual reviewed wallet SQL in the fixture; never seed production here.
  await db.exec(`CREATE SCHEMA territory_private;
    CREATE TABLE public.territory_profession_unlocks(player_id uuid PRIMARY KEY REFERENCES players(id),profession text NOT NULL,master_license boolean NOT NULL DEFAULT false);
    CREATE TABLE public.admin_grants(id uuid PRIMARY KEY,player_id uuid NOT NULL REFERENCES players(id),payload jsonb NOT NULL,claimed_at timestamptz);
    CREATE TABLE territory_private.referral_claim_cursor_v1(player_id uuid PRIMARY KEY REFERENCES players(id),red_paid integer NOT NULL DEFAULT 0);`);
  await db.exec(readFileSync('supabase/staged/territory_master_license_shop_v1.sql', 'utf8'));
  await q('UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=0 WHERE player_id=$1', [C]);
  await q("UPDATE players SET game_state=jsonb_set(game_state,'{player,redGems}','999999') WHERE id=$1", [C]);
  await as(C);
  const forgedRevision = (await q('SELECT updated_at FROM players WHERE id=$1', [C]))[0].updated_at;
  await assert.rejects(rpc('clan_create', ['Forged Wallet', 'FW', 1, '#eab308', '#1e293b', '', 'open', 1, forgedRevision], ['text','text','integer','text','text','text','text','integer','timestamptz']), /clan_not_enough_red_gems/, 'forged client red diamonds cannot buy clan with trusted zero');
  assert.equal((await q('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1', [C]))[0].balance, 0, 'failed purchase never reseeds wallet');

  // ---------- RLS: anon has zero privileges on clan tables ----------
  assert.equal((await q("SELECT has_table_privilege('anon','public.clans','SELECT') AS r"))[0].r, false, 'anon cannot read clans');
  assert.equal((await q("SELECT has_table_privilege('authenticated','public.clans','INSERT') AS r"))[0].r, false, 'authenticated cannot write clans directly');

  assert.equal((await q("SELECT has_function_privilege('authenticated','public.clan_xp_add(uuid,integer)','EXECUTE') AS r"))[0].r, false, 'internal XP grant cannot be called by players');
  assert.equal((await q("SELECT has_function_privilege('anon','public.clan_create(text,text,integer,text,text,text,text,integer,timestamptz)','EXECUTE') AS r"))[0].r, false, 'anon cannot create clans');
  assert.equal((await q("SELECT bool_and(relrowsecurity) AS r FROM pg_class WHERE relname LIKE 'clan%' AND relkind='r'"))[0].r, true, 'RLS enabled on all clan tables');

  // ---------- creation: gold gate, duplicate name/tag ----------
  await as(B);
  await q("UPDATE players SET game_state=jsonb_set(game_state,'{player,redGems}','0') WHERE id=$1", [B]);
  await assert.rejects(
    rpc('clan_create', ['Beta Clan', 'BETA', 1, '#eab308', '#1e293b', '', 'open', 1, (await q('SELECT updated_at FROM players WHERE id=$1', [B]))[0].updated_at], ['text','text','integer','text','text','text','text','integer','timestamptz']),
    /clan_not_enough_red_gems|not_enough/,
    'needs 30 red diamonds',
  );

  await as(A);
  const savedAt = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await rpc('clan_create', ['Alpha Wolves', 'AW', 1, '#eab308', '#1e293b', 'test clan', 'apply', 1, savedAt], ['text','text','integer','text','text','text','text','integer','timestamptz']);
  const clanId = (await q('SELECT id FROM clans LIMIT 1'))[0].id;
  assert.equal((await q('SELECT gold FROM players WHERE id=$1', [A]))[0].gold, 150000, 'creation preserves gold');
  assert.equal((await q('SELECT game_state FROM players WHERE id=$1', [A]))[0].game_state.player.redGems, 30, '30 red diamonds deducted exactly once');
  assert.equal((await q('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1', [A]))[0].balance, 30, 'same debit persisted to trusted red wallet');
  assert.equal((await q('SELECT role FROM clan_members WHERE player_id=$1', [A]))[0].role, 'leader', 'creator becomes leader');

  await as(B);
  await q('UPDATE players SET gold=150000, forge_materials=5, game_state=$2 WHERE id=$1', [B, wallet(150000)]);
  const bToken = async () => (await q('SELECT updated_at FROM players WHERE id=$1', [B]))[0].updated_at;
  await assert.rejects(
    rpc('clan_create', ['Alpha Wolves', 'ZZZ', 1, '#eab308', '#1e293b', '', 'open', 1, await bToken()], ['text','text','integer','text','text','text','text','integer','timestamptz']),
    /clan_bad_name|clan_duplicate|duplicate key|unique constraint/,
    'duplicate name rejected',
  );
  await assert.rejects(
    rpc('clan_create', ['Other Name', 'aw', 1, '#eab308', '#1e293b', '', 'open', 1, await bToken()], ['text','text','integer','text','text','text','text','integer','timestamptz']),
    /clan_bad_tag|clan_duplicate|duplicate key|unique constraint/,
    'duplicate tag (case-insensitive) rejected',
  );

  // ---------- CAS: stale save token rejected ----------
  await as(A);
  const stale = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(
    rpc('clan_contribute', [clanId, 100, 0, stale], ['uuid','integer','integer','timestamptz']),
    /clan_reload_save|reload/,
    'stale save token rejected',
  );

  // ---------- contribution: wallet column and JSON move together ----------
  const before = (await q('SELECT gold, game_state, updated_at FROM players WHERE id=$1', [A]))[0];
  const contrib = await rpc('clan_contribute', [clanId, 1000, 5, before.updated_at], ['uuid','integer','integer','timestamptz']);
  const afterGold = (await q('SELECT gold FROM players WHERE id=$1', [A]))[0].gold;
  assert.equal(afterGold, before.gold - 1000, 'wallet column debited exactly once');
  assert.equal(contrib.game_state.player.gold, afterGold, 'wallet JSON matches column');
  await assert.rejects(
    rpc('clan_contribute', [clanId, -5, 0, contrib.updated_at], ['uuid','integer','integer','timestamptz']),
    /clan_bad_amount|amount|check|clan_not_enough/,
    'negative amounts rejected',
  );

  // ---------- membership + role matrix ----------
  await as(B);
  await rpc('clan_apply', [clanId], ['uuid']);
  await as(A);
  const pending = await rpc('clan_state', [clanId], ['uuid']);
  assert.equal(pending.applications[0].player_id, B, 'non-member application visible to leader');
  assert.equal(pending.clan.buildings.hall.lvl, 1);
  assert.equal((await rpc('clan_directory', ['Alpha'], ['text'])).clans.length, 1, 'directory search executes and returns clan');
  await rpc('clan_accept_app', [B], ['uuid']);
  await as(B);
  await assert.rejects(rpc('clan_apply', [clanId], ['uuid']), /clan_already_member/, 'already member rejected');
  await assert.rejects(rpc('clan_kick', [A], ['uuid']), /clan_no_permission/, 'member cannot kick');
  await assert.rejects(rpc('clan_set_role', [B, 'officer'], ['uuid','text']), /clan_no_permission/, 'member cannot grant roles');

  // ---------- boss: kill via sanctioned flow, claim once ----------
  await as(A);
  await rpc('clan_boss_attack', [clanId], ['uuid']);
  await as(B);
  await rpc('clan_boss_attack', [clanId], ['uuid']);
  await as(A);
  await q('UPDATE clan_bosses SET hp=0, killed_at=now() WHERE clan_id=$1', [clanId]);
  const nextBoss = await rpc('clan_state', [clanId], ['uuid']);
  assert.equal(nextBoss.boss.no, 2, 'next boss starts while inactive participant has not claimed');
  assert(nextBoss.boss.hp > 0);
  assert.equal(nextBoss.pending_boss_rewards[0].boss_no, 1, 'previous boss reward persists after respawn');
  const archivedAmount = nextBoss.pending_boss_rewards[0].gold;
  await q("UPDATE clan_bosses SET expires_at=now()-interval '1 hour' WHERE clan_id=$1", [clanId]);
  assert.equal((await rpc('clan_state', [clanId], ['uuid'])).pending_boss_rewards[0].gold, archivedAmount, 'old entitlement survives another encounter expiration');
  const expectedA = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await rpc('clan_boss_claim', [clanId, expectedA], ['uuid','timestamptz']);
  const afterClaim = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await assert.rejects(
    rpc('clan_boss_claim', [clanId, afterClaim], ['uuid','timestamptz']),
    /clan_boss_claimed|claimed|no_damage/,
    'second boss claim rejected',
  );

  await as(B);
  const returning = await rpc('clan_state', [clanId], ['uuid']);
  assert.equal(returning.pending_boss_rewards[0].boss_no, 1, 'inactive member recovers old reward after new boss');
  const bOldReward = returning.pending_boss_rewards[0].gold;
  const bBeforeOldClaim = (await q('SELECT gold, updated_at FROM players WHERE id=$1', [B]))[0];
  await rpc('clan_boss_claim', [clanId, bBeforeOldClaim.updated_at, 1], ['uuid','timestamptz','integer']);
  const bAfterOldClaim = (await q('SELECT gold, updated_at FROM players WHERE id=$1', [B]))[0];
  assert.equal(bAfterOldClaim.gold, bBeforeOldClaim.gold + bOldReward, 'old server entitlement credited exactly');
  await assert.rejects(rpc('clan_boss_claim', [clanId, bAfterOldClaim.updated_at, 1], ['uuid','timestamptz','integer']), /clan_boss_claimed/, 'old entitlement cannot be replayed');
  await assert.rejects(rpc('clan_boss_archive_rewards', [clanId], ['uuid']), /permission denied/, 'players cannot mint reward entitlements');

  // ---------- chat rate limit ----------
  await as(A);
  for (let i = 0; i < 5; i++) await rpc('clan_chat_send', [clanId, 'msg ' + i], ['uuid','text']);
  await assert.rejects(rpc('clan_chat_send', [clanId, 'one too many'], ['uuid','text']), /clan_chat_slow|slow/, '6th message within window rejected');

  const reopened = await rpc('clan_state', [clanId], ['uuid']);
  assert.equal(reopened.chat.filter(m => m.body.startsWith('msg ')).length, 5, 'chat survives reopening');
  assert.equal(reopened.chat.find(m => m.body === 'msg 0').author_id, A, 'chat retains author identity');
  assert.equal(reopened.pending_boss_rewards.length, 0, 'reward claim survives reopening and clears pending list');
  const questToken = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await assert.rejects(rpc('clan_quest_claim', [clanId, 'cq_boss_dmg', questToken], ['uuid','text','timestamptz']), /clan_quest_locked/, 'unearned quest reward rejected');

  await q('INSERT INTO clan_boss_damage(clan_id,boss_no,player_id,damage) VALUES ($1,1,$2,6000)', [clanId, A]);
  await rpc('clan_quest_claim', [clanId, 'cq_boss_dmg', questToken], ['uuid','text','timestamptz']);
  const earned = (await q('SELECT gold, game_state, updated_at FROM players WHERE id=$1', [A]))[0];
  assert.equal(earned.gold, earned.game_state.player.gold, 'quest receipt wallet persisted');
  await assert.rejects(rpc('clan_quest_claim', [clanId, 'cq_boss_dmg', earned.updated_at], ['uuid','text','timestamptz']), /duplicate key|unique constraint/, 'quest reward can only be claimed once');
  assert.equal((await q('SELECT gold FROM players WHERE id=$1', [A]))[0].gold, earned.gold, 'duplicate quest transaction rolls back wallet');
  assert.equal((await rpc('clan_invite_candidates', ['Hero'], ['text'])).length, 1, 'invite search excludes current members');
  await rpc('clan_invite_player', [C], ['uuid']);
  await as(C);
  assert.equal((await rpc('clan_directory', ['',], ['text'])).my_invites[0].clan_id, clanId);
  await rpc('clan_accept_invite', [clanId], ['uuid']);
  assert.equal((await rpc('clan_state', [clanId], ['uuid'])).members.length, 3, 'invitation produces persisted membership');
  await rpc('clan_leave');

  await q('UPDATE players SET banned=true WHERE id=$1', [C]);
  await assert.rejects(rpc('clan_apply', [clanId], ['uuid']), /clan_login_required/, 'banned player cannot apply');
  await q('UPDATE players SET banned=false WHERE id=$1', [C]);
  await assert.rejects(rpc('clan_building_upgrade', [clanId, 'forge'], ['uuid','text']), /clan_no_permission/, 'non-member cannot spend clan treasury');
  await assert.rejects(rpc('clan_boss_sync', [clanId], ['uuid']), /clan_not_member/, 'non-member cannot advance clan boss');
  await assert.rejects(rpc('clan_xp_add', [clanId, 10000], ['uuid','integer']), /permission denied/, 'players cannot invoke internal XP grants');

  // ---------- RLS: non-member sees nothing ----------
  await as(C);
  await q('BEGIN');
  await q('SET LOCAL ROLE authenticated');
  const visible = await q('SELECT count(*)::int AS n FROM clan_members WHERE clan_id=$1', [clanId]);
  await q('COMMIT');
  assert.equal(visible[0].n, 0, 'non-member sees no roster rows');

  const js = ts.transpileModule(readFileSync('src/game/clanState.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const { normalizeClanState } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const normalized = normalizeClanState(reopened);
  assert.equal(normalized.members[0].display_name, 'Hero');
  assert.equal(normalized.buildings.hall.lvl, 1);
  assert.equal(normalized.quests.length, 4);
  assert.equal(normalized.pending_boss_rewards.length, 0);
  assert.equal(normalized.chat.find(m => m.body === 'msg 0').author_name, 'Hero');
  assert(Number.isFinite(Date.parse(normalized.chat[0].created_at)));
  assert.equal(normalized.boss.boss_no, reopened.boss.no);
  assert.equal(normalized.boss_attacks_left, reopened.boss.attacks_left);
  console.log('clans anti-cheat and client/server contract: all checks passed');
  await db.close();
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
