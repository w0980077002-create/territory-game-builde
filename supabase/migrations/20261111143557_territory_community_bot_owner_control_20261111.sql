-- 2026-11-11. Standalone Telegram community control (no player/game tables).
-- Applied to live Supabase under migration 20261111143557.
-- The owner's numeric Telegram ID is operational configuration stored separately
-- in Supabase, and MUST NOT be committed to GitHub.
create table if not exists public.territory_community_control (
  singleton smallint primary key default 1 check (singleton = 1),
  owner_telegram_id bigint not null check (owner_telegram_id > 0),
  group_chat_id bigint unique,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.territory_community_control enable row level security;
revoke all on table public.territory_community_control from public, anon, authenticated;
grant select, insert, update on table public.territory_community_control to service_role;
comment on table public.territory_community_control is
  'Separate Telegram group-monitoring bot control. No game data; only service_role access.';
