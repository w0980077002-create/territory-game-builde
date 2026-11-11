# TERRITORY

**TERRITORY** is a fantasy game played in Telegram. Its primary web delivery is **GitHub Pages**, from the `main` branch of this repository.

Разработчику: [единые инструкции](AGENTS.md), [запуск и карта проекта](docs/DEVELOPMENT_RU.md), [Пещера: реализованный DEMO](docs/CAVE_EXPEDITION_DEMO_RU.md).

- Game address: https://w0980077002-create.github.io/territory-game-builde/
- GitHub Pages workflow: [Build and deploy Territory](.github/workflows/pages.yml)
- Build command: `npm ci && npm run build`
- Asset base: `/territory-game-builde/`
- Player state: Supabase (never reset live accounts during testing).

Production builds must use GitHub Pages; the abandoned Vercel projects are not part of the deployment process. Code merged into `main` is not itself proof of a successful Pages publication—verify the published build revision before announcing the release.
