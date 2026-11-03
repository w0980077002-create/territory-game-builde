-- Halloween 2026: notification-read state must be separate from prize claiming.
-- Already-claimed TOP20 rewards stay credited; their single final letter can still
-- be read once in "New" without reopening admin_grants or minting rewards.
CREATE TABLE IF NOT EXISTS territory_private.halloween_final_mail_reads_2026 (
  player_id uuid PRIMARY KEY,
  mail_id uuid NOT NULL,
  event_id text NOT NULL DEFAULT 'halloween_2026'
    CHECK (event_id = 'halloween_2026'),
  seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE territory_private.halloween_final_mail_reads_2026 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE territory_private.halloween_final_mail_reads_2026 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_halloween_final_mail_unseen_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  v_mail jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT pg_catalog.jsonb_build_object(
    'id', m.id,
    'subject', m.subject,
    'body', m.body,
    'payload', m.payload,
    'created_at', m.created_at,
    'claimed_at', m.claimed_at
  )
  INTO v_mail
  FROM public.admin_grants m
  WHERE m.player_id = v_uid
    AND m.kind = 'mail'
    AND m.subject = '🎃 Поздравляем! Награды за Хэллоуин 2026'
    AND m.claimed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM territory_private.halloween_final_mail_reads_2026 r
      WHERE r.player_id = v_uid AND r.mail_id = m.id
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;
  RETURN v_mail;
END;
$body$;

CREATE OR REPLACE FUNCTION public.territory_halloween_final_mail_ack_v1(p_mail_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_mail_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_grants m
    WHERE m.id = p_mail_id
      AND m.player_id = v_uid
      AND m.kind = 'mail'
      AND m.subject = '🎃 Поздравляем! Награды за Хэллоуин 2026'
      AND m.claimed_at IS NOT NULL
  ) THEN RETURN false; END IF;

  INSERT INTO territory_private.halloween_final_mail_reads_2026(player_id, mail_id)
  VALUES(v_uid, p_mail_id)
  ON CONFLICT (player_id) DO NOTHING;
  RETURN EXISTS (
    SELECT 1 FROM territory_private.halloween_final_mail_reads_2026 r
    WHERE r.player_id=v_uid AND r.mail_id=p_mail_id
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.territory_halloween_final_mail_unseen_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.territory_halloween_final_mail_ack_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_final_mail_unseen_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_final_mail_ack_v1(uuid) TO authenticated;
