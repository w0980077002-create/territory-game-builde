import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const files=[
  ...Array.from({length:10},(_,i)=>`public/assets/territory/vip/badges/vip-${String(i+1).padStart(2,'0')}.svg`),
  ...['daily','weekly'].flatMap(kind=>Array.from({length:5},(_,i)=>
    `public/assets/territory/vip/chests/${kind}-${i+1}.svg`)),
];
const digest=new Set();
for(const file of files){
  const raw=readFileSync(file,'utf8');
  assert.match(raw, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(raw,/viewBox="0 0 (512|[0-9]+) [0-9]+"/);
  assert.match(raw,/<\/svg>$/);
  assert.doesNotMatch(raw,/<(?:script|foreignObject|image|text|use|a)(?:\s|>)/i,
    'No script, foreign asset or baked-in localized text: '+file);
  assert(!digest.has(createHash('sha256').update(raw).digest('hex')),
    'Two VIP pictures must not be identical: '+file);
  digest.add(createHash('sha256').update(raw).digest('hex'));
  assert(raw.length < 13_000,'VIP art must stay light for Telegram WebView: '+file);
}
const ui=readFileSync('src/components/VipStatusPanel.tsx','utf8');
assert.match(ui,/vipBadgeSrc\(tier\.level\)/);
assert.match(ui,/vipDailyChestSrc\(daily\.vip\)/);
assert.match(ui,/vipWeeklyChestSrc\(weekly\.vip\)/);
assert.match(ui,/import\.meta\.env\.BASE_URL/,'Art must honor GitHub Pages base path');
console.log('VIP original art PASS: 10 badges, 5 daily chests, 5 weekly chests; all unique, self-contained and linked to the real UI.');
