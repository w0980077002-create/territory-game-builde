-- Production-compatible surgical fix for repeated arena team tick writes.
-- This migration mirrors the already applied live fix from 2026-11-18.
-- A poll with an unchanged round/deadline no longer issues a redundant UPDATE.
-- Combat clock logic, rewards, retries and security are unchanged.
-- The function hash guard prevents patching an unknown version of arena_tick.
SET LOCAL lock_timeout = '1500ms';

DO $patch$
DECLARE
  v_current text;
  v_anchor text := $old$  UPDATE public.arena_rooms SET
    round_no=v_new_round,
    round_deadline=LEAST(
      team1_last_attack_at+make_interval(secs=>60-team1_clock_penalty),
      team2_last_attack_at+make_interval(secs=>60-team2_clock_penalty))
    WHERE id=p_room;$old$;
  v_replacement text := $new$  UPDATE public.arena_rooms SET
    round_no=v_new_round,
    round_deadline=LEAST(
      team1_last_attack_at+make_interval(secs=>60-team1_clock_penalty),
      team2_last_attack_at+make_interval(secs=>60-team2_clock_penalty))
    WHERE id=p_room
      AND ROW(round_no,round_deadline) IS DISTINCT FROM
          ROW(v_new_round,LEAST(
            team1_last_attack_at+make_interval(secs=>60-team1_clock_penalty),
            team2_last_attack_at+make_interval(secs=>60-team2_clock_penalty)));$new$;
BEGIN
  v_current := pg_get_functiondef('public.arena_tick(uuid)'::regprocedure);
  IF md5(v_current) = '1889f8f0316f407ea1849c953e2a6181' THEN
    RETURN; -- Already applied in production; safe to replay.
  END IF;
  IF md5(v_current) <> '07855d5df75eed16eeed93a7cc4363d1'
    OR length(v_current)-length(replace(v_current,v_anchor,'')) <> length(v_anchor)
  THEN
    RAISE EXCEPTION 'Arena tick function changed; migration requires re-review';
  END IF;
  EXECUTE replace(v_current, v_anchor, v_replacement);
  IF md5(pg_get_functiondef('public.arena_tick(uuid)'::regprocedure)) <> '1889f8f0316f407ea1849c953e2a6181'
  THEN
    RAISE EXCEPTION 'Arena tick function did not match the reviewed replacement';
  END IF;
END $patch$;
