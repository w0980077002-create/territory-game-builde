## Owner rule: new game content must be manageable in Admin — 2026-10-31

**Standing owner requirement for TERRITORY 1.0:** When adding any new resource, currency, collectible, consumable, equipment type, reward or game system, include the relevant owner-facing administration in the *same feature change*, without asking the owner to remember it. For grantable resources this means the existing admin player page must show the actual balance/quantity and let the owner issue or deduct an exact quantity for an individual player, with authorization, audit, server-confirmed results, and idempotent retry behavior. For non-grantable features, show suitable admin status/controls instead of pretending they are grantable.

This is an **acceptance/release gate**, not an optional follow-up ticket. Update the actual backend and admin UI together; test grants, deductions, duplicate requests, permissions and balance boundaries. Adding a UI item to `RESOURCES` alone is insufficient. Resources in separate server-owned wallets (e.g. `territory_private.dark_stones_v1`) need their own atomic admin flow, not a fake entry in the legacy `admin_grants` payload or the normal `battleStones` wallet. If the server part isn't deployed, label the feature staged and don't claim it works.

Preserve the existing 5-tap admin entry, owner credentials, live player data, and all economy safeguards. Any production database/Edge deployment remains subject to the existing reviewed release rules. Never expose generic unrestricted SQL or client-side currency minting.

## 🔒 OWNER-APPROVED LIVING RPG GAME-DESIGN LOCK — 2026-10-30

**READ BEFORE ANY NEW VISUAL/UI TASK IN TERRITORY V1:** [`docs/TERRITORY_V1_LIVING_RPG_UX_LOCKED_20261030_RU.md`](docs/TERRITORY_V1_LIVING_RPG_UX_LOCKED_20261030_RU.md). This is a **mandatory product/UX acceptance standard**, not an optional mood-board or merely a CSS theme. The owner confirmed that the post-#146 mobile Hero screen looked like a beautifully decorated *spreadsheet*, not a compelling RPG. Future work must prioritize **full-size living hero and scene > real visible equipment and upgrade actions > verified progression and next goal > compact readable stats > textured wood/gold chrome > unambiguous active navigation**.

**Owner-assigned non-overlapping execution tasks (2026-10-30):**
- **ChatGPT/UI:** [`docs/territory-v1-release/CHATGPT_LIVING_HERO_UI_TZ_20261030_RU.md`](docs/territory-v1-release/CHATGPT_LIVING_HERO_UI_TZ_20261030_RU.md). Owns `src/components/ProfileScreen.tsx`, `profileHero.css` and narrowly-scoped `src/App.tsx` navigation changes; implements full-size hero, 7 real equipped slots, genuine XP, next goal and one active navigation item.
- **Codex/Gameplay:** [`docs/territory-v1-release/CODEX_LIVING_RPG_GAMEPLAY_TZ_20261030_RU.md`](docs/territory-v1-release/CODEX_LIVING_RPG_GAMEPLAY_TZ_20261030_RU.md). First C1/#125/PR #128, then C3/#136 real server-confirmed loot/XP/equipment/save loop. **DO NOT edit ChatGPT's hero layout/nav files in parallel.** Read the two contracts before coding; no fake progress, client-authoritative grants or unapproved production DB changes.

A large empty brown panel with a tiny circular hero portrait, decorative fake item slots, invented XP percentages, two concurrently highlighted active navigation tabs, or a flat stack of stat cards **fails this design lock** even if it uses the approved wood texture. Use only existing canonical character art and real game state; keep server authority, game balance, saved players, and approved scenes intact. Apply the same player-first composition principles to city, inventory, Arena, adventure, runes, followers, professions, shop, map, and all popups. Validate in the actual Telegram WebView when feasible; browser fixtures alone do not prove user-facing quality.

- **Visual lock update (owner 2026-10-30):** The approved «Боевая корова» full composition is now an additional primary visual model for all *new* Territory V1 panels: warm carved textured wood, dimensional gold borders and buttons, richly colored magic and portrait illustrations, framed stats/skills/evolution panels, and **bold, chunky, dark-outlined readable fantasy typography** (titles ~800–900 weight; use real translatable HTML text, strong contrast and mobile accessibility). Read the 30.10 addition to `docs/ART_STYLE_LOCKED_TERRITORY_V1_20261027_RU.md` and preserve previous approved artwork. Treat the concept's +210%/Lv.100 as illustrative, not gameplay balance. The design reference image must be retained in GitHub when binary file transfer is available; do not claim the file has been uploaded until confirmed.

## TERRITORY 1.0 release command center — owner decision 2026-10-30

- **Owner operating agreement and roles:** [`docs/territory-v1-release/WORKING_AGREEMENT_RU.md`](docs/territory-v1-release/WORKING_AGREEMENT_RU.md). Review before delegating; owners do not need to test every change. Do not misrepresent scheduled checks as a continuously running Codex agent.
- **Owner permission preference (2026-10-30):** Already-connected GitHub and Gmail have app-specific `full_access` permission. Do not repeatedly ask for ordinary approved reads, code changes, tests, documentation edits, or scoped PR work; act within the approved TERRITORY 1.0 plan. This is NOT a bypass of mandatory Codex/platform approval dialogs and NOT authorization for charges, production Supabase/Edge changes, destructive actions, secrets, account/security changes or wiping players. Refer to [`WORKING_AGREEMENT_RU.md`](docs/territory-v1-release/WORKING_AGREEMENT_RU.md) for full scope.
- **Creative product mandate (owner 2026-10-30):** In addition to completing tickets, proactively audit the real first-time/short/long player journey for fun and missing content. Read `docs/CALL_OF_ODINS_VIDEO_REFERENCE_TERRITORY_V1_20261028_RU.md`, `docs/LOOTBORN_FULL_GAME_AUDIT_TERRITORY_V1_20261027_RU.md`, the new `Самостоятельный геймдизайн` section in `PLAN_RU.md`, and issue #136. Keep TERRITORY's distinct manual Arena attack/block direction selection, professions and auction; adapt PvE depth to separate Adventure/Trials/Dark Cave. Propose coherent original quests/boss phases/earned rewards, with reliable server checks; do not copy protected art/UI/copy. **C1/P0 remains first.** No speculative reward grants, duplicate systems or unsupported claims of implementation.
- **Owner rule: complete feature with original art, automatically (2026-10-30):** When a gameplay system, collectible, currency, enemy, follower, rune, skill, location, quest or other visible content is missing, independently research approved references and implement an **original TERRITORY 1.0 analogue with its visual asset in the same feature slice**. Do not wait for the owner to remember mechanics or supply a separate art brief. In the same PR/change: create/choose a distinct approved-style asset, include it in `public/assets/territory/` (or established asset directory), link it to the actual reachable UI, implement the real interaction and persistence/server authority when relevant, and test on mobile. An unconnected image, placeholder card, generic icon, issue, mock screen or unshipped code is **not a completed feature**. Preserve approved visuals, accessibility/performance, existing rewards, saves and balance; don't copy other games' graphics. If backend cannot yet safely operate, keep the feature gated; don't imply it is available. A new feature can be called live only after Pages publication is verified; owner approval requests are reserved for genuine high-impact decisions.
- **Canonical prioritized plan:** [`docs/territory-v1-release/PLAN_RU.md`](docs/territory-v1-release/PLAN_RU.md).
- **Next actionable Codex task:** [`docs/territory-v1-release/CODEX_QUEUE_RU.md`](docs/territory-v1-release/CODEX_QUEUE_RU.md). Read the queue **before** starting any new work; begin with its highest-priority unfinished, unblocked task and reuse existing issue/PR rather than making duplicates.
- **Release target is GitHub Pages from `main` only.** Vercel is explicitly out of scope for this beta: no new Vercel deploys, verification workflows, project changes or service integrations unless the owner later requests them. Do not delete existing Vercel assets. GitHub Pages CI and published revision are required before calling a game feature released.
- **Do not self-assume automation:** these Markdown instructions are a handoff for agents that are already running or explicitly invoked, not a mechanism that launches Codex by themselves.
- Keep player saves, legacy equipped gear, currencies, VIP, admin access and server-authoritative rewards intact. If a risky backend change is blocked, preserve the feature gate and work on the next safe, independent item instead of silently bypassing it.

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
- Canonical active hero art lives in `public/assets/territory/characters/heroes/` and is selected by `src/game/appearance.ts`. Do not restore deleted root-level `appearance-*`, `male2-*`, `enemy-*` or numbered generated images; they were rejected or superseded. Enemy fallback art must also use approved cartoon assets.
- Four currently available hero appearances, more planned. Equipment is **universal** across appearances; it must not be tied to a single character skin.
- In combat, heroes face right, opponents face left, with heroes about 20–30% larger. Bodies, limbs, weapons and clothing must move coherently; no detached hands, floating equipment, inert opponents or fake attacks without contact.
- Preserve mobile-first Telegram/iPhone/Samsung layouts and avoid slow section loading.
- Economy integrity, seven-day consumable/material lifetimes and oldest-expiring-first usage must remain intact.

## Locked visual standard — owner approved 2026-10-27

- **Mandatory reference for all new TERRITORY 1.0 art:** [`docs/ART_STYLE_LOCKED_TERRITORY_V1_20261027_RU.md`](docs/ART_STYLE_LOCKED_TERRITORY_V1_20261027_RU.md). Read it before creating or replacing any visual assets.
- The two fixed pillars are **warm carved wood with visible natural grain** (the existing `WoodenPlaque` asset/component) and **vivid glossy cartoon-Viking potions/items** matching the saved owner screenshot in `docs/art-reference/shop-potions-approved-20261027.jpg`.
- Preserve the seven approved `public/*-viking.webp` consumables and expand missing illustrations in this exact style. **No large circular runic-medallion backgrounds, black boxes, unrelated photorealistic bottle styles or duplicate art for different effects.** Do not replace approved art without the owner's explicit instruction.

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
