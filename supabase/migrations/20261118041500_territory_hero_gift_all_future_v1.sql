-- TERRITORY: permanent owner-approved all-players gift, 18 Nov 2026.
-- One mail per existing/future player; contents are credited only on existing
-- authenticated, atomic territory_admin_claim_grant_v2() claim.
-- Does not modify saved progress, VIP, premium wallets, or player balances.
-- Existing and future player accounts both qualify without any expiry.
CREATE UNIQUE INDEX IF NOT EXISTS territory_hero_gift_20261118_once_v1
 ON public.admin_grants(player_id)
 WHERE kind='mail' AND subject='🎁 Большой подарок всем героям TERRITORY!';

CREATE OR REPLACE FUNCTION territory_private.territory_hero_gift_20261118_new_player_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $gift$
BEGIN
  INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
  VALUES (
    NEW.id,'mail','🎁 Большой подарок всем героям TERRITORY!',
    '⚔️ Герои TERRITORY!

❤️ Спасибо каждому, кто сражается, помогает новичкам и делает наш мир живым! Мы ценим и ветеранов, и тех, кто только начинает свой путь.

🎁 Большой подарок от администрации:
🪙 10 000 золота
💎 300 синих алмазов
⚔️ 500 боевых камней
🔨 1 000 материалов кузницы
💪 100 эликсиров силы
🛡️ 100 эликсиров защиты
🎯 100 эликсиров крита
❤️ 100 зелий здоровья
❤️‍🔥 100 больших зелий здоровья
⏳ 100 зелий времени
💉 100 адреналина

Никаких заданий и условий — просто нажми «Забрать»! Подарок доступен каждому герою, включая тех, кто присоединится позже.

🐉 Монстры уже жалуются: «Да сколько можно усиливать этих героев?!» 😁

С благодарностью, команда TERRITORY ❤️',
    jsonb_build_object(
 'gold',10000,'gems',300,'stones',500,'forgeMaterials',1000,
 'items',jsonb_build_object(
   'shop_potion_hp',100,'shop_potion_hp_large',100,
   'shop_elixir_atk',100,'shop_elixir_def',100,'shop_elixir_crit',100,
   'shop_arena_time',100,'shop_arena_adrenaline',100
 )
)
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$gift$;
REVOKE ALL ON FUNCTION territory_private.territory_hero_gift_20261118_new_player_v1()
 FROM PUBLIC,anon,authenticated;

CREATE TRIGGER territory_hero_gift_20261118_new_player_v1
 AFTER INSERT ON public.players FOR EACH ROW
 EXECUTE FUNCTION territory_private.territory_hero_gift_20261118_new_player_v1();

-- Backfill all currently registered players in same migration.
INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
 SELECT p.id, 'mail', '🎁 Большой подарок всем героям TERRITORY!', '⚔️ Герои TERRITORY!

❤️ Спасибо каждому, кто сражается, помогает новичкам и делает наш мир живым! Мы ценим и ветеранов, и тех, кто только начинает свой путь.

🎁 Большой подарок от администрации:
🪙 10 000 золота
💎 300 синих алмазов
⚔️ 500 боевых камней
🔨 1 000 материалов кузницы
💪 100 эликсиров силы
🛡️ 100 эликсиров защиты
🎯 100 эликсиров крита
❤️ 100 зелий здоровья
❤️‍🔥 100 больших зелий здоровья
⏳ 100 зелий времени
💉 100 адреналина

Никаких заданий и условий — просто нажми «Забрать»! Подарок доступен каждому герою, включая тех, кто присоединится позже.

🐉 Монстры уже жалуются: «Да сколько можно усиливать этих героев?!» 😁

С благодарностью, команда TERRITORY ❤️', jsonb_build_object(
 'gold',10000,'gems',300,'stones',500,'forgeMaterials',1000,
 'items',jsonb_build_object(
   'shop_potion_hp',100,'shop_potion_hp_large',100,
   'shop_elixir_atk',100,'shop_elixir_def',100,'shop_elixir_crit',100,
   'shop_arena_time',100,'shop_arena_adrenaline',100
 )
)
 FROM public.players p
 ON CONFLICT DO NOTHING;
