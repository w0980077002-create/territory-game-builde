/*
# Territory Game — Core Schema

## Purpose
Store player profiles, game state, arena battles, and leaderboard data for a Telegram-based RPG game (Call of Odins analog).

## New Tables

1. `players` — player profile linked to Telegram
   - `id` uuid PK (auth.users)
   - `telegram_id` bigint unique — Telegram user ID
   - `username` text — Telegram username
   - `photo_url` text — Telegram avatar URL
   - `display_name` text — in-game name
   - `level` int default 1
   - `xp` int default 0
   - `gold` int default 100
   - `gems` int default 10
   - `energy` int default 20
   - `max_energy` int default 20
   - `current_chapter` int default 1
   - `chapter_wins` int default 0
   - `total_battles_won` int default 0
   - `total_bosses_defeated` int default 0
   - `arena_wins` int default 0
   - `arena_losses` int default 0
   - `arena_rating` int default 1000
   - `forge_materials` int default 0
   - `created_at` timestamptz
   - `updated_at` timestamptz

2. `player_inventory` — items owned by players
   - `id` uuid PK
   - `player_id` uuid FK -> players
   - `item_key` text — item identifier
   - `item_name` text
   - `item_icon` text
   - `item_type` text (potion/elixir/equipment/material)
   - `rarity` text (common/rare/epic/legendary)
   - `quantity` int default 1
   - `slot` text nullable (weapon/armor/helmet/boots/ring)
   - `attack` int default 0
   - `defense` int default 0
   - `hp` int default 0
   - `crit_chance` int default 0
   - `item_level` int default 1
   - `equipped` bool default false
   - `created_at` timestamptz

3. `arena_battles` — PvP battle records
   - `id` uuid PK
   - `attacker_id` uuid FK -> players
   - `defender_id` uuid FK -> players
   - `winner_id` uuid FK -> players
   - `attacker_rating_before` int
   - `defender_rating_before` int
   - `rating_change` int
   - `reward_gold` int
   - `reward_xp` int
   - `battle_log` jsonb
   - `created_at` timestamptz

4. `leaderboard` — cached leaderboard view
   - `player_id` uuid FK -> players
   - `level` int
   - `arena_rating` int
   - `total_battles_won` int
   - `arena_wins` int
   - `updated_at` timestamptz

## Security
- RLS enabled on all tables
- Players can only read/write their own data
- Arena battles visible to participants only
- Leaderboard is publicly readable (all players can see rankings)
- All owner columns default to auth.uid()
*/

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id bigint UNIQUE,
  username text,
  photo_url text,
  display_name text NOT NULL DEFAULT 'Герой',
  level int NOT NULL DEFAULT 1,
  xp int NOT NULL DEFAULT 0,
  gold int NOT NULL DEFAULT 100,
  gems int NOT NULL DEFAULT 10,
  energy int NOT NULL DEFAULT 20,
  max_energy int NOT NULL DEFAULT 20,
  current_chapter int NOT NULL DEFAULT 1,
  chapter_wins int NOT NULL DEFAULT 0,
  total_battles_won int NOT NULL DEFAULT 0,
  total_bosses_defeated int NOT NULL DEFAULT 0,
  arena_wins int NOT NULL DEFAULT 0,
  arena_losses int NOT NULL DEFAULT 0,
  arena_rating int NOT NULL DEFAULT 1000,
  forge_materials int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_player" ON players;
CREATE POLICY "select_own_player" ON players FOR SELECT
TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_player" ON players;
CREATE POLICY "insert_own_player" ON players FOR INSERT
TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_player" ON players;
CREATE POLICY "update_own_player" ON players FOR UPDATE
TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Player inventory table
CREATE TABLE IF NOT EXISTS player_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL DEFAULT auth.uid() REFERENCES players(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  item_name text NOT NULL,
  item_icon text NOT NULL,
  item_type text NOT NULL,
  rarity text NOT NULL DEFAULT 'common',
  quantity int NOT NULL DEFAULT 1,
  slot text,
  attack int NOT NULL DEFAULT 0,
  defense int NOT NULL DEFAULT 0,
  hp int NOT NULL DEFAULT 0,
  crit_chance int NOT NULL DEFAULT 0,
  item_level int NOT NULL DEFAULT 1,
  equipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE player_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_inventory" ON player_inventory;
CREATE POLICY "select_own_inventory" ON player_inventory FOR SELECT
TO authenticated USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "insert_own_inventory" ON player_inventory;
CREATE POLICY "insert_own_inventory" ON player_inventory FOR INSERT
TO authenticated WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "update_own_inventory" ON player_inventory;
CREATE POLICY "update_own_inventory" ON player_inventory FOR UPDATE
TO authenticated USING (auth.uid() = player_id) WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "delete_own_inventory" ON player_inventory;
CREATE POLICY "delete_own_inventory" ON player_inventory FOR DELETE
TO authenticated USING (auth.uid() = player_id);

-- Arena battles table
CREATE TABLE IF NOT EXISTS arena_battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  defender_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  winner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  attacker_rating_before int NOT NULL,
  defender_rating_before int NOT NULL,
  rating_change int NOT NULL,
  reward_gold int NOT NULL DEFAULT 0,
  reward_xp int NOT NULL DEFAULT 0,
  battle_log jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE arena_battles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_battles" ON arena_battles;
CREATE POLICY "select_own_battles" ON arena_battles FOR SELECT
TO authenticated USING (auth.uid() = attacker_id OR auth.uid() = defender_id);

DROP POLICY IF EXISTS "insert_battle" ON arena_battles;
CREATE POLICY "insert_battle" ON arena_battles FOR INSERT
TO authenticated WITH CHECK (auth.uid() = attacker_id OR auth.uid() = defender_id);

-- Leaderboard table (publicly readable)
CREATE TABLE IF NOT EXISTS leaderboard (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  level int NOT NULL DEFAULT 1,
  arena_rating int NOT NULL DEFAULT 1000,
  total_battles_won int NOT NULL DEFAULT 0,
  arena_wins int NOT NULL DEFAULT 0,
  photo_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_leaderboard" ON leaderboard;
CREATE POLICY "select_leaderboard" ON leaderboard FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_leaderboard" ON leaderboard;
CREATE POLICY "insert_own_leaderboard" ON leaderboard FOR INSERT
TO authenticated WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "update_own_leaderboard" ON leaderboard;
CREATE POLICY "update_own_leaderboard" ON leaderboard FOR UPDATE
TO authenticated USING (auth.uid() = player_id) WITH CHECK (auth.uid() = player_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory(player_id);
CREATE INDEX IF NOT EXISTS idx_arena_attacker ON arena_battles(attacker_id);
CREATE INDEX IF NOT EXISTS idx_arena_defender ON arena_battles(defender_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_rating ON leaderboard(arena_rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_telegram ON players(telegram_id);
