import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';import {createHash} from 'node:crypto';
const expected={ru:['573d66c8cd58c89d23a99fe80e075f6c23f07de0ad5be36b5ec06e7d0cc13557',142894],en:['d7e459d896caad6d64369592ef49a17ed1c3a53d4a8a79e91e8395035d91923e',136247]};
for(const [lang,[hash,length]] of Object.entries(expected)){
 const b=readFileSync('public/promo/og-'+lang+'-v3.jpg');
 assert.equal(b.length,length);assert.equal(createHash('sha256').update(b).digest('hex'),hash);
 assert.equal(b[0],255);assert.equal(b[1],216);
 const html=readFileSync('public/promo/'+lang+'/index.html','utf8');
 assert(html.includes('og-'+lang+'-v3.jpg'));assert(html.includes('startapp=ref_'));
}
const gameShare=readFileSync('src/game/dailyShare.ts','utf8');
assert(gameShare.includes('referralLink(bot,ref.code)'),'daily shares must open Telegram bot');
assert(!gameShare.includes("'promo/'+language"),'do not broadcast GitHub Pages links');
assert(!existsSync('.github/workflows/territory-pages-repair.yml'),
 'Secondary publishing workflow must not return');
for(const file of ['.github/workflows/pages.yml','.github/workflows/daily-share-ci.yml']){
 const s=readFileSync(file,'utf8');
 assert(!s.includes('python scripts/generate-promo-banners.py'));
 assert(s.includes('dist/promo/og-ru-v3.jpg')&&s.includes('dist/promo/og-en-v3.jpg'));
}
console.log('Approved Telegram promo assets verified');