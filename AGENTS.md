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

## Beta delivery priority — owner decision 2026-10-26

- The primary goal is finishing playable TERRITORY 1.0, including incomplete features and approved visuals. Do not start optional security redesigns, broad audits or infrastructure refactors unrelated to the requested feature; postpone those until the feature-complete milestone. Existing server-side protections and player data remain intact.
- Ship coherent batches of related UI/gameplay improvements, not one micro-commit or one approval request per button. Avoid repeated progress reports and ask the owner only for genuinely necessary decisions.
- **Low-risk UI/text/assets changes:** work directly on `main` when ready, run TypeScript and relevant focused tests, then verify the automatic Pages release. A separate PR and the complete regression suite are optional for these beta-only changes.
- **Economy, rewards, authentication, database, game saves and admin actions:** retain server authorization and anti-loss guards, test the changed contract and use a reviewed staged rollout. Never trade real testers' saved progress for publication speed.
- The Pages workflow intentionally uses a focused beta smoke gate; its comprehensive regression suite remains available in pull-request review CI. Re-enable the broader Pages release checks once the owner declares the game feature-complete.
- TERRITORY 2.0 remains an independent project; do not intermingle its changes or deployment with the 1.0 fast lane.
