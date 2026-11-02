-- STAGED ONLY: 2026 Halloween rank bonuses. No production grant before 2026-11-03 00:00 UTC.
-- Exact participants and rank come from server-confirmed hits, not client save or leaderboard.
-- All resources are existing game-only mail payloads (gold, gems, stones).
CREATE TABLE IF NOT EXISTS territory_private.halloween_top10_bonus_2026 (
  event_id text NOT NULL REFERENCES public.territory_halloween_boss_2026(id),
  player_id uuid NOT NULL REFERENCES public.players(id),
  place integer NOT NULL CHECK (place BETWEEN 1 AND 10),
  mail_id uuid NOT NULL UNIQUE REFERENCES public.admin_grants(id),
  payload jsonb NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (event_id,player_id),
  UNIQUE (event_id,place)
);
ALTER TABLE territory_private.halloween_top10_bonus_2026 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.halloween_top10_bonus_2026 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.halloween_top10_bonus_batches_2026 (
  request_id uuid PRIMARY KEY,
  expected_count bigint NOT NULL,
  snapshot_digest text NOT NULL,
  inserted_count bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE territory_private.halloween_top10_bonus_batches_2026 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.halloween_top10_bonus_batches_2026 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_halloween_top10_preview_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.territory_halloween_boss_2026%ROWTYPE;
  v_count bigint;
  v_digest text;
  v_sent bigint;
  v_claimed bigint;
  v_unexpected bigint;
  v_last timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.territory_halloween_boss_2026 WHERE id='halloween_2026';
  IF NOT FOUND THEN RAISE EXCEPTION 'halloween_top10_event_missing'; END IF;
  IF pg_catalog.clock_timestamp() <
     GREATEST(v_event.ends_at,'2026-11-03 00:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'halloween_top10_event_active';
  END IF;

  WITH ranked AS (
    SELECT h.player_id,h.total_damage,
      ROW_NUMBER() OVER (ORDER BY h.total_damage DESC,h.last_hit_at ASC NULLS LAST,h.player_id) AS place
    FROM public.territory_halloween_boss_2026_players h
    WHERE h.event_id='halloween_2026' AND h.total_hits>0 AND h.total_damage>0
  )
  SELECT count(*),
    pg_catalog.md5(COALESCE(pg_catalog.string_agg(
      ranked.place::text||':'||ranked.player_id::text||':'||ranked.total_damage::text,
      '|' ORDER BY ranked.place),'')) INTO v_count,v_digest
  FROM ranked WHERE ranked.place<=10;

  SELECT count(*),count(*) FILTER (WHERE m.claimed_at IS NOT NULL),max(b.awarded_at)
    INTO v_sent,v_claimed,v_last
  FROM territory_private.halloween_top10_bonus_2026 b
  JOIN public.admin_grants m ON m.id=b.mail_id AND m.player_id=b.player_id
  WHERE b.event_id='halloween_2026';

  WITH ranked AS (
    SELECT h.player_id,
      ROW_NUMBER() OVER (ORDER BY h.total_damage DESC,h.last_hit_at ASC NULLS LAST,h.player_id) AS place
    FROM public.territory_halloween_boss_2026_players h
    WHERE h.event_id='halloween_2026' AND h.total_hits>0 AND h.total_damage>0
  )
  SELECT count(*) INTO v_unexpected
  FROM territory_private.halloween_top10_bonus_2026 b
  WHERE b.event_id='halloween_2026'
    AND NOT EXISTS (SELECT 1 FROM ranked WHERE ranked.place<=10
      AND ranked.player_id=b.player_id AND ranked.place=b.place);

  RETURN pg_catalog.jsonb_build_object(
    'eligible',v_count,'sent',v_sent,'pending',v_count-v_sent,
    'claimed',v_claimed,'unexpected',v_unexpected,'duplicates',0,
    'digest',v_digest,'lastGrant',v_last
  );
END; $$;
REVOKE ALL ON FUNCTION public.territory_halloween_top10_preview_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_top10_preview_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_halloween_top10_bulk_v1(
  p_request_id uuid,p_expected_count bigint,p_expected_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_preview jsonb;
  v_after jsonb;
  v_old territory_private.halloween_top10_bonus_batches_2026%ROWTYPE;
  v_event public.territory_halloween_boss_2026%ROWTYPE;
  v_row record;
  v_mail_id uuid;
  v_payload jsonb;
  v_gold integer;
  v_gems integer;
  v_stones integer;
  v_inserted bigint := 0;
BEGIN
  IF p_request_id IS NULL OR p_expected_count IS NULL
    OR p_expected_count<0 OR p_expected_count>10
    OR p_expected_digest IS NULL OR p_expected_digest !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'halloween_top10_invalid_request';
  END IF;
  -- Lock same event row used by every boss hit and witch-bulk transaction.
  SELECT * INTO v_event FROM public.territory_halloween_boss_2026
    WHERE id='halloween_2026' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'halloween_top10_event_missing'; END IF;
  v_preview := public.territory_halloween_top10_preview_v1();

  SELECT * INTO v_old FROM territory_private.halloween_top10_bonus_batches_2026
    WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_old.expected_count<>p_expected_count OR v_old.snapshot_digest<>p_expected_digest THEN
      RAISE EXCEPTION 'halloween_top10_request_conflict';
    END IF;
    RETURN pg_catalog.jsonb_build_object('alreadyProcessed',true,
      'inserted',v_old.inserted_count,'snapshot',v_preview);
  END IF;

  IF (v_preview->>'eligible')::bigint<>p_expected_count
     OR v_preview->>'digest'<>p_expected_digest
     OR (v_preview->>'unexpected')::bigint<>0 THEN
    RAISE EXCEPTION 'halloween_top10_snapshot_changed';
  END IF;

  FOR v_row IN
    SELECT h.player_id,h.total_damage,
      ROW_NUMBER() OVER (ORDER BY h.total_damage DESC,h.last_hit_at ASC NULLS LAST,h.player_id) AS place
    FROM public.territory_halloween_boss_2026_players h
    WHERE h.event_id='halloween_2026' AND h.total_hits>0 AND h.total_damage>0
    ORDER BY h.total_damage DESC,h.last_hit_at ASC NULLS LAST,h.player_id
    LIMIT 10
  LOOP
    IF EXISTS (SELECT 1 FROM territory_private.halloween_top10_bonus_2026
               WHERE event_id='halloween_2026' AND player_id=v_row.player_id)
    THEN CONTINUE; END IF;
    v_gems := CASE v_row.place WHEN 1 THEN 300 WHEN 2 THEN 200 WHEN 3 THEN 150 ELSE 75 END;
    v_gold := CASE v_row.place WHEN 1 THEN 6000 WHEN 2 THEN 4000 WHEN 3 THEN 3000 ELSE 1500 END;
    v_stones := CASE v_row.place WHEN 1 THEN 10 WHEN 2 THEN 7 WHEN 3 THEN 5 ELSE 3 END;
    v_payload := pg_catalog.jsonb_build_object('gems',v_gems,'gold',v_gold,'stones',v_stones);
    v_mail_id := pg_catalog.gen_random_uuid();
    INSERT INTO public.admin_grants(id,player_id,kind,subject,body,payload)
      VALUES (v_mail_id,v_row.player_id,'mail',
        '🎃 Награда за место в топ-10 рейда!',
        'Поздравляем! Ты занял '||v_row.place::text||
          '-е место в Хэллоуинском рейде TERRITORY! Дополнительный подарок: '||
          v_gems::text||' синих алмазов, '||v_gold::text||' золота, '||
          v_stones::text||' боевых камней. Забери его из письма. '||
          'Легендарная Тыквенная ведьма начисляется отдельно всем участникам.',
        v_payload);
    INSERT INTO territory_private.halloween_top10_bonus_2026
      (event_id,player_id,place,mail_id,payload)
    VALUES('halloween_2026',v_row.player_id,v_row.place,v_mail_id,v_payload);
    v_inserted := v_inserted + 1;
  END LOOP;
  v_after := public.territory_halloween_top10_preview_v1();
  IF (v_after->>'eligible')::bigint<>p_expected_count
    OR (v_after->>'pending')::bigint<>0
    OR (v_after->>'unexpected')::bigint<>0 THEN
    RAISE EXCEPTION 'halloween_top10_reconcile_failed';
  END IF;
  INSERT INTO territory_private.halloween_top10_bonus_batches_2026
    (request_id,expected_count,snapshot_digest,inserted_count)
  VALUES (p_request_id,p_expected_count,p_expected_digest,v_inserted);
  RETURN pg_catalog.jsonb_build_object('alreadyProcessed',false,
    'inserted',v_inserted,'snapshot',v_after);
END; $$;
REVOKE ALL ON FUNCTION public.territory_halloween_top10_bulk_v1(uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_top10_bulk_v1(uuid,bigint,text) TO service_role;
