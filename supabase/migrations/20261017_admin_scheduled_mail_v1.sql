-- TERRITORY admin: manual-only moderation + scheduled in-game mail.
-- No changes to player authentication, owner credentials, game balances or hidden admin access.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS territory_private.admin_scheduled_mail_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target text NOT NULL CHECK (target IN ('one','all','active')),
 recipient_id uuid,
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
 body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
 send_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled')),
 sent_count integer NOT NULL DEFAULT 0 CHECK(sent_count>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 CONSTRAINT admin_scheduled_mail_target_chk CHECK (
  (target='one' AND recipient_id IS NOT NULL) OR
  (target IN ('all','active') AND recipient_id IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS admin_scheduled_mail_due_v1_idx
 ON territory_private.admin_scheduled_mail_v1(send_at)
 WHERE status='pending';
REVOKE ALL ON territory_private.admin_scheduled_mail_v1 FROM PUBLIC,anon,authenticated;

-- Service-role-only creation by the authenticated OWNER Edge Function.
CREATE OR REPLACE FUNCTION public.territory_admin_mail_schedule_v1(
 p_target text, p_recipient uuid, p_subject text, p_body text, p_payload jsonb, p_send_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
DECLARE v_id uuid;
BEGIN
 IF p_target IS NULL OR p_target NOT IN ('one','all','active')
 OR p_subject IS NULL OR length(trim(p_subject)) NOT BETWEEN 1 AND 80
 OR p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 1000
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
 OR p_send_at IS NULL OR p_send_at <= clock_timestamp() + interval '30 seconds'
 OR p_send_at > clock_timestamp() + interval '365 days'
 OR (p_target='one' AND (p_recipient IS NULL OR
     NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_recipient)))
 OR (p_target<>'one' AND p_recipient IS NOT NULL)
 THEN RAISE EXCEPTION 'admin_invalid_scheduled_mail'; END IF;

 INSERT INTO territory_private.admin_scheduled_mail_v1
 (target,recipient_id,subject,body,payload,send_at)
 VALUES(p_target,p_recipient,trim(p_subject),trim(p_body),p_payload,p_send_at)
 RETURNING id INTO v_id;
 INSERT INTO public.admin_audit_log(action,details)
 VALUES('mail_scheduled',jsonb_build_object('id',v_id,'target',p_target,'sendAt',p_send_at,'subject',p_subject,'recipient',p_recipient,'payload',p_payload));
 RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.territory_admin_mail_schedule_v1(text,uuid,text,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_mail_schedule_v1(text,uuid,text,text,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_admin_mail_schedules_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',q.id,'target',q.target,'recipientId',q.recipient_id,
 'subject',q.subject,'sendAt',q.send_at,'status',q.status,
 'sentCount',q.sent_count,'createdAt',q.created_at
 ) ORDER BY q.created_at DESC),'[]'::jsonb)
 FROM (
  SELECT id,target,recipient_id,subject,send_at,status,sent_count,created_at
  FROM territory_private.admin_scheduled_mail_v1
  ORDER BY created_at DESC LIMIT 60
 ) q;
$fn$;
REVOKE ALL ON FUNCTION public.territory_admin_mail_schedules_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_mail_schedules_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_admin_mail_cancel_v1(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
DECLARE v_subject text;
BEGIN
 UPDATE territory_private.admin_scheduled_mail_v1
 SET status='cancelled',finished_at=clock_timestamp()
 WHERE id=p_id AND status='pending'
 RETURNING subject INTO v_subject;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.admin_audit_log(action,details)
 VALUES('mail_schedule_cancelled',jsonb_build_object('id',p_id,'subject',v_subject));
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.territory_admin_mail_cancel_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_mail_cancel_v1(uuid) TO service_role;

-- Transactional delivery: one scheduled message -> one atomic INSERT...SELECT.
-- Row locks prevent overlapping cron workers from delivering the same job twice.
-- Failure rolls back the entire job and leaves it pending for the next minute.
CREATE OR REPLACE FUNCTION public.territory_admin_mail_dispatch_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
DECLARE v_job territory_private.admin_scheduled_mail_v1%ROWTYPE;
 v_sent int; v_jobs int := 0;
BEGIN
 FOR v_job IN
  SELECT * FROM territory_private.admin_scheduled_mail_v1
  WHERE status='pending' AND send_at<=clock_timestamp()
  ORDER BY send_at LIMIT 10 FOR UPDATE SKIP LOCKED
 LOOP
  INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
  SELECT p.id,'mail',v_job.subject,v_job.body,v_job.payload
  FROM public.players p
  WHERE (v_job.target='one' AND p.id=v_job.recipient_id)
     OR (v_job.target='all')
     OR (v_job.target='active' AND p.last_seen_at>=clock_timestamp()-interval '7 days');
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  UPDATE territory_private.admin_scheduled_mail_v1
   SET status='sent',sent_count=v_sent,finished_at=clock_timestamp()
   WHERE id=v_job.id;
  INSERT INTO public.admin_audit_log(action,details)
  VALUES('mail_scheduled_sent',jsonb_build_object('id',v_job.id,'recipients',v_sent,'subject',v_job.subject,'target',v_job.target));
  v_jobs := v_jobs+1;
 END LOOP;
 RETURN v_jobs;
END $fn$;
REVOKE ALL ON FUNCTION public.territory_admin_mail_dispatch_v1() FROM PUBLIC,anon,authenticated,service_role;

-- Runs in Postgres even if the owner closes Telegram or goes offline.
SELECT cron.schedule(
 'territory-admin-mail-v1',
 '* * * * *',
 'SELECT public.territory_admin_mail_dispatch_v1();'
);
