# TERRITORY

Работающая фэнтезийная игра в Telegram. React, TypeScript, Vite; состояние игроков — в Supabase.

**Играть:** https://w0980077002-create.github.io/territory-game-builde/

## Разработка

```sh
npm ci
npm run dev
```

Настройка тестового окружения и путь запуска: [docs/DEVELOPMENT_RU.md](docs/DEVELOPMENT_RU.md). Локальный запуск с production-настройкой обращается к настоящему серверу. Изолированный DEMO Пещеры без аккаунта и базы: `npm run build:cave-preview`.

Инструкция исполнителю — [AGENTS.md](AGENTS.md). Игровые требования — [docs/GAME_REQUIREMENTS_RU.md](docs/GAME_REQUIREMENTS_RU.md). Начинать с текущей задачи, а не с исторических очередей.

Проверки: `npm run typecheck`, `npm run lint`, `npm run build` и адресные `test:*` из `package.json`. Публикация `main` — только через [GitHub Pages workflow](.github/workflows/pages.yml); после выпуска автоматически проверяется опубликованный SHA. Экспериментальные агенты и периодические отчёты удалены; проверки PR и игровые регрессии сохранены.
