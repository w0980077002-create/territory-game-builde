-- DRAFT ONLY for issue #485: DO NOT apply to production without owner approval.
-- Isolated from player data; messages are accessible only to the service role.
create table if not exists public.territory_community_inbox (
  chat_id bigint not null,
  message_id bigint not null,
  sender_id bigint,
  sender_username text,
  message_text text not null,
  message_url text,
  category text not null check (category in ('access_or_loss','bug_report','suggestion','balance','general')),
  priority text not null check (priority in ('P0','P1','P2','P3')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  alert_sent_at timestamptz,
  primary key(chat_id,message_id)
);
alter table public.territory_community_inbox enable row level security;
revoke all on table public.territory_community_inbox from public, anon, authenticated;
grant select, insert, update, delete on table public.territory_community_inbox to service_role;
create index if not exists territory_community_inbox_priority_created_idx
  on public.territory_community_inbox(priority,created_at desc);
-- Require an active 30-day retention mechanism before enabling live collection.
-- Suggested scheduled operation after approval:
-- DELETE FROM public.territory_community_inbox
-- WHERE created_at < now() - interval '30 days';
