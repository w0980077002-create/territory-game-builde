/** Full atomic admin-claim contract on offline PGlite; never contacts production. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const licenseSQL = readFileSync('supabase/staged/territory_master_license_shop_v1.sql', 'utf8');
const atomicSQL = readFileSync('supabase/staged/20261026_admin_claim_atomic_v2.sql', 'utf8');
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const gift = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const as = async id => db.query("SELECT set_config('test.uid',$1::text,false)", [id]);
const claim = async id => (await one('SELECT public.territory_admin_claim_grant_v2($1::uuid) AS receipt', [id])).receipt;
const oldClaim = async id => (await one('SELECT public.claim_admin_grant($1::uuid) AS payload', [id])).payload;
const player = async id => one('SELECT gold,gems,forge_materials,game_state,updated_at FROM public.players WHERE id=$1', [id]);
const claimed = async id => (await one('SELECT claimed_at IS NOT NULL AS value FROM public.admin_grants WHERE id=$1', [id])).value;
const credits = async id => (await one('SELECT count(*)::int AS n FROM territory_private.territory_master_license_credit_events_v1 WHERE player_id=$1', [id])).n;
const redWallet = async id => (await one('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1', [id])).balance;
const insertGrant = async (id, uid, payload) => db.query(
  'INSERT INTO public.admin_grants(id,player_id,kind,payload) VALUES($1,$2,\'adjust\',$3::jsonb)',
  [id, uid, JSON.stringify(payload)]
);

const initial = (name, gold, gems, redGems) => ({
  player: {
    name, level: 10, xp: 20, gold, gems, redGems,
    equipped: { weapon: { id: 'gear-1', name: 'Меч', slot: 'weapon', level: 3,
      rarity: 'common', attack: 10 } }
  },
  battleStones: 2,
  forgeMaterials: 1,
  forgeMaterialBatches: [{qty:1,expiresAt:'2026-10-29T00:00:00Z'}],
  inventory: [
    {id:'old-early',name:'Эликсир силы',type:'elixir',qty:2,
      expiresAt:'2026-10-28T00:00:00Z'},
    {id:'old-late',name:'Эликсир силы',type:'elixir',qty:4,
      expiresAt:'2026-10-31T00:00:00Z'}
  ]
});

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid STABLE LANGUAGE sql
      AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
    CREATE TABLE public.players(
      id uuid PRIMARY KEY,telegram_id bigint,banned boolean NOT NULL DEFAULT false,
      gold integer NOT NULL DEFAULT 0,gems integer NOT NULL DEFAULT 0,
      level integer NOT NULL DEFAULT 10,
      forge_materials integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      game_state jsonb NOT NULL);
    CREATE TABLE public.territory_profession_unlocks(
      player_id uuid PRIMARY KEY REFERENCES public.players(id),
      profession text NOT NULL, master_license boolean NOT NULL DEFAULT false);
    CREATE TABLE public.admin_grants(
      id uuid PRIMARY KEY,player_id uuid NOT NULL REFERENCES public.players(id),
      kind text NOT NULL DEFAULT 'adjust',payload jsonb NOT NULL,
      claimed_at timestamptz);
    CREATE TABLE territory_private.referral_claim_cursor_v1(
      player_id uuid PRIMARY KEY REFERENCES public.players(id),
      red_paid integer NOT NULL DEFAULT 0);
    CREATE FUNCTION public.claim_admin_grant(p_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
    AS $$DECLARE result jsonb;BEGIN
      UPDATE admin_grants SET claimed_at=now()
      WHERE id=p_id AND player_id=auth.uid() AND claimed_at IS NULL
      RETURNING payload INTO result;RETURN result;END$$;
  `);
  await db.query('INSERT INTO public.players(id,telegram_id,gold,gems,forge_materials,game_state) VALUES($1,123,100,5,1,$2::jsonb)', [alice, JSON.stringify(initial('A',100,5,7))]);
  await db.query('INSERT INTO public.players(id,telegram_id,gold,gems,forge_materials,game_state) VALUES($1,456,0,0,1,$2::jsonb)', [bob, JSON.stringify(initial('B',0,0,2))]);
  await db.exec(licenseSQL);
  await db.exec(atomicSQL);

  assert.equal((await one("SELECT has_function_privilege('anon','public.territory_admin_claim_grant_v2(uuid)','execute') AS a")).a, false);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.territory_admin_claim_grant_v2(uuid)','execute') AS a")).a, true);
  await insertGrant(gift(1), alice, { gold: 500_000 });

  await as(alice);
  assert.equal(await oldClaim(gift(1)), null, 'cached client must not consume grant without server save');
  assert.equal(await claimed(gift(1)), false);

  const before=(await player(alice)).updated_at;
  const first=await claim(gift(1));
  assert.deepEqual([first.success,first.replayed,first.wallet_gold,first.wallet_gems],[true,false,500100,5]);
  assert.equal(first.game_state.player.gold,500_100);
  assert.equal((await player(alice)).gold,500_100);
  assert.equal(await claimed(gift(1)), true);
  assert.equal(await credits(alice), 0, 'gold only must never credit red wallet');

  const repeat=await claim(gift(1));
  assert.deepEqual([repeat.success,repeat.replayed,repeat.wallet_gold],[true,true,500100]);
  assert.equal((await player(alice)).gold,500100,'repeat does not increase balance');
  assert.equal((await one('SELECT count(*)::int AS n FROM public.players WHERE id=$1 AND updated_at=$2::timestamptz', [alice,before])).n, 0,
    'stale client save version no longer matches server revision');

  const equipped={id:'gear-1',name:'Меч ярла',slot:'weapon',level:59,rarity:'legendary',attack:111,adminTestLevel:true};
  const mixed={gold:12,gems:4,redGems:3,stones:2,forgeMaterials:5,
    items:{shop_elixir_atk:3,shop_potion_hp:1,shop_stone_5:2},
    equipLevels:{weapon:59},adminTestLevel:true,adminTestGearId:'gear-1',adminTestEquipment:equipped};
  await insertGrant(gift(2),alice,mixed);
  const second=await claim(gift(2));
  assert.deepEqual([second.wallet_gold,second.wallet_gems,second.game_state.player.redGems,
    second.game_state.battleStones,second.game_state.forgeMaterials],
    [500112,9,10,14,6]);
  assert.equal(second.game_state.player.equipped.weapon.level,59);
  assert.equal(second.game_state.inventory.length,4);
  const newElixir=second.game_state.inventory.find(e=>e.name==='Эликсир силы' && e.qty===3);
  assert.equal(newElixir?.effect.stat,'attack');
  assert.ok(new Date(newElixir.expiresAt).getTime()>Date.now()+6*86400_000);
  assert.equal(second.game_state.forgeMaterialBatches.length,2);
  assert.equal(await redWallet(alice),10,'verified red gems appear in protected license wallet');
  assert.equal(await credits(alice),1);
  await claim(gift(2));
  assert.equal(await redWallet(alice),10,'no duplicate license credit on replay');

  await insertGrant(gift(3),alice,{items:{shop_elixir_atk:-3}});
  const used=await claim(gift(3));
  const atk=used.game_state.inventory.filter(e=>e.name==='Эликсир силы');
  assert.equal(atk.find(e=>e.id==='old-early'),undefined,'oldest batch consumed first');
  assert.equal(atk.find(e=>e.id==='old-late')?.qty,3);

  await insertGrant(gift(4),alice,{gold:2_147_483_647,redGems:100});
  await assert.rejects(claim(gift(4)),/admin_grant_balance_overflow/);
  assert.equal(await claimed(gift(4)),false,'overflow must retain original unclaimed grant');
  assert.equal(await credits(alice),1,'failed claim must not leave protected-wallet ledger');
  assert.equal((await player(alice)).gold,500112);

  await insertGrant(gift(5),alice,{items:{unknown_potion:1}});
  await assert.rejects(claim(gift(5)),/admin_grant_unknown_item/);
  assert.equal(await claimed(gift(5)),false);

  await insertGrant(gift(6),alice,{gold:'five thousand'});
  await assert.rejects(claim(gift(6)),/admin_grant_invalid_quantity/);
  assert.equal(await claimed(gift(6)),false);

  await as(bob);
  await assert.rejects(claim(gift(2)),/admin_grant_missing/,'another player cannot steal reward');
  await insertGrant(gift(7),bob,{});
  const warning=await claim(gift(7));
  assert.equal(warning.success,true,'empty warning mail can be claimed safely');
  assert.equal((await player(bob)).gold,0);

  await insertGrant(gift(8),bob,{gems:77});
  const [oneClaim,twoClaim]=await Promise.all([claim(gift(8)),claim(gift(8))]);
  assert.equal([oneClaim.replayed,twoClaim.replayed].filter(x=>x===false).length,1,
    'concurrent requests apply exactly once');
  assert.equal((await player(bob)).gems,77);
  assert.equal(await credits(bob),0);

  console.log('ATOMIC ADMIN CLAIM PASS: 500k, mixed currency+gear+7d inventory, no-op legacy, replay, concurrent calls, ownership, invalid payload, int4 rollback, red-wallet once.');
} finally {
  await db.close();
}
