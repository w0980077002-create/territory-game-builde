import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hero=read('src/components/HeroShowcase.tsx');
const css=read('src/components/profileHero.css');
const tiers={
  lord:'mortarion_lord',
  conqueror:'mortarion_conqueror',
  hunter:'mortarion_hunter',
};
assert.match(hero,/state\.mortarionOwnerTestChest\?\.testOnly === true/,'only owner can access test preview selectors');
assert.match(hero,/const displayedHonor = previewHonor \?\? state\.mortarionHonor/,'real honor is canonical when QA selection off');
assert.match(hero,/getAppearanceIcon\(state\.appearance\)/,'portrait comes from real saved appearance');
assert.match(hero,/player\.equipped\[slot\.id\]/,'all equipment comes from saved state');
assert.match(hero,/MORTARION_FRAME_ART\[displayedHonor\.frame\]/,'true server rank selects art, not mock value');
assert.match(hero,/data-testid="mortarion-forged-frame"/);
assert.match(hero,/pointerEvents|className="hero-showcase__mortarion-frame"/);
assert.match(hero,/getComputedStats/);
assert.match(css,/hero-showcase__mortarion-frame/);
assert.match(css,/pointer-events:none/,'decorative visual must not block gear taps');
assert.match(css,/\.hero-showcase__gear-column\s*\{\s*z-index:3/,'equipment remains higher than portal');
assert.doesNotMatch(css,/border-radius:44% 44% 24% 24%/,'the unpopular gold oval is removed');
assert.doesNotMatch(css,/hero-showcase__character--mortarion_lord::after/,'no pseudo-element oval remains');
assert.match(css,/width:116%;[\s\S]*?animation:territoryHeroMobileBreathe/,'mobile hero is smaller');
assert.match(css,/@keyframes territoryHeroMobileBreathe \{[\s\S]*?scale\(1\.04\)/,'animated pose does not restore giant 1.16 scale');
assert.match(css,/@media \(max-width:350px\) \{[\s\S]*?hero-showcase__mortarion-frame/,'narrow 320px stage has its own smaller portal');
assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*?animation:none/,'accessible reduced motion');

for (const [tier,key] of Object.entries(tiers)) {
  const path='public/assets/territory/ui/honors/mortarion-'+tier+'-forge.svg';
  const svg=read(path);
  assert(hero.includes(key+": 'assets/territory/ui/honors/mortarion-"+tier+"-forge.svg'"),'asset mapped to correct existing rank: '+tier);
  assert(svg.startsWith('<?xml version="1.0"'),'valid XML prolog: '+path);
  assert(svg.includes('viewBox="0 0 520 720"'),'consistent asset geometry across tiers');
  assert.match(svg,/<\/svg>\s*$/,'SVG must close');
  assert.match(svg,/filter id="shadow"/,'forged-metal sculptural depth is present');
  assert.match(svg,/id="metal"/);
  assert.match(svg,/id="jewel"/);
  assert.match(svg,/open metal portal/,'transparent central view, not painted backdrop');
  assert(!/<rect\b[^>]*width="520"[^>]*height="720"/i.test(svg),'frame cannot hide original hero or scenery');
  assert(!/<script\b|<foreignObject\b|<image\b/i.test(svg),'static decorative art only');
  assert(svg.length > 4800,'detailed rank art must not regress to flat simple outline');
}
const src=read('src/game/mortarionRewards.ts');
assert.match(src,/territory_mortarion_reward_claim_v1/,'genuine rank is still issued by existing RPC');
console.log('MORTARION FRAME PASS: 3 unique layered forged portals; smaller animated hero; mobile gear z-order and official rank logic preserved; no oval');
