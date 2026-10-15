-- TERRITORY stage 3: SERVER-SIDE ECONOMY + SEASONS FOUNDATION (STAGED, INACTIVE).
-- IMPORTANT: This is deliberately under supabase/staged/, NOT supabase/migrations/.
-- Do not apply to production until end-to-end client/server cutover, backup,
-- reconciliation of existing mastery and wallet, and owner's separate approval.
-- Applying this file alone does NOT stop forged players.game_state / players.gems!
-- All new write functions are unreachable from browser clients or disabled.
BEGIN;

CREATE TABLE IF NOT EXISTS public.territory_craft_catalog_v1 (
  id text PRIMARY KEY,
  profession text NOT NULL CHECK (profession IN ('smith','alchemist','artisan','jeweler','engineer')),
  required_level integer NOT NULL CHECK (required_level BETWEEN 1 AND 300),
  mastery_xp integer NOT NULL CHECK (mastery_xp BETWEEN 1 AND 1000),
  ingredients jsonb NOT NULL CHECK (jsonb_typeof(ingredients) = 'array'),
  item_output jsonb NOT NULL CHECK (jsonb_typeof(item_output) = 'object')
);
ALTER TABLE public.territory_craft_catalog_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_craft_catalog_v1 FROM PUBLIC, anon, authenticated;

-- Never silently overwrite legacy mastery or infer it from client-authored saves.
-- Each player's authoritative state must be checked and verified at cutover.
CREATE TABLE IF NOT EXISTS public.territory_profession_mastery_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  profession text NOT NULL CHECK (profession IN ('smith','alchemist','artisan','jeweler','engineer')),
  mastery_level integer NOT NULL CHECK (mastery_level BETWEEN 1 AND 300),
  mastery_xp integer NOT NULL CHECK (mastery_xp BETWEEN 0 AND 100000),
  verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.territory_profession_mastery_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_profession_mastery_v1 FROM PUBLIC, anon, authenticated;

-- Instance-based ownership: each crafted piece has a unique durable server ID.
CREATE TABLE IF NOT EXISTS public.territory_crafted_items_v1 (
  item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  recipe_id text NOT NULL REFERENCES public.territory_craft_catalog_v1(id),
  item_output jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS territory_crafted_items_owner_v1_idx
  ON public.territory_crafted_items_v1(player_id,created_at DESC);
ALTER TABLE public.territory_crafted_items_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_crafted_items_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_craft_receipts_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  recipe_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id, operation_id)
);
ALTER TABLE public.territory_craft_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_craft_receipts_v1 FROM PUBLIC, anon, authenticated;

-- Disabled until the client stops writing currency / items into game_state and
-- the reconciliation has verified all old profession progress & resource stacks.
CREATE TABLE IF NOT EXISTS public.territory_release_flags_v1 (
  id integer PRIMARY KEY CHECK(id=1),
  craft_enabled boolean NOT NULL DEFAULT false,
  season_enabled boolean NOT NULL DEFAULT false,
  shop_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.territory_release_flags_v1(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.territory_release_flags_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_release_flags_v1 FROM PUBLIC, anon, authenticated;


-- Immutable recipe catalogue: generated from src/game/professions.ts.
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('smith_apprentice_blade','smith',1,30,'[{"id":"gather-ore","qty":5},{"id":"gather-wood","qty":2}]'::jsonb,'{"name":"Меч подмастерья","icon":"⚔️","type":"equipment","rarity":"common","description":"Кованый меч. +8 к атаке.","equipment":{"slot":"weapon","rarity":"common","level":1,"attack":8,"name":"Меч подмастерья","icon":"⚔️"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('smith_leather_armor','smith',1,35,'[{"id":"gather-ore","qty":3},{"id":"gather-hide","qty":2}]'::jsonb,'{"name":"Кожаная броня","icon":"🦺","type":"equipment","rarity":"common","description":"Защита +5, здоровье +30.","equipment":{"slot":"armor","rarity":"common","level":1,"defense":5,"hp":30,"name":"Кожаная броня","icon":"🦺"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('smith_knight_blade','smith',50,120,'[{"id":"gather-ore","qty":20},{"id":"gather-wood","qty":10},{"id":"gather-crystal","qty":3}]'::jsonb,'{"name":"Клинок рыцаря","icon":"🗡️","type":"equipment","rarity":"rare","description":"Атака +18, шанс критического удара +3%.","equipment":{"slot":"weapon","rarity":"rare","level":3,"attack":18,"critChance":3,"name":"Клинок рыцаря","icon":"🗡️"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('smith_ancient_blade','smith',300,500,'[{"id":"gather-ore","qty":80},{"id":"gather-wood","qty":30},{"id":"gather-crystal","qty":20}]'::jsonb,'{"name":"Клинок древних","icon":"🔱","type":"equipment","rarity":"legendary","description":"Атака +35, критический шанс +8%. Сила легендарной экипировки масштабируется по общему балансу игры.","equipment":{"slot":"weapon","rarity":"legendary","level":5,"attack":35,"critChance":8,"name":"Клинок древних","icon":"🔱"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('alchemist_health_potion','alchemist',1,20,'[{"id":"gather-herb","qty":3}]'::jsonb,'{"name":"Зелье здоровья мастера","icon":"🧪","type":"potion","rarity":"common","description":"Восстанавливает 50 HP мгновенно.","effect":{"stat":"hp","value":50,"duration":"instant"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('alchemist_strength','alchemist',5,50,'[{"id":"gather-herb","qty":5},{"id":"gather-crystal","qty":1}]'::jsonb,'{"name":"Эликсир силы мастера","icon":"💪","type":"elixir","rarity":"rare","description":"+10 к атаке на один бой.","effect":{"stat":"attack","value":10,"duration":"battle"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('alchemist_greater_potion','alchemist',25,90,'[{"id":"gather-herb","qty":10},{"id":"gather-crystal","qty":3}]'::jsonb,'{"name":"Большое зелье мастера","icon":"⚗️","type":"potion","rarity":"rare","description":"Восстанавливает 150 HP мгновенно.","effect":{"stat":"hp","value":150,"duration":"instant"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('alchemist_legendary_elixir','alchemist',300,500,'[{"id":"gather-herb","qty":50},{"id":"gather-crystal","qty":20}]'::jsonb,'{"name":"Эликсир легенды","icon":"🧬","type":"elixir","rarity":"legendary","description":"+20 к атаке на один бой.","effect":{"stat":"attack","value":20,"duration":"battle"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('artisan_toolkit','artisan',1,25,'[{"id":"gather-wood","qty":4},{"id":"gather-ore","qty":2}]'::jsonb,'{"name":"Набор ремесленника","icon":"🧰","type":"material","rarity":"common","description":"Ремесленный товар. Предназначен для торговли и будущих рецептов."}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('artisan_supply_crate','artisan',25,80,'[{"id":"gather-wood","qty":15},{"id":"gather-herb","qty":8}]'::jsonb,'{"name":"Ящик припасов","icon":"📦","type":"material","rarity":"rare","description":"Ценный ремесленный товар для торговли."}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('artisan_royal_chest','artisan',300,500,'[{"id":"gather-wood","qty":50},{"id":"gather-ore","qty":30},{"id":"gather-crystal","qty":15}]'::jsonb,'{"name":"Королевский ларец","icon":"🗝️","type":"material","rarity":"legendary","description":"Легендарный ремесленный товар для будущего общего аукциона."}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('jeweler_raven_amulet','jeweler',1,45,'[{"id":"gather-crystal","qty":2},{"id":"gather-ore","qty":5}]'::jsonb,'{"name":"Амулет ворона мастера","icon":"📿","type":"equipment","rarity":"rare","description":"Атака +6 и шанс крита +3%.","equipment":{"slot":"amulet","rarity":"rare","level":3,"attack":6,"critChance":3,"name":"Амулет ворона мастера","icon":"📿"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('jeweler_power_ring','jeweler',50,125,'[{"id":"gather-crystal","qty":8},{"id":"gather-ore","qty":12}]'::jsonb,'{"name":"Кольцо силы мастера","icon":"💍","type":"equipment","rarity":"epic","description":"Атака +15 и шанс крита +5%.","equipment":{"slot":"ring","rarity":"epic","level":5,"attack":15,"critChance":5,"name":"Кольцо силы мастера","icon":"💍"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('jeweler_ancient_ring','jeweler',300,500,'[{"id":"gather-crystal","qty":25},{"id":"gather-ore","qty":60}]'::jsonb,'{"name":"Кольцо древних","icon":"💍","type":"equipment","rarity":"legendary","description":"Атака +15 и шанс крита +5%. Сохраняет базовый баланс аксессуаров.","equipment":{"slot":"ring","rarity":"legendary","level":5,"attack":15,"critChance":5,"name":"Кольцо древних","icon":"💍"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('engineer_oak_shield','engineer',1,40,'[{"id":"gather-wood","qty":5},{"id":"gather-ore","qty":4}]'::jsonb,'{"name":"Укреплённый щит","icon":"🛡️","type":"equipment","rarity":"common","description":"Защита +5 и здоровье +25.","equipment":{"slot":"shield","rarity":"common","level":2,"defense":5,"hp":25,"name":"Укреплённый щит","icon":"🛡️"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('engineer_guard_helmet','engineer',25,85,'[{"id":"gather-ore","qty":12},{"id":"gather-crystal","qty":2}]'::jsonb,'{"name":"Шлем стража","icon":"⛑️","type":"equipment","rarity":"rare","description":"Защита +3 и здоровье +20.","equipment":{"slot":"helmet","rarity":"rare","level":3,"defense":3,"hp":20,"name":"Шлем стража","icon":"⛑️"}}'::jsonb) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.territory_craft_catalog_v1(id,profession,required_level,mastery_xp,ingredients,item_output) VALUES ('engineer_ancient_device','engineer',300,500,'[{"id":"gather-ore","qty":60},{"id":"gather-wood","qty":40},{"id":"gather-crystal","qty":20}]'::jsonb,'{"name":"Древний механизм","icon":"⚙️","type":"material","rarity":"legendary","description":"Легендарный инженерный товар для будущего общего аукциона."}'::jsonb) ON CONFLICT(id) DO NOTHING;

-- This craft function only accepts a recipe ID, never client-provided rewards,
-- ingredient quantities, mastery levels, currencies or arbitrary inventory JSON.
-- Row locks + same advisory key as existing gather protect concurrent spending.
CREATE OR REPLACE FUNCTION public.territory_craft_v1(p_recipe text, p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_recipe public.territory_craft_catalog_v1%ROWTYPE;
  v_progress public.territory_profession_mastery_v1%ROWTYPE;
  v_receipt public.territory_craft_receipts_v1%ROWTYPE;
  v_resource record;
  v_available bigint;
  v_needed bigint;
  v_level integer;
  v_xp integer;
  v_item uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation IS NULL OR p_recipe IS NULL OR length(p_recipe) > 100 THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text), 7724);
  SELECT * INTO v_receipt FROM public.territory_craft_receipts_v1
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_receipt.recipe_id <> p_recipe THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
    RETURN v_receipt.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND craft_enabled) THEN
    RAISE EXCEPTION 'craft_not_enabled';
  END IF;
  SELECT * INTO v_recipe FROM public.territory_craft_catalog_v1 WHERE id=p_recipe;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_recipe'; END IF;
  SELECT * INTO v_progress FROM public.territory_profession_mastery_v1
    WHERE player_id=v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_progress.verified THEN RAISE EXCEPTION 'mastery_not_verified'; END IF;
  IF v_progress.profession <> v_recipe.profession OR NOT EXISTS (
    SELECT 1 FROM public.territory_profession_unlocks u
    WHERE u.player_id=v_uid AND u.profession=v_progress.profession
      AND (v_recipe.required_level < 300 OR u.master_license)
  ) THEN RAISE EXCEPTION 'profession_not_licensed'; END IF;
  IF v_progress.mastery_level < v_recipe.required_level THEN RAISE EXCEPTION 'mastery_too_low'; END IF;

  -- All ingredient definitions come from the immutable server catalog.
  FOR v_resource IN SELECT e.value AS ingredient FROM
    pg_catalog.jsonb_array_elements(v_recipe.ingredients) AS e(value)
  LOOP
    v_needed := (v_resource.ingredient->>'qty')::bigint;
    IF v_needed < 1 OR v_needed > 100000 THEN RAISE EXCEPTION 'invalid_recipe'; END IF;
    SELECT quantity INTO v_available FROM public.territory_resource_wallet
      WHERE player_id=v_uid AND resource_id=(v_resource.ingredient->>'id') FOR UPDATE;
    IF COALESCE(v_available,0) < v_needed THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  END LOOP;

  FOR v_resource IN SELECT e.value AS ingredient FROM
    pg_catalog.jsonb_array_elements(v_recipe.ingredients) AS e(value)
  LOOP
    v_needed := (v_resource.ingredient->>'qty')::bigint;
    UPDATE public.territory_resource_wallet
      SET quantity=quantity-v_needed
      WHERE player_id=v_uid AND resource_id=(v_resource.ingredient->>'id')
        AND quantity>=v_needed;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  END LOOP;

  INSERT INTO public.territory_crafted_items_v1(player_id,recipe_id,item_output)
    VALUES(v_uid,p_recipe,v_recipe.item_output) RETURNING item_id INTO v_item;
  v_level:=v_progress.mastery_level;
  v_xp:=v_progress.mastery_xp+v_recipe.mastery_xp;
  WHILE v_level < 300 AND v_xp >= 100+(v_level-1)*25 LOOP
    v_xp:=v_xp-(100+(v_level-1)*25);
    v_level:=v_level+1;
  END LOOP;
  IF v_level=300 THEN v_xp:=0; END IF;
  UPDATE public.territory_profession_mastery_v1
    SET mastery_level=v_level, mastery_xp=v_xp, updated_at=clock_timestamp()
    WHERE player_id=v_uid;
  v_result:=jsonb_build_object('success',true,'item_id',v_item,
    'recipe_id',p_recipe,'item_output',v_recipe.item_output,
    'mastery_level',v_level,'mastery_xp',v_xp);
  INSERT INTO public.territory_craft_receipts_v1(player_id,operation_id,recipe_id,result)
    VALUES(v_uid,p_operation,p_recipe,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_craft_v1(text,uuid) FROM PUBLIC, anon, authenticated;
-- Not granted to authenticated until the client is fully migrated from local inventory.
GRANT EXECUTE ON FUNCTION public.territory_craft_v1(text,uuid) TO service_role;

-- Season entries are written by a trusted verifier only, after a real source
-- action has been checked server-side. Never trust browser-provided points.
CREATE TABLE IF NOT EXISTS public.territory_season_events_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  week date NOT NULL,
  source text NOT NULL CHECK (source IN ('pve','arena','gather','craft','quest')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 120),
  points integer NOT NULL CHECK(points BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id,week,source,source_id)
);
CREATE INDEX IF NOT EXISTS territory_season_events_rank_v1_idx
  ON public.territory_season_events_v1(week,player_id);
ALTER TABLE public.territory_season_events_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_season_events_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_season_award_v1(
  p_player uuid, p_source text, p_source_id text, p_points integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_local_day date := (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date;
  v_week date;
  v_prior integer;
  v_daily integer;
  v_cap integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND season_enabled) THEN
    RAISE EXCEPTION 'season_not_enabled';
  END IF;
  IF p_player IS NULL OR p_source_id IS NULL OR length(p_source_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_event';
  END IF;
  v_cap:= CASE p_source WHEN 'pve' THEN 5 WHEN 'arena' THEN 20 WHEN 'gather' THEN 3
    WHEN 'craft' THEN 5 WHEN 'quest' THEN 10 ELSE 0 END;
  IF p_points IS NULL OR p_points NOT BETWEEN 1 AND v_cap THEN RAISE EXCEPTION 'invalid_points'; END IF;
  v_week:=v_local_day - pg_catalog.extract(dow FROM v_local_day)::integer;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_player::text), 7725);
  SELECT points INTO v_prior FROM public.territory_season_events_v1
    WHERE player_id=p_player AND week=v_week AND source=p_source AND source_id=p_source_id;
  IF FOUND THEN
    IF v_prior<>p_points THEN RAISE EXCEPTION 'event_conflict'; END IF;
    RETURN jsonb_build_object('success',true,'repeat',true,'points',0,'week',v_week);
  END IF;
  SELECT COALESCE(SUM(points),0) INTO v_daily FROM public.territory_season_events_v1
    WHERE player_id=p_player AND source=p_source
      AND (created_at AT TIME ZONE 'Europe/Kyiv')::date=v_local_day;
  -- Daily ceilings are an additional anti-farming guard; only verifiers can award.
  IF v_daily+p_points > CASE p_source WHEN 'pve' THEN 100 WHEN 'arena' THEN 160
    WHEN 'gather' THEN 24 WHEN 'craft' THEN 50 ELSE 60 END THEN
    RETURN jsonb_build_object('success',false,'error','daily_season_cap','week',v_week);
  END IF;
  INSERT INTO public.territory_season_events_v1(player_id,week,source,source_id,points)
    VALUES(p_player,v_week,p_source,p_source_id,p_points);
  RETURN jsonb_build_object('success',true,'repeat',false,'points',p_points,'week',v_week);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_season_award_v1(uuid,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_season_award_v1(uuid,text,text,integer) TO service_role;

-- Read-only board. Disabled unless explicitly enabled at a vetted release.
CREATE OR REPLACE FUNCTION public.territory_season_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_week date;
  v_on boolean;
  v_me uuid := auth.uid();
  v_points bigint := 0;
  v_rank bigint;
  v_leaders jsonb := '[]'::jsonb;
BEGIN
  v_week := v_day - pg_catalog.extract(dow FROM v_day)::integer;
  SELECT season_enabled INTO v_on FROM public.territory_release_flags_v1 WHERE id=1;
  IF COALESCE(v_on,false) THEN
    WITH totals AS (
      SELECT player_id,SUM(points)::bigint AS points
      FROM public.territory_season_events_v1 WHERE week=v_week GROUP BY player_id
    ), ranked AS (
      SELECT player_id, points, row_number() OVER (ORDER BY points DESC, player_id) AS rank FROM totals
    )
    SELECT COALESCE(MAX(points) FILTER(WHERE player_id=v_me),0),
      MAX(rank) FILTER(WHERE player_id=v_me) INTO v_points,v_rank FROM ranked;
    WITH totals AS (
      SELECT player_id,SUM(points)::bigint AS points
      FROM public.territory_season_events_v1 WHERE week=v_week GROUP BY player_id
    ), ranked AS (
      SELECT player_id,points,row_number() OVER (ORDER BY points DESC,player_id) AS rank FROM totals
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'player_id', r.player_id,'display_name',left(p.display_name,70),
      'points',r.points,'rank',r.rank) ORDER BY r.rank),'[]'::jsonb)
      INTO v_leaders FROM ranked r JOIN public.players p ON p.id=r.player_id WHERE r.rank<=50;
  END IF;
  RETURN jsonb_build_object('enabled',COALESCE(v_on,false),'week',v_week::text,
    'ends_at', ((v_week + 7)::timestamp AT TIME ZONE 'Europe/Kyiv'),
    'my_points',v_points,'my_rank',v_rank,'leaders',v_leaders);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_season_status_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_season_status_v1() TO authenticated, service_role;


-- Verified server-wallet is a CUTOVER TARGET, not a snapshot of client saves.
-- Never auto-import potentially inflated gold/gems/stones without review.
CREATE TABLE IF NOT EXISTS public.territory_wallet_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  gold bigint NOT NULL CHECK (gold BETWEEN 0 AND 2147483647),
  gems bigint NOT NULL CHECK (gems BETWEEN 0 AND 2147483647),
  stones bigint NOT NULL CHECK (stones BETWEEN 0 AND 2147483647),
  stone_day date,
  stone_bought integer NOT NULL DEFAULT 0 CHECK(stone_bought BETWEEN 0 AND 25),
  verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.territory_wallet_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_wallet_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_shop_receipts_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  item_id text NOT NULL,
  quantity integer NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id, operation_id)
);
ALTER TABLE public.territory_shop_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_shop_receipts_v1 FROM PUBLIC, anon, authenticated;

-- Strict server-side shop catalog: never accept prices or quantities from UI.
-- Only stones are in this staged RPC; other categories require separate
-- authoritative item-ownership and reward handlers before activation.
CREATE OR REPLACE FUNCTION public.territory_shop_buy_stones_v1(
  p_item_id text,p_quantity integer,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wallet public.territory_wallet_v1%ROWTYPE;
  v_receipt public.territory_shop_receipts_v1%ROWTYPE;
  v_stones_per_unit integer;
  v_price_gems integer;
  v_total_stones integer;
  v_total_gems integer;
  v_today date := (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date;
  v_bought integer;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 25
    THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  SELECT CASE p_item_id WHEN 'shop_stone_1' THEN 1 WHEN 'shop_stone_5' THEN 5 ELSE NULL END,
         CASE p_item_id WHEN 'shop_stone_1' THEN 2 WHEN 'shop_stone_5' THEN 8 ELSE NULL END
  INTO v_stones_per_unit,v_price_gems;
  IF v_stones_per_unit IS NULL THEN RAISE EXCEPTION 'unknown_item'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_receipt FROM public.territory_shop_receipts_v1
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_receipt.item_id<>p_item_id OR v_receipt.quantity<>p_quantity
      THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
    RETURN v_receipt.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND shop_enabled) THEN
    RAISE EXCEPTION 'shop_not_enabled';
  END IF;
  SELECT * INTO v_wallet FROM public.territory_wallet_v1
    WHERE player_id=v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_wallet.verified THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
  v_total_stones:=v_stones_per_unit*p_quantity;
  v_total_gems:=v_price_gems*p_quantity;
  v_bought:=CASE WHEN v_wallet.stone_day=v_today THEN v_wallet.stone_bought ELSE 0 END;
  IF v_bought+v_total_stones>25 THEN RAISE EXCEPTION 'stone_daily_limit'; END IF;
  IF v_wallet.gems<v_total_gems THEN RAISE EXCEPTION 'insufficient_gems'; END IF;
  IF v_wallet.stones+v_total_stones>2147483647 THEN RAISE EXCEPTION 'stone_overflow'; END IF;
  UPDATE public.territory_wallet_v1 SET
    gems=gems-v_total_gems,stones=stones+v_total_stones,
    stone_day=v_today,stone_bought=v_bought+v_total_stones,updated_at=clock_timestamp()
    WHERE player_id=v_uid;
  v_result:=jsonb_build_object('success',true,'item_id',p_item_id,'quantity',p_quantity,
    'gems_after',v_wallet.gems-v_total_gems,'stones_after',v_wallet.stones+v_total_stones,
    'stone_day',v_today,'stone_bought',v_bought+v_total_stones);
  INSERT INTO public.territory_shop_receipts_v1(player_id,operation_id,item_id,quantity,result)
    VALUES(v_uid,p_operation,p_item_id,p_quantity,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_shop_buy_stones_v1(text,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_shop_buy_stones_v1(text,integer,uuid)
  TO authenticated,service_role;

COMMIT;
