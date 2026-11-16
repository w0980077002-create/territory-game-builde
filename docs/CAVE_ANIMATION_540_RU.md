# Пещера — перенос анимаций #540

> **СТАТУС ОБНОВЛЁН 16.11.2026:** визуальная работа из этого отчёта объединена в `main` через PR #541 (merge commit `900dd69ee2193dd15eb70d781356e1e8f5e5731e`) и опубликована на GitHub Pages. Старые #491 и #522 закрыты без merge; их состояние ниже — исторический preflight, не нынешний список блокеров. Не начинать этот перенос повторно, не требовать новой личной приёмки до публикации уже согласованного визуала. Полные рабочие правила: [AGENTS.md](../AGENTS.md).

База TERRITORY: `0963675973466fda7674a2113d547ba2bf39fe37`.
Источник арта VIKING **main**: `645eab542a9f9ec42a26917dcb4ea9edc39b8175`.
Проверены свежий AGENTS.md, #540, распределение #476 и открытые PR.
#491 и #522 остаются конфликтующими draft и не переносились. Других открытых
PR с реализацией этих cave-анимаций на момент preflight не было.

## Что реально перенесено

| ID | Источник в pinned VIKING | Применение | Движения | Fallback | Разрешение |
|---|---|---|---|---|---|
| `08_armored_boar` | `public/art/animation-enemies.webp`, `animation-frames.json` | существующий `eel` | 8 нарисованных поз: idle, 2 run, windup, attack, recovery, hit, death | существующий approved WebP | #540 |
| `04_club_raider` | те же atlas/registry | существующий `shardling` | те же 8 поз | существующий approved WebP | #540 |
| `07_purple_mage` | те же atlas/registry | существующий `moth` | те же 8 поз | существующий approved WebP | #540 |
| `spider_queen` | `src/game/bossAnimation.ts`, существующий TERRITORY approved WebP | прежний финальный босс этажей 21–40 | rigid procedural idle/run/windup/release/hit/death; отдельные нити паутины | прежний renderer | #540, #476 |
| `fungal_king` | тот же procedural source, существующий approved WebP | прежний босс этажей 1–20, 41–60 | rigid procedural позы, без скелета | прежний renderer | #540, #476 |
| `fire_abyss_lord` | тот же procedural source, существующий approved WebP | прежний босс 61–100 | rigid procedural позы, без скелета | прежний renderer | #540, #476 |
| `senior_driller` | `public/art/bosses/senior_driller.webp` | редкий cosmetic `shardling`, crystal, этаж ≥6, `enemy.id % 9 === 0` | rigid procedural позы, без скелета | прежний `shardling` WebP | #540, crystal в #476 |
| `moss_eater` | `public/art/bosses/moss_eater.webp` | редкий cosmetic `moth`, spore, этаж ≥6, тот же стабильный ID | rigid procedural позы, без скелета | прежний `moth` WebP | #540, moss в #476 |

Бурильщик/Пожиратель здесь только облики существующих противников: новых
мини-боссов, species, статов и волн нет. При одинаковом этаже/биоме/ID облик
совпадает после reload и фарма. Оба смотрят в сторону героя. У трёх атласных
персонажей сохранены source frame rect и индивидуальные foot pivots; масштаб
постоянен на весь клип. Бег рядовых — две готовые позы, не отдельный run-риг.
Размер тела +17% (116 → 136 canvas units); босс 196 → 206, без изменения коллизий.

Оставшиеся 13 из исходных 21 не включены:

| ID | Причина / режим |
|---|---|
| `winged_helmet_warrior`, `whitebeard_mage`, `strongman_boulder` | не заменять действующего героя |
| `goose_aviator` | отдельный этап спутника; слот/владение не создавать |
| `brown_white_dog` | кандидат в спутники, внедрение не утверждено |
| `01_sword_shield_veteran`, `02_roman_spearman`, `03_pirate_bandit`, `05_shield_spearman`, `06_red_crest_legionary` | нет адресного cave-разрешения |
| `capybara_bruiser` | будущий Поход |
| `minotaur_echo` | будущие Испытания |
| `cappuccina_approved` | запрещена #476, название файла не является разрешением |

Нового дизайна/генерации нет. Это утверждённые владельцем исходники; независимая
юридическая экспертиза коммерческих прав этим переносом не подтверждается.

## Визуальный контракт

- Только чтение `Enemy.pose/impact/poseUntil/deathAt`, `World.time` и существующих
  эффектов. Ни одного вызова урона, нового боевого таймера или изменения engine.
- Замах сохраняется до фактического impact, затем release/recovery. Во время
  получения урона не прерывается уже запланированная атака врага.
- Электрическая дуга видит только уже назначенные `target/heroImpact` либо
  `cleaveTargets/cleaveImpact`. Начало и след читают текущую матрицу существующего
  меча внутри heroRig. Кости, обмундирование и choreography героя не заменялись.
- Короткие вспышки и направленные сколы используют существующие impact-события.
  Прежний hit-stop движка и «БАМ/ХРЯСЬ/БДЫЩ» сохранены. Нового hit-stop нет.
- Три прежние фазы босса имеют разные цвета и glyphs, круг заполняется ДО удара.
  Тяжёлый удар отличается двойным знаком, вход мягко проявляется; смерть затухает.
- Синтезированные локальные attack/contact/death cues; mute/background сохранены,
  старые эффекты и boss entry из checkpoint не проигрываются повторно.
- Reduced motion отключает тряску/вращение и след; остаются статичные сигналы.
  Автобюджет по стоимости 90 кадров уменьшает фоновые частицы/glow/camera;
  низкое `deviceMemory` начинает с low. Это визуальные уровни, не изменение боя.
- Найденная прежняя косметическая пыль потребляла общий `Math.random()`.
  Теперь у неё собственная deterministic последовательность; боевой RNG не тронут.

## Загрузка и воспроизведение

Три выбранных атласа (24 кадра) и две текстуры: **1 895 344 байта** суммарно,
около 6,1 MiB RGBA при декодировании всех пяти. В первый экран они не загружаются:
запрос начинается только при появлении подходящего противника. Шесть существующих
approved WebP не менялись и не дублировались. Формат source crops — lossless WebP;
два новых master-текстурных изображения ограничены исходными 768 px.

Новые файлы исключены из обязательного Promise.all. У 404/неполного клипа/пока
не завершилась загрузка показывается прежний спрайт с прежней опорой; ошибка
кэшируется на mount, нет retry на каждом кадре. AbortController отменяет новые
запросы при unmount. `assetPaths()` включает их для portable/CI, обычный resolver
сохраняет `BASE_URL`. Проверен HTTP-префикс `/territory-game-builde/`.

Повторить импорт: `python scripts/art/import-cave-animation.py /path/to/source`.
Импортёр проверяет source SHA; JSON хранит rect/pivot и SHA256 новых WebP.
В runtime не попадают PNG-мастера, чужой store/экономика или полный VIKING runtime.

## Проверки и доказательства

Обязательные команды: `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run test:cave-expedition`, `npm run test:cave-expedition:browser`,
`npm run test:cave-playtest`, `npm run test:combat`, `npm run test:pve`.

Новые проверки: `npm run test:cave-animation:browser` и включённый в cave-expedition
`check-cave-animation.mjs`: SHA/rect/pivot, actual pose mapping, отмена/404/задержка,
stable variants, sound cursors, автобюджет. Полный этаж с seed 540 даёт **идентичный
World и остаток RNG** с/без визуальных вызовов: четыре участка, три фазы, победа.

Отдельный `check-cave-floor-browser.py` проходит четыре полных маршрута 9/10/11,
reload в бою, добычу/replay, 12 Umbra + крылья, 7 кнопок. Мобильные ширины
320/360/390/430, RU/EN, малая высота, reduced motion. Обычные успешные HTTP-запросы
без 404/page errors; намеренные 404 проверяются отдельно.

`artifacts/cave-expedition/animation-evidence/` содержит 64 кадра всех восьми
обликов, три статичных phase-сигнала, электрический удар, mobile UI и JSON с
замерами настоящего Chromium. QA checkpoint-кадры явно синтетические.
Видео `real-combat-floor21-390.webm` — **реальные RAF и UI**, начальный офлайн-этаж
21 задан явно, без stepping/подмены победы: четыре участка, все фазы Королевы,
победа при x2. Снимки до/после сняты с одинаковыми визуальными checkpoint;
в них скрыто только мешающее просмотру окно паузы тестовой CSS.

Артефакты и видео служат доказательствами разработчика, а не заменяют приёмку
в обычной TERRITORY. Физический **Telegram Android WebView не проверен**.
До личной приёмки владельца PR не сливать/auto-merge не включать согласно AGENTS.md.
Последний Pages workflow для baseline `0963675` успешен; прямой HTTP Pages из
данного окружения заблокирован сетевым CONNECT 403, опубликованный HTML/SHA через
HTTP не подтверждён. Эта ветка сама не опубликована; production/backend не менялись.
