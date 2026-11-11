import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const warehouse = readFileSync('src/components/CompactWarehouse.tsx','utf8');
const css = readFileSync('src/components/compactWarehouse.css','utf8');
const inventory = readFileSync('src/components/InventoryScreen.tsx','utf8');
const belt = readFileSync('src/game/belt.ts','utf8');

assert.match(inventory, /<CompactWarehouse/, 'Items must render the compact warehouse');
assert.match(inventory, /onItemSelect=\{setSelected\}/, 'Tap must open the real existing item details');
assert.match(inventory, /data-testid="inventory-pinned-belt"/, 'Pinned belt must not disappear');
assert.equal((inventory.match(/<BeltCells/g) || []).length, 1, 'Exactly one belt');
assert.match(inventory, /<GearShowcase userId=\{userId\} onForge=\{onForge\}\/>/, 'Do not replace equipment showcase');
assert.match(inventory, /<FollowersPanel \/>/, 'Keep companions tab');
assert.match(inventory, /putInBelt\(latest, item\.id/, 'Keep real belt insertion');
assert.match(inventory, /takeFromBelt\(current, i\)/, 'Keep real belt removal');
assert.match(inventory, /groupConsumablesForDisplay\(state\.inventory\)/, 'Aggregate identical consumables into one warehouse tile');
assert.doesNotMatch(inventory, /elixirExpiryTime|elixirTimeLeftLabel/, 'No legacy expiry sorting');
assert.match(inventory, /role="tablist"/, 'Keep bottom tabs in position');
assert.match(warehouse, /onClick=\{\(\) => onSelect\(item\)\}/, 'Item taps must select the precise item');
assert.match(warehouse, /item\.id/, 'Display selection retains original batch ID');
assert.doesNotMatch(warehouse, /elixirTimeLeftLabel|warehouse-tile__expiry/, 'Permanent consumables never display expiration');
assert.doesNotMatch(warehouse, /forgeMaterialTimeLeftLabel|forgeTimer|Shelf life.*forge/, 'Forge materials are permanent');
assert.match(warehouse, /forgeMaterials > 0/, 'Never create fake forge material items');
assert.match(warehouse, /value=\{search\}/, 'Search input should be controlled');
assert.match(warehouse, /setFilter\(id\)/, 'Filters should be interactive');
assert.match(warehouse, /<Modal title=\{en \? 'Forge materials'/, 'Forge material info must use the real Modal component');
const modal = readFileSync('src/components/ui/Modal.tsx','utf8');
assert.match(modal, /role="dialog" aria-modal="true"/, 'Shared Modal implements an accessible dialog');
assert.doesNotMatch(warehouse, /useGame\.set|saveCloudSave|supabase\.rpc/, 'Warehouse must never modify game state or call server');
assert.match(belt, /export const/, 'Existing belt engine remains separate');


assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'Approved compact three-column warehouse layout stays unchanged');
assert.match(css, /@media\(max-width:340px\)/, 'Small Android width');
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/, 'Reduced-motion accessibility');
console.log('Compact warehouse OK: search, filters, existing 3-col grid, grouped consumables, permanent consumables and forge materials, details, belt, equipment and companions preserved.');
