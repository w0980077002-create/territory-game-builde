import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
];
for (const [name, filename] of uniqueGear) {
  assert.ok(art.includes(`'${name.toLocaleLowerCase()}': '${filename}'`), `${name} must use its unique artwork`);
  const file = statSync(`${gallery}${filename}.webp`);
  assert.ok(file.size > 2_000 && file.size < 100_000, `Badly-sized game art: ${filename}`);
}
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
console.log('Profession artwork PASS: 15 unique-gear assets, 5 distinct WebP master portraits, stable item mapping, both profession screens and current shop license details.');
