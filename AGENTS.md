# TERRITORY 1.0 — rules for coding agents

This repository contains the live Telegram game **TERRITORY 1.0**. Treat its main branch, GitHub Pages site and connected Supabase project as production. **TERRITORY 2.0 is an independent project; never mix the two.**

## Non-negotiable safety boundaries

- Never reset, confiscate, migrate or silently alter player progress, currencies, VIP, equipped items or inventories.
- Do not modify the production Supabase database, authentication policies, secrets, migrations or Edge Functions without a separately assigned, reviewed infrastructure task.
- Preserve the administrator login and its existing hidden entrance: **five taps on «прогресс сохранён»**. Never change admin passwords or automatic ban rules.
- Never introduce client-authoritative rewards, currency grants, inventory mutations or timers. Security-sensitive flows require server-side validation and tests.
- The live game is automatically published from `main` through `.github/workflows/pages.yml`. Prefer a focused `copilot/` feature branch and pull request for agent-generated code. Do not push unfinished prototypes directly into live screens.
- Changes to unrelated systems require a new explicit task; do not mix V1 and V2 work.

## Product direction

- Visuals: vivid, saturated, high-quality **cartoon Viking** style; never drab, realistic, childish, or generic placeholders.
- Four currently available hero appearances, more planned. Equipment is **universal** across appearances; it must not be tied to a single character skin.
- In combat, heroes face right, opponents face left, with heroes about 20–30% larger. Bodies, limbs, weapons and clothing must move coherently; no detached hands, floating equipment, inert opponents or fake attacks without contact.
- Preserve mobile-first Telegram/iPhone/Samsung layouts and avoid slow section loading.
- Economy integrity, seven-day consumable/material lifetimes and oldest-expiring-first usage must remain intact.

## Working agreement

1. Assign non-overlapping files/tasks to specialist agents; work on independent branches or PRs.
2. Inspect the surrounding code and existing tests before editing; never invent a backend or duplicate game logic.
3. Verify relevant tests (`npm run typecheck`, focused `npm run test:*`, plus visual tests where applicable). The Pages workflow contains additional release gates.
4. Explain user-facing changes and risks **in Russian**, briefly and honestly. Never call a still-image swap or an unverified puppet rig a finished natural combat animation.
5. Keep production state untouched and hand work back for final integration/approval of high-impact changes.

Specialized GitHub Copilot profiles are in `.github/agents/`. These files configure agent behavior but do not grant extra authority or automatically launch jobs.
