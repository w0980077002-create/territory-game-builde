# TERRITORY: one-time live inventory cleanup — October 17, 2026

Confirmed by the game owner. This is a one-time cleanup, not a permanent inventory limit.

### Retention
- All equipped items remain unchanged.
- Non-equipment items, belt items, currency, progress and forge materials remain unchanged.
- Forged equipment (`upgradeCount>0` or level above `baseLevel`) remains in inventory.
- Unknown/custom/unique gear is retained rather than guessed to be disposable.
- All ordinary boss-loot duplicates and catalog-shop equipment compete for one best spare per equipment slot **only when its weighted stats exceed the equipped item** or the slot is empty.
- Score = attack*4 + defense*3 + hp*0.10 + critChance*12. Consistent for equipped vs spare; no inferred level inflation.

### Live roll-out and rollback
1. Apply `20261017_inventory_cleanup_prepare.sql` to the existing production Supabase instance (private helpers + replay guard, no deletion).
2. Preview `territory_private.trim_inventory_v1(game_state)` over production data and record the before/after totals.
3. Apply `20261017_inventory_cleanup_once.sql` ONLY after reviewing the preview. It atomically archives the COMPLETE original `public.players` rows for all existing players into `territory_private.inventory_before_cleanup_20261017`, locks rows, updates the single nested inventory JSON array, sets `inventoryCleanupVersion=1`, and verifies every non-inventory field and progress value is unchanged. Any failure rolls back automatically.
4. Prior loaded clients must reload after cleanup; the monotonic server cleanup version and the existing `updated_at` compare-and-swap reject replay from stale sessions.
5. For restoration, **do not blindly restore complete old player rows**: players will continue progressing. Recover a specific discarded item from the private original inventory, merging it into the player's CURRENT state only after verifying it is not already present; preserve all wallet/progress data and compute the current stat summaries with the existing server guard.

Migration does not automatically execute when GitHub Pages publishes. Do not re-apply the one-time migration or create a second backup with the same name.

This is not a server-side anti-cheat implementation; full browser game-state snapshots remain a broader economy risk.
