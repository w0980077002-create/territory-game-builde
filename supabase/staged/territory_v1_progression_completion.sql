-- TERRITORY 1.0 T5-T8. STAGED ONLY. No automatic player snapshot import, cutover or activation.
-- Reward/catalog rows are deliberately empty until owner approval. Mail uses the
-- existing atomic territory_admin_claim_grant_v2 flow; there is no second wallet.
BEGIN;
DO $dependencies$ BEGIN
 IF to_regprocedure('public.territory_admin_claim_grant_v2(uuid)') IS NULL OR to_regclass('public.territory_crafted_items_v1') IS NULL OR to_regclass('public.territory_profession_stage8_items') IS NULL THEN RAISE EXCEPTION 'progression_atomic_mail_or_craft_missing'; END IF;
END $dependencies$;
CREATE SCHEMA IF NOT EXISTS territory_private;
GRANT USAGE ON SCHEMA territory_private TO service_role;
CREATE TABLE IF NOT EXISTS territory_private.v1_progression_config (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false
);
INSERT INTO territory_private.v1_progression_config VALUES(1,false) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS territory_private.v1_activity_rules (
 activity text PRIMARY KEY CHECK(activity ~ '^[a-z][a-z0-9_]{1,59}$'),
 slot integer UNIQUE NOT NULL CHECK(slot BETWEEN 1 AND 5),
 target integer NOT NULL CHECK(target BETWEEN 1 AND 2147483647)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_activity_counts (
 player_id uuid REFERENCES public.players(id), day date NOT NULL, activity text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>=0), PRIMARY KEY(player_id,day,activity)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_reward_rules (
 id text PRIMARY KEY, period text NOT NULL CHECK(period IN('daily','weekly','fund')),
 fund text CHECK(fund IN('level','arena','blessing','adventure','artifact','dark_energy')),
 track text NOT NULL DEFAULT 'free' CHECK(track IN('free','premium')),
 threshold integer NOT NULL CHECK(threshold>0), reward jsonb NOT NULL CHECK(jsonb_typeof(reward)='object'),
 CHECK((period='fund')=(fund IS NOT NULL)),
 CHECK(period<>'daily' OR threshold IN(20,40,60,80,100)),
 CHECK(period<>'weekly' OR threshold<=700), CHECK(period='fund' OR track='free')
);
CREATE TABLE IF NOT EXISTS territory_private.v1_progression_claims (
 player_id uuid REFERENCES public.players(id), rule_id text NOT NULL,
 period_key text NOT NULL, grant_id uuid REFERENCES public.admin_grants(id),
 PRIMARY KEY(player_id,rule_id,period_key)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_blessing_rules (
 level integer PRIMARY KEY CHECK(level>0), required_xp bigint NOT NULL CHECK(required_xp>=0),
 charges integer NOT NULL CHECK(charges>0), gold_bonus_bp integer NOT NULL CHECK(gold_bonus_bp>=0), battle_xp integer CHECK(battle_xp>=0)
);
-- The existing src/game/progression.ts defines ONLY this level: 3 fights, +50% gold.
INSERT INTO territory_private.v1_blessing_rules VALUES(1,0,3,5000,NULL) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS territory_private.v1_blessing (
 player_id uuid PRIMARY KEY REFERENCES public.players(id),
 legacy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(legacy_snapshot)='object'),
 day text NOT NULL, last_claim_utc_day date, charges integer NOT NULL CHECK(charges>=0),
 level integer NOT NULL DEFAULT 1 REFERENCES territory_private.v1_blessing_rules(level),
 xp bigint NOT NULL DEFAULT 0 CHECK(xp>=0)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_fund_progress (
 player_id uuid REFERENCES public.players(id), fund text NOT NULL CHECK(fund IN('level','arena','blessing','adventure','artifact','dark_energy')),
 progress bigint NOT NULL DEFAULT 0 CHECK(progress>=0), premium boolean NOT NULL DEFAULT false,
 purchase_event uuid, PRIMARY KEY(player_id,fund)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_gem_rules (
 gem_kind text NOT NULL CHECK(gem_kind ~ '^[a-z][a-z0-9_]{1,59}$'),
 level integer NOT NULL CHECK(level>0), next_level integer CHECK(next_level>level),
 attack integer NOT NULL DEFAULT 0 CHECK(attack>=0), defense integer NOT NULL DEFAULT 0 CHECK(defense>=0), hp integer NOT NULL DEFAULT 0 CHECK(hp>=0),
 PRIMARY KEY(gem_kind,level)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_gem_inventory (
 player_id uuid REFERENCES public.players(id), gem_kind text NOT NULL, gem_level integer NOT NULL,
 quantity bigint NOT NULL CHECK(quantity BETWEEN 0 AND 2147483647),
 PRIMARY KEY(player_id,gem_kind,gem_level), FOREIGN KEY(gem_kind,gem_level) REFERENCES territory_private.v1_gem_rules(gem_kind,level)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_socket_rules (
 rarity text PRIMARY KEY CHECK(rarity IN('common','rare','epic','legendary')),
 sockets integer NOT NULL CHECK(sockets BETWEEN 1 AND 16)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_gem_sockets_v1 (
 source text NOT NULL CHECK(source IN('stage3','stage8')), item_id uuid NOT NULL,
 socket_index integer NOT NULL CHECK(socket_index BETWEEN 1 AND 16),
 gem_kind text NOT NULL, gem_level integer NOT NULL,
 PRIMARY KEY(source,item_id,socket_index), FOREIGN KEY(gem_kind,gem_level) REFERENCES territory_private.v1_gem_rules(gem_kind,level)
);
CREATE TABLE IF NOT EXISTS territory_private.v1_progression_events (
 event_id uuid PRIMARY KEY, player_id uuid NOT NULL REFERENCES public.players(id),
 kind text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS territory_private.v1_progression_receipts (
 player_id uuid REFERENCES public.players(id), operation_id uuid NOT NULL,
 action text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(player_id,operation_id)
);
DO $acl$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['v1_progression_config','v1_activity_rules','v1_activity_counts','v1_reward_rules','v1_progression_claims','v1_blessing_rules','v1_blessing','v1_fund_progress','v1_gem_rules','v1_gem_inventory','v1_socket_rules','v1_gem_sockets_v1','v1_progression_events','v1_progression_receipts'] LOOP
  EXECUTE format('ALTER TABLE territory_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON territory_private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $acl$;

-- No client-accessible initialization from game_state. A reviewed import supplies
-- the exact legacy blessing, including local-date receipt strings and charges.
CREATE OR REPLACE FUNCTION territory_private.v1_import_blessing(p_player uuid,p_legacy jsonb,p_claimed_utc_day date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old jsonb;
BEGIN
 PERFORM 1 FROM public.players WHERE id=p_player AND banned IS NOT TRUE FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'progression_player_unavailable'; END IF;
 IF jsonb_typeof(p_legacy) IS DISTINCT FROM 'object' OR jsonb_typeof(p_legacy->'day') IS DISTINCT FROM 'string'
  OR NOT COALESCE((p_legacy->>'charges') ~ '^[0-9]{1,9}$',false) THEN RAISE EXCEPTION 'progression_legacy_invalid'; END IF;
 IF p_legacy->>'day'<>'' AND p_claimed_utc_day IS NULL AND NOT (p_legacy->>'day' ~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'progression_legacy_claim_utc_day_required'; END IF;
 SELECT legacy_snapshot INTO old FROM territory_private.v1_blessing WHERE player_id=p_player;
 IF FOUND THEN
  IF old IS DISTINCT FROM p_legacy THEN RAISE EXCEPTION 'progression_legacy_already_imported'; END IF;
  RETURN;
 END IF;
 INSERT INTO territory_private.v1_blessing(player_id,legacy_snapshot,day,last_claim_utc_day,charges)
 VALUES(p_player,p_legacy,p_legacy->>'day',coalesce(p_claimed_utc_day,CASE WHEN p_legacy->>'day'<>'' THEN (p_legacy->>'day')::date END),(p_legacy->>'charges')::int);
END $$;
REVOKE ALL ON FUNCTION territory_private.v1_import_blessing(uuid,jsonb,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.v1_import_blessing(uuid,jsonb,date) TO service_role;

-- Must be invoked in the SAME transaction as a verified battle/craft/gather/
-- payment result. RPC callers cannot report their own progress or gem awards.
CREATE OR REPLACE FUNCTION territory_private.v1_progression_event(p_player uuid,p_event uuid,p_kind text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved territory_private.v1_progression_events%ROWTYPE; rule territory_private.v1_activity_rules%ROWTYPE;
 b territory_private.v1_blessing%ROWTYPE; br territory_private.v1_blessing_rules%ROWTYPE;
 amount bigint; result jsonb:='{}'; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_event IS NULL OR p_kind IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'progression_event_invalid'; END IF;
 PERFORM 1 FROM public.players WHERE id=p_player AND banned IS NOT TRUE FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'progression_player_unavailable'; END IF;
 -- Callers already hold this player lock; never take the event lock first.
 PERFORM pg_advisory_xact_lock(hashtextextended('progression_event:'||p_event::text,0));
 SELECT * INTO saved FROM territory_private.v1_progression_events WHERE event_id=p_event;
 IF FOUND THEN
  IF saved.player_id IS DISTINCT FROM p_player OR saved.kind IS DISTINCT FROM p_kind OR saved.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'progression_event_reused'; END IF;
  RETURN saved.result;
 END IF;
 IF NOT COALESCE((SELECT enabled FROM territory_private.v1_progression_config WHERE id=1),false) THEN RAISE EXCEPTION 'progression_disabled'; END IF;
 IF p_kind='activity' THEN
  IF (SELECT count(*) FROM territory_private.v1_activity_rules)<>5 THEN RAISE EXCEPTION 'progression_activity_config_missing'; END IF;
  SELECT * INTO rule FROM territory_private.v1_activity_rules WHERE activity=p_payload->>'activity';
  IF NOT FOUND OR NOT COALESCE((p_payload->>'quantity') ~ '^[1-9][0-9]{0,8}$',false) THEN RAISE EXCEPTION 'progression_activity_invalid'; END IF;
  amount:=(p_payload->>'quantity')::bigint;
  INSERT INTO territory_private.v1_activity_counts VALUES(p_player,today,rule.activity,least(amount,rule.target))
  ON CONFLICT(player_id,day,activity) DO UPDATE SET quantity=least(territory_private.v1_activity_counts.quantity+excluded.quantity,rule.target);
 ELSIF p_kind IN('fund_progress','fund_purchase') THEN
  IF p_payload->>'fund' IS NULL OR p_payload->>'fund' NOT IN('level','arena','blessing','adventure','artifact','dark_energy') THEN RAISE EXCEPTION 'progression_fund_invalid'; END IF;
  INSERT INTO territory_private.v1_fund_progress(player_id,fund) VALUES(p_player,p_payload->>'fund') ON CONFLICT DO NOTHING;
  IF p_kind='fund_purchase' THEN
   -- The caller is a trusted payment transaction, never a browser assertion.
   UPDATE territory_private.v1_fund_progress SET premium=true,purchase_event=coalesce(purchase_event,p_event) WHERE player_id=p_player AND fund=p_payload->>'fund';
  ELSE
   IF NOT COALESCE((p_payload->>'value') ~ '^[0-9]{1,9}$',false) THEN RAISE EXCEPTION 'progression_fund_invalid'; END IF;
   UPDATE territory_private.v1_fund_progress SET progress=greatest(progress,(p_payload->>'value')::bigint) WHERE player_id=p_player AND fund=p_payload->>'fund';
  END IF;
 ELSIF p_kind='gem_grant' THEN
  IF NOT COALESCE((p_payload->>'quantity') ~ '^[1-9][0-9]{0,8}$',false) OR NOT COALESCE((p_payload->>'level') ~ '^[1-9][0-9]{0,8}$',false) THEN RAISE EXCEPTION 'progression_gem_invalid'; END IF;
  INSERT INTO territory_private.v1_gem_inventory VALUES(p_player,p_payload->>'kind',(p_payload->>'level')::int,(p_payload->>'quantity')::bigint)
  ON CONFLICT(player_id,gem_kind,gem_level) DO UPDATE SET quantity=territory_private.v1_gem_inventory.quantity+excluded.quantity;
 ELSIF p_kind='blessing_battle' THEN
  IF p_payload->>'mode' IS DISTINCT FROM 'campaign' THEN RAISE EXCEPTION 'progression_blessing_campaign_only'; END IF;
  SELECT * INTO b FROM territory_private.v1_blessing WHERE player_id=p_player;
  IF NOT FOUND THEN RAISE EXCEPTION 'progression_legacy_import_required'; END IF;
  SELECT * INTO br FROM territory_private.v1_blessing_rules WHERE level=b.level;
  result:=jsonb_build_object('gold_bonus_bp',CASE WHEN b.charges>0 THEN br.gold_bonus_bp ELSE 0 END);
  UPDATE territory_private.v1_blessing SET charges=greatest(charges-1,0),xp=xp+coalesce(br.battle_xp,0) WHERE player_id=p_player;
  SELECT * INTO br FROM territory_private.v1_blessing_rules WHERE required_xp<=b.xp+coalesce(br.battle_xp,0) AND level>=b.level ORDER BY level DESC LIMIT 1;
  UPDATE territory_private.v1_blessing SET level=br.level WHERE player_id=p_player;
 ELSE RAISE EXCEPTION 'progression_event_invalid'; END IF;
 INSERT INTO territory_private.v1_progression_events VALUES(p_event,p_player,p_kind,p_payload,result,clock_timestamp());
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION territory_private.v1_progression_event(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.v1_progression_event(uuid,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_progression_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
 week date; points integer; weekly integer; b jsonb; activities jsonb; funds jsonb; gems jsonb; sockets jsonb; rewards jsonb; claims jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'progression_login_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND banned IS NOT TRUE) THEN RAISE EXCEPTION 'progression_player_unavailable'; END IF;
 week:=today-(extract(isodow FROM today)::int-1);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.activity,'slot',a.slot,'target',a.target,'current',coalesce(c.quantity,0)) ORDER BY a.slot),'[]') INTO activities
 FROM territory_private.v1_activity_rules a LEFT JOIN territory_private.v1_activity_counts c ON c.activity=a.activity AND c.player_id=u AND c.day=today;
 SELECT (count(*)*20)::int INTO points FROM territory_private.v1_activity_counts c JOIN territory_private.v1_activity_rules a USING(activity) WHERE c.player_id=u AND c.day=today AND c.quantity>=a.target;
 SELECT (count(*)*20)::int INTO weekly FROM territory_private.v1_activity_counts c JOIN territory_private.v1_activity_rules a USING(activity) WHERE c.player_id=u AND c.day BETWEEN week AND today AND c.quantity>=a.target;
 SELECT to_jsonb(s)-'player_id'-'legacy_snapshot' INTO b FROM territory_private.v1_blessing s WHERE player_id=u;
 SELECT coalesce(jsonb_agg(to_jsonb(f)-'player_id'),'[]') INTO funds FROM territory_private.v1_fund_progress f WHERE player_id=u;
 SELECT coalesce(jsonb_agg(to_jsonb(g)-'player_id'),'[]') INTO gems FROM territory_private.v1_gem_inventory g WHERE player_id=u AND quantity>0;
 SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO sockets FROM territory_private.v1_gem_sockets_v1 s JOIN (SELECT 'stage3'::text source,item_id,player_id FROM public.territory_crafted_items_v1 UNION ALL SELECT 'stage8'::text,item_id,player_id FROM public.territory_profession_stage8_items) c USING(source,item_id) WHERE c.player_id=u;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO rewards FROM territory_private.v1_reward_rules r;
 SELECT coalesce(jsonb_agg(to_jsonb(c)-'player_id'),'[]') INTO claims FROM territory_private.v1_progression_claims c WHERE c.player_id=u;
 RETURN jsonb_build_object('enabled',coalesce((SELECT enabled FROM territory_private.v1_progression_config WHERE id=1),false),'day',today,'week',week,
  'dailyPoints',points,'weeklyPoints',weekly,'activities',activities,'blessing',b,'legacyImportRequired',b IS NULL,
  'nextBlessingAt',CASE WHEN b IS NOT NULL AND coalesce(b->>'last_claim_utc_day','')<today::text AND coalesce(b->>'day','')<>today::text THEN clock_timestamp() ELSE ((today+1)::timestamp AT TIME ZONE 'UTC') END,
  'gemRules',(SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM territory_private.v1_gem_rules g),
  'socketRules',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM territory_private.v1_socket_rules s),
  'blessingRules',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM territory_private.v1_blessing_rules r),
  'funds',funds,'gems',gems,'sockets',sockets,'rewards',rewards,'claims',claims);
END $$;
REVOKE ALL ON FUNCTION public.territory_progression_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_progression_status_v1() TO authenticated;

-- Matches the existing admin-mail payload contract; malformed configured values
-- never create poison mail or turn negative rewards into a debit.
CREATE OR REPLACE FUNCTION territory_private.v1_reward_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; v jsonb; item text; quantity jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p='{}'::jsonb THEN RETURN false; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p) LOOP
  IF k IN('gold','gems','redGems','stones','forgeMaterials') THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]{1,10}$' OR v::text::numeric>2147483647 THEN RETURN false; END IF;
  ELSIF k='items' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
   FOR item,quantity IN SELECT * FROM jsonb_each(v) LOOP
    IF item NOT IN('shop_potion_hp','shop_potion_hp_large','shop_elixir_atk','shop_elixir_def','shop_elixir_crit','shop_arena_time','shop_arena_adrenaline')
     OR jsonb_typeof(quantity) IS DISTINCT FROM 'number' OR quantity::text !~ '^[1-9][0-9]{0,8}$' THEN RETURN false; END IF;
   END LOOP;
  ELSE RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION territory_private.v1_reward_valid(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_progression_action_v1(p_action text,p_operation uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); saved territory_private.v1_progression_receipts%ROWTYPE;
 r territory_private.v1_reward_rules%ROWTYPE; b territory_private.v1_blessing%ROWTYPE;
 today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date; v_period_key text; points bigint; premium boolean;
 item uuid; socket integer; kind text; lev integer; nextlev integer; qty bigint; n bigint; maxsocket integer; v_rarity text; v_source text; v_output jsonb;
 s territory_private.v1_gem_sockets_v1%ROWTYPE; grant_id uuid; result jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'progression_login_required'; END IF;
 IF p_operation IS NULL OR p_action IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'progression_request_invalid'; END IF;
 PERFORM 1 FROM public.players WHERE id=u AND banned IS NOT TRUE FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'progression_player_unavailable'; END IF;
 SELECT * INTO saved FROM territory_private.v1_progression_receipts WHERE player_id=u AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.action IS DISTINCT FROM p_action OR saved.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'progression_operation_reused'; END IF;
  RETURN saved.result;
 END IF;
 IF NOT COALESCE((SELECT enabled FROM territory_private.v1_progression_config WHERE id=1),false) THEN RAISE EXCEPTION 'progression_disabled'; END IF;
 IF p_action='claim_reward' THEN
  SELECT * INTO r FROM territory_private.v1_reward_rules WHERE id=p_payload->>'ruleId';
  IF NOT FOUND THEN RAISE EXCEPTION 'progression_reward_config_missing'; END IF;
  IF r.period<>'fund' AND (SELECT count(*) FROM territory_private.v1_activity_rules)<>5 THEN RAISE EXCEPTION 'progression_activity_config_missing'; END IF;
  IF r.period='fund' THEN
   SELECT progress,f.premium INTO points,premium FROM territory_private.v1_fund_progress f WHERE player_id=u AND fund=r.fund;
   v_period_key:='lifetime';
   IF r.track='premium' AND premium IS DISTINCT FROM true THEN RAISE EXCEPTION 'progression_fund_purchase_required'; END IF;
  ELSE
   SELECT count(*)*20 INTO points FROM territory_private.v1_activity_counts c JOIN territory_private.v1_activity_rules a USING(activity)
    WHERE c.player_id=u AND c.quantity>=a.target AND c.day BETWEEN CASE WHEN r.period='daily' THEN today ELSE today-(extract(isodow FROM today)::int-1) END AND today;
   v_period_key:=CASE WHEN r.period='daily' THEN today ELSE today-(extract(isodow FROM today)::int-1) END::text;
  END IF;
  IF coalesce(points,0)<r.threshold THEN RAISE EXCEPTION 'progression_reward_not_reached'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.v1_progression_claims c WHERE player_id=u AND c.rule_id=r.id AND c.period_key=v_period_key) THEN RAISE EXCEPTION 'progression_reward_already_claimed'; END IF;
  IF NOT territory_private.v1_reward_valid(r.reward) THEN RAISE EXCEPTION 'progression_reward_config_invalid'; END IF;
  INSERT INTO public.admin_grants(player_id,kind,subject,body,payload) VALUES(u,'mail','TERRITORY · Награда за прогресс','Награда за подтверждённые сервером достижения.',r.reward) RETURNING id INTO grant_id;
  INSERT INTO territory_private.v1_progression_claims VALUES(u,r.id,v_period_key,grant_id);
 ELSIF p_action='claim_blessing' THEN
  SELECT * INTO b FROM territory_private.v1_blessing WHERE player_id=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'progression_legacy_import_required'; END IF;
  IF b.last_claim_utc_day>=today OR b.day=today::text OR b.day=to_char(today,'Dy Mon DD YYYY') THEN RAISE EXCEPTION 'progression_blessing_already_claimed'; END IF;
  UPDATE territory_private.v1_blessing SET day=today::text,last_claim_utc_day=today,charges=(SELECT charges FROM territory_private.v1_blessing_rules WHERE level=b.level) WHERE player_id=u;
 ELSIF p_action IN('insert_gem','remove_gem') THEN
  item:=(p_payload->>'itemId')::uuid; socket:=(p_payload->>'socket')::integer; v_source:=p_payload->>'source';
  IF v_source IS NULL OR v_source NOT IN('stage3','stage8') THEN RAISE EXCEPTION 'progression_item_source_invalid'; END IF;
  IF item IS NULL OR socket IS NULL THEN RAISE EXCEPTION 'progression_socket_invalid'; END IF;
  -- Canonical gear is locked; transferred item keeps its sockets and provenance.
  IF v_source='stage3' THEN
   SELECT item_output INTO v_output FROM public.territory_crafted_items_v1 WHERE item_id=item AND player_id=u AND auction_escrow IS NULL FOR UPDATE;
  ELSE
   SELECT item_output INTO v_output FROM public.territory_profession_stage8_items WHERE item_id=item AND player_id=u AND auction_escrow IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR UPDATE;
  END IF;
  IF v_output IS NULL THEN RAISE EXCEPTION 'progression_item_not_owned'; END IF;
  IF coalesce(v_output#>>'{equipment,slot}',v_output->>'slot','') NOT IN('helmet','amulet','armor','weapon','shield','ring','boots') THEN RAISE EXCEPTION 'progression_equipment_required'; END IF;
  v_rarity:=coalesce(v_output#>>'{equipment,rarity}',v_output->>'rarity');
  IF p_action='insert_gem' THEN
   SELECT sockets INTO maxsocket FROM territory_private.v1_socket_rules WHERE v1_socket_rules.rarity=v_rarity;
   IF maxsocket IS NULL THEN RAISE EXCEPTION 'progression_socket_config_missing'; END IF;
   IF socket<1 OR socket>maxsocket THEN RAISE EXCEPTION 'progression_socket_invalid'; END IF;
   kind:=p_payload->>'kind';lev:=(p_payload->>'level')::int;
   IF EXISTS(SELECT 1 FROM territory_private.v1_gem_sockets_v1 WHERE source=v_source AND item_id=item AND socket_index=socket) THEN RAISE EXCEPTION 'progression_socket_occupied'; END IF;
   UPDATE territory_private.v1_gem_inventory SET quantity=quantity-1 WHERE player_id=u AND gem_kind=kind AND gem_level=lev AND quantity>=1;
   IF NOT FOUND THEN RAISE EXCEPTION 'progression_gem_unavailable'; END IF;
   INSERT INTO territory_private.v1_gem_sockets_v1 VALUES(v_source,item,socket,kind,lev);
  ELSE
   DELETE FROM territory_private.v1_gem_sockets_v1 WHERE source=v_source AND item_id=item AND socket_index=socket RETURNING * INTO s;
   IF NOT FOUND THEN RAISE EXCEPTION 'progression_socket_empty'; END IF;
   INSERT INTO territory_private.v1_gem_inventory VALUES(u,s.gem_kind,s.gem_level,1) ON CONFLICT(player_id,gem_kind,gem_level) DO UPDATE SET quantity=territory_private.v1_gem_inventory.quantity+1;
  END IF;
 ELSIF p_action IN('synthesize_gem','quick_synthesize_gem') THEN
  kind:=p_payload->>'kind';lev:=(p_payload->>'level')::int;
  SELECT next_level INTO nextlev FROM territory_private.v1_gem_rules WHERE gem_kind=kind AND level=lev;
  IF nextlev IS NULL OR NOT EXISTS(SELECT 1 FROM territory_private.v1_gem_rules WHERE gem_kind=kind AND level=nextlev) THEN RAISE EXCEPTION 'progression_gem_upgrade_config_missing'; END IF;
  SELECT quantity INTO qty FROM territory_private.v1_gem_inventory WHERE player_id=u AND gem_kind=kind AND gem_level=lev;
  n:=CASE WHEN p_action='quick_synthesize_gem' THEN coalesce(qty,0)/3 ELSE 1 END;
  IF n<1 OR coalesce(qty,0)<n*3 THEN RAISE EXCEPTION 'progression_gems_insufficient'; END IF;
  UPDATE territory_private.v1_gem_inventory SET quantity=quantity-3*n WHERE player_id=u AND gem_kind=kind AND gem_level=lev;
  INSERT INTO territory_private.v1_gem_inventory VALUES(u,kind,nextlev,n) ON CONFLICT(player_id,gem_kind,gem_level) DO UPDATE SET quantity=territory_private.v1_gem_inventory.quantity+excluded.quantity;
 ELSE RAISE EXCEPTION 'progression_action_invalid'; END IF;
 result:=jsonb_build_object('operationId',p_operation,'action',p_action,'grantId',grant_id,'status',public.territory_progression_status_v1());
 INSERT INTO territory_private.v1_progression_receipts VALUES(u,p_operation,p_action,p_payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.territory_progression_action_v1(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_progression_action_v1(text,uuid,jsonb) TO authenticated;

-- Canonical source is derived from ownership for server-selected equipped IDs.
-- Ambiguous source IDs and escrow/expiry fail closed instead of using a save copy.
CREATE OR REPLACE FUNCTION territory_private.v1_gem_item_stats(p_player uuid,p_item uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sources integer; source_kind text; result jsonb;
BEGIN
 SELECT count(*),min(source) INTO sources,source_kind FROM (
  SELECT 'stage3'::text source FROM public.territory_crafted_items_v1 WHERE item_id=p_item AND player_id=p_player AND auction_escrow IS NULL
   AND coalesce(item_output#>>'{equipment,slot}',item_output->>'slot','') IN('helmet','amulet','armor','weapon','shield','ring','boots')
  UNION ALL SELECT 'stage8'::text FROM public.territory_profession_stage8_items WHERE item_id=p_item AND player_id=p_player AND auction_escrow IS NULL AND (expires_at IS NULL OR expires_at>now())
   AND coalesce(item_output#>>'{equipment,slot}',item_output->>'slot','') IN('helmet','amulet','armor','weapon','shield','ring','boots')
 ) owned;
 IF sources<>1 THEN RAISE EXCEPTION 'progression_equipped_item_unverified'; END IF;
 SELECT jsonb_build_object('attack',coalesce(sum(r.attack),0),'defense',coalesce(sum(r.defense),0),'hp',coalesce(sum(r.hp),0)) INTO result
 FROM territory_private.v1_gem_sockets_v1 s JOIN territory_private.v1_gem_rules r ON r.gem_kind=s.gem_kind AND r.level=s.gem_level
 WHERE s.item_id=p_item AND s.source=source_kind;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION territory_private.v1_gem_item_stats(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.v1_gem_item_stats(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION territory_private.v1_gem_equipped_stats(p_player uuid,p_stats jsonb,p_equipped uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item uuid; bonus jsonb; atk bigint:=0; def bigint:=0; hpbonus bigint:=0;
 basehp bigint; basemax bigint; baseatk bigint; basedef bigint; k text;
BEGIN
 IF p_equipped IS NULL OR cardinality(p_equipped)>7 OR cardinality(p_equipped)<>(SELECT count(DISTINCT id) FROM unnest(p_equipped) id) THEN RAISE EXCEPTION 'progression_equipped_invalid'; END IF;
 IF jsonb_typeof(p_stats) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'progression_stats_invalid'; END IF;
 FOREACH k IN ARRAY ARRAY['attack','defense','hp','maxHp'] LOOP
  IF NOT coalesce((p_stats->>k) ~ '^[0-9]{1,10}$',false) OR (p_stats->>k)::numeric>2147483647 THEN RAISE EXCEPTION 'progression_stats_invalid'; END IF;
 END LOOP;
 basehp:=(p_stats->>'hp')::bigint; basemax:=(p_stats->>'maxHp')::bigint; baseatk:=(p_stats->>'attack')::bigint; basedef:=(p_stats->>'defense')::bigint;
 IF basemax<1 OR basehp>basemax THEN RAISE EXCEPTION 'progression_stats_invalid'; END IF;
 FOREACH item IN ARRAY p_equipped LOOP
  bonus:=territory_private.v1_gem_item_stats(p_player,item);
  atk:=atk+(bonus->>'attack')::bigint;def:=def+(bonus->>'defense')::bigint;hpbonus:=hpbonus+(bonus->>'hp')::bigint;
 END LOOP;
 IF cardinality(p_equipped)<>(SELECT count(DISTINCT slot) FROM (
  SELECT coalesce(item_output#>>'{equipment,slot}',item_output->>'slot') slot FROM public.territory_crafted_items_v1 WHERE player_id=p_player AND item_id=ANY(p_equipped)
  UNION ALL SELECT coalesce(item_output#>>'{equipment,slot}',item_output->>'slot') FROM public.territory_profession_stage8_items WHERE player_id=p_player AND item_id=ANY(p_equipped)
 ) gear) THEN RAISE EXCEPTION 'progression_equipped_duplicate_slot'; END IF;
 IF baseatk+atk>2147483647 OR basedef+def>2147483647 OR basemax+hpbonus>2147483647 THEN RAISE EXCEPTION 'progression_stats_overflow'; END IF;
 RETURN p_stats||jsonb_build_object('attack',baseatk+atk,'defense',basedef+def,'maxHp',basemax+hpbonus,'hp',floor(basehp::numeric*(basemax+hpbonus)/basemax));
END $$;
REVOKE ALL ON FUNCTION territory_private.v1_gem_equipped_stats(uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.v1_gem_equipped_stats(uuid,jsonb,uuid[]) TO service_role;
COMMIT;
