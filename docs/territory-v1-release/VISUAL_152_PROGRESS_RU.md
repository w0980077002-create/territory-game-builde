# #145: проверка PR #152

Это рабочий чеклист, а не акт завершения. Артефакты получены из реальных React-компонентов с изолированным тестовым состоянием, без подключения аккаунтов и сервера. Настоящий Telegram WebView и визуальная приёмка владельцем не выполнялись.

## Парные снимки героя

«До» — `main` 8e0167e; «после» — рабочая версия PR. Одно и то же начальное состояние героя, язык и ширина; анимации выключены. Для полного снимка секции ограничение высоты тестовой оболочки снято. Короткая оболочка отдельно проверялась браузерным smoke.

| Ширина | Русский | English |
| --- | --- | --- |
| 320 | [до](visual-152/hero-before-320-ru.png) · [после](visual-152/hero-after-320-ru.png) | [before](visual-152/hero-before-320-en.png) · [after](visual-152/hero-after-320-en.png) |
| 360 | [до](visual-152/hero-before-360-ru.png) · [после](visual-152/hero-after-360-ru.png) | [before](visual-152/hero-before-360-en.png) · [after](visual-152/hero-after-360-en.png) |
| 390 | [до](visual-152/hero-before-390-ru.png) · [после](visual-152/hero-after-390-ru.png) | [before](visual-152/hero-before-390-en.png) · [after](visual-152/hero-after-390-en.png) |
| 430 | [до](visual-152/hero-before-430-ru.png) · [после](visual-152/hero-after-430-ru.png) | [before](visual-152/hero-before-430-en.png) · [after](visual-152/hero-after-430-en.png) |

## Парные снимки склада

Изолированное начальное состояние, реальные компоненты; экран 700 CSS px. «До» — тот же `main` 8e0167e. Содержимое и количество предметов одинаковы, время создаётся тестовой фикстурой.

| Ширина | Русский | English |
| --- | --- | --- |
| 320 | [до](visual-152/inventory-before-320-ru.png) · [после](visual-152/inventory-after-320-ru.png) | [before](visual-152/inventory-before-320-en.png) · [after](visual-152/inventory-after-320-en.png) |
| 390 | [до](visual-152/inventory-before-390-ru.png) · [после](visual-152/inventory-after-390-ru.png) | [before](visual-152/inventory-before-390-en.png) · [after](visual-152/inventory-after-390-en.png) |

## Спутники и окно карты

Парные снимки соответствуют одному тестовому состоянию; «до» — `main` 8e0167e. Спутники показаны с тестовым разблокированным персонажем, карта — с открытым списком направлений.

| Экран | 320 RU | 320 EN | 390 RU | 390 EN |
| --- | --- | --- | --- | --- |
| Спутники | [до](visual-152/companions-before-320-ru.png) · [после](visual-152/companions-after-320-ru.png) | [before](visual-152/companions-before-320-en.png) · [after](visual-152/companions-after-320-en.png) | [до](visual-152/companions-before-390-ru.png) · [после](visual-152/companions-after-390-ru.png) | [before](visual-152/companions-before-390-en.png) · [after](visual-152/companions-after-390-en.png) |
| Список карты | [до](visual-152/map-dialog-before-320-ru.png) · [после](visual-152/map-dialog-after-320-ru.png) | [before](visual-152/map-dialog-before-320-en.png) · [after](visual-152/map-dialog-after-320-en.png) | [до](visual-152/map-dialog-before-390-ru.png) · [после](visual-152/map-dialog-after-390-ru.png) | [before](visual-152/map-dialog-before-390-en.png) · [after](visual-152/map-dialog-after-390-en.png) |

## Поход

Реальный `BattleScreen`, изолированное начальное состояние, одинаковая ширина и язык; боевой компонент и серверный транспорт в фикстуре подменены. «До» — `main` 8e0167e.

| Ширина | Русский | English |
| --- | --- | --- |
| 320 | [до](visual-152/journey-before-320-ru.png) · [после](visual-152/journey-after-320-ru.png) | [before](visual-152/journey-before-320-en.png) · [after](visual-152/journey-after-320-en.png) |
| 390 | [до](visual-152/journey-before-390-ru.png) · [после](visual-152/journey-after-390-ru.png) | [before](visual-152/journey-before-390-en.png) · [after](visual-152/journey-after-390-en.png) |

Окно выхода Арены и панель результата показаны на искусственном состоянии комнаты; боевой фон и транспорт фикстуры подменены. Числа награды в снимке результата — тестовые, а не начисленные игроку.

| Состояние | 320 RU | 320 EN | 390 RU | 390 EN |
| --- | --- | --- | --- | --- |
| Выход | [до](visual-152/arena-leave-before-320-ru.png) · [после](visual-152/arena-leave-after-320-ru.png) | [before](visual-152/arena-leave-before-320-en.png) · [after](visual-152/arena-leave-after-320-en.png) | [до](visual-152/arena-leave-before-390-ru.png) · [после](visual-152/arena-leave-after-390-ru.png) | [before](visual-152/arena-leave-before-390-en.png) · [after](visual-152/arena-leave-after-390-en.png) |
| Результат | [до](visual-152/arena-result-before-320-ru.png) · [после](visual-152/arena-result-after-320-ru.png) | [before](visual-152/arena-result-before-320-en.png) · [after](visual-152/arena-result-after-320-en.png) | [до](visual-152/arena-result-before-390-ru.png) · [после](visual-152/arena-result-after-390-ru.png) | [before](visual-152/arena-result-before-390-en.png) · [after](visual-152/arena-result-after-390-en.png) |

## Чеклист

- [ ] Герой: сцена, реальные слоты и путь проверены в изолированном Chromium; художественная приёмка и состояния со всеми вариантами реальной экипировки не завершены.
- [ ] Город и инвентарь: склад получил более крупные предметы и полные названия, браузерный smoke проверяет карточки и их закрытие; полный визуальный аудит всех вкладок и состояний не завершён.
- [ ] Общий Modal и окна правил/призов Арены: проверены размер, внутренний скролл, закрытие, Escape, возврат фокуса и вложенный общий Modal в Chromium; остальные локальные окна требуют отдельной проверки.
- [ ] Арена и бой, поход, испытания и существующая Тёмная пещера. В Походе текущий противник выделен сценой и реальной наградой; изолированный browser smoke проверяет переходы в поход и испытание на четырёх ширинах и двух языках. Окно выхода и три состояния результата Арены проверены с подменённым транспортом. Сам сетевой бой, серверная Пещера и остальные локальные состояния ещё требуют отдельной визуальной проверки.
- [ ] Руны, спутники, кузница, профессии, магазин и VIP. Спутники: изолированная проверка выбранного и закрытого состояния, выбор и настоящие данные на четырёх ширинах и двух языках; остальные состояния требуют проверки.
- [ ] Карта, задания, награды, клан, почта, аукцион и мини-игры. Список карты: проверены скролл, закрытие, фокус, маршрут кузницы, четыре ширины и два языка; жесты карты и прочие состояния требуют отдельной визуальной проверки.
- [ ] Парные снимки остальных разделов, реальные пути действий и окончательная проверка всех окон.
- [ ] Успешные Actions на конечном SHA и визуальная приёмка владельцем.

Незавершённые пункты нельзя считать принятыми по наличию общей темы или статических CSS-проверок.

## Локальные окна, требующие отдельного обхода

Кроме общего `Modal`, в коде найдены отдельные окна: `ArenaRulesModal`, `ArenaWeeklyBoard`, подтверждение выхода `ArenaRoom`, заточка `ForgeScreen`, книга рун `RuneSkillBook`, список направлений `WorldMapCanvas`, бонусы `VikingSlots`/`ServerVikingSlots`, награда `MonopolyScreen`, панели и награда `monopoly/MonopolyAdventure`, а также локальные окна колеса и покупки магазина. Это список источников для проверки, а не утверждение, что каждый путь доступен в текущей конфигурации или уже проверен. Окна Арены и список карты имеют указанный выше изолированный browser smoke; остальные требуют проверки фактического открытия, клавиатуры, фокуса, скролла и вложенности.
