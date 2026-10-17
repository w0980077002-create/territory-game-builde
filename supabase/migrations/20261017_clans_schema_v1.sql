
CREATE TABLE clans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tag text NOT NULL,
  emblem integer NOT NULL DEFAULT 1,
  color1 text NOT NULL DEFAULT '#eab308'::text,
  color2 text NOT NULL DEFAULT '#1e293b'::text,
  description text NOT NULL DEFAULT ''::text,
  join_mode text NOT NULL DEFAULT 'apply'::text,
  min_level integer NOT NULL DEFAULT 1,
  leader_id uuid NOT NULL,
  level integer NOT NULL DEFAULT 1,
  xp integer NOT NULL DEFAULT 0,
  xp_today integer NOT NULL DEFAULT 0,
  xp_day date NOT NULL DEFAULT CURRENT_DATE,
  rating integer NOT NULL DEFAULT 1000,
  treasury_gold bigint NOT NULL DEFAULT 0,
  treasury_points integer NOT NULL DEFAULT 0,
  buildings jsonb NOT NULL DEFAULT '{}'::jsonb,
  boss_no integer NOT NULL DEFAULT 1,
  season_medal integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clans_name_lower_key ON clans USING btree (lower(name));
CREATE UNIQUE INDEX clans_pkey ON clans USING btree (id);
CREATE INDEX clans_rating_idx ON clans USING btree (rating DESC, level DESC);
CREATE UNIQUE INDEX clans_tag_lower_key ON clans USING btree (lower(tag));

CREATE TABLE clan_members (
  clan_id uuid NOT NULL,
  player_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  display_name text NOT NULL DEFAULT ''::text,
  level integer NOT NULL DEFAULT 1,
  power integer NOT NULL DEFAULT 0,
  contributed_gold bigint NOT NULL DEFAULT 0,
  contributed_points integer NOT NULL DEFAULT 0,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  last_active_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX clan_members_clan_idx ON clan_members USING btree (clan_id, power DESC);
CREATE UNIQUE INDEX clan_members_pkey ON clan_members USING btree (player_id);

CREATE TABLE clan_applications (
  id bigint GENERATED ALWAYS AS IDENTITY,
  clan_id uuid NOT NULL,
  player_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clan_applications_clan_id_player_id_key ON clan_applications USING btree (clan_id, player_id);
CREATE UNIQUE INDEX clan_applications_pkey ON clan_applications USING btree (id);

CREATE TABLE clan_invites (
  id bigint GENERATED ALWAYS AS IDENTITY,
  clan_id uuid NOT NULL,
  player_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clan_invites_clan_id_player_id_key ON clan_invites USING btree (clan_id, player_id);
CREATE UNIQUE INDEX clan_invites_pkey ON clan_invites USING btree (id);

CREATE TABLE clan_chat (
  id bigint GENERATED ALWAYS AS IDENTITY,
  clan_id uuid NOT NULL,
  author_id uuid,
  author_name text NOT NULL DEFAULT ''::text,
  author_role text NOT NULL DEFAULT 'member'::text,
  kind text NOT NULL DEFAULT 'chat'::text,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX clan_chat_clan_idx ON clan_chat USING btree (clan_id, id DESC);
CREATE UNIQUE INDEX clan_chat_pkey ON clan_chat USING btree (id);

CREATE TABLE clan_chat_mutes (
  clan_id uuid NOT NULL,
  player_id uuid NOT NULL,
  until timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX clan_chat_mutes_pkey ON clan_chat_mutes USING btree (clan_id, player_id);

CREATE TABLE clan_treasury_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  clan_id uuid NOT NULL,
  player_id uuid,
  kind text NOT NULL,
  gold bigint NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX clan_treasury_log_clan_idx ON clan_treasury_log USING btree (clan_id, id DESC);
CREATE UNIQUE INDEX clan_treasury_log_pkey ON clan_treasury_log USING btree (id);

CREATE TABLE clan_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  clan_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'system'::text,
  body text NOT NULL DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX clan_events_clan_idx ON clan_events USING btree (clan_id, id DESC);
CREATE UNIQUE INDEX clan_events_pkey ON clan_events USING btree (id);

CREATE TABLE clan_bosses (
  clan_id uuid NOT NULL,
  boss_no integer NOT NULL,
  max_hp bigint NOT NULL,
  hp bigint NOT NULL,
  phase integer NOT NULL DEFAULT 1,
  spawned_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '3 days'::interval),
  killed_at timestamp with time zone
);
CREATE UNIQUE INDEX clan_bosses_pkey ON clan_bosses USING btree (clan_id);

CREATE TABLE clan_boss_damage (
  id bigint GENERATED ALWAYS AS IDENTITY,
  clan_id uuid NOT NULL,
  boss_no integer NOT NULL,
  player_id uuid NOT NULL,
  damage bigint NOT NULL,
  day date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX clan_boss_damage_day_idx ON clan_boss_damage USING btree (clan_id, day);
CREATE UNIQUE INDEX clan_boss_damage_pkey ON clan_boss_damage USING btree (id);
CREATE INDEX clan_boss_damage_player_idx ON clan_boss_damage USING btree (clan_id, player_id, boss_no);

CREATE TABLE clan_boss_claims (
  clan_id uuid NOT NULL,
  boss_no integer NOT NULL,
  player_id uuid NOT NULL,
  gold integer NOT NULL,
  claimed_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clan_boss_claims_pkey ON clan_boss_claims USING btree (clan_id, boss_no, player_id);

CREATE TABLE clan_quest_claims (
  clan_id uuid NOT NULL,
  quest_id text NOT NULL,
  period text NOT NULL,
  player_id uuid NOT NULL,
  gold integer NOT NULL,
  claimed_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clan_quest_claims_pkey ON clan_quest_claims USING btree (clan_id, quest_id, period, player_id);

CREATE TABLE clan_war_signups (
  war_key text NOT NULL,
  clan_id uuid NOT NULL,
  rating integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clan_war_signups_pkey ON clan_war_signups USING btree (clan_id);

CREATE TABLE clan_wars (
  id bigint GENERATED ALWAYS AS IDENTITY,
  war_key text NOT NULL,
  clan_a uuid NOT NULL,
  clan_b uuid NOT NULL,
  score_a bigint NOT NULL DEFAULT 0,
  score_b bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'::text,
  winner uuid,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone NOT NULL,
  resolved_at timestamp with time zone
);
CREATE INDEX clan_wars_clan_idx ON clan_wars USING btree (clan_a, clan_b, status);
CREATE UNIQUE INDEX clan_wars_pkey ON clan_wars USING btree (id);

CREATE TABLE clan_war_strikes (
  id bigint GENERATED ALWAYS AS IDENTITY,
  war_id bigint NOT NULL,
  clan_id uuid NOT NULL,
  player_id uuid NOT NULL,
  score bigint NOT NULL,
  day date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX clan_war_strikes_war_day_idx ON clan_war_strikes USING btree (war_id, day);
CREATE UNIQUE INDEX clan_war_strikes_pkey ON clan_war_strikes USING btree (id);

CREATE TABLE clan_seasons (
  id integer NOT NULL,
  started_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  archived boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX clan_seasons_pkey ON clan_seasons USING btree (id);

CREATE TABLE clan_season_archive (
  id bigint GENERATED ALWAYS AS IDENTITY,
  season integer NOT NULL,
  clan_id uuid,
  rank integer NOT NULL,
  medal integer NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT ''::text,
  tag text NOT NULL DEFAULT ''::text,
  rating integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clan_season_archive_pkey ON clan_season_archive USING btree (id);

-- RLS (mirrors live DB; needed for the harness's member-visibility check)
ALTER TABLE clan_members ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION clan_member_of(p_clan uuid, p_player uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS
'SELECT EXISTS (SELECT 1 FROM clan_members WHERE clan_id = p_clan AND player_id = p_player);';
CREATE POLICY members_select_roster ON clan_members FOR SELECT TO authenticated
USING (player_id = auth.uid() OR clan_member_of(clan_id, auth.uid()));
GRANT SELECT ON clan_members TO authenticated;
