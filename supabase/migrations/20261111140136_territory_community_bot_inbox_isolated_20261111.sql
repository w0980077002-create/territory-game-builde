-- Isolated Telegram community-bot inbox: applied to live Supabase wmyrdpbwlkzsktnhookx
-- via migration 20261111140136 on 2026-11-11 with owner approval.
-- No user game tables, auth, wallets, inventory or other existing functions are modified.
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
  primary key (chat_id, message_id)
);
alter table public.territory_community_inbox enable row level security;
revoke all on table public.territory_community_inbox from public, anon, authenticated;
grant select, insert, update, delete on table public.territory_community_inbox to service_role;
create index if not exists territory_community_inbox_priority_created_idx
  on public.territory_community_inbox(priority, created_at desc);
select cron.schedule(
  'territory-community-inbox-30day-prune',
  '15 3 * * *',
  $$delete from public.territory_community_inbox where created_at < now() - interval '30 days'$$
);
