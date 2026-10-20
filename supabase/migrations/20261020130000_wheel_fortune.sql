-- Wheel of Fortune: one shared ticket, atomic payout, durable recovery.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE TABLE territory_private.fortune_inventory_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
 common integer NOT NULL DEFAULT 0 CHECK(common>=0),
 rare integer NOT NULL DEFAULT 0 CHECK(rare>=0),
 golden_key integer NOT NULL DEFAULT 0 CHECK(golden_key>=0),
 vip_until timestamptz
);
CREATE TABLE territory_private.fortune_receipts_v1 (
 player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('spin','common','rare','golden')),
 prize text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),
 refunded boolean NOT NULL DEFAULT false,
 acknowledged boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(player_id,operation_id)
);
CREATE UNIQUE INDEX fortune_one_unseen_v1 ON territory_private.fortune_receipts_v1(player_id) WHERE NOT acknowledged;
CREATE TABLE territory_private.fortune_loot_v1 (
 kind text NOT NULL CHECK(kind IN('common','rare','golden')),
 prize text NOT NULL CHECK(prize IN('gold','gems','potion','elixir','stone','materials')),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100),
 weight integer NOT NULL CHECK(weight BETWEEN 1 AND 10000),
 PRIMARY KEY(kind,prize)
);
INSERT INTO territory_private.fortune_loot_v1 VALUES
 ('common','gold',30,4000),('common','potion',1,3000),('common','stone',1,2000),('common','materials',1,1000),
 ('rare','gold',60,2500),('rare','gems',2,2000),('rare','elixir',1,2000),('rare','stone',2,2000),('rare','materials',2,1500),
 ('golden','gold',100,2500),('golden','gems',3,2500),('golden','elixir',2,2000),('golden','stone',3,2000),('golden','materials',3,1000);
ALTER TABLE territory_private.fortune_inventory_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.fortune_receipts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.fortune_loot_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.fortune_inventory_v1,territory_private.fortune_receipts_v1,territory_private.fortune_loot_v1 FROM PUBLIC,anon,authenticated;

-- gen_random_uuid is PostgreSQL's cryptographically strong v4 generator.
-- First 32 bits are random (version/variant bits occur later). Rejection sampling
-- avoids modulo bias: 4294960000 is exactly divisible by 10000.
CREATE FUNCTION territory_private.fortune_draw_v1() RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path='pg_catalog' AS $$
DECLARE n bigint;
BEGIN
 LOOP
  n:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint;
  IF n<4294960000 THEN RETURN (n%10000)::integer; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION territory_private.fortune_draw_v1() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION territory_private.fortune_prize_v1(n integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='pg_catalog' AS $$
 SELECT jsonb_build_object('prize',prize,'quantity',qty) FROM (VALUES
 (0,3000,'gold',100),(3000,4400,'gems',1),(4400,5200,'gems',3),(5200,5400,'gems',5),
 (5400,7200,'potion',1),(7200,8000,'elixir',1),(8000,9000,'stone',1),
 (9000,9700,'common',1),(9700,9900,'rare',1),(9900,9950,'golden_key',1),
 (9950,9995,'vip',1),(9995,10000,'level',1)) AS t(lo,hi,prize,qty) WHERE n>=lo AND n<hi;
$$;
REVOKE ALL ON FUNCTION territory_private.fortune_prize_v1(integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog' AS $$
 SELECT greatest(p.vip_level,CASE WHEN f.vip_until>statement_timestamp() THEN 1 ELSE 0 END)
 FROM public.players p LEFT JOIN territory_private.fortune_inventory_v1 f ON f.player_id=p.id WHERE p.id=u;
$$;
REVOKE ALL ON FUNCTION territory_private.fortune_vip_v1(uuid) FROM PUBLIC,anon,authenticated;

-- Read-only entitlement endpoint for login and expiry refresh. No wallet writes.
CREATE FUNCTION public.territory_fortune_entitlement_v1() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog' AS $$
 SELECT jsonb_build_object('vip',territory_private.fortune_vip_v1(p.id),
  'vip_until',f.vip_until,'permanent_vip',p.vip_level,'server_now',statement_timestamp())
 FROM public.players p LEFT JOIN territory_private.fortune_inventory_v1 f ON f.player_id=p.id
 WHERE p.id=auth.uid() AND NOT p.banned;
$$;
REVOKE ALL ON FUNCTION public.territory_fortune_entitlement_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_fortune_entitlement_v1() TO authenticated;

CREATE FUNCTION public.territory_fortune_v1(p_action text DEFAULT 'status',p_key uuid DEFAULT NULL,
 p_expected timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $$
DECLARE u uuid:=auth.uid(); p public.players%ROWTYPE;
 a territory_private.hall_accounts_v1%ROWTYPE; f territory_private.fortune_inventory_v1%ROWTYPE;
 r territory_private.fortune_receipts_v1%ROWTYPE; outcome jsonb; st jsonb; hero jsonb; inv jsonb;
 item jsonb; idx integer; n integer; qty integer; prize text; lv integer; xp_next bigint;
 refund boolean:=false; loot record; cumulative integer:=0;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 -- All fortune operations lock player -> shared hall account -> private inventory.
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 IF p_action IS NULL OR p_action NOT IN('status','ack','spin','common','rare','golden')
 THEN RAISE EXCEPTION 'fortune_invalid_action'; END IF;
 INSERT INTO territory_private.hall_accounts_v1(player_id) VALUES(u) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=u FOR UPDATE;
 INSERT INTO territory_private.fortune_inventory_v1(player_id) VALUES(u) ON CONFLICT DO NOTHING;
 SELECT * INTO f FROM territory_private.fortune_inventory_v1 WHERE player_id=u FOR UPDATE;
 IF p_action='ack' THEN
  IF p_key IS NULL THEN RAISE EXCEPTION 'fortune_missing_key'; END IF;
  UPDATE territory_private.fortune_receipts_v1 SET acknowledged=true WHERE player_id=u AND operation_id=p_key;
 ELSIF p_action<>'status' THEN
  IF p_key IS NULL THEN RAISE EXCEPTION 'fortune_missing_key'; END IF;
  SELECT * INTO r FROM territory_private.fortune_receipts_v1 WHERE player_id=u AND operation_id=p_key;
  IF FOUND THEN
   IF r.action<>p_action THEN RAISE EXCEPTION 'fortune_key_reused'; END IF;
  ELSE
   -- A second device receives the unsettled receipt instead of spending again.
   SELECT * INTO r FROM territory_private.fortune_receipts_v1 WHERE player_id=u AND NOT acknowledged;
   IF NOT FOUND THEN
    IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'fortune_reload_required'; END IF;
    IF EXISTS(SELECT 1 FROM territory_private.hall_sessions_v1 WHERE player_id=u AND created_at>clock_timestamp()-interval '15 minutes')
    THEN RAISE EXCEPTION 'fortune_hall_active'; END IF;
    st:=p.game_state; hero:=st->'player'; inv:=st->'inventory';
    IF jsonb_typeof(inv) IS DISTINCT FROM 'array' OR jsonb_typeof(hero) IS DISTINCT FROM 'object'
      OR (hero->>'gold')::integer IS DISTINCT FROM p.gold OR (hero->>'gems')::integer IS DISTINCT FROM p.gems
      OR (hero->>'level')::integer IS DISTINCT FROM p.level
    THEN RAISE EXCEPTION 'fortune_invalid_save'; END IF;
    n:=territory_private.fortune_draw_v1();
    IF p_action='spin' THEN
     IF a.tickets<1 THEN RAISE EXCEPTION 'hall_no_tickets'; END IF;
     outcome:=territory_private.fortune_prize_v1(n);
     prize:=outcome->>'prize'; qty:=(outcome->>'quantity')::integer;
     refund:=prize='level' AND p.level>=100;
     UPDATE territory_private.hall_accounts_v1 SET tickets=tickets-CASE WHEN refund THEN 0 ELSE 1 END WHERE player_id=u;
    ELSE
     IF (p_action='common' AND f.common<1) OR (p_action='rare' AND f.rare<1) OR (p_action='golden' AND f.golden_key<1)
     THEN RAISE EXCEPTION 'fortune_no_chest'; END IF;
     IF (SELECT sum(weight) FROM territory_private.fortune_loot_v1 WHERE kind=p_action) IS DISTINCT FROM 10000::bigint
     THEN RAISE EXCEPTION 'fortune_invalid_loot'; END IF;
     FOR loot IN SELECT * FROM territory_private.fortune_loot_v1 WHERE kind=p_action ORDER BY prize LOOP
      cumulative:=cumulative+loot.weight;
      IF n<cumulative THEN prize:=loot.prize; qty:=loot.quantity; EXIT; END IF;
     END LOOP;
     UPDATE territory_private.fortune_inventory_v1 SET
      common=common-CASE WHEN p_action='common' THEN 1 ELSE 0 END,
      rare=rare-CASE WHEN p_action='rare' THEN 1 ELSE 0 END,
      golden_key=golden_key-CASE WHEN p_action='golden' THEN 1 ELSE 0 END WHERE player_id=u;
    END IF;
    IF prize='gold' THEN hero:=jsonb_set(hero,'{gold}',to_jsonb(p.gold+qty));
    ELSIF prize='gems' THEN hero:=jsonb_set(hero,'{gems}',to_jsonb(p.gems+qty));
    ELSIF prize IN('potion','elixir') THEN
     item:=CASE WHEN prize='potion' THEN
      '{"name":"Зелье здоровья","icon":"🧪","type":"potion","rarity":"common","description":"Восстанавливает 50 HP мгновенно","effect":{"stat":"hp","value":50,"duration":"instant"}}'::jsonb
      ELSE '{"name":"Эликсир силы","icon":"💪","type":"elixir","rarity":"rare","description":"+10 к атаке на один бой","effect":{"stat":"attack","value":10,"duration":"battle"}}'::jsonb END;
     SELECT (ordinality-1)::integer INTO idx FROM jsonb_array_elements(inv) WITH ORDINALITY
      WHERE value->>'name'=item->>'name' AND value->>'type'=item->>'type' AND value->'effect'=item->'effect' LIMIT 1;
     IF idx IS NULL THEN inv:=inv||jsonb_build_array(item||jsonb_build_object('id','fortune_'||gen_random_uuid()::text,'qty',qty));
     ELSE inv:=jsonb_set(inv,ARRAY[idx::text,'qty'],to_jsonb((inv->idx->>'qty')::integer+qty)); END IF;
     st:=jsonb_set(st,'{inventory}',inv);
    ELSIF prize='stone' THEN st:=jsonb_set(st,'{battleStones}',to_jsonb((st->>'battleStones')::integer+qty));
    ELSIF prize='materials' THEN st:=jsonb_set(st,'{forgeMaterials}',to_jsonb((st->>'forgeMaterials')::integer+qty));
    ELSIF prize IN('common','rare','golden_key') THEN
     UPDATE territory_private.fortune_inventory_v1 SET
      common=common+CASE WHEN prize='common' THEN qty ELSE 0 END,
      rare=rare+CASE WHEN prize='rare' THEN qty ELSE 0 END,
      golden_key=golden_key+CASE WHEN prize='golden_key' THEN qty ELSE 0 END WHERE player_id=u;
    ELSIF prize='vip' THEN
     UPDATE territory_private.fortune_inventory_v1 SET vip_until=greatest(clock_timestamp(),coalesce(vip_until,clock_timestamp()))+interval '24 hours' WHERE player_id=u;
    ELSIF prize='level' AND NOT refund THEN
     lv:=p.level+1;
     xp_next:=CASE WHEN lv>=100 THEN 0 ELSE floor(100*power(1.15::double precision,lv-1))::bigint END;
     IF lv>=83 AND lv<100 THEN xp_next:=floor(xp_next*(3+0.12*(lv-83))); END IF;
     hero:=hero||jsonb_build_object('level',lv,'xp',CASE WHEN lv=100 THEN 0 ELSE (hero->>'xp')::integer END,
       'xpToNext',xp_next,'maxEnergy',(hero->>'maxEnergy')::integer+1,
       'stats',(hero->'stats')||jsonb_build_object('maxHp',(hero->'stats'->>'maxHp')::integer+20,
         'hp',(hero->'stats'->>'maxHp')::integer+20,'attack',(hero->'stats'->>'attack')::integer+5,
         'defense',(hero->'stats'->>'defense')::integer+2));
     SELECT coalesce(jsonb_agg(CASE WHEN lv>=CASE value->>'id' WHEN 'follower_1' THEN 3 WHEN 'follower_2' THEN 8 WHEN 'follower_3' THEN 15 WHEN 'follower_4' THEN 25 WHEN 'follower_5' THEN 40 ELSE 101 END
      THEN value||'{"unlocked":true}'::jsonb ELSE value END ORDER BY ordinality),'[]'::jsonb)
      INTO item FROM jsonb_array_elements(st->'followers') WITH ORDINALITY;
     st:=jsonb_set(st,'{followers}',item);
    END IF;
    st:=jsonb_set(st,'{player}',hero);
    UPDATE public.players SET game_state=st,gold=(hero->>'gold')::integer,gems=(hero->>'gems')::integer,
      level=(hero->>'level')::integer,xp=(hero->>'xp')::bigint,max_energy=(hero->>'maxEnergy')::integer,
      forge_materials=(st->>'forgeMaterials')::integer,
      updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond') WHERE id=u RETURNING * INTO p;
    INSERT INTO territory_private.fortune_receipts_v1(player_id,operation_id,action,prize,quantity,refunded)
     VALUES(u,p_key,p_action,prize,qty,refund) RETURNING * INTO r;
   END IF;
  END IF;
 END IF;
 IF p_action IN('status','ack') THEN
  SELECT * INTO r FROM territory_private.fortune_receipts_v1 WHERE player_id=u AND NOT acknowledged;
 END IF;
 SELECT * INTO f FROM territory_private.fortune_inventory_v1 WHERE player_id=u;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=u;
 RETURN jsonb_build_object('success',true,'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems,
  'game_state',p.game_state,'tickets',a.tickets,'common',f.common,'rare',f.rare,'golden_key',f.golden_key,
  'vip_until',f.vip_until,'server_now',clock_timestamp(),'vip',territory_private.fortune_vip_v1(u),
  'receipt',CASE WHEN r.operation_id IS NULL THEN NULL ELSE jsonb_build_object('id',r.operation_id,'action',r.action,'prize',r.prize,'quantity',r.quantity,'refunded',r.refunded) END);
END $$;
REVOKE ALL ON FUNCTION public.territory_fortune_v1(text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_fortune_v1(text,uuid,timestamptz) TO authenticated;

-- Refuse another Hall session while a confirmed reward awaits presentation.
DO $$
DECLARE original text; anchor text:='SELECT * INTO s FROM territory_private.hall_sessions_v1 WHERE player_id=v_uid FOR UPDATE;';
BEGIN
 original:=pg_get_functiondef('public.territory_hall_start_v1(text)'::regprocedure);
 IF strpos(original,anchor)=0 THEN RAISE EXCEPTION 'fortune_hall_guard_changed'; END IF;
 EXECUTE replace(original,anchor,
  'IF EXISTS(SELECT 1 FROM territory_private.fortune_receipts_v1 WHERE player_id=v_uid AND NOT acknowledged) THEN RAISE EXCEPTION ''fortune_recover_required''; END IF; '||anchor);
END $$;
-- Reuse every existing VIP benefit, at temporary tier 1; permanent tiers win.
-- Fail closed if production implementations differ from the reviewed snapshot.
DO $$
DECLARE routine text; original text; anchor text:='SELECT vip_level INTO v_vip FROM players WHERE id = auth.uid();';
BEGIN
 FOREACH routine IN ARRAY ARRAY['public.arena_set_auto(uuid,boolean)','public.arena_state(uuid,bigint)'] LOOP
  original:=pg_get_functiondef(to_regprocedure(routine));
  IF original IS NULL OR strpos(original,anchor)=0 THEN RAISE EXCEPTION 'fortune_vip_guard_changed: %',routine; END IF;
  EXECUTE replace(original,anchor,'SELECT territory_private.fortune_vip_v1(auth.uid()) INTO v_vip;');
 END LOOP;
END $$;
COMMIT;
