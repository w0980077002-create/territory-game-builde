# TERRITORY — PvE balance revision (2026-10-17)

## Scope
Only newly generated campaign enemies, bosses, trial guardians and damage taken by them in PvE are changed.
Existing player levels, completed floors, inventory, reforged equipment, active follower, currency, stone purchase cap,
arena PvP, Supabase tables and saved player data are **not migrated or reset**.

## Difficulty
- Chapters 1-3 retain their previous enemy multipliers. Chapters 4-20 and 20-100 ramp up.
- Past chapter/floor 100, enemy HP, attack and defense keep scaling smoothly with a sub-linear power-law tail.
- Campaign bosses have stronger baseline HP/attack/defense, with extra resistance at chapters divisible by 5 and 10.
- Trial guardians remain above campaign enemies at the same floor.
- Starting chapter 15, ordinary enemies have a combined hero+follower per-round damage limit;
  boss and trial limits are 40% and 34% of max HP per round, respectively.
- This is a combat balance update, **not server-side validation of PvE rewards or progression**.

## Verification
Run `npm run test:pve` and `npm run test:progression`, plus normal build/type checks.
A pull request must pass review CI before merging to main. Main Pages CI reruns PvE checks before deployment.
No additional purchase stones, forge materials or rewards are granted by this update.

## Follow-up
Measure median chapter clears, trial success, consumed stones, and death rates on real player cohorts.
If content is too hard at levels 5-20, tune the early coefficients only; keep 100+ scaling and
one-round damage caps. For true anti-cheat protection, record PvE victories and rewards in a
trusted server function, not solely in browser state.
