import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import './build-mortarion-approved-frame.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hero=read('src/components/HeroShowcase.tsx');
const css=read('src/components/profileHero.css');
const crown=read('src/components/MortarionLordFrame.tsx');
const tiers={lord:'mortarion_lord',conqueror:'mortarion_conqueror',hunter:'mortarion_hunter'};
assert.match(hero,/state\.mortarionOwnerTestChest\?\.testOnly === true/,'owner-only visual test, official rank unchanged');
assert.match(hero,/const displayedHonor = previewHonor \?\? state\.mortarionHonor/,'real server honor remains canonical');
assert.match(hero,/getAppearanceIcon\(state\.appearance\)/,'saved hero appearance preserved');
assert.match(hero,/player\.equipped\[slot\.id\]/,'saved equipment preserved');
assert.match(hero,/MORTARION_FRAME_ART\[displayedHonor\.frame\]/,'server-saved tier selects asset');
assert.match(hero,/hero-showcase__stage--' \+ displayedHonor\?\.frame/,'ornaments belong to the full stage');
assert.match(hero,/<div className="hero-showcase__gear-column">\{slots\.slice\(3\)\.map\(renderSlot\)\}<\/div>[\s\S]*?\{displayedHonor\?\.frame === 'mortarion_lord' \? <MortarionLordFrame \/> : frameArt && <img key=\{frameArt\} className=\"hero-showcase__mortarion-frame\"/,'art behind gear buttons');
assert.match(css,/hero-showcase__mortarion-frame/);
assert.match(css,/position:absolute;\s*inset:0;\s*width:100%;\s*height:100%/,'no center portrait cage');
assert.match(css,/pointer-events:none/,'gear remains clickable');
assert.match(css,/\.hero-showcase__gear-column\s*\{\s*z-index:3/,'gear above decoration');
assert.doesNotMatch(css,/border-radius:44% 44% 24% 24%/,'no oval');
assert.doesNotMatch(css,/hero-showcase__character--mortarion_lord::after/,'no CSS cage');
assert.match(css,/hero-showcase__stage--mortarion_lord[\s\S]*?object-fit:contain/,'approved square art cannot be stretched');
assert.match(css,/width:116%;[\s\S]*?animation:territoryHeroMobileBreathe/,'mobile hero size untouched');
assert.match(css,/@keyframes territoryHeroMobileBreathe \{[\s\S]*?scale\(1\.04\)/,'hero breathing remains subtle');
assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*?animation:none/);

const approved='public/assets/territory/ui/honors/mortarion-lord-approved.avif';
assert(hero.includes("mortarion_lord: 'assets/territory/ui/honors/mortarion-lord-approved.avif'"),
  'TOP-1 must display owner-approved art, never a hand-approximated SVG');
const bytes=readFileSync(approved);
assert.equal(bytes.length,10787);
assert.equal(bytes.toString('ascii',4,8),'ftyp');
assert.equal(bytes.toString('ascii',8,12),'avif');
assert.equal(createHash('sha256').update(bytes).digest('hex'),'7830e264d961ba609d62f87fbee9b80258e34600f52ca1a15955a38f1b936624');
assert.match(crown,/onError=\{\(\) =>/,'unsupported AVIF needs a local fallback');
assert.match(crown,/setFormat\('webp'\)/,'fallback preserves exact approved art');
assert.match(crown,/preserveAspectRatio=\{rail \? 'none' : 'xMidYMid meet'\}/,'gems retain proportions');
assert.match(crown,/aria-hidden="true"/,'decorative only');

for (const tier of ['conqueror','hunter']) {
  const key=tiers[tier];
  const path='public/assets/territory/ui/honors/mortarion-'+tier+'-stage.svg';
  const svg=read(path);
  assert(hero.includes(key+": 'assets/territory/ui/honors/mortarion-"+tier+"-stage.svg'"),'other tiers preserved');
  assert(svg.startsWith('<?xml version="1.0"'));
  assert(svg.includes('viewBox="0 0 680 660"'));
  assert.match(svg,/<\/svg>\s*$/);
  assert.match(svg,/Transparent center/,'other ranks still keep the character visible');
  assert(!/<rect\b[^>]*width="680"[^>]*height="660"/i.test(svg));
}
assert.match(read('src/game/mortarionRewards.ts'),/territory_mortarion_reward_claim_v1/,'live rewards remain server-owned');
console.log('MORTARION APPROVED ART PASS: exact owner reference file SHA256, transparent AVIF with same-art WebP fallback, no gameplay changes');
