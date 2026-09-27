# TERRITORY — TOP BUTTONS HOTFIX 61

This overlay fixes the HOME artwork input path for Android/mobile use.

## What changed
- HOME touch routing is bootstrapped from `app.js`, so it no longer depends on the HTML listing `home-router.js`.
- Added `touchend` / `pointerup` / `click` capture handling.
- HOME detection accepts both `#home.screen.active` and `body[data-screen="home"]`.
- Added the missing `gear6` hit zone.
- Arena and PvE dependencies are loaded dynamically.
- `pve-flow.js` and `pve-flow.css` are included because the router references them.
- A singleton guard prevents duplicate HOME input routers when `home-router.js` is also loaded.

## Install from phone
1. Unzip this archive.
2. Copy the files into the root of the current GitHub project.
3. Choose **replace/overwrite** when asked.
4. Do not delete other project files.
5. Refresh the game with cache cleared if the old JavaScript is still visible.

Files in this overlay are intended to be placed at repository root.
