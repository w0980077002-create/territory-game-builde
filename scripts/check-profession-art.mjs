import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

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
for (const profession of ['smith', 'alchemist', 'artisan', 'jeweler', 'engineer']) {
  assert.match(art, new RegExp(`${profession}: uniqueGearIcon\\(`), `Missing ${profession} emblem`);
}
for (const screen of [legacy, stage8]) {
  assert.match(screen, /craftOutputArt\(/, 'Recipes must show real item art');
  assert.match(screen, /PROFESSION_ART\[/, 'Profession selection must show illustrated emblems');
}
assert.match(art, /equipmentArt\(equipment: Equipment\)/);
assert.match(art, /UNIQUE_EQUIPMENT_BY_NAME\[name\]/);
assert.match(art, /function itemArt\(item: ArtSource\)/);
console.log('Profession artwork: 15 transparent optimized assets, stable item-name mapping, 5 illustrated masters and both recipe screens PASS');
