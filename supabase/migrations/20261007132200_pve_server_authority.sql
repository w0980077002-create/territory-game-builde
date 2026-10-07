/*
  PvE server authority
  - Starts PvE battles through a SECURITY DEFINER function and charges 1 battle stone atomically.
  - Claims PvE rewards on the server; the client cannot provide reward amounts or loot.
  - One battle UUID can be claimed only once; repeated claims return the canonical stored result.
  - Campaign progression is validated against the current server-side chapter/win counters.
*/

CREATE TABLE IF NOT EXISTS pve_battles (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  enemy_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stage', 'trial')),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'claimed', 'expired')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pve_battles_player_created ON pve_battles(player_id, created_at DESC);

ALTER TABLE pve_battles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_pve_battles" ON pve_battles;
CREATE POLICY "select_own_pve_battles" ON pve_battles
  FOR SELECT TO authenticated USING (auth.uid() = player_id);

REVOKE ALL ON pve_battles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON pve_battles TO authenticated;

CREATE OR REPLACE FUNCTION territory_pve_xp_for_level(p_level int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT floor(100 * power(1.15, greatest(0, p_level - 1)))::int;
$$;

CREATE OR REPLACE FUNCTION begin_pve_battle(
  p_enemy_id text,
  p_kind text,
  p_battle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id uuid := auth.uid();
  v_state jsonb;
  v_chapter int;
  v_chapter_wins int;
  v_trial_level int;
  v_battle_stones int;
  v_expected_enemy text;
BEGIN
  IF v_player_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  IF p_kind NOT IN ('stage', 'trial') THEN
    RETURN jsonb_build_object('error', 'invalid_battle_kind');
  END IF;

  IF p_battle_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_battle_id');
  END IF;

  IF EXISTS (SELECT 1 FROM pve_battles WHERE id = p_battle_id) THEN
    RETURN jsonb_build_object('error', 'battle_id_already_exists');
  END IF;

  SELECT game_state, current_chapter, chapter_wins
    INTO v_state, v_chapter, v_chapter_wins
    FROM players
   WHERE id = v_player_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'player_not_found');
  END IF;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('error', 'game_state_missing');
  END IF;

  v_battle_stones := COALESCE((v_state->>'battleStones')::int, 0);
  IF v_battle_stones < 1 THEN
    RETURN jsonb_build_object('error', 'no_battle_stones');
  END IF;

  IF p_kind = 'trial' THEN
    v_trial_level := COALESCE((v_state->>'trialLevel')::int, 1);
    v_expected_enemy := format('trial_%s', v_trial_level);
    IF p_enemy_id <> v_expected_enemy THEN
      RETURN jsonb_build_object('error', 'invalid_trial');
    END IF;
  ELSE
    IF v_chapter_wins < 5 THEN
      v_expected_enemy := format('ch%s_enemy_%s', v_chapter, v_chapter_wins);
    ELSE
      v_expected_enemy := format('ch%s_boss', v_chapter);
    END IF;
    IF p_enemy_id <> v_expected_enemy THEN
      RETURN jsonb_build_object('error', 'invalid_campaign_target');
    END IF;
  END IF;

  v_state := jsonb_set(v_state, '{battleStones}', to_jsonb(v_battle_stones - 1), true);

  INSERT INTO pve_battles (id, player_id, enemy_id, kind)
  VALUES (p_battle_id, v_player_id, p_enemy_id, p_kind);

  UPDATE players
     SET game_state = v_state,
         updated_at = now()
   WHERE id = v_player_id;

  RETURN jsonb_build_object(
    'battle_id', p_battle_id,
    'battle_stones', v_battle_stones - 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION claim_pve_win(p_battle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id uuid := auth.uid();
  v_battle pve_battles%ROWTYPE;
  v_state jsonb;
  v_player jsonb;
  v_stats jsonb;
  v_chapter int;
  v_chapter_wins int;
  v_trial_level int;
  v_is_boss boolean := false;
  v_reward_gold int := 0;
  v_reward_xp int := 0;
  v_reward_gems int := 0;
  v_reward_materials int := 0;
  v_blessing_charges int := 0;
  v_level int;
  v_xp int;
  v_xp_to_next int;
  v_max_energy int;
  v_gold int;
  v_gems int;
  v_total_battles int;
  v_total_bosses int;
  v_forge_materials int;
  v_attack int;
  v_defense int;
  v_max_hp int;
  v_crit_chance int;
  v_loot jsonb := NULL;
  v_inventory jsonb;
  v_quests jsonb;
  v_achievements jsonb;
  v_followers jsonb;
  v_result jsonb;
  v_expected_enemy text;
  v_is_weapon boolean;
  v_rarity text;
  v_loot_id text;
  v_current_gold_for_achievement int;
BEGIN
  IF v_player_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_battle
    FROM pve_battles
   WHERE id = p_battle_id
     AND player_id = v_player_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'battle_not_found');
  END IF;

  IF v_battle.status = 'claimed' THEN
    RETURN COALESCE(v_battle.result, jsonb_build_object('error', 'missing_claim_result'));
  END IF;

  IF v_battle.created_at < now() - interval '30 minutes' THEN
    UPDATE pve_battles
       SET status = 'expired', claimed_at = now()
     WHERE id = v_battle.id;
    RETURN jsonb_build_object('error', 'battle_expired');
  END IF;

  SELECT game_state, current_chapter, chapter_wins, level, xp, gold, gems, max_energy,
         total_battles_won, total_bosses_defeated, forge_materials
    INTO v_state, v_chapter, v_chapter_wins, v_level, v_xp, v_gold, v_gems, v_max_energy,
         v_total_battles, v_total_bosses, v_forge_materials
    FROM players
   WHERE id = v_player_id
   FOR UPDATE;

  IF NOT FOUND OR v_state IS NULL THEN
    RETURN jsonb_build_object('error', 'player_not_found');
  END IF;

  IF v_battle.kind = 'trial' THEN
    v_trial_level := COALESCE((v_state->>'trialLevel')::int, 1);
    v_expected_enemy := format('trial_%s', v_trial_level);
    IF v_battle.enemy_id <> v_expected_enemy THEN
      RETURN jsonb_build_object('error', 'invalid_trial_progress');
    END IF;
    v_reward_gold := 40 + v_trial_level * 12;
    v_reward_xp := 40 + v_trial_level * 10;
    v_reward_gems := CASE WHEN v_trial_level % 5 = 0 THEN 5 ELSE 1 END;
    v_reward_materials := 1;
  ELSE
    IF v_chapter_wins < 5 THEN
      v_expected_enemy := format('ch%s_enemy_%s', v_chapter, v_chapter_wins);
      v_is_boss := false;
    ELSE
      v_expected_enemy := format('ch%s_boss', v_chapter);
      v_is_boss := true;
    END IF;

    IF v_battle.enemy_id <> v_expected_enemy THEN
      RETURN jsonb_build_object('error', 'invalid_campaign_progress');
    END IF;

    IF v_is_boss THEN
      v_reward_gold := 50 + v_chapter * 15;
      v_reward_xp := 80 + v_chapter * 20;
      v_reward_materials := 3;

      v_is_weapon := random() >= 0.5;
      v_rarity := CASE
        WHEN floor(v_chapter / 10.0)::int = 0 THEN 'common'
        WHEN floor(v_chapter / 10.0)::int = 1 THEN 'rare'
        WHEN floor(v_chapter / 10.0)::int = 2 THEN 'epic'
        ELSE 'legendary'
      END;
      v_loot_id := gen_random_uuid()::text;
      v_loot := jsonb_build_object(
        'id', v_loot_id,
        'name', CASE WHEN v_is_weapon THEN 'Клинок победителя' ELSE 'Доспех воина' END,
        'icon', CASE WHEN v_is_weapon THEN '⚔️' ELSE '🛡️' END,
        'type', 'equipment',
        'rarity', v_rarity,
        'qty', 1,
        'description', format('Уровень %s · %s', v_chapter, v_rarity),
        'equipment', jsonb_build_object(
          'id', v_loot_id,
          'slot', CASE WHEN v_is_weapon THEN 'weapon' ELSE 'armor' END,
          'name', CASE WHEN v_is_weapon THEN 'Клинок победителя' ELSE 'Доспех воина' END,
          'icon', CASE WHEN v_is_weapon THEN '⚔️' ELSE '🛡️' END,
          'rarity', v_rarity,
          'attack', CASE WHEN v_is_weapon THEN 10 + v_chapter * 3 ELSE 0 END,
          'defense', CASE WHEN v_is_weapon THEN 0 ELSE 5 + v_chapter * 2 END,
          'hp', CASE WHEN v_is_weapon THEN 0 ELSE 20 + v_chapter * 5 END,
          'level', v_chapter
        )
      );
    ELSE
      v_reward_gold := 15 + v_chapter * 5;
      v_reward_xp := 20 + v_chapter * 8;
      v_reward_materials := CASE WHEN random() < 0.35 THEN 1 ELSE 0 END;
    END IF;

    v_blessing_charges := COALESCE((v_state->'blessing'->>'charges')::int, 0);
    IF v_blessing_charges > 0 THEN
      v_reward_gold := round(v_reward_gold * 1.5)::int;
      v_state := jsonb_set(v_state, '{blessing,charges}', to_jsonb(v_blessing_charges - 1), true);
    END IF;
  END IF;

  v_player := COALESCE(v_state->'player', '{}'::jsonb);
  v_stats := COALESCE(v_player->'stats', '{}'::jsonb);
  v_level := COALESCE((v_player->>'level')::int, v_level, 1);
  v_xp := COALESCE((v_player->>'xp')::int, v_xp, 0) + v_reward_xp;
  v_xp_to_next := territory_pve_xp_for_level(v_level);
  v_max_energy := COALESCE((v_player->>'maxEnergy')::int, v_max_energy, 20);

  v_stats := jsonb_set(v_stats, '{maxHp}', to_jsonb(COALESCE((v_stats->>'maxHp')::int, 100)), true);
  v_stats := jsonb_set(v_stats, '{hp}', to_jsonb(COALESCE((v_stats->>'hp')::int, 100)), true);
  v_stats := jsonb_set(v_stats, '{attack}', to_jsonb(COALESCE((v_stats->>'attack')::int, 20)), true);
  v_stats := jsonb_set(v_stats, '{defense}', to_jsonb(COALESCE((v_stats->>'defense')::int, 5)), true);
  v_stats := jsonb_set(v_stats, '{critChance}', to_jsonb(COALESCE((v_stats->>'critChance')::int, 5)), true);
  v_stats := jsonb_set(v_stats, '{critDamage}', to_jsonb(COALESCE((v_stats->>'critDamage')::int, 50)), true);

  WHILE v_xp >= v_xp_to_next LOOP
    v_xp := v_xp - v_xp_to_next;
    v_level := v_level + 1;
    v_xp_to_next := territory_pve_xp_for_level(v_level);
    v_stats := jsonb_set(v_stats, '{maxHp}', to_jsonb((v_stats->>'maxHp')::int + 20), true);
    v_stats := jsonb_set(v_stats, '{hp}', to_jsonb((v_stats->>'maxHp')::int), true);
    v_stats := jsonb_set(v_stats, '{attack}', to_jsonb((v_stats->>'attack')::int + 5), true);
    v_stats := jsonb_set(v_stats, '{defense}', to_jsonb((v_stats->>'defense')::int + 2), true);
    v_max_energy := v_max_energy + 1;
  END LOOP;

  v_gold := COALESCE((v_player->>'gold')::int, v_gold, 0) + v_reward_gold;
  v_gems := COALESCE((v_player->>'gems')::int, v_gems, 0) + v_reward_gems;
  v_total_battles := COALESCE(v_total_battles, 0) + CASE WHEN v_battle.kind = 'stage' AND NOT v_is_boss THEN 1 ELSE 0 END;
  v_total_bosses := COALESCE(v_total_bosses, 0) + CASE WHEN v_battle.kind = 'stage' AND v_is_boss THEN 1 ELSE 0 END;
  v_forge_materials := COALESCE(v_forge_materials, 0) + v_reward_materials;

  IF v_battle.kind = 'trial' THEN
    v_state := jsonb_set(v_state, '{trialLevel}', to_jsonb(v_trial_level + 1), true);
  ELSIF NOT v_is_boss THEN
    v_chapter_wins := v_chapter_wins + 1;
  ELSE
    v_chapter := v_chapter + 1;
    v_chapter_wins := 0;
  END IF;

  v_state := jsonb_set(v_state, '{player,level}', to_jsonb(v_level), true);
  v_state := jsonb_set(v_state, '{player,xp}', to_jsonb(v_xp), true);
  v_state := jsonb_set(v_state, '{player,xpToNext}', to_jsonb(v_xp_to_next), true);
  v_state := jsonb_set(v_state, '{player,gold}', to_jsonb(v_gold), true);
  v_state := jsonb_set(v_state, '{player,gems}', to_jsonb(v_gems), true);
  v_state := jsonb_set(v_state, '{player,maxEnergy}', to_jsonb(v_max_energy), true);
  v_state := jsonb_set(v_state, '{player,stats}', v_stats, true);
  v_state := jsonb_set(v_state, '{currentChapter}', to_jsonb(v_chapter), true);
  v_state := jsonb_set(v_state, '{chapterWins}', to_jsonb(v_chapter_wins), true);
  v_state := jsonb_set(v_state, '{totalBattlesWon}', to_jsonb(v_total_battles), true);
  v_state := jsonb_set(v_state, '{totalBossesDefeated}', to_jsonb(v_total_bosses), true);
  v_state := jsonb_set(v_state, '{forgeMaterials}', to_jsonb(v_forge_materials), true);

  IF v_battle.kind = 'stage' AND v_is_boss THEN
    v_inventory := COALESCE(v_state->'inventory', '[]'::jsonb) || jsonb_build_array(v_loot);
    v_state := jsonb_set(v_state, '{inventory}', v_inventory, true);
  END IF;

  v_quests := (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN (q->>'claimed')::boolean THEN q
        WHEN q->>'id' = 'q_daily_1'
          THEN jsonb_set(q, '{current}', to_jsonb(LEAST((q->>'target')::int, (q->>'current')::int + 1)), true)
        WHEN v_battle.kind = 'stage' AND v_is_boss AND q->>'id' = 'q_weekly_1'
          THEN jsonb_set(q, '{current}', to_jsonb(LEAST((q->>'target')::int, (q->>'current')::int + 1)), true)
        WHEN v_battle.kind = 'stage' AND v_is_boss AND q->>'id' = 'q_story_1'
          THEN jsonb_set(q, '{current}', to_jsonb(LEAST((q->>'target')::int, (q->>'current')::int + 1)), true)
        ELSE q
      END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_state->'quests', '[]'::jsonb)) WITH ORDINALITY AS t(q, ord)
  );
  v_state := jsonb_set(v_state, '{quests}', v_quests, true);

  v_current_gold_for_achievement := v_gold;
  v_achievements := (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN (a->>'claimed')::boolean THEN a
        WHEN a->>'id' IN ('ach_1', 'ach_2')
          THEN jsonb_set(a, '{current}', to_jsonb((a->>'current')::int + 1), true)
        WHEN v_battle.kind = 'stage' AND v_is_boss AND a->>'id' IN ('ach_3', 'ach_4')
          THEN jsonb_set(a, '{current}', to_jsonb((a->>'current')::int + 1), true)
        WHEN v_battle.kind = 'stage' AND a->>'id' = 'ach_5'
          THEN jsonb_set(a, '{current}', to_jsonb(v_current_gold_for_achievement), true)
        ELSE a
      END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_state->'achievements', '[]'::jsonb)) WITH ORDINALITY AS t(a, ord)
  );
  v_state := jsonb_set(v_state, '{achievements}', v_achievements, true);

  v_followers := (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN f->>'id' = 'follower_1' AND v_level >= 3
          THEN jsonb_set(f, '{unlocked}', 'true'::jsonb, true)
        ELSE f
      END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_state->'followers', '[]'::jsonb)) WITH ORDINALITY AS t(f, ord)
  );
  v_state := jsonb_set(v_state, '{followers}', v_followers, true);

  v_attack := COALESCE((v_stats->>'attack')::int, 20);
  v_defense := COALESCE((v_stats->>'defense')::int, 5);
  v_max_hp := COALESCE((v_stats->>'maxHp')::int, 100);
  v_crit_chance := COALESCE((v_stats->>'critChance')::int, 5);

  UPDATE players
     SET level = v_level,
         xp = v_xp,
         gold = v_gold,
         gems = v_gems,
         max_energy = v_max_energy,
         current_chapter = v_chapter,
         chapter_wins = v_chapter_wins,
         total_battles_won = v_total_battles,
         total_bosses_defeated = v_total_bosses,
         forge_materials = v_forge_materials,
         attack = v_attack,
         defense = v_defense,
         max_hp = v_max_hp,
         crit_chance = v_crit_chance,
         game_state = v_state,
         updated_at = now()
   WHERE id = v_player_id;

  v_result := jsonb_build_object(
    'game_state', v_state,
    'gold', v_reward_gold,
    'xp', v_reward_xp,
    'gems', v_reward_gems,
    'forge_materials', v_reward_materials,
    'loot', v_loot
  );

  UPDATE pve_battles
     SET status = 'claimed',
         result = v_result,
         claimed_at = now()
   WHERE id = v_battle.id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION begin_pve_battle(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION begin_pve_battle(text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION claim_pve_win(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_pve_win(uuid) TO authenticated;
