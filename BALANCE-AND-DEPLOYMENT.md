# Territory — equipment balance foundation (v3)

This archive is a **development build**, not a direct deployment. It keeps the existing screens, PvE/PvP mechanics, Supabase integration, admin panel, and migration files. It does not add real payments, Stars, wallets, professions UI, or player trading.

## What changed

- Added `src/game/equipmentCatalog.ts` as the shared source for current shop equipment and the existing boss-drop formula. Shop prices/availability are separate from base combat stats.
- Added `src/game/equipmentBalance.ts` for a single deterministic equipment-upgrade formula.
- New shop and boss-drop items keep their original base stats, base level, and upgrade count.
- Successful forge upgrades now use a **fixed gain per upgrade based on item slot and rarity** rather than compounding 15% of the current stat. Weapons gain attack; accessories grow more slowly; defensive slots use separate defense/HP budgets. Critical chance remains unchanged by the forge, as it was previously.
- Administrative item-level changes use the same deterministic stat formula; they cannot lower an item below its original template level.
- Chapter and trial base enemy HP were increased by 25%; enemy attack, defense, combat turns, and PvE/PvP mechanics were left unchanged. This offsets the removal of runaway player attack and makes one-shotting standard mid/late-game mobs less likely.
- Save migration version is `3` (including migration from the earlier v2 development formula). It normalizes recognised shop items and generated `loot_` boss drops, including both the old forge-upgrade path and the old admin level-grant path.
- Unknown/custom equipment is preserved rather than guessed or destructively rewritten. It receives a stable baseline for future upgrades.
- The existing admin API and admin login flow were not changed in this build. Admin work is intentionally out of scope for this balance pass.
- Added `npm run test:balance` to check catalogue coverage, old-save normalization, repeatability, admin-level changes, and safe handling of unknown equipment.

## The new balance rule

Forge gains are chosen from a single slot-and-rarity table in `src/game/equipmentBalance.ts`. Weapons gain the most attack; rings and amulets contribute less attack per level; armor, helmets, shields, and boots use smaller defense/HP growth values so upgrading all defensive slots does not overwhelm enemy damage.

`current stat = original base stat + round(slot-and-rarity gain × successful upgrades)`

The stat is calculated from the saved base value and total successful upgrade count, never from the already-rounded current value. This removes compound growth, makes item levels predictable, and preserves a clearer distinction between rarity and equipment slot. Critical chance does not grow through forge upgrades.

Example: the known epic shop sword with 35 base attack and 53 old upgrades normalizes to 141 attack instead of 64,767. The known epic boss-drop sword with 82 base attack and 34 upgrades normalizes to 150 attack instead of the old compound value. Their stats remain different because their original items were different, but the 6.5× runaway gap is removed.

## Before publishing

1. Keep a backup of this ZIP and the current live build.
2. Test the build in a separate branch or staging site, not over the live game.
3. Use a test account with shop equipment, boss-drop equipment, and an old save containing heavily upgraded items.
4. Confirm the migrated save is written successfully and still retains the player's level, gold, gems, chapters, quests, inventory, and equipped items.
5. Test the forge, a normal PvE fight, a boss fight, the arena, and save/reload.
6. Only promote the build after the project build and these gameplay checks pass.

The migration recalculates items that already carry balance metadata too, so saves created with the earlier development formula are moved onto the current curve. The balance migration is performed when a save is loaded and its new state is saved. Back up the live database before deploying it. Unknown/custom items are deliberately not guessed; if a custom item exists, keep its stats and review it separately rather than applying a potentially incorrect conversion.

## Profession and crafting roadmap

The current changes prepare the item data model for later recipes and crafted gear, but do not yet implement professions or mastery 300. Those should be added after the current balance baseline is verified, using the same catalogue and stat formula rather than introducing a second equipment system.

## Verification status for this archive

- Equipment balance regression checks pass, including migration of the two historical growth paths, idempotency, preservation of unknown/custom items, and a chapter-58 one-shot guard.
- Focused balance regression checks pass (`npm run test:balance`).
- A standalone TypeScript transpilation pass should be run as part of final CI validation.
- A complete Vite production build was **not confirmed**: dependency installation timed out in the working environment. Treat this as a development archive, not a verified production release. The local environment has incomplete dependencies; validate type-checking and the full build in CI or a staging environment before replacing the live game.
