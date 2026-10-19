import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const expected={ru:['839cb3f89a8d89e6d9d586ae404cba14f3d36f12127ef659e5c644b2c1850e19',195564],en:['219f8f28c12c348cb4105b134aef45ff47635831ed58c37d0a121ea0d16f2afc',184604]};
for(const [lang,[hash,length]] of Object.entries(expected)){
 const b=readFileSync('public/promo/og-'+lang+'-v2.jpg');
 assert.equal(b.length,length);assert.equal(createHash('sha256').update(b).digest('hex'),hash);
 assert.equal(b[0],255);assert.equal(b[1],216);
 const html=readFileSync('public/promo/'+lang+'/index.html','utf8');
 assert(html.includes('og-'+lang+'-v2.jpg'));assert(html.includes('startapp=ref_'));
}
assert(readFileSync('src/game/dailyShare.ts','utf8').includes("v:'2'"));
for(const file of ['.github/workflows/pages.yml','.github/workflows/territory-pages-repair.yml','.github/workflows/daily-share-ci.yml']){
 const s=readFileSync(file,'utf8');
 assert(!s.includes('python scripts/generate-promo-banners.py'));
 assert(s.includes('dist/promo/og-ru-v2.jpg')&&s.includes('dist/promo/og-en-v2.jpg'));
}
console.log('Approved Telegram promo assets verified');