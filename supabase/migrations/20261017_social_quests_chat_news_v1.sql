-- One-time Telegram chat and news subscription quests.
-- Membership is checked in the trusted social-quests Edge Function via Telegram Bot API.
-- This RPC is service_role-only: ordinary clients cannot forge verification.
CREATE TABLE IF NOT EXISTS territory_private.social_quest_claims_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  task text NOT NULL CHECK (task IN ('chat','news')),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (player_id,task)
);
REVOKE ALL ON territory_private.social_quest_claims_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_social_status_v1(p_player uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'chat', EXISTS(SELECT 1 FROM territory_private.social_quest_claims_v1
      WHERE player_id=p_player AND task='chat'),
    'news', EXISTS(SELECT 1 FROM territory_private.social_quest_claims_v1
      WHERE player_id=p_player AND task='news')
  );
$$;
REVOKE ALL ON FUNCTION public.territory_social_status_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_social_status_v1(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_social_claim_v1(
  p_player uuid,p_task text,p_expected timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE p public.players%ROWTYPE; v_state jsonb; v_stones integer;
BEGIN
  IF p_player IS NULL OR p_task NOT IN ('chat','news') OR p_expected IS NULL
  THEN RAISE EXCEPTION 'social_invalid_request'; END IF;
  SELECT * INTO p FROM public.players WHERE id=p_player
    AND telegram_id IS NOT NULL AND NOT banned FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'social_verified_telegram_required'; END IF;
  IF EXISTS (SELECT 1 FROM territory_private.social_quest_claims_v1
    WHERE player_id=p_player AND task=p_task)
  THEN RAISE EXCEPTION 'social_already_claimed'; END IF;
  IF p.updated_at IS DISTINCT FROM p_expected
    OR jsonb_typeof(p.game_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p.game_state->'player') IS DISTINCT FROM 'object'
    OR (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$'
    OR (p.game_state->>'battleStones') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'social_reload_required'; END IF;
  IF p.gold <> (p.game_state->'player'->>'gold')::integer
    OR p.gold::bigint + 150 > 2147483647
    OR (p.game_state->>'battleStones')::bigint + 3 > 2147483647
  THEN RAISE EXCEPTION 'social_invalid_wallet'; END IF;
  v_stones:=(p.game_state->>'battleStones')::integer;
  v_state:=jsonb_set(p.game_state,'{player,gold}',to_jsonb(p.gold+150));
  v_state:=jsonb_set(v_state,'{battleStones}',to_jsonb(v_stones+3));
  UPDATE public.players SET game_state=v_state,gold=p.gold+150
   WHERE id=p_player RETURNING * INTO p;
  INSERT INTO territory_private.social_quest_claims_v1(player_id,task)
    VALUES(p_player,p_task);
  RETURN jsonb_build_object('success',true,'task',p_task,'gold',150,'stones',3,
    'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems,
    'game_state',p.game_state);
END $$;
REVOKE ALL ON FUNCTION public.territory_social_claim_v1(uuid,text,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_social_claim_v1(uuid,text,timestamptz)
  TO service_role;