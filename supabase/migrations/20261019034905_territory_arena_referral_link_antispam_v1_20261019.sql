-- Quietly reject referral links/advertising in the in-game arena chat.
-- Public Telegram groups are separate and are NOT moderated by this RPC.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE original text; updated text; anchor text;
BEGIN
 IF to_regprocedure('public.arena_chat(uuid,text)') IS NULL
 THEN RAISE EXCEPTION 'arena_chat_missing'; END IF;
 IF NOT (SELECT p.prosecdef AND 'search_path=public'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
  FROM pg_proc p WHERE p.oid='public.arena_chat(uuid,text)'::regprocedure)
 THEN RAISE EXCEPTION 'arena_chat_security_changed'; END IF;
 original:=pg_get_functiondef('public.arena_chat(uuid,text)'::regprocedure);
 IF strpos(original,'chat_link_blocked')<>0 THEN RAISE EXCEPTION 'arena_chat_already_moderated'; END IF;
 anchor:='IF v_text = '''' THEN RAISE EXCEPTION ''empty''; END IF;';
 IF strpos(original,anchor)=0 THEN RAISE EXCEPTION 'arena_chat_body_changed'; END IF;
 updated:=replace(original,anchor,anchor||E'\n  '||
   'IF v_text ~* ''(https?://|www[.]|t[.]me|telegram[.]me|startapp[[:space:]]*=|ref_[a-f0-9]{14})'' THEN RAISE EXCEPTION ''chat_link_blocked''; END IF;');
 IF updated=original THEN RAISE EXCEPTION 'arena_chat_filter_not_applied'; END IF;
 EXECUTE updated;
END $patch$;
COMMIT;
