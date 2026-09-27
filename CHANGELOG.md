# TERRITORY CLEANUP PASS 29

## Особые места мира
- Added unique interactive actions for the three unlocked world locations.
- Bjorn's Forge: spend materials to temper metal for a chapter reward.
- Astrid's Hunting Trail: spend energy to go hunting and receive a unique world loot item.
- Einar's Ancient Ruins: spend energy to decipher runes for gems, materials and XP.
- Each location action is persistent and can be used once per chapter.
- Rewards are stored separately from NPC quest state.
- Added lightweight location loot generation using the existing inventory item shape.
- Kept PvE, Arena, NPC relations and story systems separated.
- Verified app.js and pve-battle.js with node --check.

## TERRITORY CLEANUP PASS 30

### Визуальные сцены особых мест
- Добавлены отдельные мини-сцены для Кузницы Бьёрна, Охотничьей тропы и Древних руин.
- Перед получением награды игрок сначала входит в сцену места и видит уникальный текст события.
- Добавлена лёгкая анимация эмблемы места и отдельная кнопка действия.
- Сцена учитывает текущую главу, поэтому атмосферный текст меняется по мере прохождения мира.
- Существующие награды, ограничения «один раз за главу» и сохранение состояния не изменены.
- PvE и Arena архитектурно не затронуты.
- Проверено через node --check.


## TERRITORY CLEANUP PASS 31

### Интерактивный осмотр особых мест
- В мини-сценах добавлена отдельная кнопка «🔎 Осмотреть».
- Игрок может пролистывать несколько наблюдений локации до выполнения основного действия.
- Сцена показывает текущую главу, атмосферный текст и стоимость/награду.
- Осмотр не тратит энергию, материалы и не расходует возможность места.
- Основная награда и ограничение «один раз за главу» остались без изменений.
- PvE и Arena не затронуты.
- Проверено через node --check.

## TERRITORY CLEANUP PASS 32

### Выборы внутри особых мест
- Кузница Бьёрна, Охотничья тропа и Древние руины получили по два разных варианта действия.
- Каждый вариант имеет собственный текст и собственную награду.
- Стоимость входа остаётся общей для выбранной локации и списывается один раз при успешном выборе.
- Выбранный путь сохраняется в `worldLocationActions`, поэтому результат не теряется после перезагрузки.
- Ограничение «один раз за главу» сохранено.
- Старые сохранения остаются совместимыми: если выбора нет, используется базовая награда локации.
- PvE и Arena архитектурно не затронуты.
- Проверено через node --check.

## PASS 33 — Память мира и последствия выбора
- Решения в особых локациях теперь оставляют постоянную запись в `worldMemories`.
- Выбор в кузнице влияет на доверие к Бьёрну.
- Выбор на охотничьей тропе влияет на доверие к Астрид.
- Выбор в древних руинах влияет на доверие к Эйнару.
- Добавлена панель «Память мира» с последними решениями героя.
- Сохранены правила: одна особая локация — один выбор за главу.
- PvE и Arena не изменялись.

## PASS 34 — Отголоски решений
- Added persistent world echoes that appear in later chapters when previous location choices match.
- Added six follow-up world events tied to Bjorn, Astrid and Einar location choices.
- Echoes provide new rewards and can deepen NPC relations.
- Echoes are once per chapter and persist through TerritoryStore.
- Added a dedicated “Отголоски прошлого” panel to the world roadmap.
- Kept Arena and PvE battle systems isolated.

## TERRITORY CLEANUP PASS 35 — Хроника героя
- Added a persistent hero chronicle built from world memories and completed world echoes.
- Added six lightweight earned identity badges based on the player's remembered location choices.
- Added a chronological timeline showing recent decisions and returning echoes.
- Chronicle data is derived from existing saved world memory/echo state; no new mandatory progression was introduced.
- Kept the existing once-per-chapter rules and preserved PvE/Arena separation.
- Verified with node --check.

## TERRITORY CLEANUP PASS 36 — Живые связи
- Added context-aware NPC bond scenes for Bjorn, Astrid and Einar.
- NPC dialogue now changes with the current trust tier.
- Bond scenes can reference the hero's most recent remembered choice for that NPC.
- Added a visual trust progress bar and next-tier hint inside the bond scene.
- Added a lightweight “📖 Вспомнить” action to NPC cards without introducing new mandatory progression or costs.
- Kept existing NPC relation, quest, world-memory and echo systems compatible.
- PvE and Arena remain isolated.
- Verified with node --check.

## TERRITORY CLEANUP PASS 38 — Личные линии
- Added persistent follow-up scenes for Bjorn, Astrid and Einar after their personal secrets are opened.
- Follow-up scenes unlock only in a later chapter and require continued NPC trust.
- Each continuation is claimable once per chapter and gives its own reward plus additional NPC trust.
- Added a dedicated “Продолжение личных историй” panel to the world roadmap.
- Follow-up state persists in `npcStoryAftermath` and remains compatible with existing saves.
- PvE and Arena remain isolated.
- Verified with node --check.

## PASS 39 — Финалы личных историй
- Добавлена система персональных финалов для Бьёрна, Астрид и Эйнара.
- Финал зависит от выбранного ранее пути в особой локации.
- Финалы требуют открытой тайны, продолжения личной истории в следующей главе и 90 доверия.
- Каждый финал имеет отдельную сцену, награду и сохраняется один раз.
- Добавлена панель «Финалы личных историй».
- Завершённые линии записываются в хронику через существующую память состояния.
- Arena и PvE архитектура не изменялись.

## PASS 40 — Общая история Territory
- Добавлена первая общая сюжетная арка, связывающая личные истории Бьёрна, Астрид и Эйнара.
- Арка открывается после завершения всех трёх личных финалов и перехода в следующую главу.
- Добавлены три разных направления общей истории: собрать союз, сделать ставку на силу кузницы или открыть древний путь.
- Выбор сохраняется в `worldConvergence`, одноразово выдаёт награду и усиливает отношения с персонажами.
- Добавлена отдельная панель «Общая история Territory» на карте мира.
- Событие записывается в сохранение и становится основой для будущих связанных событий.
- PvE и Arena не изменялись.
- Проверено через node --check.


## TERRITORY CLEANUP PASS 41

### Последствия общего пути
- Added a branch-consequence layer after the three-way Territory convergence.
- The selected common path now unlocks a path-specific event in the following chapter.
- Each branch event has two choices with distinct rewards and NPC relation effects.
- Branch choices are stored in worldBranchEvents and worldMemories, so the world remembers them.
- The system is once-per-chapter and does not modify PvE or Arena combat state.
- Verified app.js and pve-battle.js with node --check.
