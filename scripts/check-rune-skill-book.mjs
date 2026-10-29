import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const catalog = JSON.parse(read('src/game/config/territory-rune-skill-book-v1.json'));
const ui = read('src/components/builds/RuneSkillBook.tsx');
const profile = read('src/components/ProfileScreen.tsx');

assert.equal(catalog.schema, 'territory-rune-skill-book/1');
assert.equal(catalog.mode, 'visual_preview_only');
assert.deepEqual(catalog.groups.map(g => g.id), ['base', 'core', 'control', 'awakening', 'final']);
assert.equal(catalog.groups.length, 5);
const ids = new Set();
const runeIds = new Set();
for (const group of catalog.groups) {
  assert.equal(group.skills.length, 3, `${group.id} must expose exactly three skills`);
  for (const skill of group.skills) {
    assert(!ids.has(skill.id), `duplicate skill: ${skill.id}`);
    ids.add(skill.id);
    assert(skill.nameRu && skill.nameEn && skill.descriptionRu && skill.descriptionEn);
    assert(skill.runes.length >= 2 && skill.runes.length <= 3);
    for (const rune of skill.runes) {
      assert(!runeIds.has(rune.id), `duplicate rune: ${rune.id}`);
      runeIds.add(rune.id);
      assert(rune.nameRu && rune.nameEn && rune.effectRu && rune.effectEn);
    }
  }
}
assert.equal(ids.size, 15);
assert.equal(runeIds.size, 45);
assert(catalog.passives.length >= 3);
assert(new Set(catalog.passives.map(p => p.id)).size === catalog.passives.length);
assert(ui.includes('aria-modal="true"'));
assert(ui.includes('aria-pressed'));
assert(ui.includes('onSelectionChange'));
assert(ui.includes('do not yet affect live battles'));
assert(!ui.includes('useGame.set('), 'visual book must not mutate saved state');
assert(profile.includes('profile-rune-skill-book'));
assert(profile.includes('setRuneBookOpen] = useState(VERIFIED_RUNE_BOOK && initialTrainingOpen)'), 'map Runes open verified rune book only');
assert(profile.includes('VERIFIED_RUNE_BOOK && <details'), 'Do not expose preview while production combat is disabled');
console.log('Rune skill book OK: 5 groups, 15 skills, 45 rune variants, 3 passive slots; visual-only.');
