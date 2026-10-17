# TERRITORY equipment management — 2026-10-17

## User experience (RU / EN)
- Equipped gear displays actual attack/defense/HP/crit stats.
- Tap any spare gear to compare equipped vs bag with color-coded per-stat deltas.
- Confirm before permanently discarding or salvaging spare gear. Equipped gear is never shown as a discard target.
- Unforged ordinary boss loot can be salvaged for **one forge material each, maximum three per UTC day**.
- Shop gear, unique/crafted/admin equipment and upgraded gear **cannot mint forge materials**. They can be deleted from the bag only after a separate confirmation.
- Per-stat changes are authoritative data from the current GameState, not additive recalculations of player base stats. Weighted hint is advisory; critical chance, survivability and build matter.

## Economy risk controls
- Backend is required; if RPC or cloud sync fails, the client displays an error and prompts reload. **No local award fallback.**
- Only server-side current inventory item, exact matching ID, uniquely occurring in bag, type equipment, qty=1 can be consumed.
- `auth.uid()` scoping, `FOR UPDATE` player lock, exact `updated_at` revision, per-day private counter, atomic consume+grant.
- Grant 1 material per unmodified boss drop only; owner already confirms by a second click.
- Repeat requests cannot grant again because item is already gone. Forged or other items never grant materials.
- Existing client saves still allow forging material changes outside this API. This feature is **not** a certification of full economy anti-cheat.
- A complete archive of all player rows from the previous one-time cleanup is still kept. This feature does not perform mass deletes.

## Deploy
1. Run `npm run test:gear-recycle` and full release/CI tests in GitHub.
2. Apply `supabase/migrations/20261017_gear_compare_recycle_v1.sql` to live Supabase. Query the `pg_proc` and private cap table, verify anonymous privilege revoked.
3. Merge PR to main only after the backend is ready; GitHub Pages deploys frontend.
4. Ask tester to fully relaunch Telegram miniapp.

Never expose or mutate the private daily counter directly from browser. Postgres function is responsible for UTC dates and grant count.
