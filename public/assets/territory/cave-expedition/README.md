# Original TERRITORY cave DEMO art — 2026-11-11

Generated with OpenAI image generation for this isolated prototype. No reference-game images were used. Exported WebP atlases retain alpha; light alpha noise from generation was removed during export. Existing approved art files were not overwritten.

- `creatures.webp`: 1536×1024, 6 columns × 4 rows. Columns: idle / run A / run B / attack / hit / death. Rows: original obsidian six-legged Shardling; emerald fungal Spore Sail; amber armored Deep Eel; original cathedral-shell abyss crab boss.
- `biomes.webp`: 1774×887, 2 columns × 2 rows. Crystal cavern / fungal garden / amber mine / astral crypt. Historical panorama atlas retained unchanged; portrait combat uses the new chamber paintings; low-height landscape orientation retains these wide paintings without stretching.
- `party-run.webp`: 1448×1086, 4 columns × 3 rows. Four running keyframes. Rows: approved blue/blond Viking / red-bearded northern warrior / forest healer. Generated using the three approved idle sprites as references to preserve identity. Existing attack/block/hit/death poses are reused from their unchanged original folders.

Frame grounding: every actor is independently projected from world coordinates. Cell baseline and transparent padding are part of the atlas; no CSS bounce animation is used.

## Portrait chamber scenes — owner screenshot feedback, 2026-11-11

- `crystal-chamber.webp`: original 1024×1536 crystal mine room, broad walkable stone floor, enclosing arch and distant doorway.
- `chambers.webp`: original 1024×1536 atlas, four 512×768 portrait rooms: top-left fungal garden, top-right amber mine, bottom-left astral crypt, bottom-right ember forge.
- Generated for this task with OpenAI image generation; no third-party game art copied. Exported to WebP; established character art is unchanged. Paintings contain no UI or characters. The renderer crops each panel independently with preserved aspect ratio.
- The hero uses existing `combat2d/male_viking/` joint cutouts and shared choreography. Companion sprites use alpha bounds, event-driven pose changes and contact-synced melee/projectiles. They are not newly generated full skeletal rigs.
