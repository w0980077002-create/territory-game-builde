import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {transform} from 'esbuild';
const source=readFileSync('src/game/vipChestPreview.ts','utf8');
const js=await transform(source,{loader:'ts',format:'esm'});
const {VIP_CHEST_ART,previewVipChest}=await import('data:text/javascript;base64,'+Buffer.from(js.code).toString('base64'));
assert.equal(Object.keys(VIP_CHEST_ART).length,2,'Exactly two chest appearances');
assert.notEqual(VIP_CHEST_ART.daily,VIP_CHEST_ART.weekly);
for (const path of Object.values(VIP_CHEST_ART)) {
  assert.match(path,/\\.webp$/);
  assert(existsSync('public/'+path),'Missing playable VIP chest art: '+path);
}
for (const kind of ['daily','weekly']) {
  let previous={gold:0,materials:0,potions:0};
  for(let tier=1;tier<=10;tier++){
    const reward=previewVipChest(kind,tier);
    for(const key of ['gold','materials','potions']){
      assert(Number.isSafeInteger(reward[key])&&reward[key]>0);
      assert(reward[key]>=previous[key],'Non-monotonic '+key+' on '+kind+' tier '+tier);
    }
    assert(reward.gold>previous.gold);
    previous=reward;
  }
}
assert.deepEqual(previewVipChest('daily',10),previewVipChest('daily',999),'Tier must be clamped');
const screen=readFileSync('src/components/VipMobileShowcase.tsx','utf8');
const css=readFileSync('src/components/vipTerritory.css','utf8');
assert.match(screen,/previewVipChest\\(chest,tier\\)/);
assert.match(screen,/VIP_CHEST_ART\\[kind\\]/);
assert.match(screen,/setChestPhase\\('opening'\\)/);
assert.match(screen,/chestPhase==='open'/);
assert.match(screen,/Только пример\\. Награды не начисляются и не сохраняются/);
assert.doesNotMatch(screen,/chests\\/.*\\.svg/,'Old ten-image chest selector must be unused');
assert.match(css,/vip-chest-stage--open \\.vip-chest-stage-lid/);
assert.match(css,/prefers-reduced-motion:reduce/);
console.log('VIP two chest types PASS: two real WebP assets, 10-tier monotonic examples, no reward writes, animated preview');
