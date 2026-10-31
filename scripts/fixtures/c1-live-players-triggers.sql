-- Synthetic PG17 fixture: function and trigger definitions read-only from live 2026-10-31.
-- No player rows or credentials. See test for deliberately simplified dependencies.
CREATE OR REPLACE FUNCTION public.territory_normalize_state_v4(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_state jsonb:=input; v_player jsonb; v_eq jsonb; v_inventory jsonb; v_belt jsonb;
BEGIN
  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
   OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object' THEN RETURN input; END IF;
  v_player:=v_state->'player';
  IF jsonb_typeof(v_player->'equipped')='object' THEN
    SELECT coalesce(jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='object'
      THEN public.territory_normalize_gear_v4(e.value) ELSE e.value END),'{}'::jsonb)
    INTO v_eq FROM jsonb_each(v_player->'equipped') e;
    v_player:=jsonb_set(v_player,'{equipped}',v_eq);
  END IF;
  IF jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',public.territory_normalize_gear_v4(x.value->'equipment'))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_inventory FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
  END IF;
  IF jsonb_typeof(v_state->'belt')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',public.territory_normalize_gear_v4(x.value->'equipment'))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_belt FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{belt}',v_belt);
  END IF;
  -- Legitimate baseline stats are determined by player level, not client data.
  -- Level itself is NOT changed; this prevents forged base stats restoring damage.
  v_player:=jsonb_set(v_player,'{stats}',
    coalesce(v_player->'stats','{}'::jsonb) || jsonb_build_object(
      'maxHp',100+20*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'hp',100+20*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'attack',20+5*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'defense',5+2*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'critChance',5,'critDamage',50));
  v_state:=jsonb_set(v_state,'{player}',v_player);
  v_state:=jsonb_set(v_state,'{balanceVersion}','4'::jsonb,true);
  RETURN v_state;
END;
$function$;

CREATE OR REPLACE FUNCTION public.territory_gear_recompute_columns_v4(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_eq jsonb; v_base jsonb; v_att numeric; v_def numeric; v_hp numeric; v_crit numeric;
BEGIN
 IF jsonb_typeof(input->'player') IS DISTINCT FROM 'object' THEN RETURN '{}'::jsonb; END IF;
 v_base:=input->'player'->'stats';
 SELECT coalesce(sum(coalesce((x.value->>'attack')::numeric,0)),0),
        coalesce(sum(coalesce((x.value->>'defense')::numeric,0)),0),
        coalesce(sum(coalesce((x.value->>'hp')::numeric,0)),0),
        coalesce(sum(coalesce((x.value->>'critChance')::numeric,0)),0)
 INTO v_att,v_def,v_hp,v_crit
 FROM jsonb_each(coalesce(input->'player'->'equipped','{}'::jsonb)) x
 WHERE jsonb_typeof(x.value)='object';
 RETURN jsonb_build_object(
   'attack',least(2147483647,coalesce((v_base->>'attack')::numeric,20)+v_att)::int,
   'defense',least(2147483647,coalesce((v_base->>'defense')::numeric,5)+v_def)::int,
   'max_hp',least(2147483647,coalesce((v_base->>'maxHp')::numeric,100)+v_hp)::int,
   'crit_chance',least(75,coalesce((v_base->>'critChance')::numeric,5)+v_crit)::int);
END;
$function$;

CREATE OR REPLACE FUNCTION territory_private.referral_try_qualify_v2(p_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_wins int; v_xp int; v_level int; v_bonus int;
BEGIN
 SELECT a.credited_wins,a.credited_xp,
   CASE WHEN a.stage_wins>=3 THEN 30 ELSE 0 END +
   CASE WHEN a.boss_wins>=1 THEN 80 ELSE 0 END
 INTO v_wins,v_xp,v_bonus
 FROM territory_private.referral_activity_v2 a WHERE a.player_id=p_uid;
 IF coalesce(v_wins,0)<10 OR coalesce(v_xp,0)+coalesce(v_bonus,0)<450
 THEN RETURN false; END IF;
 SELECT CASE WHEN (game_state->'player'->>'level') ~ '^[0-9]{1,5}$'
   THEN (game_state->'player'->>'level')::integer ELSE 0 END
 INTO v_level FROM public.players
 WHERE id=p_uid AND telegram_id IS NOT NULL AND NOT banned;
 IF coalesce(v_level,0)<5 THEN RETURN false; END IF;
 UPDATE territory_private.referral_invites_v1
 SET qualified_at=clock_timestamp()
 WHERE invited_id=p_uid AND qualified_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO territory_private.referral_chests_v1(invited_id,inviter_id)
 SELECT invited_id,inviter_id FROM territory_private.referral_invites_v1
 WHERE invited_id=p_uid AND qualified_at IS NOT NULL
 ON CONFLICT(invited_id) DO NOTHING;
 RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION territory_private.owner_cap_state_v1(p_state jsonb, p_hero integer, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_state jsonb:=p_state;
  v_equipped jsonb;
  v_inventory jsonb;
  v_belt jsonb;
BEGIN
  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object' THEN
    RETURN p_state;
  END IF;
  IF jsonb_typeof(v_state#>'{player,equipped}')='object' THEN
    SELECT coalesce(jsonb_object_agg(e.key,
      CASE WHEN jsonb_typeof(e.value)='object'
        THEN territory_private.owner_cap_item_v1(e.value,p_hero,p_player)
        ELSE e.value END),'{}'::jsonb)
      INTO v_equipped FROM jsonb_each(v_state#>'{player,equipped}') e;
    v_state:=jsonb_set(v_state,'{player,equipped}',v_equipped);
  END IF;
  IF jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',
          territory_private.owner_cap_item_v1(x.value->'equipment',p_hero,p_player))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_inventory FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
  END IF;
  IF jsonb_typeof(v_state->'belt')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',
          territory_private.owner_cap_item_v1(x.value->'equipment',p_hero,p_player))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_belt FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{belt}',v_belt);
  END IF;
  RETURN v_state;
END;
$function$;

CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(p_item jsonb, p_hero integer, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_approved integer;
  v_approval_at timestamptz;
  v_player_at timestamptz;
  v_saved jsonb;
  v_item jsonb;
  v_old jsonb;
  v_state jsonb;
  v_slot text;
  v_id text;
  v_requested integer;
  v_oldlevel integer;
  v_stats jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RETURN p_item; END IF;
  v_slot:=p_item->>'slot';
  v_id:=p_item->>'id';
  v_item:=p_item-'adminTestLevel';
  SELECT a.target_level,a.approved_equipment,a.updated_at INTO v_approved,v_saved,v_approval_at
  FROM territory_private.owner_test_gear_v1 a
  WHERE a.player_id=p_player AND a.slot=v_slot AND a.equipment_id=v_id;

  -- Ordinary equipment stays under the hero-level cap; the marker alone
  -- can never grant a bypass.
  IF v_approved IS NULL THEN
    RETURN territory_private.cap_overlevel_item_20261018(v_item,p_hero);
  END IF;

  -- Compare against the already-committed version, never against the historic
  -- owner receipt. Items may move between equipped, bag and belt.
  SELECT game_state,updated_at INTO v_state,v_player_at FROM public.players WHERE id=p_player;
  IF jsonb_typeof(v_state#>'{player,equipped}')='object' THEN
    SELECT x.value INTO v_old FROM jsonb_each(v_state#>'{player,equipped}') x
    WHERE x.value->>'id'=v_id LIMIT 1;
  END IF;
  IF v_old IS NULL AND jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT x.value->'equipment' INTO v_old
    FROM jsonb_array_elements(v_state->'inventory') x(value)
    WHERE x.value#>>'{equipment,id}'=v_id LIMIT 1;
  END IF;
  IF v_old IS NULL AND jsonb_typeof(v_state->'belt')='array' THEN
    SELECT x.value->'equipment' INTO v_old
    FROM jsonb_array_elements(v_state->'belt') x(value)
    WHERE x.value#>>'{equipment,id}'=v_id LIMIT 1;
  END IF;

  IF (v_item->>'level') ~ '^[0-9]{1,3}$'
    AND (v_old->>'level') ~ '^[0-9]{1,3}$' THEN
    v_requested:=(v_item->>'level')::integer;
    v_oldlevel:=(v_old->>'level')::integer;

    -- Last owner command was already applied. Accept one legitimate forge
    -- upgrade to the next level (max 500), but do not replace it on later saves.
    -- A new owner correction downwards bypasses this branch and is applied
    -- by the owner-authorized transaction below.
    IF v_oldlevel >= v_approved THEN
      -- During an explicit OWNER relevel, the approval row has been refreshed
      -- with a NULL receipt. A requested correction DOWN to its new target
      -- must win over any older server value.
      IF v_saved IS NULL AND v_requested = v_approved
        AND v_oldlevel <> v_approved
        AND v_approval_at >= v_player_at THEN
        NULL; -- fall through to the owner's requested canonical relevel below
      ELSIF v_requested = v_oldlevel + 1
        AND v_requested <= p_hero AND v_requested <= 500 THEN
        RETURN public.territory_normalize_gear_v4(v_item)
          || jsonb_build_object('adminTestLevel',true);
      END IF;
      IF (v_saved IS NOT NULL OR v_requested <> v_approved
          OR v_oldlevel = v_approved OR v_approval_at < v_player_at)
        AND (v_requested = v_oldlevel OR v_saved IS NOT NULL
            OR v_requested < v_oldlevel) THEN
        RETURN v_old || jsonb_build_object('adminTestLevel',true);
      END IF;
      -- Old approvals without a receipt also retain the current level if
      -- the submitted jump is not the single validated forge step.
      IF v_requested > v_oldlevel + 1 THEN
        RETURN v_old || jsonb_build_object('adminTestLevel',true);
      END IF;
    END IF;
  END IF;

  -- Owner correction / one-time compatibility with old receipt-free grants.
  IF jsonb_typeof(v_saved)='object'
    AND v_saved->>'id'=v_id AND v_saved->>'slot'=v_slot
    AND v_saved->>'level'=v_approved::text
    AND v_saved->'adminTestLevel'='true'::jsonb
  THEN RETURN v_saved; END IF;

  v_item:=jsonb_set(v_item,'{level}',to_jsonb(v_approved),true);
  IF v_item->>'name'='Клинок победителя' AND v_slot='weapon' THEN
    v_stats:=jsonb_build_object('attack',10+v_approved*3,'defense',0,'hp',0);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  ELSIF v_item->>'name'='Доспех воина' AND v_slot='armor' THEN
    v_stats:=jsonb_build_object('attack',0,'defense',5+v_approved*2,'hp',20+v_approved*5);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  END IF;
  v_item:=public.territory_normalize_gear_v4(v_item);
  RETURN territory_private.cap_overlevel_item_20261018(v_item,v_approved)
    || jsonb_build_object('adminTestLevel',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.territory_economy_audit_trigger_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_stones_old bigint;v_stones_new bigint;v_bought_old integer;v_bought_new integer;
 v_chapter_old integer;v_chapter_new integer;v_alert text:=NULL;
BEGIN
 IF (OLD.game_state->>'battleStones') ~ '^[0-9]{1,10}$'
 THEN v_stones_old:=(OLD.game_state->>'battleStones')::bigint;END IF;
 IF (NEW.game_state->>'battleStones') ~ '^[0-9]{1,10}$'
 THEN v_stones_new:=(NEW.game_state->>'battleStones')::bigint;END IF;
 IF (OLD.game_state->>'dailyStonesBought') ~ '^[0-9]{1,2}$'
 THEN v_bought_old:=(OLD.game_state->>'dailyStonesBought')::integer;END IF;
 IF (NEW.game_state->>'dailyStonesBought') ~ '^[0-9]{1,2}$'
 THEN v_bought_new:=(NEW.game_state->>'dailyStonesBought')::integer;END IF;
 IF (OLD.game_state->>'currentChapter') ~ '^[0-9]{1,9}$'
 THEN v_chapter_old:=(OLD.game_state->>'currentChapter')::integer;END IF;
 IF (NEW.game_state->>'currentChapter') ~ '^[0-9]{1,9}$'
 THEN v_chapter_new:=(NEW.game_state->>'currentChapter')::integer;END IF;
 IF NEW.gold IS DISTINCT FROM OLD.gold OR NEW.gems IS DISTINCT FROM OLD.gems
 OR NEW.level IS DISTINCT FROM OLD.level
 OR v_stones_new IS DISTINCT FROM v_stones_old
 OR v_bought_new IS DISTINCT FROM v_bought_old
 OR v_chapter_new IS DISTINCT FROM v_chapter_old THEN
  IF NEW.gems>OLD.gems+500 THEN v_alert:='large_gem_gain';
  ELSIF NEW.gold>OLD.gold+250000 THEN v_alert:='large_gold_gain';
  ELSIF v_stones_old IS NOT NULL AND v_stones_new>v_stones_old+25 THEN v_alert:='large_stone_gain';
  ELSIF NEW.level>OLD.level+5 THEN v_alert:='large_level_jump';END IF;
  INSERT INTO public.territory_economy_audit_v1(
  player_id,actor_id,gold_old,gold_new,gems_old,gems_new,level_old,level_new,
  stones_old,stones_new,bought_old,bought_new,chapter_old,chapter_new,suspicious,reason)
  VALUES(NEW.id,auth.uid(),OLD.gold,NEW.gold,OLD.gems,NEW.gems,OLD.level,NEW.level,
  v_stones_old,v_stones_new,v_bought_old,v_bought_new,v_chapter_old,v_chapter_new,
  v_alert IS NOT NULL,v_alert);
 END IF;
 RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.territory_economy_guard_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 v_state jsonb:=NEW.game_state; v_p jsonb:=v_state->'player';
 v_gold numeric; v_gems numeric; v_level numeric; v_stones numeric; v_bought numeric;
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
  IF pg_catalog.jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'territory_invalid_game_state'; END IF;
  IF pg_catalog.jsonb_typeof(v_p->'gold') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_p->'gems') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_p->'level') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_state->'battleStones') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'territory_invalid_wallet_type'; END IF;
  v_gold:=(v_p->>'gold')::numeric;
  v_gems:=(v_p->>'gems')::numeric;
  v_level:=(v_p->>'level')::numeric;
  v_stones:=(v_state->>'battleStones')::numeric;
  IF v_gold IS DISTINCT FROM NEW.gold OR v_gems IS DISTINCT FROM NEW.gems
    OR v_level IS DISTINCT FROM NEW.level OR v_stones NOT BETWEEN 0 AND 2147483647
    OR pg_catalog.trunc(v_stones)<>v_stones
  THEN RAISE EXCEPTION 'territory_wallet_snapshot_mismatch'; END IF;
  IF v_state ? 'dailyStonesBought' THEN
    IF pg_catalog.jsonb_typeof(v_state->'dailyStonesBought') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'territory_invalid_stone_counter'; END IF;
    v_bought:=(v_state->>'dailyStonesBought')::numeric;
    IF v_bought NOT BETWEEN 0 AND 25 OR pg_catalog.trunc(v_bought)<>v_bought
    THEN RAISE EXCEPTION 'territory_invalid_stone_counter'; END IF;
  END IF;
 END IF;
 IF NEW.game_state IS DISTINCT FROM OLD.game_state OR NEW.gold IS DISTINCT FROM OLD.gold
   OR NEW.gems IS DISTINCT FROM OLD.gems OR NEW.level IS DISTINCT FROM OLD.level THEN
  NEW.updated_at:=GREATEST(pg_catalog.clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_stats jsonb;
BEGIN
  IF NEW.game_state IS NULL THEN RETURN NEW; END IF;
  NEW.game_state:=territory_private.owner_cap_state_v1(
    public.territory_normalize_state_v4(NEW.game_state),NEW.level,NEW.id);
  v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
  IF v_stats<>'{}'::jsonb THEN
    NEW.attack:=(v_stats->>'attack')::integer;
    NEW.defense:=(v_stats->>'defense')::integer;
    NEW.max_hp:=(v_stats->>'max_hp')::integer;
    NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION territory_private.inventory_cleanup_save_guard_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF OLD.game_state->>'inventoryCleanupVersion' = '1'
      AND NEW.game_state->>'inventoryCleanupVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'territory_stale_inventory_cleanup_snapshot';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION territory_private.referral_after_save_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state
    AND EXISTS(SELECT 1 FROM territory_private.referral_invites_v1
      WHERE invited_id=NEW.id AND qualified_at IS NULL)
 THEN PERFORM territory_private.referral_try_qualify_v2(NEW.id); END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.update_leaderboard_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins,
photo_url, attack, defense, max_hp, crit_chance)
VALUES (NEW.id, NEW.display_name, NEW.level, NEW.arena_rating, NEW.total_battles_won, NEW.arena_wins,
NEW.photo_url, NEW.attack, NEW.defense, NEW.max_hp, NEW.crit_chance)
ON CONFLICT (player_id) DO UPDATE SET
display_name = EXCLUDED.display_name,
level = EXCLUDED.level,
arena_rating = EXCLUDED.arena_rating,
total_battles_won = EXCLUDED.total_battles_won,
arena_wins = EXCLUDED.arena_wins,
photo_url = EXCLUDED.photo_url,
attack = EXCLUDED.attack,
defense = EXCLUDED.defense,
max_hp = EXCLUDED.max_hp,
crit_chance = EXCLUDED.crit_chance,
updated_at = now();
RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS territory_economy_audit_after_v1 ON public.players;
CREATE TRIGGER territory_economy_audit_after_v1 AFTER UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION territory_economy_audit_trigger_v1();

DROP TRIGGER IF EXISTS territory_economy_guard_before_v1 ON public.players;
CREATE TRIGGER territory_economy_guard_before_v1 BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION territory_economy_guard_v1();

DROP TRIGGER IF EXISTS territory_gear_guard_before_v4 ON public.players;
CREATE TRIGGER territory_gear_guard_before_v4 BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance ON public.players FOR EACH ROW EXECUTE FUNCTION territory_gear_guard_v4();

DROP TRIGGER IF EXISTS territory_inventory_cleanup_guard_v1 ON public.players;
CREATE TRIGGER territory_inventory_cleanup_guard_v1 BEFORE UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.inventory_cleanup_save_guard_v1();

DROP TRIGGER IF EXISTS territory_referral_after_save_v2 ON public.players;
CREATE TRIGGER territory_referral_after_save_v2 AFTER UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.referral_after_save_v2();

DROP TRIGGER IF EXISTS trigger_update_leaderboard ON public.players;
CREATE TRIGGER trigger_update_leaderboard AFTER INSERT OR UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION update_leaderboard_entry();

