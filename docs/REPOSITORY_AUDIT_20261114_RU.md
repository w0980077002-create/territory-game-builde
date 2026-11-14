# Аудит репозитория TERRITORY — 14.11.2026

## Дополнение: упрощение управления по следующему поручению владельца

После первоначальной уборки владелец передал техническое управление и попросил убрать лишних агентов и действия. Удалены:

- 6 специализированных профилей `.github/agents/`;
- Qwen issue-dispatch и его код/тесты, обслуживавшие только этот механизм;
- workflow «команды специалистов» и его Python-диспетчер;
- ежечасный triage и 15-минутный монитор, повторявшие служебные отчёты;
- дублирующий архив общих инструкций (прежний текст доступен в Git).

Причина: эти механизмы не исполняли полный цикл игровой разработки. Qwen был ограничен единичной правкой, «специалисты» повторяли имеющиеся тесты, мониторинг создавал отчёты без исправления. Повторные запуски CI на PR и проверка после deploy уже покрывают нужные события. Удаление триггеров остановит новые запуски после попадания изменения в `main`; уже запущенные задания автоматически не отменяются.

`AGENTS.md` сокращён до рабочего порядка. Игровые правила и художественные ограничения сохранены в [GAME_REQUIREMENTS_RU.md](GAME_REQUIREMENTS_RU.md), числа и механики не менялись. `CLAUDE.md` и `START-HERE-RU.md` стали короткими указателями. Старые `QUALITY_*`-маркеры не требуются.

Новые постоянные агенты не добавлены. Текущий исполнитель отвечает за законченный результат; дополнительный агент нужен только при конкретной независимой задаче. Технические решения и обычные проверенные исправления не требуют повторного согласования владельцем.

Проверено повторно: typecheck, lint, build, owner-decisions и elixir-expiry — PASS; 81 Markdown-файл без битых относительных ссылок. Содержимое 15 оставшихся workflow побайтно совпадает с исходным. Проверка owner-decisions теперь читает перенесённые требования из нового файла и проверяет ссылку на него из AGENTS.md; прежние проверки VIP и календаря сохранены. AGENTS.md сокращён примерно с 31,8 до 8,5 КБ.

Игровой код, SQL, `package.json`, release gate, workflow PR-регрессий, Pages deploy, проверка опубликованного SHA и все специализированные проверки механик оставлены. Сначала изменения подготовлены локально; состояние публикации сообщается отдельно в результате работы. Ниже — результаты первоначальной фазы, в которой профили ещё существовали.


Проверенная исходная ревизия: `b9b542b`. Работа выполнена локально в ветке `maintenance/repository-instructions-audit-20261114` по поручению владельца убрать противоречия и препятствия разработке.

## Причины и исправления

| Найдено | Исправлено |
| --- | --- |
| Общие инструкции, профили ролей, handoff и шаблон PR содержали разные требования | Приоритет текущего поручения и `AGENTS.md` явно распространяется на профили, спецификации и шаблоны. Убраны старые эксклюзивные назначения и запрет merge первоначального прототипа |
| Экономический профиль требовал семидневного сгорания, QA — таймеров истечения | Оба профиля приведены к бессрочным расходникам и материалам. Старые отчёты помечены историческими, их факты на дату не переписаны |
| Документы утверждали отсутствие байтов v2-арта | Три транспортных ZIP найдены в Git; архив восстановлен, SHA256 и 21 мастер проверены. Описан рабочий доступ к исходникам |
| Транспортный README требовал отсутствующий `import-approved-characters-v2.mjs` и старую ветку PR | Добавлен автономный `scripts/check-character-art-pack.py`: проверка без записи и распаковка в новую локальную папку. Архивные указания не исполняются |
| Исследование Lootborn требовалось для любого PR; шаблон ссылался на несуществующий относительный путь | Область ограничена новым игровым дизайном; технические исправления и документация освобождены. Ссылка исправлена, подготовка PR не требует предварительного выпуска |
| Обязательная координация с отдельным ревьюером могла останавливать локальную работу | Проверка экономики обязательна по существу; недоступность профиля не блокирует реализацию и изолированные тесты |
| «CSS только для раскладки» мешало нужным состояниям и анимациям | Разрешены эффекты, адаптивность и анимация с сохранением утверждённых иллюстраций |
| После сборки появился untracked AVIF, уже воспроизводимый из проверенных base64-частей | Добавлено точное исключение только генерируемого файла в `.gitignore`; файл не удалён |
| Инструкция запуска не объясняла приоритет `.env.local` | Добавлена проверка выбранного тестового окружения без перезаписи существующей настройки |

## Проверка

- `npm run typecheck` — PASS.
- `npm run lint` — PASS, без ослабления правил.
- `npm run build` — PASS; prebuild проверил SHA256 одобренного Mortarion AVIF.
- Все 55 регрессионных команд из `review-ci.yml` (помимо установки, typecheck и build) и дополнительный `test:cave-expedition` — **56/56 PASS**. Вложенные npm-команды включают дополнительные проверки.
- `python3 scripts/check-character-art-pack.py` и распаковка в новую `/tmp/territory-art-v2-audit` — PASS.
- Валидатор из проверенного пакета — PASS: 21 RGBA, 21/21 SHA256, альфа и прозрачные углы, отдельные preview.
- Относительные Markdown-ссылки в корневых документах, `docs/` и `.github/` проверены на наличие файлов. Внешние URL и якоря этим не проверяются.
- `git diff --check` — PASS.

Среда проверки: Node.js `v24.19.0`; workflows используют Node.js 20. Это локальные результаты, не запуск GitHub Actions.

### Воспроизведение регрессионных проверок

```sh
node scripts/auth-mock-tests.cjs
node scripts/edge-initdata-tests.cjs
node scripts/edge-identity-tests.cjs
npm run test:owner-decisions
node scripts/check-halloween-world-boss.mjs
node scripts/check-halloween-companion-reward.mjs
node scripts/check-halloween-refresh.mjs
node scripts/check-halloween-admin.mjs
python3 scripts/check-halloween-operator.py
node scripts/check-halloween-bulk-pglite.mjs
node scripts/check-adventure-client-ui.mjs
node scripts/check-cave-systems.mjs
node scripts/check-dark-stones.mjs
node scripts/check-adventure-receipt-adapter.mjs
npm run test:stage1
npm run test:slots
node scripts/check-pages-build-sha.mjs
npm run test:balance
npm run test:pve
node scripts/check-trial-reload-integrity.mjs
node scripts/check-pve-next-navigation.mjs
node scripts/check-pve-recovery-controls.mjs
npm run test:inventory-cleanup
npm run test:gear-recycle
npm run test:gear-showcase
npm run test:workshop
npm run test:companion-navigation
npm run test:founders
npm run test:referral-activity
npm run test:hall
npm run test:admin-master
npm run test:admin-mail
npm run test:admin-geography
npm run test:economy
node scripts/check-equipment-safety-v4.mjs
npm run test:professions
npm run test:professions:stage8
npm run test:master-license
npm run test:feature-separation
npm run test:mobile-home
npm run test:visual-viking
node scripts/check-territory-oak-unified.mjs
npm run test:events
npm run test:arena-prizes
node scripts/check-combat-visuals.mjs
node scripts/check-arena-postfight.mjs
node scripts/check-belt-victory-milestones.mjs
npm run test:elixir-expiry
node scripts/check-arena-live-belt-guard.mjs
node scripts/check-arena-matchmaking.mjs
node scripts/check-arena-team-live.mjs
node scripts/check-rune-skill-book.mjs
node scripts/check-rune-15-slot-gate.mjs
node scripts/check-rune-slots-v1.mjs
node scripts/check-v1-full-combat-catalog.mjs
npm run test:cave-expedition
```

## Что это позволяет делать дальше

Продолжать разработку на текущем коде без повторного получения уже имеющихся персонажей, без старых эксклюзивных назначений и лишних согласований безопасных локальных изменений. Рабочая карта и команды: [DEVELOPMENT_RU.md](DEVELOPMENT_RU.md). DEMO и реальные серверные этажи остаются разными по сохранению и наградам.

## Границы результата

Это аудит инструкций, маршрута разработки, локальной сборки, относительных ссылок и существующих регрессий. Он не доказывает отсутствие всех ошибок игры. Новые персонажи проверены как исходные изображения; они ещё не анимированы и не подключены в бой. Браузерные сценарии, физический телефон и Telegram WebView в этой работе не запускались, поскольку игровой интерфейс не менялся.

Живая база, секреты, настройки GitHub, открытые issue/PR, фактические права и активность production не проверялись и не изменялись. SQL и Edge Functions не применялись, deploy и push не выполнялись. Исторические миграции, отчёты, ZIP и одобренный арт сохранены. Защита сохранений, серверные квитанции и release gate не ослаблены.
