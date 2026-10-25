-- TERRITORY 1.0 — STAGE 8 SERVER-AUTHORITATIVE PROFESSIONS (STAGING ONLY).
-- DO NOT ADD TO migrations/, APPLY TO PRODUCTION, OR ENABLE THE RELEASE FLAG.
-- Requires reviewed Stage3 server foundations and reconciled/verified mastery.
-- Generated catalogue below must match scripts/professions/stage8-model.mjs.
-- Reusable operation IDs, serial player locks, authoritative wallets and Kyiv-day
-- XP quota make training and item crafting one protected economic operation.

BEGIN;

-- Fresh, versioned tables leave historic receipts, items and mastery untouched.
CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_release (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  cutover_at timestamptz,
  version text NOT NULL DEFAULT 'profession-stage8-draft-20261025'
    CHECK (version = 'profession-stage8-draft-20261025'),
  CONSTRAINT stage8_cutover_required CHECK (NOT enabled OR cutover_at IS NOT NULL)
);
INSERT INTO public.territory_profession_stage8_release(id,enabled)
VALUES (1,false) ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled)
    THEN RAISE EXCEPTION 'stage8_active_refuse_draft_reapply'; END IF;
END $$;
ALTER TABLE public.territory_profession_stage8_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_release FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_bands (
  from_level integer PRIMARY KEY CHECK (from_level BETWEEN 1 AND 299),
  to_level integer NOT NULL CHECK (to_level BETWEEN from_level AND 299),
  xp_to_next integer NOT NULL CHECK (xp_to_next BETWEEN 1 AND 100000)
);
INSERT INTO public.territory_profession_stage8_bands(from_level,to_level,xp_to_next) VALUES
  (1,24,26),(25,49,67),(50,99,90),(100,149,162),
  (150,199,270),(200,249,383),(250,299,513)
ON CONFLICT (from_level) DO NOTHING;
ALTER TABLE public.territory_profession_stage8_bands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_bands FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_catalog (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 90),
  profession text NOT NULL CHECK (profession IN ('smith','alchemist','artisan','jeweler','engineer')),
  required_level integer NOT NULL CHECK (required_level BETWEEN 1 AND 300),
  kind text NOT NULL CHECK (kind IN ('practice','item')),
  mastery_xp integer NOT NULL CHECK (mastery_xp BETWEEN 1 AND 300),
  ingredients jsonb NOT NULL CHECK (jsonb_typeof(ingredients) = 'array' AND jsonb_array_length(ingredients) BETWEEN 1 AND 4),
  item_output jsonb CHECK (
    (kind='practice' AND item_output IS NULL)
    OR (kind='item' AND jsonb_typeof(item_output)='object')
  )
);
ALTER TABLE public.territory_profession_stage8_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_catalog FROM PUBLIC, anon, authenticated;

-- DO NOT rewrite v1 mastery: its XP formula differs from Stage8. An audited
-- one-time reconciliation creates this row and converts fractional progress,
-- preserving the player's achieved level and existing v1 data. New rows are
-- unverified by default so an operator cannot accidentally enable progression
-- for unreconciled accounts by flipping the release flag.
CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_progress (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  profession text NOT NULL CHECK (profession IN ('smith','alchemist','artisan','jeweler','engineer')),
  mastery_level integer NOT NULL CHECK (mastery_level BETWEEN 1 AND 300),
  mastery_xp integer NOT NULL CHECK (mastery_xp BETWEEN 0 AND 100000),
  verified boolean NOT NULL DEFAULT false,
  origin text NOT NULL DEFAULT 'verified_v1' CHECK(origin IN ('verified_v1','new_unlock')),
  original_v1_level integer CHECK (original_v1_level BETWEEN 1 AND 300),
  original_v1_xp integer CHECK (original_v1_xp BETWEEN 0 AND 100000),
  reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT stage8_verified_requires_audit CHECK (NOT verified OR reconciled_at IS NOT NULL),
  CONSTRAINT stage8_progress_origin_check CHECK (
    (origin='verified_v1' AND original_v1_level IS NOT NULL AND original_v1_xp IS NOT NULL)
    OR (origin='new_unlock' AND original_v1_level IS NULL AND original_v1_xp IS NULL)
  )
);
ALTER TABLE public.territory_profession_stage8_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_progress FROM PUBLIC, anon, authenticated;

-- A new player may initialize after a real post-cutover purchase ONLY when a
-- trusted purchase handler (service_role) recorded an immutable receipt here.
-- The old unlock timestamp by itself is not proof that the gem debit was
-- server-authoritative. No authenticated INSERT/UPDATE/DELETE on this table.
CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_new_unlock_events (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  profession text NOT NULL CHECK (profession IN ('smith','alchemist','artisan','jeweler','engineer')),
  purchase_operation uuid NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  initialized_at timestamptz,
  gems_after integer CHECK (gems_after >= 0),
  result jsonb
);
ALTER TABLE public.territory_profession_stage8_new_unlock_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_new_unlock_events FROM PUBLIC, anon, authenticated;
-- Trusted post-cutover purchase adapter may attest a real purchase; no client
-- may mint this proof. No broad UPDATE/DELETE grants even to service_role.
GRANT INSERT ON public.territory_profession_stage8_new_unlock_events TO service_role;

-- Each calendar day is defined by the server timestamp in Europe/Kyiv.
CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_daily_xp (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  xp_used integer NOT NULL DEFAULT 0 CHECK (xp_used BETWEEN 0 AND 300),
  PRIMARY KEY (player_id,local_day)
);
ALTER TABLE public.territory_profession_stage8_daily_xp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_daily_xp FROM PUBLIC, anon, authenticated;

-- Each item is a unique, non-transferable (until future verified market) server
-- instance. Consumable expiry is server-stamped; gathered resources never expire.
CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_items (
  item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  recipe_id text NOT NULL REFERENCES public.territory_profession_stage8_catalog(id),
  item_output jsonb NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS territory_profession_stage8_item_owner_idx
  ON public.territory_profession_stage8_items(player_id,created_at DESC);
ALTER TABLE public.territory_profession_stage8_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_items FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_receipts (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  recipe_id text NOT NULL REFERENCES public.territory_profession_stage8_catalog(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE public.territory_profession_stage8_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_receipts FROM PUBLIC, anon, authenticated;

-- Catalog rows generated mechanically from the vetted 55-recipe Stage8 model.
INSERT INTO public.territory_profession_stage8_catalog
  (id,profession,required_level,kind,mastery_xp,ingredients,item_output)
SELECT r.value->>'id',r.value->>'profession',(r.value->>'requiredLevel')::integer,
  r.value->>'kind',(r.value->>'masteryXp')::integer,r.value->'ingredients',
  CASE WHEN r.value->'output'='null'::jsonb THEN NULL ELSE r.value->'output' END
FROM pg_catalog.jsonb_array_elements($stage8_catalog$[{"id":"s8_smith_practice_1","profession":"smith","requiredLevel":1,"kind":"practice","name":"Кузнец: Ученик","masteryXp":30,"ingredients":[{"id":"gather-ore","qty":1}],"output":null},{"id":"s8_smith_practice_25","profession":"smith","requiredLevel":25,"kind":"practice","name":"Кузнец: Подмастерье","masteryXp":80,"ingredients":[{"id":"gather-ore","qty":2}],"output":null},{"id":"s8_smith_practice_50","profession":"smith","requiredLevel":50,"kind":"practice","name":"Кузнец: Ремесленник","masteryXp":100,"ingredients":[{"id":"gather-wood","qty":2}],"output":null},{"id":"s8_smith_practice_100","profession":"smith","requiredLevel":100,"kind":"practice","name":"Кузнец: Опытный мастер","masteryXp":180,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_smith_practice_150","profession":"smith","requiredLevel":150,"kind":"practice","name":"Кузнец: Знаток","masteryXp":225,"ingredients":[{"id":"gather-hide","qty":3}],"output":null},{"id":"s8_smith_practice_200","profession":"smith","requiredLevel":200,"kind":"practice","name":"Кузнец: Старший мастер","masteryXp":255,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_smith_practice_250","profession":"smith","requiredLevel":250,"kind":"practice","name":"Кузнец: Великий мастер","masteryXp":285,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_alchemist_practice_1","profession":"alchemist","requiredLevel":1,"kind":"practice","name":"Алхимик: Ученик","masteryXp":30,"ingredients":[{"id":"gather-herb","qty":1}],"output":null},{"id":"s8_alchemist_practice_25","profession":"alchemist","requiredLevel":25,"kind":"practice","name":"Алхимик: Подмастерье","masteryXp":80,"ingredients":[{"id":"gather-herb","qty":2}],"output":null},{"id":"s8_alchemist_practice_50","profession":"alchemist","requiredLevel":50,"kind":"practice","name":"Алхимик: Ремесленник","masteryXp":100,"ingredients":[{"id":"gather-wood","qty":2}],"output":null},{"id":"s8_alchemist_practice_100","profession":"alchemist","requiredLevel":100,"kind":"practice","name":"Алхимик: Опытный мастер","masteryXp":180,"ingredients":[{"id":"gather-herb","qty":3}],"output":null},{"id":"s8_alchemist_practice_150","profession":"alchemist","requiredLevel":150,"kind":"practice","name":"Алхимик: Знаток","masteryXp":225,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_alchemist_practice_200","profession":"alchemist","requiredLevel":200,"kind":"practice","name":"Алхимик: Старший мастер","masteryXp":255,"ingredients":[{"id":"gather-herb","qty":3}],"output":null},{"id":"s8_alchemist_practice_250","profession":"alchemist","requiredLevel":250,"kind":"practice","name":"Алхимик: Великий мастер","masteryXp":285,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_artisan_practice_1","profession":"artisan","requiredLevel":1,"kind":"practice","name":"Ремесленник: Ученик","masteryXp":30,"ingredients":[{"id":"gather-wood","qty":1}],"output":null},{"id":"s8_artisan_practice_25","profession":"artisan","requiredLevel":25,"kind":"practice","name":"Ремесленник: Подмастерье","masteryXp":80,"ingredients":[{"id":"gather-wood","qty":2}],"output":null},{"id":"s8_artisan_practice_50","profession":"artisan","requiredLevel":50,"kind":"practice","name":"Ремесленник: Ремесленник","masteryXp":100,"ingredients":[{"id":"gather-hide","qty":2}],"output":null},{"id":"s8_artisan_practice_100","profession":"artisan","requiredLevel":100,"kind":"practice","name":"Ремесленник: Опытный мастер","masteryXp":180,"ingredients":[{"id":"gather-wood","qty":3}],"output":null},{"id":"s8_artisan_practice_150","profession":"artisan","requiredLevel":150,"kind":"practice","name":"Ремесленник: Знаток","masteryXp":225,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_artisan_practice_200","profession":"artisan","requiredLevel":200,"kind":"practice","name":"Ремесленник: Старший мастер","masteryXp":255,"ingredients":[{"id":"gather-wood","qty":3}],"output":null},{"id":"s8_artisan_practice_250","profession":"artisan","requiredLevel":250,"kind":"practice","name":"Ремесленник: Великий мастер","masteryXp":285,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_jeweler_practice_1","profession":"jeweler","requiredLevel":1,"kind":"practice","name":"Ювелир: Ученик","masteryXp":30,"ingredients":[{"id":"gather-ore","qty":1}],"output":null},{"id":"s8_jeweler_practice_25","profession":"jeweler","requiredLevel":25,"kind":"practice","name":"Ювелир: Подмастерье","masteryXp":80,"ingredients":[{"id":"gather-ore","qty":2}],"output":null},{"id":"s8_jeweler_practice_50","profession":"jeweler","requiredLevel":50,"kind":"practice","name":"Ювелир: Ремесленник","masteryXp":100,"ingredients":[{"id":"gather-crystal","qty":2}],"output":null},{"id":"s8_jeweler_practice_100","profession":"jeweler","requiredLevel":100,"kind":"practice","name":"Ювелир: Опытный мастер","masteryXp":180,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_jeweler_practice_150","profession":"jeweler","requiredLevel":150,"kind":"practice","name":"Ювелир: Знаток","masteryXp":225,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_jeweler_practice_200","profession":"jeweler","requiredLevel":200,"kind":"practice","name":"Ювелир: Старший мастер","masteryXp":255,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_jeweler_practice_250","profession":"jeweler","requiredLevel":250,"kind":"practice","name":"Ювелир: Великий мастер","masteryXp":285,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_engineer_practice_1","profession":"engineer","requiredLevel":1,"kind":"practice","name":"Инженер: Ученик","masteryXp":30,"ingredients":[{"id":"gather-wood","qty":1}],"output":null},{"id":"s8_engineer_practice_25","profession":"engineer","requiredLevel":25,"kind":"practice","name":"Инженер: Подмастерье","masteryXp":80,"ingredients":[{"id":"gather-ore","qty":2}],"output":null},{"id":"s8_engineer_practice_50","profession":"engineer","requiredLevel":50,"kind":"practice","name":"Инженер: Ремесленник","masteryXp":100,"ingredients":[{"id":"gather-wood","qty":2}],"output":null},{"id":"s8_engineer_practice_100","profession":"engineer","requiredLevel":100,"kind":"practice","name":"Инженер: Опытный мастер","masteryXp":180,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_engineer_practice_150","profession":"engineer","requiredLevel":150,"kind":"practice","name":"Инженер: Знаток","masteryXp":225,"ingredients":[{"id":"gather-wood","qty":3}],"output":null},{"id":"s8_engineer_practice_200","profession":"engineer","requiredLevel":200,"kind":"practice","name":"Инженер: Старший мастер","masteryXp":255,"ingredients":[{"id":"gather-ore","qty":3}],"output":null},{"id":"s8_engineer_practice_250","profession":"engineer","requiredLevel":250,"kind":"practice","name":"Инженер: Великий мастер","masteryXp":285,"ingredients":[{"id":"gather-crystal","qty":3}],"output":null},{"id":"s8_smith_watch_blade","profession":"smith","requiredLevel":25,"masteryXp":100,"kind":"item","ingredients":[{"id":"gather-ore","qty":5},{"id":"gather-wood","qty":2}],"output":{"name":"Клинок дозорного","icon":"🗡️","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Клинок дозорного.","equipment":{"slot":"weapon","rarity":"rare","level":3,"attack":17,"critChance":2,"name":"Клинок дозорного","icon":"🗡️"}}},{"id":"s8_smith_north_armor","profession":"smith","requiredLevel":100,"masteryXp":180,"kind":"item","ingredients":[{"id":"gather-ore","qty":9},{"id":"gather-hide","qty":6}],"output":{"name":"Латы северянина","icon":"🛡️","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Латы северянина.","equipment":{"slot":"armor","rarity":"rare","level":3,"defense":11,"hp":70,"name":"Латы северянина","icon":"🛡️"}}},{"id":"s8_smith_storm_axe","profession":"smith","requiredLevel":200,"masteryXp":255,"kind":"item","ingredients":[{"id":"gather-ore","qty":14},{"id":"gather-wood","qty":8},{"id":"gather-crystal","qty":4}],"output":{"name":"Секира бури","icon":"🪓","type":"equipment","rarity":"epic","description":"Ремесленная экипировка: Секира бури.","equipment":{"slot":"weapon","rarity":"epic","level":5,"attack":33,"critChance":7,"name":"Секира бури","icon":"🪓"}}},{"id":"s8_smith_jarl_blade","profession":"smith","requiredLevel":300,"masteryXp":1,"kind":"item","ingredients":[{"id":"gather-ore","qty":30},{"id":"gather-wood","qty":20},{"id":"gather-crystal","qty":12}],"output":{"name":"Клинок первого ярла","icon":"⚔️","type":"equipment","rarity":"legendary","description":"Ремесленная экипировка: Клинок первого ярла.","equipment":{"slot":"weapon","rarity":"legendary","level":5,"attack":35,"critChance":8,"name":"Клинок первого ярла","icon":"⚔️"}}},{"id":"s8_jeweler_spark_ring","profession":"jeweler","requiredLevel":25,"masteryXp":100,"kind":"item","ingredients":[{"id":"gather-ore","qty":4},{"id":"gather-crystal","qty":3}],"output":{"name":"Кольцо искры","icon":"💍","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Кольцо искры.","equipment":{"slot":"ring","rarity":"rare","level":3,"attack":8,"critChance":2,"name":"Кольцо искры","icon":"💍"}}},{"id":"s8_jeweler_guard_amulet","profession":"jeweler","requiredLevel":100,"masteryXp":180,"kind":"item","ingredients":[{"id":"gather-ore","qty":6},{"id":"gather-crystal","qty":7}],"output":{"name":"Оберег северных врат","icon":"📿","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Оберег северных врат.","equipment":{"slot":"amulet","rarity":"rare","level":3,"attack":5,"critChance":3,"name":"Оберег северных врат","icon":"📿"}}},{"id":"s8_jeweler_sapphire_ring","profession":"jeweler","requiredLevel":200,"masteryXp":255,"kind":"item","ingredients":[{"id":"gather-ore","qty":12},{"id":"gather-crystal","qty":12}],"output":{"name":"Сапфировое кольцо","icon":"💎","type":"equipment","rarity":"epic","description":"Ремесленная экипировка: Сапфировое кольцо.","equipment":{"slot":"ring","rarity":"epic","level":5,"attack":14,"critChance":4,"name":"Сапфировое кольцо","icon":"💎"}}},{"id":"s8_jeweler_jarl_seal","profession":"jeweler","requiredLevel":300,"masteryXp":1,"kind":"item","ingredients":[{"id":"gather-ore","qty":25},{"id":"gather-crystal","qty":20}],"output":{"name":"Печать ярла","icon":"💍","type":"equipment","rarity":"legendary","description":"Ремесленная экипировка: Печать ярла.","equipment":{"slot":"ring","rarity":"legendary","level":5,"attack":15,"critChance":5,"name":"Печать ярла","icon":"💍"}}},{"id":"s8_engineer_guard_helm","profession":"engineer","requiredLevel":25,"masteryXp":100,"kind":"item","ingredients":[{"id":"gather-ore","qty":4},{"id":"gather-wood","qty":3}],"output":{"name":"Шлем дозорного","icon":"⛑️","type":"equipment","rarity":"common","description":"Ремесленная экипировка: Шлем дозорного.","equipment":{"slot":"helmet","rarity":"common","level":1,"defense":3,"hp":20,"name":"Шлем дозорного","icon":"⛑️"}}},{"id":"s8_engineer_path_boots","profession":"engineer","requiredLevel":100,"masteryXp":180,"kind":"item","ingredients":[{"id":"gather-ore","qty":7},{"id":"gather-hide","qty":6}],"output":{"name":"Сапоги следопыта","icon":"🥾","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Сапоги следопыта.","equipment":{"slot":"boots","rarity":"rare","level":2,"defense":4,"hp":36,"critChance":1,"name":"Сапоги следопыта","icon":"🥾"}}},{"id":"s8_engineer_north_shield","profession":"engineer","requiredLevel":200,"masteryXp":255,"kind":"item","ingredients":[{"id":"gather-ore","qty":13},{"id":"gather-wood","qty":10}],"output":{"name":"Щит северной стражи","icon":"🛡️","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Щит северной стражи.","equipment":{"slot":"shield","rarity":"rare","level":2,"defense":5,"hp":25,"name":"Щит северной стражи","icon":"🛡️"}}},{"id":"s8_engineer_jarl_plate","profession":"engineer","requiredLevel":300,"masteryXp":1,"kind":"item","ingredients":[{"id":"gather-ore","qty":30},{"id":"gather-hide","qty":15},{"id":"gather-crystal","qty":8}],"output":{"name":"Доспех мастера механизмов","icon":"🛡️","type":"equipment","rarity":"legendary","description":"Ремесленная экипировка: Доспех мастера механизмов.","equipment":{"slot":"armor","rarity":"legendary","level":3,"defense":12,"hp":80,"name":"Доспех мастера механизмов","icon":"🛡️"}}},{"id":"s8_artisan_messenger_boots","profession":"artisan","requiredLevel":25,"masteryXp":100,"kind":"item","ingredients":[{"id":"gather-wood","qty":4},{"id":"gather-hide","qty":3}],"output":{"name":"Сапоги гонца","icon":"🥾","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Сапоги гонца.","equipment":{"slot":"boots","rarity":"rare","level":2,"defense":3,"hp":35,"critChance":1,"name":"Сапоги гонца","icon":"🥾"}}},{"id":"s8_artisan_trader_armor","profession":"artisan","requiredLevel":100,"masteryXp":180,"kind":"item","ingredients":[{"id":"gather-hide","qty":8},{"id":"gather-wood","qty":6}],"output":{"name":"Броня караванщика","icon":"🦺","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Броня караванщика.","equipment":{"slot":"armor","rarity":"rare","level":3,"defense":10,"hp":65,"name":"Броня караванщика","icon":"🦺"}}},{"id":"s8_artisan_north_helm","profession":"artisan","requiredLevel":200,"masteryXp":255,"kind":"item","ingredients":[{"id":"gather-ore","qty":15},{"id":"gather-hide","qty":8}],"output":{"name":"Шлем старейшины","icon":"⛑️","type":"equipment","rarity":"rare","description":"Ремесленная экипировка: Шлем старейшины.","equipment":{"slot":"helmet","rarity":"rare","level":1,"defense":3,"hp":20,"name":"Шлем старейшины","icon":"⛑️"}}},{"id":"s8_artisan_jarl_boots","profession":"artisan","requiredLevel":300,"masteryXp":1,"kind":"item","ingredients":[{"id":"gather-hide","qty":28},{"id":"gather-wood","qty":20},{"id":"gather-crystal","qty":7}],"output":{"name":"Сапоги великого мастера","icon":"🥾","type":"equipment","rarity":"legendary","description":"Ремесленная экипировка: Сапоги великого мастера.","equipment":{"slot":"boots","rarity":"legendary","level":2,"defense":4,"hp":40,"critChance":2,"name":"Сапоги великого мастера","icon":"🥾"}}},{"id":"s8_alchemist_herbal_mix","profession":"alchemist","kind":"item","requiredLevel":25,"masteryXp":100,"ingredients":[{"id":"gather-herb","qty":5},{"id":"gather-wood","qty":2}],"output":{"name":"Травяной настой","icon":"🧪","type":"potion","rarity":"common","description":"Травяной настой: 50 hp.","effect":{"stat":"hp","value":50,"duration":"instant"}}},{"id":"s8_alchemist_focus","profession":"alchemist","kind":"item","requiredLevel":100,"masteryXp":180,"ingredients":[{"id":"gather-herb","qty":9},{"id":"gather-crystal","qty":4}],"output":{"name":"Эликсир точности","icon":"✨","type":"elixir","rarity":"rare","description":"Эликсир точности: 3 critChance.","effect":{"stat":"critChance","value":3,"duration":"battle"}}},{"id":"s8_alchemist_health","profession":"alchemist","kind":"item","requiredLevel":200,"masteryXp":255,"ingredients":[{"id":"gather-herb","qty":18},{"id":"gather-crystal","qty":5}],"output":{"name":"Зелье северного здоровья","icon":"⚗️","type":"potion","rarity":"epic","description":"Зелье северного здоровья: 150 hp.","effect":{"stat":"hp","value":150,"duration":"instant"}}},{"id":"s8_alchemist_jarl_elixir","profession":"alchemist","kind":"item","requiredLevel":300,"masteryXp":1,"ingredients":[{"id":"gather-herb","qty":30},{"id":"gather-crystal","qty":16}],"output":{"name":"Эликсир стойкости ярла","icon":"🧬","type":"elixir","rarity":"epic","description":"Эликсир стойкости ярла: 15 defense.","effect":{"stat":"defense","value":15,"duration":"battle"}}}]$stage8_catalog$::jsonb) AS r(value)
-- This file refuses to run while enabled. If reapplied to an INACTIVE staging
-- database, reconcile the whole canonical catalogue, never keep stale costs.
ON CONFLICT (id) DO UPDATE SET
  profession=EXCLUDED.profession,required_level=EXCLUDED.required_level,
  kind=EXCLUDED.kind,mastery_xp=EXCLUDED.mastery_xp,
  ingredients=EXCLUDED.ingredients,item_output=EXCLUDED.item_output;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.territory_profession_stage8_catalog)<>55
    THEN RAISE EXCEPTION 'stage8_catalog_unexpected_rows'; END IF;
END $$;

-- Only a trusted, separately reviewed service-role cutover may reconcile one
-- account from VERIFIED old server mastery. Client game_state is not read.
-- An existing Stage8 row is never overwritten, and legacy data is retained.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_reconcile(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_old public.territory_profession_mastery_v1%ROWTYPE;
  v_existing public.territory_profession_stage8_progress%ROWTYPE;
  v_old_threshold integer;
  v_new_threshold integer;
  v_converted integer;
BEGIN
  IF p_player IS NULL THEN RAISE EXCEPTION 'invalid_player'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_player::text),7724);
  SELECT * INTO v_existing FROM public.territory_profession_stage8_progress
    WHERE player_id=p_player FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('success',v_existing.verified,
    'existing',true,'mastery_level',v_existing.mastery_level,
    'mastery_xp',v_existing.mastery_xp); END IF;

  SELECT * INTO v_old FROM public.territory_profession_mastery_v1
    WHERE player_id=p_player AND verified=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy_mastery_not_verified'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_unlocks
    WHERE player_id=p_player AND profession=v_old.profession)
    THEN RAISE EXCEPTION 'profession_disagreement'; END IF;

  IF v_old.mastery_level=300 THEN
    IF v_old.mastery_xp<>0 THEN RAISE EXCEPTION 'legacy_mastery_xp_invalid'; END IF;
    v_converted:=0;
  ELSE
    v_old_threshold:=100+(v_old.mastery_level-1)*25;
    IF v_old.mastery_xp<0 OR v_old.mastery_xp>=v_old_threshold
      THEN RAISE EXCEPTION 'legacy_mastery_xp_invalid'; END IF;
    SELECT xp_to_next INTO v_new_threshold FROM public.territory_profession_stage8_bands
      WHERE v_old.mastery_level BETWEEN from_level AND to_level;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_mastery_band'; END IF;
    -- Exact level retained; fractional progress mapped to the new scale.
    v_converted:=floor((v_old.mastery_xp::numeric / v_old_threshold) * v_new_threshold)::integer;
  END IF;

  INSERT INTO public.territory_profession_stage8_progress(
    player_id,profession,mastery_level,mastery_xp,verified,
    original_v1_level,original_v1_xp,reconciled_at)
  VALUES(p_player,v_old.profession,v_old.mastery_level,v_converted,true,
    v_old.mastery_level,v_old.mastery_xp,clock_timestamp());
  RETURN jsonb_build_object('success',true,'existing',false,
    'mastery_level',v_old.mastery_level,'mastery_xp',v_converted);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_reconcile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_reconcile(uuid) TO service_role;

-- Conservative release preflight: neither anon nor authenticated may directly
-- mint gems, resources or unlocks, and the old purchase RPC must be revoked.
-- A denied RLS policy alone does NOT count as enough here; the ACL must be
-- hardened so no legacy client can restore server-spent currency.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_economy_ready()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_old_rpc oid := pg_catalog.to_regprocedure('public.territory_profession_unlock(text)');
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF pg_catalog.has_column_privilege(v_role,'public.players','gems','INSERT')
      OR pg_catalog.has_column_privilege(v_role,'public.players','gems','UPDATE')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_resource_wallet','quantity','INSERT')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_resource_wallet','quantity','UPDATE')
      OR pg_catalog.has_table_privilege(v_role,'public.territory_resource_wallet','DELETE')
      OR pg_catalog.has_table_privilege(v_role,'public.territory_profession_unlocks','INSERT')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_profession_unlocks','profession','INSERT')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_profession_unlocks','profession','UPDATE')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_profession_unlocks','master_license','UPDATE')
      OR pg_catalog.has_table_privilege(v_role,'public.territory_profession_mastery_v1','INSERT')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_profession_mastery_v1','mastery_level','UPDATE')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_profession_mastery_v1','mastery_xp','UPDATE')
      OR pg_catalog.has_column_privilege(v_role,'public.territory_profession_mastery_v1','verified','UPDATE')
      OR (v_old_rpc IS NOT NULL AND pg_catalog.has_function_privilege(v_role,v_old_rpc,'EXECUTE'))
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_economy_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_economy_ready() TO service_role;

-- Atomic purchase for genuinely NEW accounts only. Existing accounts go through
-- the audited v1 reconciliation path. Never infer "new" from absent mastery:
-- the player creation timestamp MUST be after the signed-off cutover instant.
-- Refuse purchase while authenticated users can UPDATE players.gems directly.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_purchase(p_profession text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_player public.players%ROWTYPE;
  v_event public.territory_profession_stage8_new_unlock_events%ROWTYPE;
  v_cutover timestamptz;
  v_after integer;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_operation IS NULL OR p_profession IS NULL
    OR p_profession NOT IN ('smith','alchemist','artisan','jeweler','engineer')
    THEN RAISE EXCEPTION 'invalid_request'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_event FROM public.territory_profession_stage8_new_unlock_events
    WHERE player_id=v_uid FOR UPDATE;
  IF FOUND THEN
    IF v_event.purchase_operation<>p_operation OR v_event.profession<>p_profession
      THEN RAISE EXCEPTION 'profession_already_purchased'; END IF;
    IF v_event.result IS NULL THEN RAISE EXCEPTION 'purchase_receipt_not_ready'; END IF;
    RETURN v_event.result;
  END IF;

  SELECT cutover_at INTO v_cutover FROM public.territory_profession_stage8_release
    WHERE id=1 AND enabled=true;
  IF NOT FOUND OR v_cutover IS NULL THEN RAISE EXCEPTION 'profession_stage8_disabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  SELECT * INTO v_player FROM public.players WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_player.banned THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF v_player.created_at<v_cutover THEN RAISE EXCEPTION 'legacy_account_requires_review'; END IF;
  IF EXISTS(SELECT 1 FROM public.territory_profession_mastery_v1 WHERE player_id=v_uid)
    OR EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress WHERE player_id=v_uid)
    OR EXISTS(SELECT 1 FROM public.territory_profession_unlocks WHERE player_id=v_uid)
    THEN RAISE EXCEPTION 'existing_profession_requires_review'; END IF;
  IF v_player.gems IS NULL OR v_player.gems<1000 THEN RAISE EXCEPTION 'insufficient_gems'; END IF;

  UPDATE public.players SET gems=gems-1000 WHERE id=v_uid AND gems>=1000
    RETURNING gems INTO v_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_gems'; END IF;
  INSERT INTO public.territory_profession_unlocks(player_id,profession)
    VALUES(v_uid,p_profession);
  INSERT INTO public.territory_profession_stage8_progress(
    player_id,profession,mastery_level,mastery_xp,verified,origin,
    original_v1_level,original_v1_xp,reconciled_at)
  VALUES(v_uid,p_profession,1,0,true,'new_unlock',NULL,NULL,clock_timestamp());
  v_result:=jsonb_build_object('success',true,'profession',p_profession,
    'gems_after',v_after,'mastery_level',1,'mastery_xp',0);
  INSERT INTO public.territory_profession_stage8_new_unlock_events(
    player_id,profession,purchase_operation,verified_at,initialized_at,gems_after,result)
  VALUES(v_uid,p_profession,p_operation,clock_timestamp(),clock_timestamp(),v_after,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_purchase(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_purchase(text,uuid) TO authenticated, service_role;

-- Fallback for a purchase performed by a separately reviewed service-role
-- adapter which has already written a trusted new_unlock_event. It never
-- deducts currency, never creates a profession without that server proof,
-- and NEVER reinitializes a legacy account or an existing Stage8 account.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_initialize()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_event public.territory_profession_stage8_new_unlock_events%ROWTYPE;
  v_progress public.territory_profession_stage8_progress%ROWTYPE;
  v_cutover timestamptz;
  v_created timestamptz;
  v_profession text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_progress FROM public.territory_profession_stage8_progress
    WHERE player_id=v_uid FOR UPDATE;
  IF FOUND THEN
    IF NOT v_progress.verified THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
    RETURN jsonb_build_object('success',true,'existing',true,
      'profession',v_progress.profession,'mastery_level',v_progress.mastery_level,
      'mastery_xp',v_progress.mastery_xp);
  END IF;
  SELECT cutover_at INTO v_cutover FROM public.territory_profession_stage8_release
    WHERE id=1 AND enabled=true;
  IF NOT FOUND OR v_cutover IS NULL THEN RAISE EXCEPTION 'profession_stage8_disabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  SELECT created_at INTO v_created FROM public.players WHERE id=v_uid AND banned=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF v_created<v_cutover THEN RAISE EXCEPTION 'legacy_account_requires_review'; END IF;
  IF EXISTS(SELECT 1 FROM public.territory_profession_mastery_v1 WHERE player_id=v_uid)
    THEN RAISE EXCEPTION 'legacy_mastery_requires_reconciliation'; END IF;
  SELECT * INTO v_event FROM public.territory_profession_stage8_new_unlock_events
    WHERE player_id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_event.verified_at<v_cutover
    THEN RAISE EXCEPTION 'verified_new_purchase_required'; END IF;
  SELECT profession INTO v_profession FROM public.territory_profession_unlocks WHERE player_id=v_uid;
  IF NOT FOUND OR v_profession<>v_event.profession THEN RAISE EXCEPTION 'profession_disagreement'; END IF;
  INSERT INTO public.territory_profession_stage8_progress(
    player_id,profession,mastery_level,mastery_xp,verified,origin,
    original_v1_level,original_v1_xp,reconciled_at)
  VALUES(v_uid,v_profession,1,0,true,'new_unlock',NULL,NULL,clock_timestamp());
  UPDATE public.territory_profession_stage8_new_unlock_events
    SET initialized_at=clock_timestamp() WHERE player_id=v_uid;
  RETURN jsonb_build_object('success',true,'existing',false,
    'profession',v_profession,'mastery_level',1,'mastery_xp',0);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_initialize() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_initialize() TO authenticated, service_role;

-- No trust in browser-supplied amounts or inventory snapshots. All readbacks
-- come from the same server tables used by the write RPC.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_status()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_enabled boolean := false;
  v_progress public.territory_profession_stage8_progress%ROWTYPE;
  v_license boolean := false;
  v_unlock text;
  v_created timestamptz;
  v_cutover timestamptz;
  v_resources jsonb := '{}'::jsonb;
  v_used integer := 0;
  v_day date := (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  SELECT enabled,cutover_at INTO v_enabled,v_cutover FROM public.territory_profession_stage8_release WHERE id=1;
  IF NOT COALESCE(v_enabled,false) THEN
    RETURN jsonb_build_object('enabled',false,'version','profession-stage8-draft-20261025');
  END IF;
  IF NOT public.territory_profession_stage8_economy_ready() THEN
    RETURN jsonb_build_object('enabled',false,
      'version','profession-stage8-draft-20261025','reason','economy_not_server_authoritative');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  SELECT * INTO v_progress FROM public.territory_profession_stage8_progress
    WHERE player_id=v_uid AND verified=true;
  IF NOT FOUND THEN
    SELECT profession INTO v_unlock FROM public.territory_profession_unlocks WHERE player_id=v_uid;
    IF FOUND OR EXISTS(SELECT 1 FROM public.territory_profession_mastery_v1 WHERE player_id=v_uid)
      OR EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress WHERE player_id=v_uid)
      THEN RETURN jsonb_build_object('enabled',false,
        'version','profession-stage8-draft-20261025','reason','mastery_not_reconciled'); END IF;
    SELECT created_at INTO v_created FROM public.players WHERE id=v_uid;
    IF v_cutover IS NULL OR v_created<v_cutover THEN
      RETURN jsonb_build_object('enabled',false,
        'version','profession-stage8-draft-20261025','reason','legacy_account_requires_review');
    END IF;
    -- Clean post-cutover player with NO unlock can see the chooser, but must
    -- use the atomic Stage8 purchase RPC; status never creates a profession.
    SELECT COALESCE(jsonb_object_agg(resource_id,quantity),'{}'::jsonb) INTO v_resources
      FROM public.territory_resource_wallet WHERE player_id=v_uid;
    RETURN jsonb_build_object('enabled',true,'version','profession-stage8-draft-20261025',
      'profession',NULL,'mastery_level',1,'mastery_xp',0,'daily_xp_used',0,
      'daily_xp_cap',300,'master_license',false,'resources',v_resources);
  END IF;
  SELECT u.master_license INTO v_license FROM public.territory_profession_unlocks u
    WHERE u.player_id=v_uid AND u.profession=v_progress.profession;
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled',false,
    'version','profession-stage8-draft-20261025','reason','profession_disagreement'); END IF;
  SELECT COALESCE(jsonb_object_agg(resource_id,quantity),'{}'::jsonb) INTO v_resources
    FROM public.territory_resource_wallet WHERE player_id=v_uid;
  SELECT xp_used INTO v_used FROM public.territory_profession_stage8_daily_xp
    WHERE player_id=v_uid AND local_day=v_day;
  RETURN jsonb_build_object(
    'enabled',true,'version','profession-stage8-draft-20261025',
    'profession',v_progress.profession,'mastery_level',v_progress.mastery_level,
    'mastery_xp',v_progress.mastery_xp,'daily_xp_used',COALESCE(v_used,0),
    'daily_xp_cap',300,'master_license',COALESCE(v_license,false),
    'resources',v_resources);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.territory_profession_stage8_execute(p_recipe text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_recipe public.territory_profession_stage8_catalog%ROWTYPE;
  v_progress public.territory_profession_stage8_progress%ROWTYPE;
  v_receipt public.territory_profession_stage8_receipts%ROWTYPE;
  v_license boolean := false;
  v_resource record;
  v_available bigint;
  v_level integer;
  v_xp integer;
  v_threshold integer;
  v_day date := (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date;
  v_used integer;
  v_item uuid;
  v_expires_at timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_recipe IS NULL OR length(p_recipe) NOT BETWEEN 1 AND 90
      OR p_recipe !~ '^[a-z0-9_]+$' OR p_operation IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  -- Shared with the existing gather/craft economy. Serializes both devices.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_receipt FROM public.territory_profession_stage8_receipts
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_receipt.recipe_id<>p_recipe THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
    RETURN v_receipt.result;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled)
    THEN RAISE EXCEPTION 'craft_not_enabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;

  SELECT * INTO v_recipe FROM public.territory_profession_stage8_catalog WHERE id=p_recipe;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_recipe'; END IF;
  SELECT * INTO v_progress FROM public.territory_profession_stage8_progress
    WHERE player_id=v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_progress.verified THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
  SELECT u.master_license INTO v_license FROM public.territory_profession_unlocks u
    WHERE u.player_id=v_uid AND u.profession=v_progress.profession;
  IF NOT FOUND OR v_recipe.profession<>v_progress.profession THEN
    RAISE EXCEPTION 'profession_not_unlocked';
  END IF;
  IF v_recipe.required_level=300 AND NOT COALESCE(v_license,false)
    THEN RAISE EXCEPTION 'master_license_required'; END IF;
  IF v_progress.mastery_level<v_recipe.required_level THEN RAISE EXCEPTION 'mastery_too_low'; END IF;

  -- The daily journal and operation receipt commit in the SAME transaction.
  INSERT INTO public.territory_profession_stage8_daily_xp(player_id,local_day,xp_used)
    VALUES(v_uid,v_day,0) ON CONFLICT(player_id,local_day) DO NOTHING;
  SELECT xp_used INTO v_used FROM public.territory_profession_stage8_daily_xp
    WHERE player_id=v_uid AND local_day=v_day FOR UPDATE;
  IF v_used+v_recipe.mastery_xp>300 THEN RAISE EXCEPTION 'daily_mastery_xp_limit'; END IF;

  -- Validate and sum each ingredient before debiting anything. Resource IDs
  -- come solely from the protected catalogue, never from client parameters.
  IF v_recipe.ingredients IS NULL OR jsonb_typeof(v_recipe.ingredients)<>'array'
      OR jsonb_array_length(v_recipe.ingredients) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'invalid_catalog';
  END IF;
  FOR v_resource IN
    SELECT value->>'id' AS resource_id,SUM((value->>'qty')::bigint) AS qty
    FROM pg_catalog.jsonb_array_elements(v_recipe.ingredients) AS e(value)
    GROUP BY value->>'id' ORDER BY value->>'id'
  LOOP
    IF v_resource.resource_id NOT IN ('gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal')
       OR v_resource.qty NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    SELECT quantity INTO v_available FROM public.territory_resource_wallet
      WHERE player_id=v_uid AND resource_id=v_resource.resource_id FOR UPDATE;
    IF COALESCE(v_available,0)<v_resource.qty THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  END LOOP;

  FOR v_resource IN
    SELECT value->>'id' AS resource_id,SUM((value->>'qty')::bigint) AS qty
    FROM pg_catalog.jsonb_array_elements(v_recipe.ingredients) AS e(value)
    GROUP BY value->>'id' ORDER BY value->>'id'
  LOOP
    UPDATE public.territory_resource_wallet SET quantity=quantity-v_resource.qty
      WHERE player_id=v_uid AND resource_id=v_resource.resource_id AND quantity>=v_resource.qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  END LOOP;

  -- Training spends resources for XP and never mints an inventory item.
  IF v_recipe.kind='item' THEN
    IF v_recipe.item_output IS NULL THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    IF v_recipe.item_output->>'type' IN ('elixir','potion')
      THEN v_expires_at:=clock_timestamp()+INTERVAL '7 days'; END IF;
    INSERT INTO public.territory_profession_stage8_items(player_id,recipe_id,item_output,expires_at)
      VALUES(v_uid,p_recipe,v_recipe.item_output,v_expires_at) RETURNING item_id INTO v_item;
  ELSIF v_recipe.kind<>'practice' OR v_recipe.item_output IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_catalog';
  END IF;

  -- XP table is versioned server data. Existing legacy levels are not reset.
  v_level:=v_progress.mastery_level;
  v_xp:=v_progress.mastery_xp+v_recipe.mastery_xp;
  WHILE v_level<300 LOOP
    SELECT xp_to_next INTO v_threshold FROM public.territory_profession_stage8_bands
      WHERE v_level BETWEEN from_level AND to_level;
    IF NOT FOUND OR v_threshold<1 THEN RAISE EXCEPTION 'invalid_mastery_band'; END IF;
    EXIT WHEN v_xp<v_threshold;
    v_xp:=v_xp-v_threshold;
    v_level:=v_level+1;
  END LOOP;
  IF v_level=300 THEN v_xp:=0; END IF;
  UPDATE public.territory_profession_stage8_progress
    SET mastery_level=v_level,mastery_xp=v_xp,updated_at=clock_timestamp()
    WHERE player_id=v_uid;
  UPDATE public.territory_profession_stage8_daily_xp
    SET xp_used=xp_used+v_recipe.mastery_xp
    WHERE player_id=v_uid AND local_day=v_day;

  v_result:=jsonb_build_object('success',true,'recipe_id',p_recipe,
    'kind',v_recipe.kind,'item_id',v_item,'item_output',v_recipe.item_output,
    'expires_at',v_expires_at,'mastery_level',v_level,'mastery_xp',v_xp,
    'daily_xp_used',v_used+v_recipe.mastery_xp);
  INSERT INTO public.territory_profession_stage8_receipts(player_id,operation_id,recipe_id,result)
    VALUES(v_uid,p_operation,p_recipe,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_execute(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_execute(text,uuid) TO authenticated, service_role;

-- IMPORTANT: release flag remains false. Manual cutover requires separate
-- approval, production backup, security audit and verified player migration.
COMMIT;
