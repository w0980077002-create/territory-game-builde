-- TERRITORY 2026-11-17: one independent, server-authoritative 70-second
-- cooldown per consumable kind in ALL Arena modes (duel, 3v3, 20v20).
-- No data migration, wallet/equipment/progress update, or backfill.
-- Existing buff_active (one buff of a kind per battle) and max 5 uses remain.
-- Guard exact existing production fragments so concurrent changes fail closed.
DO $arena_70s_all_modes$
DECLARE
  v_item text;
  v_secure text;
  v_state text;
  v_old text := 'IF NOT v_room.team_live_v1 AND v_me.item_round = v_room.round_no THEN RAISE EXCEPTION ''item_round''; END IF;';
  v_old_cooldown text := 'IF v_r.team_live_v1 AND EXISTS (';
  v_old_visibility text := '''itemCooldowns'', CASE WHEN v_room.team_live_v1 THEN';
BEGIN
  v_item := pg_get_functiondef('public.arena_use_item(uuid,text)'::regprocedure);
  v_secure := pg_get_functiondef('public.arena_secure_v1(text,timestamp with time zone,text,uuid,integer,text,uuid)'::regprocedure);
  v_state := pg_get_functiondef('public.arena_state(uuid,bigint)'::regprocedure);

  IF v_item IS NULL OR v_secure IS NULL OR v_state IS NULL
    OR length(v_item)-length(replace(v_item,v_old,'')) <> length(v_old)
    OR length(v_secure)-length(replace(v_secure,v_old_cooldown,'')) <> length(v_old_cooldown)
    OR length(v_state)-length(replace(v_state,v_old_visibility,'')) <> length(v_old_visibility)
    OR position('u.used_at > clock_timestamp() - interval ''70 seconds''' in v_secure)=0
    OR position('max(u.used_at) AS last_used' in v_state)=0
  THEN RAISE EXCEPTION 'arena_70s_all_modes_conflicting_server_version'; END IF;

  -- Old shared one-use-per-round restriction prevents independent timers in duels.
  -- The secure RPC checks usage timestamps under the existing room row lock.
  EXECUTE replace(v_item, v_old, '-- All modes use the secured per-kind 70-second cooldown.');
  EXECUTE replace(v_secure, v_old_cooldown, 'IF EXISTS (');
  EXECUTE replace(v_state, v_old_visibility,
    '''itemCooldowns'', CASE WHEN v_room.status=''active'' THEN');
END
$arena_70s_all_modes$;
