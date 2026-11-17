-- Draft only. DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- Community bot only, isolated from gameplay/economy/auth.
-- Create the final migration through the Supabase CLI before releasing.
ALTER TABLE public.territory_community_control
  ADD COLUMN IF NOT EXISTS humor_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS humor_mode text NOT NULL DEFAULT 'mentions',
  ADD COLUMN IF NOT EXISTS humor_next_reply_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  ADD COLUMN IF NOT EXISTS humor_day date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS humor_sent_today integer NOT NULL DEFAULT 0;

-- Existing control rows keep humor disabled. Owner can set mode after rollout.
CREATE OR REPLACE FUNCTION public.territory_community_humor_claim_v1(
 p_chat_id bigint, p_kind text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; n integer; cooldown interval;
BEGIN
 IF auth.role() <> 'service_role' THEN RETURN false; END IF;
 IF p_kind NOT IN ('direct','ambient') THEN RETURN false; END IF;
 SELECT * INTO c FROM public.territory_community_control WHERE singleton=1 FOR UPDATE;
 IF NOT FOUND OR NOT c.enabled OR NOT c.humor_enabled
    OR c.group_chat_id IS DISTINCT FROM p_chat_id THEN RETURN false; END IF;
 IF p_kind='ambient' AND c.humor_mode <> 'lively' THEN RETURN false; END IF;
 n := CASE WHEN c.humor_day=CURRENT_DATE THEN c.humor_sent_today ELSE 0 END;
 -- Hard budget stop: at most 15 generated group replies per day.
 IF n>=15 OR c.humor_next_reply_at > now() THEN RETURN false; END IF;
 cooldown := CASE WHEN p_kind='ambient' THEN interval '15 minutes' ELSE interval '2 minutes' END;
 UPDATE public.territory_community_control
 SET humor_next_reply_at=now()+cooldown,
     humor_day=CURRENT_DATE,
     humor_sent_today=n+1,
     updated_at=now()
 WHERE singleton=1;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.territory_community_humor_claim_v1(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_community_humor_claim_v1(bigint,text) TO service_role;
