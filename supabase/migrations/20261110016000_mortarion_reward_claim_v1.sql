-- Mortarion raid one-time post-event reward claim. Explicit owner approval 10 Nov.
-- Entire raid participation ledger is server-owned, including tester bots.
-- A player sees one evolving chest; no payout is made before the event ends.
-- The existing 5-hits/hour, 60-second cooldown, HP and TOP-10 stay unchanged.
BEGIN;
SET LOCAL lock_timeout='4s';

CREATE OR REPLACE FUNCTION territory_private.mortarion_reward_add_item_v1(
  p_inventory jsonb, p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_id text:=p_item->>'id'; v_idx integer; v_qty integer; v_old_qty integer;
BEGIN
 IF pg_catalog.jsonb_typeof(p_inventory) IS DISTINCT FROM 'array'
  OR v_id IS NULL OR pg_catalog.jsonb_typeof(p_item->'qty') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'mortarion_reward_bad_inventory'; END IF;
 v_qty:=(p_item->>'qty')::integer;
 IF v_qty<1 OR v_qty>20 THEN RAISE EXCEPTION 'mortarion_reward_bad_quantity'; END IF;
 SELECT (ordinality-1)::integer INTO v_idx
 FROM pg_catalog.jsonb_array_elements(p_inventory) WITH ORDINALITY
 WHERE value->>'id'=v_id LIMIT 1;
 IF v_idx IS NULL THEN
   RETURN p_inventory || pg_catalog.jsonb_build_array(p_item);
 END IF;
 v_old_qty:=COALESCE((p_inventory->v_idx->>'qty')::integer,0);
 IF v_old_qty>2147483647-v_qty THEN RAISE EXCEPTION 'mortarion_reward_item_overflow'; END IF;
 RETURN pg_catalog.jsonb_set(p_inventory,ARRAY[v_idx::text,'qty'],pg_catalog.to_jsonb(v_old_qty+v_qty));
END; $fn$;
REVOKE ALL ON FUNCTION territory_private.mortarion_reward_add_item_v1(jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.territory_mortarion_reward_claim_v1(p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_uid uuid:=auth.uid();
 v_now timestamptz:=pg_catalog.clock_timestamp();
 v_event public.territory_mortarion_2026%ROWTYPE;
 v_part public.territory_mortarion_2026_players%ROWTYPE;
 v_player public.players%ROWTYPE;
 v_old territory_private.mortarion_reward_receipts_v1%ROWTYPE;
 v_rank integer:=NULL; v_days integer:=0; v_needed integer:=5;
 v_tier text:='participant';
 v_gold integer:=100; v_gems integer:=2; v_mats integer:=2; v_elix integer:=1;
 v_heart boolean:=false; v_stone boolean:=false;
 v_ingredient boolean:=false; v_fragment boolean:=false;
 v_part_no integer; v_blueprint text; v_item_id text;
 v_title text:=NULL; v_frame text:=NULL; v_medal text:=NULL;
 v_inventory jsonb; v_state jsonb; v_hero jsonb; v_receipt jsonb;
 v_drops jsonb:='[]'::jsonb;
 v_new jsonb; v_total_gold integer; v_total_gems integer;
 v_materials integer; v_current_days jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'mortarion_auth_required'; END IF;
 -- Global row first: same lock ordering as the original raid's hit function.
 SELECT * INTO v_event FROM public.territory_mortarion_2026
  WHERE id='mortarion_2026' FOR SHARE;
 IF NOT FOUND OR NOT v_event.enabled THEN RAISE EXCEPTION 'mortarion_rewards_unavailable'; END IF;
 v_now:=pg_catalog.clock_timestamp();
 IF v_event.hp>0 AND v_now<v_event.ends_at
 THEN RAISE EXCEPTION 'mortarion_rewards_not_final'; END IF;

 SELECT * INTO v_player FROM public.players WHERE id=v_uid AND NOT COALESCE(banned,false)
  FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_player_unavailable'; END IF;

 -- Read first: if the response was lost, replay the exact original receipt.
 SELECT * INTO v_old FROM territory_private.mortarion_reward_receipts_v1
  WHERE event_id=v_event.id AND player_id=v_uid FOR UPDATE;
 IF FOUND THEN
   RETURN pg_catalog.jsonb_build_object(
     'success',true,'already_claimed',true,'receipt',v_old.receipt,
     'updated_at',v_player.updated_at,
     'wallet_gold',v_player.gold,'wallet_gems',v_player.gems,
     'game_state',v_player.game_state);
 END IF;

 -- Never overwrite a concurrent player save with a stale wallet or inventory.
 IF p_expected IS NULL OR v_player.updated_at IS DISTINCT FROM p_expected
 THEN RAISE EXCEPTION 'mortarion_rewards_reload_required'; END IF;
 SELECT * INTO v_part FROM public.territory_mortarion_2026_players
 WHERE event_id=v_event.id AND player_id=v_uid AND total_hits>0;
 IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_rewards_not_participant'; END IF;

 v_state:=v_player.game_state;
 v_hero:=v_state->'player';
 v_inventory:=v_state->'inventory';
 IF pg_catalog.jsonb_typeof(v_state) IS DISTINCT FROM 'object'
 OR pg_catalog.jsonb_typeof(v_hero) IS DISTINCT FROM 'object'
 OR pg_catalog.jsonb_typeof(v_inventory) IS DISTINCT FROM 'array'
 OR (v_hero->>'gold')::integer IS DISTINCT FROM v_player.gold
 OR (v_hero->>'gems')::integer IS DISTINCT FROM v_player.gems
 OR (v_state->>'forgeMaterials')::integer IS DISTINCT FROM v_player.forge_materials
 THEN RAISE EXCEPTION 'mortarion_rewards_invalid_save'; END IF;

 v_days:=pg_catalog.cardinality(v_part.hit_days);
 v_current_days:=pg_catalog.to_jsonb(v_part.hit_days);
 -- If everybody killed the boss early, count only the event's lived 24h
 -- windows. Otherwise finishing all five days remains necessary for Legendary.
 IF v_event.hp=0 THEN
   v_needed:=pg_catalog.greatest(1,pg_catalog.least(5,
     pg_catalog.ceil(pg_catalog.date_part('epoch',v_event.updated_at-v_event.starts_at)/86400)::integer));
 END IF;

 IF v_days>=v_needed AND v_part.total_hits>=15 THEN
   v_tier:='legendary';
 ELSIF v_days>=pg_catalog.least(3,v_needed) THEN
   v_tier:='hunter';
 END IF;

 -- Real player accounts and the owner's ten testers share one unbiased rank.
 -- No exclusion based on test-bot identity; top 10 is the existing server order.
 SELECT z.rank INTO v_rank FROM (
   SELECT s.player_id,pg_catalog.row_number() OVER(
       ORDER BY s.total_damage DESC,s.last_hit_at ASC NULLS LAST,s.player_id
     )::integer AS rank
   FROM public.territory_mortarion_2026_players s
   JOIN public.players p ON p.id=s.player_id
   WHERE s.event_id=v_event.id AND s.total_damage>0 AND NOT COALESCE(p.banned,false)
 ) z WHERE z.player_id=v_uid;
 IF v_rank IS NULL OR v_rank>10 THEN v_rank:=NULL; END IF;

 IF v_rank=1 THEN
   v_tier:='legendary';
 ELSIF v_rank BETWEEN 2 AND 3 AND v_tier='participant' THEN
   v_tier:='hunter';
 END IF;

 IF v_tier='hunter' THEN
   v_gold:=300;v_gems:=6;v_mats:=6;v_elix:=3;
 ELSIF v_tier='legendary' THEN
   v_gold:=800;v_gems:=14;v_mats:=12;v_elix:=5;
 END IF;

 IF v_rank=1 THEN
   v_gold:=v_gold+400;v_gems:=v_gems+10;v_mats:=v_mats+6;
   v_title:='Повелитель душ';v_frame:='mortarion_lord';v_medal:='Корона Мортариона';
 ELSIF v_rank BETWEEN 2 AND 3 THEN
   v_gold:=v_gold+200;v_gems:=v_gems+5;v_mats:=v_mats+3;
   v_title:='Покоритель тьмы';v_frame:='mortarion_conqueror';v_medal:='Печать Покорителя';
 ELSIF v_rank BETWEEN 4 AND 10 THEN
   v_gold:=v_gold+100;v_gems:=v_gems+2;v_mats:=v_mats+2;
   v_title:='Охотник на души';v_frame:='mortarion_hunter';v_medal:='Медаль Мортариона';
 END IF;

 -- Extra victory bonus only when raid HP actually reached zero.
 IF v_event.hp=0 THEN
   v_gold:=v_gold+100;v_gems:=v_gems+2;v_mats:=v_mats+2;
 END IF;

 -- Probabilities are draws at claim time and each receipt is saved exactly once.
 -- 0.3% Heart: only Legendary; tradeable as a future auction material.
 -- 0.05% Awakening Stone: exceptionally rare and never premium cash.
 v_fragment:=v_rank BETWEEN 1 AND 3 OR (
    v_tier='legendary' AND pg_catalog.random()<0.12
 ) OR (v_tier='hunter' AND pg_catalog.random()<0.04);
 v_ingredient:=v_tier<>'participant' AND pg_catalog.random()<
   CASE WHEN v_tier='legendary' THEN 0.25 ELSE 0.10 END;
 v_heart:=v_tier='legendary' AND pg_catalog.random()<0.003;
 v_stone:=v_tier='legendary' AND pg_catalog.random()<0.0005;

 IF v_fragment THEN
   v_blueprint:=CASE WHEN pg_catalog.random()<0.5 THEN 'guardian_blade' ELSE 'guardian_amulet' END;
   v_part_no:=CASE WHEN pg_catalog.random()<0.22 THEN 1
                    WHEN pg_catalog.random()<0.44 THEN 2
                    WHEN pg_catalog.random()<0.64 THEN 3
                    WHEN pg_catalog.random()<0.84 THEN 4
                    WHEN pg_catalog.random()<0.95 THEN 5 ELSE 6 END;
   v_item_id:='trial_fragment_'||v_blueprint||'_'||v_part_no;
   v_new:=pg_catalog.jsonb_build_object('id',v_item_id,
     'name','Фрагмент '||v_part_no||'/6 · '||
       CASE WHEN v_blueprint='guardian_blade' THEN 'Клинок Стража' ELSE 'Амулет Стража' END,
     'icon','📜','type','material',
     'rarity',CASE WHEN v_part_no=6 THEN 'legendary' WHEN v_part_no=5 THEN 'epic' ELSE 'rare' END,
     'qty',1,'description','Фрагмент чертежа для профессии мастера. Не портится.');
   v_inventory:=territory_private.mortarion_reward_add_item_v1(v_inventory,v_new);
   v_drops:=v_drops||pg_catalog.jsonb_build_array(
     pg_catalog.jsonb_build_object('id',v_item_id,'name',v_new->>'name','qty',1));
 END IF;
 IF v_ingredient THEN
   v_new:=pg_catalog.jsonb_build_object('id','mortarion_soul_essence',
     'name','Эссенция душ Мортариона','icon','✦','type','material',
     'rarity','epic','qty',1,
     'description','Редкий бессрочный материал будущих рецептов мастеров.');
   v_inventory:=territory_private.mortarion_reward_add_item_v1(v_inventory,v_new);
   v_drops:=v_drops||pg_catalog.jsonb_build_array(
     pg_catalog.jsonb_build_object('id',v_new->>'id','name',v_new->>'name','qty',1));
 END IF;
 IF v_heart THEN
   v_new:=pg_catalog.jsonb_build_object('id','mortarion_heart',
     'name','Сердце Мортариона','icon','💜','type','material',
     'rarity','legendary','qty',1,
     'description','Уникальный бессрочный материал. Будущий рецепт мастеров и аукцион; шанс 0,3%.');
   v_inventory:=territory_private.mortarion_reward_add_item_v1(v_inventory,v_new);
   v_drops:=v_drops||pg_catalog.jsonb_build_array(
     pg_catalog.jsonb_build_object('id',v_new->>'id','name',v_new->>'name','qty',1));
 END IF;
 IF v_stone THEN
   v_new:=pg_catalog.jsonb_build_object('id','cow_awakening_stone',
     'name','Камень пробуждения','icon','💜','type','material',
     'rarity','legendary','qty',1,
     'description','Особо редкий бессрочный камень пробуждения спутника. Не продаётся.');
   v_inventory:=territory_private.mortarion_reward_add_item_v1(v_inventory,v_new);
   v_drops:=v_drops||pg_catalog.jsonb_build_array(
     pg_catalog.jsonb_build_object('id',v_new->>'id','name',v_new->>'name','qty',1));
 END IF;
 -- Elixirs expire only after the player claims the single earned chest.
 IF v_elix>0 THEN
   v_new:=pg_catalog.jsonb_build_object('id','mortarion_elixir_2026',
     'name','Эликсир силы','icon','💪','type','elixir','rarity','rare',
     'qty',v_elix,'description','+10 к атаке на один бой',
     'effect',pg_catalog.jsonb_build_object('stat','attack','value',10,'duration','battle'),
     'expiresAt',pg_catalog.to_jsonb(pg_catalog.clock_timestamp()+interval '7 days'));
   v_inventory:=territory_private.mortarion_reward_add_item_v1(v_inventory,v_new);
 END IF;

 IF v_player.gold>2147483647-v_gold OR v_player.gems>2147483647-v_gems
   OR v_player.forge_materials>2147483647-v_mats
 THEN RAISE EXCEPTION 'mortarion_rewards_wallet_overflow'; END IF;
 v_total_gold:=v_player.gold+v_gold;
 v_total_gems:=v_player.gems+v_gems;
 v_materials:=v_player.forge_materials+v_mats;
 v_receipt:=pg_catalog.jsonb_build_object(
   'eventId',v_event.id,'tier',v_tier,'place',v_rank,
   'totalHits',v_part.total_hits,'activeDays',v_days,'hitDays',v_current_days,
   'gold',v_gold,'gems',v_gems,'materials',v_mats,'elixirs',v_elix,
   'fragment',v_fragment,'ingredient',v_ingredient,'heart',v_heart,
   'awakeningStone',v_stone,'items',v_drops,
   'collectiveVictory',v_event.hp=0,'title',v_title,'frame',v_frame,
   'medal',v_medal);

 v_hero:=pg_catalog.jsonb_set(v_hero,'{gold}',pg_catalog.to_jsonb(v_total_gold));
 v_hero:=pg_catalog.jsonb_set(v_hero,'{gems}',pg_catalog.to_jsonb(v_total_gems));
 v_state:=pg_catalog.jsonb_set(v_state,'{player}',v_hero);
 v_state:=pg_catalog.jsonb_set(v_state,'{inventory}',v_inventory);
 v_state:=pg_catalog.jsonb_set(v_state,'{forgeMaterials}',pg_catalog.to_jsonb(v_materials));
 v_state:=pg_catalog.jsonb_set(v_state,'{mortarionReward}',v_receipt,true);
 IF v_rank BETWEEN 1 AND 10 THEN
   v_state:=pg_catalog.jsonb_set(v_state,'{mortarionHonor}',pg_catalog.jsonb_build_object(
     'eventId',v_event.id,'place',v_rank,'title',v_title,
     'frame',v_frame,'medal',v_medal),true);
 END IF;

 UPDATE public.players SET game_state=v_state,gold=v_total_gold,
   gems=v_total_gems,forge_materials=v_materials WHERE id=v_uid RETURNING * INTO v_player;
 INSERT INTO territory_private.mortarion_reward_receipts_v1
   (event_id,player_id,tier,place,receipt)
 VALUES(v_event.id,v_uid,v_tier,v_rank,v_receipt);

 RETURN pg_catalog.jsonb_build_object('success',true,'already_claimed',false,
   'receipt',v_receipt,
   'updated_at',v_player.updated_at,
   'wallet_gold',v_player.gold,'wallet_gems',v_player.gems,
   'game_state',v_player.game_state);
END; $fn$;

REVOKE ALL ON FUNCTION public.territory_mortarion_reward_claim_v1(timestamptz)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_mortarion_reward_claim_v1(timestamptz)
 TO authenticated;
COMMIT;
