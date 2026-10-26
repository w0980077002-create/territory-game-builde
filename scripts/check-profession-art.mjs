import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const art = readFileSync('src/game/art.ts', 'utf8');
const legacy = readFileSync('src/components/ProfessionsScreen.tsx', 'utf8');
const stage8 = readFileSync('src/components/ProfessionsStage8Screen.tsx', 'utf8');
const gallery = 'public/assets/territory/ui/unique-gear/';

const uniqueGear = [
  ['Клинок древних', 'ancient-blade'],
  ['Секира бури', 'storm-axe'],
  ['Клинок первого ярла', 'jarl-blade'],
  ['Печать ярла', 'jarl-ring'],
  ['Доспех мастера механизмов', 'jarl-armor'],
  ['Сапоги великого мастера', 'jarl-boots'],
  ['Амулет ворона мастера', 'master-raven-amulet'],
  ['Клинок дозорного', 'watch-blade'],
  ['Сапфировое кольцо', 'sapphire-ring'],
  ['Щит северной стражи', 'north-shield'],
  ['Латы северянина', 'north-armor'],
  ['Шлем старейшины', 'master-helm'],
  ['Кольцо древних', 'ancient-ring'],
  ['Кольцо силы мастера', 'master-power-ring'],
  ['Кольцо искры', 'spark-ring'],
  ['Оберег северных врат', 'north-gate-amulet'],
  ['Шлем дозорного', 'watch-helmet'],
  ['Сапоги следопыта', 'ranger-boots'],
  ['Сапоги гонца', 'messenger-boots'],
  ['Броня караванщика', 'caravan-armor'],
];
const distinctItemHashes = new Set();
for (const [name, filename] of uniqueGear) {
  assert.ok(art.includes(`'${name.toLocaleLowerCase()}': '${filename}'`), `${name} must use its unique artwork`);
  const file = statSync(`${gallery}${filename}.webp`);
  assert.ok(file.size > 2_000 && file.size < 100_000, `Badly-sized game art: ${filename}`);
  const data = readFileSync(`${gallery}${filename}.webp`);
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WEBP');
  distinctItemHashes.add(createHash('sha256').update(data).digest('hex'));
}
assert.equal(distinctItemHashes.size, uniqueGear.length, 'Every named crafted item must have its own art');
for (const [name, filename] of [
  ['Травяной настой', 'herbal-infusion'],
  ['Эликсир точности', 'focus-elixir'],
  ['Зелье северного здоровья', 'north-health-potion'],
]) {
  assert.ok(art.includes(`'${name.toLocaleLowerCase()}': '${filename}'`), `Craft potion ${name} must have unique art`);
  const data = readFileSync(`${gallery}${filename}.webp`);
  assert.ok(data.length > 2_000 && data.length < 100_000, `Badly-sized craft potion: ${filename}`);
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WEBP');
  distinctItemHashes.add(createHash('sha256').update(data).digest('hex'));
}
assert.equal(distinctItemHashes.size, uniqueGear.length + 3, 'All new potion artworks must be distinct');
// Test the actual rendering helper against the authoritative Stage 8 recipe
// catalog: all twenty craftable products must resolve to distinct artwork.
const stage8Catalog = JSON.parse(readFileSync('supabase/staged/territory_profession_stage8_catalog.json', 'utf8'));
const artModule = await build({
  entryPoints: ['src/game/art.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': JSON.stringify('/territory-game-builde/') },
});
const { craftOutputArt } = await import(`data:text/javascript;base64,${Buffer.from(artModule.outputFiles[0].contents).toString('base64')}`);
const craftArtPaths = new Set();
for (const recipe of stage8Catalog.recipes.filter((entry) => entry.kind === 'item' && entry.id.startsWith('s8_'))) {
  const artPath = craftOutputArt(recipe.output);
  assert.match(artPath, /\/unique-gear\/[^/]+\.webp$/, `Generic craft image for ${recipe.output.name}`);
  const filename = artPath.split('/').at(-1);
  assert.ok(statSync(`${gallery}${filename}`).size > 2_000, `Missing art file for ${recipe.output.name}`);
  assert.ok(!craftArtPaths.has(artPath), `Two crafted items share art: ${recipe.output.name}`);
  craftArtPaths.add(artPath);
}
assert.equal(craftArtPaths.size, 20, 'Every new Stage 8 crafted item should have its own picture');
assert.match(art, /эликсир стойкости ярла[\s\S]*uniqueGearIcon\('legendary-elixir'\)/);
assert.ok(statSync(`${gallery}legendary-elixir.webp`).size > 2_000);
const portraitHashes = new Set();
for (const profession of ['smith', 'alchemist', 'artisan', 'jeweler', 'engineer']) {
  assert.ok(art.includes(`${profession}: masterPortrait('${profession}')`), `Missing ${profession} master portrait`);
  const filename = `public/assets/territory/ui/profession-masters/${profession}.webp`;
  const bytes = readFileSync(filename);
  assert.ok(bytes.length > 12_000 && bytes.length < 250_000, `Master portrait too small/large: ${profession}`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `Bad WebP header: ${profession}`);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `Not a real WebP: ${profession}`);
  portraitHashes.add(createHash('sha256').update(bytes).digest('hex'));
}
assert.equal(portraitHashes.size, 5, 'Every profession must have its own distinct character portrait');
for (const screen of [legacy, stage8]) {
  assert.match(screen, /craftOutputArt\(/, 'Recipes must show real item art');
  assert.match(screen, /PROFESSION_ART\[/, 'Profession selection must show illustrated masters');
}
assert.match(legacy, /h-\[72px\] w-\[72px\]/, 'Master portraits must be recognizable in the legacy selection screen');
assert.match(stage8, /h-16 w-16 shrink-0/, 'Stage 8 must display full-size illustrated masters');
assert.doesNotMatch(legacy, /license will become available later|лицензия мастера.*появится позже|Лицензия мастера — скоро/i, 'Do not advertise the already-available Master license as coming soon');
assert.match(art, /equipmentArt\(equipment: Equipment\)/);
assert.match(art, /UNIQUE_EQUIPMENT_BY_NAME\[name\]/);
assert.match(art, /function itemArt\(item: ArtSource\)/);
console.log('Profession artwork PASS: 24 distinct craft/gear assets, 5 master portraits, stage8 output mapping, both profession screens and current shop license details.');
