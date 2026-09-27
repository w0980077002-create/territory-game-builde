# TERRITORY HOME INPUT HOTFIX 10063

This overlay replaces `home-router.js`.

Fixes:
- one tap is routed once (touch/pointer/click duplication is suppressed);
- tap must stay within 14 px, so swipes/scrolls do not activate a neighboring button;
- HOME hit zones no longer overlap between header, energy, chapter and side rails;
- real DOM buttons/links are not stolen by the fallback router;
- missing sections no longer redirect to an unrelated section;
- keeps Arena/PvE/Forge/gear routing from the previous hotfix.

Overlay this `home-router.js` over the current project and replace the old file.
