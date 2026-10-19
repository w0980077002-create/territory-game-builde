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
assert.match(inventory, /data-testid="equipment-responsive-layout" className="flex min-h-full w-full min-w-0 flex-col"/,
  'The equipment section should occupy the available scroll height');
assert.match(inventory, /className="my-auto w-full min-w-0 pt-3 pb-4"/,
  'Short equipment lists are centered vertically, while long bags remain scrollable');
assert.match(inventory, /<BeltCells/, 'Existing consumable belt preserved');
assert.equal((inventory.match(/<BeltCells/g) || []).length, 1, 'Render exactly one consumable belt');
assert.match(inventory, /\{tab === 'items' && \(\s*<section\s+data-testid="inventory-pinned-belt"/,
  'Belt must be rendered only on the Items tab in its own fixed section');
assert.ok(inventory.indexOf('data-testid="inventory-pinned-belt"') > inventory.indexOf('role="tabpanel"') &&
  inventory.indexOf('data-testid="inventory-pinned-belt"') < inventory.indexOf('role="tablist"'),
  'Belt must sit between scrollable items and the bottom section navigation');
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
  'Compact hero must follow the selected playable appearance');
assert.match(component, /scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/,
  'Compare the tapped item without excessive scrolling');
assert.match(css, /\.gear-mini-bar \{/, 'Collapsed hero strip style must be present');
assert.match(css, /\.gear-compare-panel \{ scroll-margin-top: 72px; \}/,
  'Preserve context around comparison when scrolling');
// The inventory sections now live in a separate bottom bar above the main nav.
assert.match(inventory, /flex h-full min-h-0 flex-col gap-2 animate-fade-in/,
  'Inventory must keep scrollable content and pinned tabs in a full-height flex column');
assert.match(inventory, /ref=\{inventoryContentRef\} id="inventory-current-section"[^>]*overflow-y-auto/,
  'Inventory content must scroll independently of the bottom navigation');
assert.match(inventory, /grid shrink-0 grid-cols-3/,
  'All three inventory tabs must remain fixed below content');
assert.ok(inventory.indexOf('role="tablist"') > inventory.indexOf('role="tabpanel"'),
  'The inventory tab bar belongs below the scrollable content');
assert.match(app, /screen === 'inventory' \? 'overflow-hidden px-3 pt-3 pb-1'/,
  'App must reserve a separate non-scrolling space for the inventory bottom tabs');
