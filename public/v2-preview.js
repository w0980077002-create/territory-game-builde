/* Independent visual preview: zero API calls, zero production auth, zero saves. */
(() => {
  'use strict';
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlayTitle');
  const body = document.getElementById('sheetBody');
  const battle = document.querySelector('.v2-battle');
  const auto = document.getElementById('auto');
  const speed = document.getElementById('speed');
  const html = (strings, ...values) => strings.map((part, i) => part + (values[i] ?? '')).join('');
  const images = {
    hero: './assets/territory/characters/heroes/male_viking/idle.webp',
    companion: './assets/territory/characters/followers/loyal_shield/idle.webp',
    helmet: './item-helmet.webp', armor: './item-armor.webp',
    weapon: './item-weapon.webp', shield: './item-shield.webp',
    boots: './item-boots.webp', ring: './item-ring.webp',
  };
  const makeTiles = (items) => '<div class="v2-tile-grid">' + items.map(([label, icon]) =>
    '<button type="button" class="v2-tile" data-view="' + label + '"><strong>' + icon + '</strong><span>' + label + '</span></button>').join('') + '</div>';
  const equipment = () => '<div class="v2-tile-grid">' +
    Object.entries(images).filter(([key]) => !['hero','companion'].includes(key)).map(([key,src]) =>
      '<button class="v2-tile" data-view="Склад"><img src="' + src + '" alt=""/><span>Ур. 85 · ' + ({helmet:'Шлем',armor:'Броня',weapon:'Оружие',shield:'Щит',boots:'Сапоги',ring:'Кольцо'}[key] ?? key) + '</span></button>').join('') +
    '</div>';
  const screens = {
    'Меню': () => makeTiles([['Герой','🛡️'],['Склад','🎒'],['Руны','🔷'],['Последователи','🐂'],['Арена','⚔️'],['Профессии','⚒️'],['Клан','🛡'],['Игры','🎲'],['Почта','✉️'],['Настройки','⚙️'],['Характеристики','📊'],['Приключение','🗺️']]),
    'Порт': () => '<p class="v2-screen-desc">Центр города: профессии, кузница, торговля и путешествия. Функции действующей TERRITORY будут перенесены после тестирования.</p>' + makeTiles([['Профессии','⚒️'],['Склад','🎒'],['Приключение','🗺️'],['Клан','🛡'],['Рынок','🏪'],['Игры','🎲']]),
    'Герой': () => '<div class="v2-screen-hero"><img src="' + images.helmet + '" alt="Шлем"/><img src="' + images.hero + '" alt="Мультяшный викинг"/></div><div class="v2-featureline">⚔️ Сила: 124 500 · ❤️ HP: 8 500</div><div class="v2-section-tabs"><button data-view="Снаряжение" class="selected">Снаряжение</button><button data-view="Навыки">Навыки</button><button data-view="Руны">Руны</button></div>' + equipment(),
    'Снаряжение': () => '<p class="v2-screen-desc">Семь существующих слотов TERRITORY. Экипировка и улучшения игрока сохранятся после миграции.</p>' + equipment(),
    'Склад': () => '<p class="v2-screen-desc">Здесь будет привычная сетка: всё / снаряжение / материалы / камни. Текущие предметы игроков в прототип не загружаются.</p><div class="v2-section-tabs"><button class="selected">Снаряжение</button><button data-view="Руны">Руны</button><button data-view="Последователи">Спутники</button></div>' + equipment() + '<button class="v2-sheet-button" data-view="Снаряжение">Сравнить экипировку</button>',
    'Навыки': () => '<p class="v2-screen-desc">Активные, пассивные, талант и руны. Используется понятная структура как в любимой игре, с собственной графикой.</p><div class="v2-section-tabs"><button class="selected">Активные</button><button data-view="Руны">Руны</button><button data-view="Последователи">Последователи</button></div>' + makeTiles([['Вихрь','🌪️'],['Ледяной удар','❄️'],['Щит','🛡️'],['Молния','⚡'],['Лечение','💚'],['Усиление','🔥']]) + '<div class="v2-featureline">Выбрано: 4/5 · Очки навыков: 12</div>',
    'Руны': () => '<p class="v2-screen-desc">Развитие рун: ячейки, уровни, сочетания и свойства. Только интерфейс, без расходования реальных материалов.</p><div class="v2-rune-grid"><span>ᚱ</span><span>ᛟ</span><span>ᚦ</span><span>ᛉ</span><span>ᛞ</span><span>ᛇ</span><span>ᛃ</span><span>ᛋ</span></div><div class="v2-featureline">Руническая сборка 1 · 0 изменений сохранено</div><button class="v2-sheet-button" data-view="Навыки">Навыки</button>',
    'Последователи': () => '<p class="v2-screen-desc">Один активный спутник + будущая поддержка. Все старые уровни и ID должны сохраниться.</p><img class="v2-follower-fig" src="' + images.companion + '" alt="Текущий спутник"/><div class="v2-featureline">Верный щит · Защитник · Ур. 12</div><div class="v2-demo-cow" role="img" aria-label="Место для любимой боевой коровы">🐂</div><p class="v2-cow-note">Любимая боевая корова запланирована в мультяшном взрослом стиле. Пока это указатель места, а не окончательная иллюстрация.</p><button class="v2-sheet-button" data-view="Склад">Открыть склад</button>',
    'Приключение': () => '<p class="v2-screen-desc">Главы, испытания, боссы, шахты и экспедиции. Сюжетный автобой не расходует камень за каждого врага.</p>' + makeTiles([['Бой','⚔️'],['Испытания','🐲'],['Карта','🗺️'],['Награды','🎁'],['Склад','🎒'],['Арена','🛡️']]),
    'Магазин': () => '<p class="v2-screen-desc">Витрина будет переделана под новую экономику. Реальные покупки в демонстрации недоступны.</p>' + makeTiles([['Рынок','🏪'],['Награды','🎁'],['Склад','🎒']]),
    'Арена': () => '<p class="v2-screen-desc">Арена остаётся особым режимом TERRITORY: PvP, живой чат во время боя, эликсиры, сезоны и 30 минут общения после боя.</p><div class="v2-featureline">⚔️ Бой с другим игроком</div><div class="v2-featureline">💬 Чат доступен во время и после боя</div>',
    'Характеристики': () => '<div class="v2-featureline">❤️ Здоровье: 8 500</div><div class="v2-featureline">⚔️ Атака: 1 180</div><div class="v2-featureline">🛡️ Защита: 420</div><div class="v2-featureline">✨ Критический шанс: 25%</div><p class="v2-screen-desc">Показатели демонстрационные и не относятся к конкретному игроку.</p>',
    'Испытания': () => '<p class="v2-screen-desc">Особые бои и боссы. Цена каждого режима будет взята из утверждённых серверных правил, а не из расходов обычного похода.</p>' + makeTiles([['Приключение','🗺️'],['Арена','⚔️'],['Награды','🎁']]),
    'Карта': () => '<p class="v2-screen-desc">Карта приключений со сменяемыми мирами, биомами и боссами.</p>' + makeTiles([['Приключение','🗺️'],['Испытания','🐲'],['Порт','⚓']]),
    'Настройки': () => '<p class="v2-screen-desc">Графика, эффекты, фон города и боя, качество анимаций, языки. Параметры пока локальные для макета.</p>' + makeTiles([['Бой','⚔️'],['Герой','🛡️'],['Приключение','🗺️']]),
    'Задания': () => '<div class="v2-featureline">🎯 Победи каменного великана · 0/1</div><div class="v2-featureline">🎁 Награды будут начисляться только сервером</div>',
    'Награды': () => '<div class="v2-featureline">🎁 Ежедневные подарки · недоступно в макете</div><div class="v2-featureline">⚔️ Камни за особые задания и приключения</div>',
  };
  function render(name) {
    if (name === 'Бой') { close(); return; }
    title.textContent = name;
    body.innerHTML = (screens[name] ?? (() =>
      '<p class="v2-screen-desc">' + name + ' — раздел TERRITORY 2.0. В демонстрационной версии действующие покупки и награды не подключены.</p>' +
      makeTiles([['Бой','⚔️'],['Герой','🛡️'],['Приключение','🗺️'],['Меню','▦']])))();
    overlay.classList.remove('hidden');
    body.scrollTop = 0;
  }
  function close() { overlay.classList.add('hidden'); }
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-view]');
    if (target) { render(target.getAttribute('data-view')); return; }
    if (event.target === overlay) close();
  });
  document.getElementById('close').addEventListener('click', close);
  document.getElementById('back').addEventListener('click', () => render('Меню'));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  let fast = false;
  speed.addEventListener('click', () => {
    fast = !fast;
    speed.setAttribute('aria-pressed', String(fast));
    speed.textContent = fast ? '×1' : '×2';
    battle.classList.toggle('fast', fast);
  });
  // Local visual combat simulation. IMPORTANT: this never awards XP/items/currency,
  // never spends Battle Stones and never represents real player progression.
  const stageText = document.querySelector('.v2-stage-bar strong');
  const mission = document.querySelector('.v2-task b');
  const enemyHit = document.querySelector('.v2-hit');
  const stageIcons = Array.from(document.querySelectorAll('.v2-progress i')).slice(0, 4);
  let visualStage = 12;
  let visualWave = 2;
  let visualTicks = 0;
  let lastPanel = null;
  window.setInterval(() => {
    if (!playing || document.hidden) return;
    visualTicks += fast ? 2 : 1;
    if (visualTicks % 3 === 0) {
      // Deterministic preview number; real damage comes from the future combat engine.
      enemyHit.textContent = '−' + (1140 + (visualTicks % 6) * 105).toLocaleString('ru-RU');
    }
    if (visualTicks < 8) return;
    visualTicks = 0;
    visualWave += 1;
    if (visualWave > 4) {
      visualWave = 1;
      visualStage += 1;
    }
    stageText.textContent = '6-' + visualStage + ' · ' +
      (visualWave === 4 ? 'Встреча с боссом' : 'Новая волна врагов');
    mission.textContent = visualWave === 4
      ? 'Победи главного босса' : 'Победи врагов на пути';
    stageIcons.forEach((icon, index) => {
      icon.classList.toggle('passed', index + 1 < visualWave);
      icon.classList.toggle('current', index + 1 === visualWave);
    });
  }, 950);

  let playing = true;
  auto.addEventListener('click', () => {
    playing = !playing;
    auto.setAttribute('aria-pressed', String(playing));
    auto.classList.toggle('off', !playing);
    battle.classList.toggle('paused', !playing);
  });
})();