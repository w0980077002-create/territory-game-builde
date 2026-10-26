-- STAGED companion: serialize verified-win recording with season finalization.
-- Room/battle timestamps and combat logic stay unchanged. Season scoring uses
-- the actual verified recording instant AFTER acquiring the finalizer lock.
-- This prevents late/backdated transaction timestamps entering a closed week.
BEGIN;
CREATE OR REPLACE FUNCTION public.arena_weekly_capture_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $$
DECLARE v_recorded_at timestamptz;
BEGIN
 IF NEW.status='finished' AND OLD.status IS DISTINCT FROM 'finished'
   AND NEW.winner_team IN(1,2) THEN
   -- Same transaction lock as territory_private.weekly_season_tick_v1.
   -- An in-flight capture commits before tick can take its snapshot. A capture
   -- waiting on tick is recorded at the real post-lock time in the new week.
   PERFORM pg_advisory_xact_lock(14601,701);
   v_recorded_at:=clock_timestamp();
   INSERT INTO public.arena_weekly_wins_v1(room_id,player_id,won_at)
   SELECT NEW.id,p.user_id,v_recorded_at FROM public.arena_participants p
   WHERE p.room_id=NEW.id AND p.is_bot=false AND p.user_id IS NOT NULL
     AND p.team=NEW.winner_team
   ON CONFLICT(room_id,player_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.arena_weekly_capture_v1() FROM PUBLIC,anon,authenticated;
COMMIT;
