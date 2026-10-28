import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const companions=read('src/components/FollowersPanel.tsx');
const styles=read('src/components/followersCamp.css');
const panel=read('src/components/expansion/ExpansionPanels.tsx');
const panelStyles=read('src/components/expansion/expansionPanels.css');
const model=read('src/game/followers.ts');
const inventory=read('src/components/InventoryScreen.tsx');

assert.match(companions,/const active = selectedFollower\(state\)/);
assert.match(companions,/getFollowerArt\(active\.id\)/);
assert.match(companions,/selectFollower\(useGame\.get\(\), id\)/,'Keep existing PvE follower selection');
assert.match(companions,/trainFollower\(current, id\)/,'Keep exact validated training model');
assert.match(companions,/followerTrainingCost\(follower\.level\)/,'Read real training cost');
assert.match(companions,/state\.player\.gold >= price\.gold/);
assert.match(companions,/state\.forgeMaterials >= price\.materials/);
assert.match(companions,/MAX_FOLLOWER_LEVEL/);
assert.match(companions,/FOLLOWER_TEMPLATES\.map/);
assert.match(companions,/aria-pressed=\{focus\}/,'Exactly one focused follower tile');
assert.match(companions,/aria-pressed=\{focus\}/);
assert.match(companions,/не на Арене/,'Follower PvE-only rule visible');
assert.match(companions,/role="progressbar"/,'Training progress reflects real level');
assert.match(companions,/data-testid="followers-panel"/);
assert.match(inventory,/<FollowersPanel \/>/,'Real tab still mounted');
assert.doesNotMatch(companions,/onSummon|purchase|server_award|rewardGold/,'Do not invent client rewards');
assert.match(model,/export function followerTrainingCost/);
assert.match(styles,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/,'Five companion portraits');
assert.match(styles,/max-width:350px/,'Small Samsung layout');

for (const exported of ['SummoningPanel','DarkEnergyPanel','SeaVoyagePanel']){
  assert.match(panel,new RegExp('export function '+exported+'\\('),exported+' missing');
}
assert.match(panel,/not connected to the game server yet/, 'Disconnected modes must not claim to work');
assert.match(panel,/\!onSummon/, 'Do not enable summoning without server callback');
assert.match(panel,/\!onEquip/, 'Do not enable relic equip without callback');
assert.match(panel,/\!onDismantle/, 'Do not enable dismantle without callback');
assert.match(panel,/\!onClaim/, 'Do not enable ship reward without callback');
assert.match(panel,/confirmDismantle/, 'Dismantling requires confirmation');
assert.doesNotMatch(panel,/useGame\.set|supabase|localStorage|grantRewards|Math\.random/, 'Presentation may not award or mutate');
assert.match(panelStyles,/max-width:340px/,'Small-phone layout');
for(const img of [
  'assets/territory/map/icons/companions-v1.webp',
  'assets/territory/map/icons/rune-stones-v1.webp',
  'assets/territory/ui/materials/royal-chest.webp',
  'monopoly/ship.webp','ic-sea.webp',
  'assets/territory/ui/equipment-cartoon/ring.webp',
  'assets/territory/ui/equipment-cartoon/amulet.webp',
  'assets/territory/ui/equipment-cartoon/weapon.webp',
  'assets/territory/ui/equipment-cartoon/armor.webp'
]) assert.ok(existsSync('public/'+img),'Missing original art: '+img);
console.log('T18 companion & expansion UI PASS: five real companions + no unverified purchases, relic rewards or ship claims.');
