import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync('src/components/GearShowcase.tsx', 'utf8');
const css = readFileSync('src/components/GearShowcase.css', 'utf8');
const inventory = readFileSync('src/components/InventoryScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx','utf8');
const cloud = readFileSync('src/game/cloud.ts','utf8');

for (const slot of ['helmet','amulet','armor','weapon','shield','ring','boots']) {
  assert.match(component, new RegExp('gear-slot-' + slot), 'Missing interactive slot ' + slot);
  assert.match(css, new RegExp('\\.gear-slot-' + slot + '\\s*\\{'), 'Missing stage position for ' + slot);
}
assert.match(component, /getAppearanceIcon\(state\.appearance\)/, 'Hero art must reflect selected playable appearance');
assert.match(component, /state\.player\.equipped\[id\]/, 'Stage must display actual equipped gear');
assert.match(component, /chooseSlot\(id\)/, 'Equipped slots must open own stats');
assert.match(component, /chooseBag\(item\.id\)/, 'Bag item selection must compare');
assert.match(component, /<GearPortrait equipped=\{worn\}/, 'Current equipped gear must show on left');
assert.match(component, /<GearPortrait equipped=\{worn\} candidate=\{candidate\}/, 'Selected bag gear must show on right');
assert.match(component, /value - \(equipped\?\.\[s\.key\] \?\? 0\)/, 'Stat deltas must reflect real worn stats');
assert.match(component, /gear-card-delta/, 'Comparison deltas must be shown inside selected card');
assert.match(component, /GEAR_STATS\.map/, 'All four item stats must be present');
assert.match(component, /aria-pressed=\{filter === slot\}/, 'Inventory filter accessible state');
assert.match(component, /filters\.map/, 'All inventory filters');
assert.match(component, /sort === 'rarity'/, 'Support rarity sorting');
assert.match(component, /sort === 'recent'/, 'Support newest-first sorting');
assert.match(component, /setSelection\(\{ kind: 'worn', slot \}\)/, 'Worn item click must switch to own details');
assert.match(component, /setSelection\(\{ kind: 'bag', id \}\)/, 'Bag item click must select comparison');
assert.match(component, /saveCloudSave\(userId, snapshot\)/, 'Flush queued state first');
assert.match(component, /recycleCloudEquipment\(userId, id, action\)/, 'Server, not client, must recycle items');
assert.match(component, /canSalvageEquipment\(current\)/, 'Recycle limited to eligible gear');
assert.match(component, /const current = snapshot\.inventory\.find/, 'Reject stale item selection');
assert.match(component, /setConfirm\('discard'\)/, 'Discard must require confirmation');
assert.match(component, /setConfirm\('salvage'\)/, 'Salvage must require confirmation');
assert.match(component, /onClick=\{unequip\}/, 'Unequip actual worn slot');
assert.match(component, /setRemainingToday\(receipt\.remainingToday\)/, 'Server verified daily counter reflected');
assert.match(component, /window\.location\.reload\(\)/, 'Save conflicts must prompt reload');
assert.match(inventory, /<GearShowcase userId=\{userId\}\/>/, 'Equipment tab must use redesigned stage');
assert.match(inventory, /<BeltCells/, 'Existing consumable belt preserved');
assert.match(inventory, /putInBelt/, 'Existing consumable use preserved');
assert.doesNotMatch(inventory, /<GearComparison/, 'Remove legacy equipment modal');
assert.match(app, /useState<'items' \| 'equipment'>\('equipment'\)/, 'Equipment should open by default');
assert.match(cloud, /recycleCloudEquipment/, 'Use existing receipt-driven token synchronization');
assert.match(css, /grid-template-columns: repeat\(5/, 'Compact bag grid required');
assert.match(css, /@media \(max-width: 370px\)/, 'Small Android layout required');
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'Accessibility reduced motion required');
console.log('Hero gear showcase: 7 slots, selected hero, real compare, filter, sorting, mobile UI, belt and atomic recycle integration PASS');

assert.doesNotMatch(component, /gear-diff-block/, 'Do not duplicate the stat rows below comparison cards');
assert.match(css, /clamp\(208px, 55vw, 250px\)/, 'Mobile gear scene should leave room for the bag');

assert.match(component, /const selectedItem = chosenVisible \? chosen : undefined;/,
  'Opening equipment must not preselect the first item or hide the inventory behind comparison');
assert.doesNotMatch(component, /displayed\[0\]/,
  'Never silently compare the first item from the bag');
assert.match(component, /\{selection && <section ref=\{compareRef\}/,
  'Comparison pane should appear only when a player selects gear');
assert.match(component, /const miniHero = selection\?\.kind === 'bag' && !heroExpanded;/,
  'Selecting spare gear should compact the full hero stage');
assert.match(component, /setHeroExpanded\(true\)/, 'The player must be able to expand hero');
assert.match(component, /setHeroExpanded\(false\)/, 'The player must be able to minimize hero');
assert.match(component, /getAppearanceIcon\(state\.appearance\)/,
  'Compact hero must be the player's real selected appearance');
assert.match(component, /scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/,
  'Compare the tapped item without excessive scrolling');
assert.match(css, /\.gear-mini-bar \{/, 'Collapsed hero strip style must be present');
assert.match(css, /\.gear-compare-panel \{ scroll-margin-top: 72px; \}/,
  'Preserve context around comparison when scrolling');
assert.match(inventory, /space-y-2 animate-fade-in pb-2/, 'Shorten tabs-to-stage spacing');
