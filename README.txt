TERRITORY HOME FINAL PATCH — 2026-10-04

Replace these files in the ROOT of territory-game-builde:
- territory-home-modular.js
- territory-home-modular.css
- pve-core.js
- pve-core.css
- local-runtime.js
- territory-profile-public-fix.js

What this patch fixes:
- Home is the main live PvE battle screen.
- Battle starts and continues on Home; it no longer redirects the fight to the Map screen.
- Bot -> bot -> bot -> bot -> boss flow stays on Home.
- Map is a separate permanent button and opens chapter/location selection.
- Left/right Home buttons remain fixed.
- Bottom navigation is fixed and aligned; the Battle button starts PvE on Home.
- x2 / Auto / Battle Stones work with the active PvE battle.
- Home background uses cover instead of stretching.
- Profile/privacy fix keeps Battle Stones hidden from public player profiles.

Do NOT delete Arena or Salon files.
Do not replace the existing assets folder; keep the current repo assets.
