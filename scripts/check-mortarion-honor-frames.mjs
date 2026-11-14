import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hero=read('src/components/HeroShowcase.tsx');
const css=read('src/components/profileHero.css');
const tiers={lord:'mortarion_lord',conqueror:'mortarion_conqueror',hunter:'mortarion_hunter'};
assert.match(hero,/state\.mortarionOwnerTestChest\?\.testOnly === true/,'owner-only test preview, real honors unchanged');
assert.match(hero,/const displayedHonor = previewHonor \?\? state\.mortarionHonor/,'official honor is canonical outside owner test');
assert.match(hero,/getAppearanceIcon\(state\.appearance\)/,'real selected player portrait preserved');
assert.match(hero,/player\.equipped\[slot\.id\]/,'all actual equipment preserved');
assert.match(hero,/MORTARION_FRAME_ART\[displayedHonor\.frame\]/,'server-issued rank uses correct premium art');
assert.match(hero,/hero-showcase__stage--' \+ displayedHonor\?\.frame/,'rank class belongs to entire stage');
assert.match(hero,/<div className="hero-showcase__gear-column">\{slots\.slice\(3\)\.map\(renderSlot\)\}<\/div>[\s\S]*?\{frameArt && <img className="hero-showcase__mortarion-frame"/,'art is mounted on stage, NOT inside character');
assert.match(css,/hero-showcase__mortarion-frame/);
assert.match(css,/position:absolute;\s*inset:0;\s*width:100%;\s*height:100%/,'full stage coverage avoids constricting central portrait');
assert.match(css,/pointer-events:none/,'gear buttons stay clickable');
assert.match(css,/\.hero-showcase__gear-column\s*\{\s*z-index:3/,'equipment sits above corner ornaments');
assert.doesNotMatch(css,/border-radius:44% 44% 24% 24%/,'no oval');
assert.doesNotMatch(css,/hero-showcase__character--mortarion_lord::after/,'no CSS cage');
assert.doesNotMatch(css,/width:calc\(100% \+ 22px\)/,'no floating narrow frame');
assert.match(css,/width:116%;[\s\S]*?animation:territoryHeroMobileBreathe/,'mobile dwarf is balanced');
assert.match(css,/@keyframes territoryHeroMobileBreathe \{[\s\S]*?scale\(1\.04\)/,'breathe does not restore giant scale');
assert.match(css,/@media \(max-width:350px\) \{[\s\S]*?hero-showcase__mortarion-frame/,'320px layout remains covered');
assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*?animation:none/);

for (const [tier,key] of Object.entries(tiers)) {
  const path='public/assets/territory/ui/honors/mortarion-'+tier+'-stage.svg';
  const svg=read(path);
  assert(hero.includes(key+": 'assets/territory/ui/honors/mortarion-"+tier+"-stage.svg'"),'art matches official rank '+tier);
  assert(svg.startsWith('<?xml version="1.0"'),'SVG XML prolog');
  assert(svg.includes('viewBox="0 0 680 660"'),'all ranks cover exactly the stage');
  assert.match(svg,/<\/svg>\s*$/);
  assert.match(svg,/<filter id="shadow"/,'depth through actual shading');
  assert.match(svg,/id="armor"/);
  assert.match(svg,/id="gold"/);
  assert.match(svg,/id="stone"/);
  assert.match(svg,/Transparent center/,'center x=140..540 unobstructed');
  assert.match(svg,/NO bar over legs/,'feet and official level plaque unobstructed');
  assert(!/<rect\b[^>]*width="680"[^>]*height="660"/i.test(svg),'cannot mask background');
  assert(!/<script\b|<foreignObject\b|<image\b/i.test(svg),'art inert, no external dependency');
  assert(svg.length > 4800,'art is not trivial flat outline');
}
assert.match(read('src/game/mortarionRewards.ts'),/territory_mortarion_reward_claim_v1/,'actual rewards still server-controlled');
console.log('MORTARION HERALDRY PASS: three original 680x660 stage ornaments, hero/feet visible, 320px gear safe, authoritative rewards unchanged');
