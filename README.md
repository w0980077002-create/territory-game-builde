TERRITORY — BACK BUTTON HOTFIX 64

Based on HOME INPUT HOTFIX 63.

Fixes the back button inside PvE bot battle:
- visible button changed to ←
- pointer/touch/click all call the same safe close handler
- stops duplicate/competing handlers
- clears battle/result state
- hides PvE flow overlay and returns to HOME

Overlay these 3 files over the current project:
- home-router.js
- pve-battle.js
- pve-flow.js
