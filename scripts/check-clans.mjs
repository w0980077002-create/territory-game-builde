import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  return (await q('SELECT public.' + name + '(' + params + ') AS result', args))[0].result;
};
const wallet = (gold) => JSON.stringify({ player: { name: 'Hero', gold, gems: 0, redGems: 0, level: 30, xp: 0, xpToNext: 1, energy: 0, maxEnergy: 0, stats: {}, equipped: {} }, inventory: [], forgeMaterials: 5, battleStones: 0 });

try {
  await db.exec([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
    'CREATE SCHEMA auth;',
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';",
    `CREATE TABLE public.players(
      id uuid PRIMARY KEY, display_name text NOT NULL DEFAULT 'Hero', level integer NOT NULL DEFAULT 30,
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

  const schemaSql = readFileSync('supabase/migrations/20261017_clans_schema_v1.sql', 'utf8');
  await db.exec(schemaSql);
  const fnsSql = readFileSync('supabase/migrations/20261017_clans_functions_snapshot.sql', 'utf8');
  for (const part of fnsSql.split(/(?=CREATE OR REPLACE FUNCTION public\.)/)) {
    if (part.trim()) await db.exec(part);
  }

  // ---------- RLS: anon has zero privileges on clan tables ----------
  assert.equal((await q("SELECT has_table_privilege('anon','public.clans','SELECT') AS r"))[0].r, false, 'anon cannot read clans');
  assert.equal((await q("SELECT has_table_privilege('authenticated','public.clans','INSERT') AS r"))[0].r, false, 'authenticated cannot write clans directly');

  // ---------- creation: gold gate, duplicate name/tag ----------
  await as(B);
  await assert.rejects(
    rpc('clan_create', ['Beta Clan', 'BETA', 1, '#eab308', '#1e293b', '', 'open', 1, (await q('SELECT updated_at FROM players WHERE id=$1', [B]))[0].updated_at], ['text','text','integer','text','text','text','text','integer','timestamptz']),
    /clan_not_enough_gold|not_enough/,
    'needs 100k gold',
  );

  await as(A);
  const savedAt = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await rpc('clan_create', ['Alpha Wolves', 'AW', 1, '#eab308', '#1e293b', 'test clan', 'apply', 1, savedAt], ['text','text','integer','text','text','text','text','integer','timestamptz']);
  const clanId = (await q('SELECT id FROM clans LIMIT 1'))[0].id;
  assert.equal((await q('SELECT gold FROM players WHERE id=$1', [A]))[0].gold, 50000, '100k deducted once');
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
  await rpc('clan_accept_app', [B], ['uuid']);
  await as(B);
  await assert.rejects(rpc('clan_apply', [clanId], ['uuid']), /clan_already_member/, 'already member rejected');
  await assert.rejects(rpc('clan_kick', [A], ['uuid']), /clan_no_permission/, 'member cannot kick');
  await assert.rejects(rpc('clan_set_role', [B, 'officer'], ['uuid','text']), /clan_no_permission/, 'member cannot grant roles');

  // ---------- boss: kill via sanctioned flow, claim once ----------
  await as(A);
  await rpc('clan_boss_attack', [clanId], ['uuid']);
  await q('UPDATE clan_bosses SET hp=0, killed_at=now() WHERE clan_id=$1', [clanId]);
  const expectedA = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await rpc('clan_boss_claim', [clanId, expectedA], ['uuid','timestamptz']);
  const afterClaim = (await q('SELECT updated_at FROM players WHERE id=$1', [A]))[0].updated_at;
  await assert.rejects(
    rpc('clan_boss_claim', [clanId, afterClaim], ['uuid','timestamptz']),
    /clan_boss_claimed|claimed|no_damage/,
    'second boss claim rejected',
  );

  // ---------- chat rate limit ----------
  await as(A);
  for (let i = 0; i < 5; i++) await rpc('clan_chat_send', [clanId, 'msg ' + i], ['uuid','text']);
  await assert.rejects(rpc('clan_chat_send', [clanId, 'one too many'], ['uuid','text']), /clan_chat_slow|slow/, '6th message within window rejected');

  // ---------- RLS: non-member sees nothing ----------
  await as(C);
  await q('BEGIN');
  await q('SET LOCAL ROLE authenticated');
  const visible = await q('SELECT count(*)::int AS n FROM clan_members WHERE clan_id=$1', [clanId]);
  await q('COMMIT');
  assert.equal(visible[0].n, 0, 'non-member sees no roster rows');

  console.log('clans anti-cheat: all checks passed');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
