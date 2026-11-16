# Хрустальный разлом — этап 1 / #536

Этап опубликован по прямому поручению владельца: [PR #538](https://github.com/w0980077002-create/territory-game-builde/pull/538), `main 012b455`, [Pages deployment](https://github.com/w0980077002-create/territory-game-builde/actions/runs/43852306335) и [проверка опубликованной версии на четырёх мобильных размерах](https://github.com/w0980077002-create/territory-game-builde/actions/runs/43853625322) успешны. Визуальная приёмка владельцем проходит в Telegram. Порталы #537 — отдельный следующий PR.

Изменено только окружение `crystal` в существующем Canvas-рендерере Пещеры. Чистый арт без UI/персонажей: древний виадук над провалом, водопады, большие гранёные кристаллы, руины с резьбой, мох и фиолетовые грибы. HTML HUD, 12 слотов Umbra + крылья, размеры актёров, механика боя, этажи, риск, добыча, сохранения и серверный код не изменены.

Слои имеют собственные скорости камеры: дальняя пещера ×0.16, лучи ×0.23, независимые руины/кристаллы ×0.46, пол ×1, ближние уступы ×1.3. Координаты непрерывные мировые; рисунки не зеркалятся. Края полос заранее растушёваны и перекрываются. Передние объекты находятся ниже ног, в нижних 6% сцены. Редкие частицы тускнеют в бою. Движение воды, дымки и света берётся из времени симуляции, reduced-motion фиксирует ambient clock.

## Проверить визуально

Настоящие кадры Canvas + HTML HUD при одном сохранённом состоянии боя, этаж 36:

| Ширина | До | После |
|---|---|---|
| 320×568 | [до](evidence/crystal-rift-536/before-320.png) | [после](evidence/crystal-rift-536/after-320.png) |
| 360×640 | [до](evidence/crystal-rift-536/before-360.png) | [после](evidence/crystal-rift-536/after-360.png) |
| 390×844 | [до](evidence/crystal-rift-536/before-390.png) | [после](evidence/crystal-rift-536/after-390.png) |
| 430×740 | [до](evidence/crystal-rift-536/before-430.png) | [после](evidence/crystal-rift-536/after-430.png) |

[Движение, зал 3](evidence/crystal-rift-536/moving-room-3.png) · [босс в Crystal](evidence/crystal-rift-536/crystal-boss.png) · [RU + Telegram insets](evidence/crystal-rift-536/insets-reduced-ru.png) · [EN + reduced-motion](evidence/crystal-rift-536/insets-reduced-en.png) · [2 CPU / 2 GB, 320 px](evidence/crystal-rift-536/low-detail-320.png) · [откат при недоступном новом арте](evidence/crystal-rift-536/asset-fallback.png).

Играбельный HTML создаётся прежней командой `npm run build:cave-preview`: `artifacts/cave-expedition/territory-cave-demo.html`. Его можно скачать из PR Actions → **Cave expedition — isolated playable artifact** → `territory-cave-demo-<sha>`. Это существующая изолированная Пещера, не новый игровой маршрут; файл не обращается к живым аккаунтам. Не загружать на production до приёмки.

## Ассеты и производительность

Два новых WebP: `crystal-rift-depth.webp` 1536×1024 — 175 558 байт; `crystal-rift-props.webp` 1536×768 RGBA — 412 434 байта. Всего **587 992 байта / 574.2 KiB**. Арт создан для этой сцены по направлению из #536; это не исходный скриншот владельца и не сплющенный игровой экран. PNG-мастера сохранены в рабочем окружении `/workspace/generated_images/`.

При загрузке один раз готовятся семь небольших Canvas-кэшей: дальний план, пол, три отдельных пропса, дымка и луч. Alpha-чистка, растушёвка и градиенты выполняются до интерактивного кадра; затем кэши переиспользуются без привязки к размеру экрана. Ключ — объект загруженного изображения в WeakMap. Кэши занимают около 7.1 MiB RGBA; декодированные WebP — ещё около 10.5 MiB. Нет полноэкранных фильтров, blur или дополнительных композитных буферов в кадре. Существующий лимит DPR ≤2 сохранён. На устройствах ≤4 CPU или ≤4 GB уменьшаются только лучи/акценты воды/дымка/частицы, геометрия мира остаётся. Ошибка загрузки одного из двух новых изображений возвращает прежний рендер Crystal и не блокирует игру.

Сравнительный Chromium diagnostic: 360×640, DPR 2, CPU throttle ×4, 6 секунд, реальные игровые RAF. [JSON](evidence/crystal-rift-536/report.json):

| | До | После |
|---|---:|---:|
| Кадров | 102 | 114 |
| Медиана RAF, ms | 50.1 | 50.0 |
| p95 RAF, ms | 66.8 | 66.7 |
| JS heap, bytes | 7 613 556 | 7 428 632 |

Отдельный [счётчик Canvas-вызовов](evidence/crystal-rift-536/draw-calls.json), после прогрева в неподвижном бою за 73 кадра: `drawImage` 31 → 36 на кадр; новые linear gradients 30 → 0; radial gradients 1 → 1 (прежний портал); новые Canvas 0 → 0.

В сравнительном прогоне просадки относительно исходной сцены не обнаружено. **Это примерно 20 FPS при искусственном ×4 замедлении, а не доказательство 60 FPS на Android.** JS heap не учитывает GPU/растровую память; физический телефон этим тестом не заменяется.

## Проверки

- PASS: TypeScript, общий ESLint, production build, `git diff --check`.
- PASS: `test:cave-expedition`, `test:cave-playtest`, `test:adventure-server`, `test:pve` — включая серверные квитанции/повторы/сохранения на изолированном PGlite, без записи в live-аккаунты.
- PASS: `check-crystal-rift-browser.py` — 320/360/390/430, короткая высота, 13 слотов, отсутствие скролла/выхода HUD, одинаковое состояние до/после, RU/EN, побайтовая неподвижность Canvas на паузе, возобновление, Telegram insets, reduced-motion, четыре Crystal-зала ⭐⭐⭐/⭐⭐⭐/⭐⭐⭐/⭐⭐⭐, 45 побеждённых врагов с боссом, fallback и low-detail.
- PASS: `check-cave-expedition-browser.py` — все четыре маршрута, бой/босс/победа/поражение, возобновление, RU/EN, reduced-motion, offline, отсутствие debug API в delivery HTML, retry после ошибки обязательного ассета.
- PASS: `check-cave-floor-browser.py` — 4 риска-маршрута на 320/360/390/430, 4 зала, 37/41/45/42 противника, reload, 0 внешних запросов.
- Записано [настоящее движение и бой, 360 px](evidence/crystal-rift-536/real-time-crystal-360.webm): без engine stepping и искусственных побед. [Кадр в пути](evidence/crystal-rift-536/real-time-travel.png).

Воспроизведение:

```sh
node scripts/build-cave-expedition-preview.mjs --test
npm run build:cave-preview
# Необязательно: HTML-стенд исходного main для сравнительных кадров/профиля.
CAVE_BASELINE=/tmp/crystal-before.html python scripts/check-crystal-rift-browser.py
python scripts/check-cave-expedition-browser.py
python scripts/check-cave-floor-browser.py
```

**Не проверено:** физический Android, настоящий портретный Telegram WebView и долгий нагрев телефона. Insets и touch/mobile в Chromium — эмуляция, не проверка приложения Telegram. Финальную художественную приёмку делает владелец; после неё отдельно решается merge/выпуск первого этапа, обновляется main, затем начинается #537.
