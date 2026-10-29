import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menu = readFileSync('src/components/runes/RuneSkillsMenu.tsx', 'utf8');
const css = readFileSync('src/components/runes/runeSkillsMenu.css', 'utf8');
const map = readFileSync('src/components/MapScreen.tsx', 'utf8');

const skills = [...menu.matchAll(/id: '[a-z_]+', nameRu: '[^']+', nameEn: '[^']+', detailRu:/g)];
assert.equal(skills.length, 15, 'Five branches must contain three independent skills each');
for (const branch of ['База', 'Ядро', 'Контроль', 'Пробуждение', 'Финал']) {
  assert.ok(menu.includes(`titleRu: '${branch}'`), `Missing ${branch} branch`);
}
for (const passive of ['northern_blood', 'rune_guard', 'keen_eye']) {
  assert.ok(menu.includes(`id: '${passive}'`), `Missing passive skill ${passive}`);
}
assert.match(menu, /const DEFAULT_CHOICES = \[[^\]]{9,}\]/, 'One skill must be equipped in every branch');
assert.match(menu, /const \[passives, setPassives\]/, 'Passive skills must be selectable');
assert.match(menu, /const \[runesBySkill, setRunesBySkill\]/, 'Rune slots should be specific to each skill');
assert.match(menu, /selected\.length < 2/, 'No more than two rune modifiers per skill');
assert.match(menu, /focused\.compatibleRunes\.includes\(rune\.id\)/, 'Only compatible runes should be offered');
assert.match(menu, /TRAINING_RUNES/, 'Existing six original Territory runes should be reused');
assert.match(menu, /onOpenTraining/, 'Existing safe training remains reachable');
assert.match(menu, /Предпросмотр/, 'The screen must disclose that it is not a live combat feature');
assert.doesNotMatch(menu, /useGame\.set|supabase\.|localStorage\.setItem|territory_gather_|wallet|claimReward/, 'Visual selection must not modify player rewards or progress');
assert.match(map, /case 'runes': setRuneMenuOpen\(true\)/, 'The location opens the new menu');
assert.match(css, /max-width: 350px/, 'Skill grid must adapt to narrow Telegram screens');
assert.match(css, /prefers-reduced-motion/, 'Respect reduced motion on mobile');

console.log('TERRITORY 1.0 rune skill menu: 15 active + 3 passive, 2 runes/skill, safe map deep link PASS');
