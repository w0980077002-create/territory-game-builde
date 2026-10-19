import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const rendered=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {LanguageProvider} from './src/game/i18n';import {MonopolyAdventure} from './src/components/monopoly/MonopolyAdventure';module.exports=renderToStaticMarkup(<LanguageProvider><MonopolyAdventure onBack={()=>{}}/></LanguageProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',outdir:'/tmp/monopoly-ssr',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':'"/territory-game-builde/"','import.meta.env.VITE_SUPABASE_URL':'"https://offline-visual.invalid"','import.meta.env.VITE_SUPABASE_ANON_KEY':'"offline-visual-only"','import.meta.env.DEV':'false'}});
const js=rendered.outputFiles.find(f=>f.path.endsWith('.js')).text;
const mod={exports:{}};new Function('require','module','exports',js)(require,mod,mod.exports);const html=mod.exports;
const indices=[...html.matchAll(/data-cell-index="(\d+)"/g)].map(m=>+m[1]);
assert.deepEqual(indices,Array.from({length:28},(_,i)=>i),'exactly 28 rendered cells use real indices');
assert.ok(!html.includes('mono-cell-number'),'no duplicate numbered overlay');
for(const label of ['Подарки','Задания','Награды за круги','Спецпредложения','Джекпот','Правила'])assert.ok(html.includes(label),'missing menu '+label);
assert.ok(html.includes('mono-scene-shortcuts'),'quick actions on board');
for(const panel of ['gifts','quests','offers'])assert.ok(html.includes('data-shortcut="'+panel+'"'),'missing shortcut '+panel);
assert.ok(html.includes('mono-dice-cta'),'roll from dice');
assert.ok(!html.includes('mono-actions'),'no big cards below');
assert.ok(!html.includes('mono-roll-caption'),'no duplicate roll button');
assert.ok(!/lucide|🎟|💎|🪨|⚒|🧪|💪|🎒|🏰|👑|⚀|⚁|⚂/.test(html),'no emoji or stock game icons in rendered screen');
for(const path of ['art-atlas.png','hero-frames.png']){const b=readFileSync('public/monopoly/'+path);assert.equal(b[25],6,'generated atlas must have RGBA alpha');}
const component=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');assert.match(component,/Серверной механики джекпота нет/);
const css=readFileSync('src/components/monopoly/monopoly.css','utf8');assert.match(css,/prefers-reduced-motion/);assert.match(css,/100dvh/);
console.log('Monopoly visual structure PASS: actual component SSR, 28 unnumbered cells, compact quick actions, illustrated assets, transparent atlases, honest jackpot, safe-area/reduced-motion rules. NOT a browser screenshot or device validation.');

const redeemApi=readFileSync('src/components/monopoly/api.ts','utf8');
assert.ok(!redeemApi.includes('window.location.reload('),'Monopoly rewards must not restart Telegram');
assert.match(redeemApi,/acceptMonopolyClaimReceipt/,'redeem must adopt verified server revision');
const giftUi=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');
assert.match(giftUi,/setData\(current=>current\?/,'Monopoly gifts should update in place');

const panelsCss=readFileSync('src/components/monopoly/monopoly.css','utf8');
assert.match(panelsCss,/scale\(\.333333\)/,'main die should be 1/3 visual size');
assert.match(panelsCss,/max-height:min\(61dvh,470px\)/,'panels stay compact on phones');
assert.match(component,/mono-panel-tabs/,'gift, quest and offer tabs must be available');
assert.match(component,/mono-panel-status/,'panels must show current state and refresh');
assert.match(component,/goToDice/,'incomplete quests must navigate back to the playable board');
assert.match(component,/claimAllReady/,'multiple ready rewards must be claimable with server checks');
assert.ok(!component.includes('window.location.reload('),'panels must not reload the Mini App');

const shareUI=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');
const shareClient=readFileSync('src/game/dailyShare.ts','utf8');
assert.match(shareUI,/DailyShareCard task="monopoly"/,'Monopoly shares are daily');
assert.ok(!shareUI.includes('monopoly-referral-task'),'no referral qualification needed');
assert.match(shareClient,/language==='ru'/,'language switching is explicit');
assert.match(shareClient,/shareDailyPromo/,'Telegram picker is used');
assert.ok(shareClient.includes('referralLink(bot,ref.code)'),'share must link directly to Telegram bot, not GitHub Pages');


const monopolyCss=readFileSync('src/components/monopoly/monopoly.css','utf8');
const monopolyUi=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');
assert.match(monopolyCss,/\.mono-panel\.panel-rewards/,'lap rewards must have compact sizing');
assert.match(monopolyCss,/max-height:min\(59dvh,430px\)/,'lap rewards cannot cover the full phone');
assert.match(monopolyCss,/\.mono-panel-return/,'return action is fixed outside scrolling rewards');
assert.match(monopolyUi,/← В Монополию/,'always-visible return to Monopoly is required');
