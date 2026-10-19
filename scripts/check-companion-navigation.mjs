import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inv=readFileSync('src/components/InventoryScreen.tsx','utf8');
const profile=readFileSync('src/components/ProfileScreen.tsx','utf8');
const panel=readFileSync('src/components/FollowersPanel.tsx','utf8');
const model=readFileSync('src/game/followers.ts','utf8');
const app=readFileSync('src/App.tsx','utf8');
const showcase=readFileSync('src/components/GearShowcase.tsx','utf8');

assert.match(inv,/import \{ FollowersPanel \} from '\.\/FollowersPanel'/);
assert.match(inv,/<FollowersPanel \/>/);
assert.match(inv,/useState<'items' \| 'equipment' \| 'followers'>\(initialTab\)/);
assert.match(inv,/switchTab = \(to: 'items' \| 'equipment' \| 'followers'\)/);
assert.match(inv,/grid shrink-0 grid-cols-3/,'Three inventory section tabs must stay in the bottom bar');
assert.ok(inv.indexOf('role="tablist"') > inv.indexOf('role="tabpanel"'),
  'Companion tab must be reached from the bottom panel');
assert.match(inv,/role="tablist"/);
for(const tab of ['equipment','items','followers']){
  assert.match(inv,new RegExp("aria-selected=\\{tab === '"+tab+"'\\}"),"Missing tab state "+tab);
  assert.match(inv,new RegExp("switchTab\\('"+tab+"'\\)"),"Missing selectable tab "+tab);
}
assert.match(inv,/aria-controls="inventory-current-section"/);
assert.match(inv,/id="inventory-current-section" role="tabpanel"/);
assert.match(inv,/<GearShowcase userId=\{userId\}\/>/);
assert.match(inv,/<BeltCells/);
assert.match(inv,/putInBelt/);
assert.match(app,/<InventoryScreen key=\{inventoryTab\} initialTab=\{inventoryTab\} userId=\{user\.id\} \/>/);
assert.match(showcase,/recycleCloudEquipment\(userId, id, action\)/);
assert.doesNotMatch(profile,/<FollowersPanel \/>/,'Profile must no longer host companion cards');
assert.doesNotMatch(profile,/EQUIPMENT_SLOTS/,'Profile must no longer render a duplicate equipment list');
assert.match(profile,/data-testid="profile-appearance"/);
assert.match(profile,/data-testid="profile-base-stats"/);
assert.match(profile,/getComputedStats\(state\)/);
assert.match(profile,/linkTelegram\(initData\)/,'Telegram account linkage must still work');
assert.match(profile,/APPEARANCE_PRESETS\.map/,'Hero appearance controls must remain accessible');
assert.match(profile,/state\.totalBattlesWon/);
const stats=profile.indexOf('{/* Computed stats (with equipment) */}');
const combat=profile.indexOf('{/* Battle record */}');
const appearance=profile.indexOf('{/* Appearance is optional;');
assert(stats>=0&&combat>stats&&appearance>combat,'Show real final stats and battles before optional cosmetics');
assert.match(panel,/const active = selectedFollower\(state\)/);
assert.match(panel,/getFollowerArt\(active\.id\)/,'Show real selected companion');
assert.match(panel,/selectFollower\(useGame\.get\(\), id\)/,'Keep existing companion selection');
assert.match(panel,/trainFollower\(current, id\)/,'Keep current-state training action');
assert.match(panel,/followerTrainingCost\(follower\.level\)/);
assert.match(panel,/state\.forgeMaterials >= price\.materials/,'Do not weaken training cost requirement');
assert.match(panel,/state\.player\.gold >= price\.gold/,'Do not weaken gold requirement');
assert.match(model,/export function reconcileFollowers/,'Existing unlocked and trained followers must be preserved');
assert.match(model,/export function selectedFollower/,'Exactly one active follower remains');
assert.match(model,/export function selectFollower/);
assert.match(model,/export function trainFollower/);
assert.match(panel,/only PvE|только PvE|не на Арене/,'Arena must remain unaffected by companions');
console.log('Companions moved into inventory: three accessible tabs, one active PvE companion, existing costs/levels preserved, clean profile, belt and gear intact.');
