-- STAGING ONLY: depends on territory_v1_combat_completion.sql. No player data is
-- modified by installation. No reward configuration is seeded or enabled.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.adventure_rewards_v1 (
  stage integer PRIMARY KEY CHECK(stage BETWEEN 1 AND 100),
  encounter_id text NOT NULL UNIQUE REFERENCES territory_private.combat_encounters_v1(encounter_id),
  enabled boolean NOT NULL DEFAULT false,
  gold integer NOT NULL CHECK(gold >= 0),
  xp integer NOT NULL CHECK(xp >= 0),
  -- Items are intentionally blocked until an approved, server-owned item grant
  -- contract is integrated. An empty array means that no item is awarded.
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(items)='array'),
  approval_reference text NOT NULL CHECK(length(trim(approval_reference))>0)
);
CREATE TABLE IF NOT EXISTS territory_private.adventure_progress_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id),
  unlocked_stage integer NOT NULL DEFAULT 1 CHECK(unlocked_stage BETWEEN 1 AND 100),
  completed_stage integer NOT NULL DEFAULT 0 CHECK(completed_stage BETWEEN 0 AND 100),
  CHECK(unlocked_stage = least(100,completed_stage+1))
);
CREATE TABLE IF NOT EXISTS territory_private.adventure_settlements_v1 (
  session_id uuid PRIMARY KEY REFERENCES territory_private.combat_sessions_v1(session_id),
  player_id uuid NOT NULL REFERENCES public.players(id),
  stage integer NOT NULL CHECK(stage BETWEEN 1 AND 100),
  outcome text NOT NULL CHECK(outcome IN ('hero_won','enemy_won','draw')),
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.adventure_rewards_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.adventure_progress_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.adventure_settlements_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.adventure_rewards_v1,territory_private.adventure_progress_v1,
 territory_private.adventure_settlements_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON territory_private.adventure_rewards_v1,
 territory_private.adventure_progress_v1,territory_private.adventure_settlements_v1 TO service_role;

-- Must be called from start commit under the existing account lock. Both direct
-- Edge start and any route use this check; the caller cannot bypass stage order.
CREATE OR REPLACE FUNCTION territory_private.adventure_check_start_v1(p_player uuid,p_encounter text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r territory_private.adventure_rewards_v1%ROWTYPE; e territory_private.combat_encounters_v1%ROWTYPE;
  unlocked integer; completed integer;
BEGIN
 SELECT * INTO r FROM territory_private.adventure_rewards_v1 WHERE encounter_id=p_encounter AND enabled FOR SHARE;
 IF NOT FOUND OR r.items <> '[]'::jsonb THEN RAISE EXCEPTION 'adventure_reward_not_ready'; END IF;
 SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=p_encounter AND enabled FOR SHARE;
 IF NOT FOUND OR e.stage<>r.stage OR e.mode<>(CASE WHEN r.stage%10=0 THEN 'boss' ELSE 'pve' END)
   THEN RAISE EXCEPTION 'adventure_encounter_invalid'; END IF;
 SELECT unlocked_stage,completed_stage INTO unlocked,completed FROM territory_private.adventure_progress_v1 WHERE player_id=p_player;
 IF r.stage<>coalesce(unlocked,1) OR coalesce(completed,0)>=r.stage THEN RAISE EXCEPTION 'adventure_stage_locked'; END IF;
END $$;

-- Called only by the server combat commit, after storing a terminal state in the
-- same transaction. Session id is the durable idempotency key. The player row is
-- the existing wallet/save and is locked before reading or updating balances.
CREATE OR REPLACE FUNCTION territory_private.adventure_settle_v1(p_player uuid,p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s territory_private.combat_sessions_v1%ROWTYPE; e territory_private.combat_encounters_v1%ROWTYPE;
 r territory_private.adventure_rewards_v1%ROWTYPE; p public.players%ROWTYPE;
 existing territory_private.adventure_settlements_v1%ROWTYPE;
 st jsonb; stats jsonb; followers jsonb; receipt jsonb; outcome text;
 lv integer; v_max_energy integer; balance bigint; threshold bigint;
BEGIN
 SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
 IF NOT FOUND OR coalesce(p.banned,false) THEN RAISE EXCEPTION 'adventure_account_unavailable'; END IF;
 SELECT * INTO s FROM territory_private.combat_sessions_v1 WHERE session_id=p_session AND player_id=p_player FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'adventure_session_missing'; END IF;
 SELECT * INTO existing FROM territory_private.adventure_settlements_v1 WHERE session_id=p_session;
 IF FOUND THEN RETURN existing.receipt; END IF;
 outcome:=s.state->>'status';
 IF outcome NOT IN ('hero_won','enemy_won','draw') OR outcome IS NULL THEN RAISE EXCEPTION 'adventure_not_finished'; END IF;
 SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=s.encounter_id FOR SHARE;
 SELECT * INTO r FROM territory_private.adventure_rewards_v1 WHERE encounter_id=s.encounter_id AND enabled FOR SHARE;
 IF NOT FOUND OR r.items <> '[]'::jsonb OR e.stage<>r.stage OR e.mode<>(CASE WHEN r.stage%10=0 THEN 'boss' ELSE 'pve' END)
   THEN RAISE EXCEPTION 'adventure_reward_not_ready'; END IF;
 INSERT INTO territory_private.adventure_progress_v1(player_id) VALUES(p_player) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM territory_private.adventure_progress_v1 WHERE player_id=p_player AND r.stage=unlocked_stage AND completed_stage<r.stage FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'adventure_stage_locked'; END IF;
 IF outcome='hero_won' THEN
   st:=p.game_state; stats:=st#>'{player,stats}';
   IF jsonb_typeof(st->'player') IS DISTINCT FROM 'object' OR jsonb_typeof(stats) IS DISTINCT FROM 'object'
     OR (st#>>'{player,gold}')::bigint IS DISTINCT FROM p.gold::bigint
     OR (st#>>'{player,xp}')::bigint IS DISTINCT FROM p.xp::bigint
     OR (st#>>'{player,level}')::int IS DISTINCT FROM p.level
     OR (st#>>'{player,maxEnergy}')::int IS DISTINCT FROM p.max_energy
     OR p.level NOT BETWEEN 1 AND 100 OR p.xp<0 OR p.gold<0
     OR coalesce((stats->>'maxHp')::int,0) <=0 OR coalesce((stats->>'attack')::int,-1)<0 OR coalesce((stats->>'defense')::int,-1)<0
     OR (st#>>'{player,xpToNext}')::bigint IS DISTINCT FROM (CASE WHEN p.level>=100 THEN 0 ELSE floor(floor(100*power(1.15::double precision,p.level-1))*(CASE WHEN p.level>=83 THEN 3::double precision+0.12::double precision*(p.level-83) ELSE 1 END))::bigint END)
     THEN RAISE EXCEPTION 'adventure_save_needs_reconciliation'; END IF;
   IF p.gold::bigint+r.gold>2147483647 THEN RAISE EXCEPTION 'adventure_wallet_limit'; END IF;
   lv:=p.level; v_max_energy:=p.max_energy; balance:=p.xp::bigint+r.xp;
   WHILE lv<100 LOOP
     threshold:=coalesce((st#>>'{player,xpToNext}')::bigint,0);
     IF threshold<=0 THEN threshold:=floor(floor(100*power(1.15::double precision,lv-1))*(CASE WHEN lv>=83 THEN 3::double precision+0.12::double precision*(lv-83) ELSE 1 END))::bigint; END IF;
     EXIT WHEN balance<threshold;
     balance:=balance-threshold; lv:=lv+1;
     threshold:=CASE WHEN lv>=100 THEN 0 ELSE floor(floor(100*power(1.15::double precision,lv-1))*(CASE WHEN lv>=83 THEN 3::double precision+0.12::double precision*(lv-83) ELSE 1 END))::bigint END;
     st:=jsonb_set(st,'{player,xpToNext}',to_jsonb(threshold));
     stats:=jsonb_set(stats,'{maxHp}',to_jsonb((stats->>'maxHp')::int+20));
     stats:=jsonb_set(stats,'{hp}',stats->'maxHp');
     stats:=jsonb_set(stats,'{attack}',to_jsonb((stats->>'attack')::int+5));
     stats:=jsonb_set(stats,'{defense}',to_jsonb((stats->>'defense')::int+2));
     v_max_energy:=v_max_energy+1;
   END LOOP;
   IF lv>=100 THEN balance:=0; st:=jsonb_set(st,'{player,xpToNext}','0'::jsonb); END IF;
   IF balance>2147483647 THEN RAISE EXCEPTION 'adventure_xp_limit'; END IF;
   st:=jsonb_set(st,'{player,gold}',to_jsonb(p.gold+r.gold));
   st:=jsonb_set(st,'{player,xp}',to_jsonb(balance));
   st:=jsonb_set(st,'{player,level}',to_jsonb(lv));
   st:=jsonb_set(st,'{player,maxEnergy}',to_jsonb(v_max_energy));
   st:=jsonb_set(st,'{player,stats}',stats);
   IF lv>p.level AND jsonb_typeof(st->'followers')='array' THEN
     SELECT coalesce(jsonb_agg(CASE WHEN (f.value->>'id') IN ('follower_1','follower_2','follower_3','follower_4','follower_5')
       AND lv >= (CASE f.value->>'id' WHEN 'follower_1' THEN 3 WHEN 'follower_2' THEN 8 WHEN 'follower_3' THEN 15 WHEN 'follower_4' THEN 25 ELSE 40 END)
       THEN jsonb_set(f.value,'{unlocked}','true'::jsonb) ELSE f.value END ORDER BY f.ordinality),'[]'::jsonb) INTO followers
       FROM jsonb_array_elements(st->'followers') WITH ORDINALITY f(value,ordinality);
     st:=jsonb_set(st,'{followers}',followers);
   END IF;
   UPDATE public.players SET game_state=st,gold=p.gold+r.gold,xp=balance::integer,level=lv,max_energy=v_max_energy
     WHERE id=p_player RETURNING * INTO p;
   UPDATE territory_private.adventure_progress_v1 SET completed_stage=greatest(completed_stage,r.stage),
     unlocked_stage=least(100,greatest(completed_stage,r.stage)+1) WHERE player_id=p_player;
 END IF;
 SELECT jsonb_build_object('success',true,'session_id',p_session,'outcome',outcome,'stage',r.stage,
   'reward',jsonb_build_object('gold',CASE WHEN outcome='hero_won' THEN r.gold ELSE 0 END,
     'xp',CASE WHEN outcome='hero_won' THEN r.xp ELSE 0 END,'items','[]'::jsonb),
   'completed_stage',completed_stage,'unlocked_stage',unlocked_stage,
   'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems,'game_state',p.game_state)
   INTO receipt FROM territory_private.adventure_progress_v1 WHERE player_id=p_player;
 INSERT INTO territory_private.adventure_settlements_v1(session_id,player_id,stage,outcome,receipt)
   VALUES(p_session,p_player,r.stage,outcome,receipt);
 RETURN receipt;
END $$;
-- Read only: derive the account from the JWT, never accept a player id.
CREATE OR REPLACE FUNCTION public.territory_adventure_progress_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); completed integer; unlocked integer;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
   THEN RAISE EXCEPTION 'adventure_account_unavailable'; END IF;
 SELECT completed_stage,unlocked_stage INTO completed,unlocked
   FROM territory_private.adventure_progress_v1 WHERE player_id=u;
 RETURN jsonb_build_object('completed_stage',coalesce(completed,0),'unlocked_stage',coalesce(unlocked,1));
END $$;
REVOKE ALL ON FUNCTION public.territory_adventure_progress_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_adventure_progress_v1() TO authenticated;
REVOKE ALL ON FUNCTION territory_private.adventure_check_start_v1(uuid,text),
 territory_private.adventure_settle_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.adventure_check_start_v1(uuid,text),
 territory_private.adventure_settle_v1(uuid,uuid) TO service_role;
COMMIT;
