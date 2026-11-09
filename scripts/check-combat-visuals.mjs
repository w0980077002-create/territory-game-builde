import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const read = (path) => readFileSync(path, 'utf8');

const poses = ['idle', 'attack', 'block', 'dodge', 'hit', 'death'];
const sets = {
  heroes: ['male_viking', 'male_rogue', 'female_warrior', 'female_archer'],
  followers: ['loyal_shield', 'northern_warrior', 'forest_healer', 'moon_hunter', 'rune_mage'],
  enemies: ['goblin', 'boar', 'bandit', 'wolf', 'troll'],
  bosses: ['bandit_chief', 'northern_jarl', 'dark_priest', 'undead_king', 'barrow_guardian', 'abyss_demon', 'giant_king', 'storm_lord', 'fire_lord', 'chaos_shadow'],
};
for (const [group, names] of Object.entries(sets)) {
  for (const name of names) for (const pose of poses) {
    const image = `public/assets/territory/characters/${group}/${name}/${pose}.webp`;
    assert(existsSync(image), `Missing combat pose: ${image}`);
  }
}
for (const image of ['sword', 'bow', 'staff']) {
  assert(existsSync(`public/assets/territory/ui/items/${image}.webp`), `Missing weapon art: ${image}`);
}

const arena = read('src/components/arena/BattleScene.tsx');
const pve = read('src/components/pve/PveFight.tsx');
const room = read('src/components/arena/ArenaRoom.tsx');
const art = read('src/game/art.ts');
const gear = read('src/components/arena/GearStrip.tsx');
const effects = read('src/index.css');

assert.match(arena, /combatFrames=\{getCombatAppearance\(enemy\.appearance\)\}/, 'PvP opponent animations disconnected');
assert.match(arena, /portraitFollower &&/, 'Companion must not appear before unlocking');
assert.match(arena, /getFollowerCombatFrames\(portraitFollower\.id\)/, 'Companion animation frames missing');
const followerLane = arena.match(/data-testid="arena-visible-follower"[\s\S]*?className="([^"]*)"/)?.[1] ?? '';
assert(followerLane.includes('z-30'), 'Companion needs foreground layer above the hero to remain visible on Android');
assert(followerLane.includes('h-[68%]') && followerLane.includes('w-[66%]'), 'Companion must not shrink behind the hero');
assert(arena.includes("portraitFollower ? '-right-[12%]' : 'right-0'"), 'Make room for active follower without shifting solo hero');
assert(arena.includes('strike={null}'), 'Companion in PvP is visual-only: never inject bonus hits');
assert.match(arena, /getFollowerArt\(portraitFollower\.id\)/, 'Use the selected companion image');
assert(!arena.includes('h-[52%] w-[48%]'), 'Do not restore the invisible follower layout');
assert.match(pve, /getEnemyCombatFrames\((?:enemy|activeEnemy)\.art\)/, 'PvE enemy animations disconnected');
assert.match(pve, /getFollowerCombatFrames\(follower\.id\)/, 'PvE companion animation frames missing');
assert.match(pve, /data-testid="pve-visible-follower"/, 'Companion needs its own PvE foreground lane');
assert(pve.includes('z-30 h-[72%] w-[74%]'), 'Normal companion cannot shrink behind the hero in Trials');
assert(pve.includes("follower ? 'right-[-8%] w-[88%]' : 'right-0 w-full'"), 'Shift only the hero with a visible companion; keep solo hero centered');
assert(!pve.includes('z-10 h-[52%] w-[48%]'), 'Do not bury a selected companion under the hero');

 
// After a PvE win or loss the outcome must replace (not trail below) the tall
// arena, so the primary CTA stays above the Telegram bottom navigation.
const pveResultBranch = pve.indexOf('if (outcome) {', pve.indexOf('const hint ='));
const pveCombatScreen = pve.indexOf('<div className="space-y-2 animate-fade-in">', pveResultBranch);
assert(pveResultBranch > 0 && pveCombatScreen > pveResultBranch,
  'PvE result must early-return its own screen before mounting the battle arena');
assert(pve.indexOf('<OutcomePanel outcome={outcome}', pveResultBranch) < pveCombatScreen,
  'Result card must be rendered on the separate outcome route');
assert.match(pve, /data-testid="pve-result-screen"/, 'Mobile outcome screen selector missing');
assert.match(pve, /data-testid="pve-outcome-card"/, 'Victory and defeat must share a compact result card');
assert.match(pve, /data-testid="pve-result-next"/, 'Next fight / retry action missing');
assert.match(pve, /data-testid="pve-result-exit"/, 'Return from outcome missing');
assert.match(pve, /outcome\.won[\s\S]*?'Повторить бой'/, 'Defeat must offer the same existing paid start flow for retry');
assert(pve.indexOf('data-testid="pve-result-actions"') < pve.indexOf('data-testid="victory-next-goal"'),
  'Primary result actions must appear before the optional next-goal panel');

for (const image of ['watch-helmet', 'master-raven-amulet', 'caravan-armor', 'watch-blade', 'north-shield', 'spark-ring', 'ranger-boots']) {
  assert(existsSync(`public/assets/territory/ui/unique-gear/${image}.webp`), `Missing actual crafted gear: ${image}`);
}
// Only the 4 item-specific pictures are restored. All 7 user-rejected
// generic slot files must stay removed from source control and the game.
for (const image of ['sword', 'knight-blade', 'hero-sword', 'plate-armor']) {
  assert(existsSync(`public/assets/territory/ui/equipment-cartoon/${image}.webp`), `Owner-approved gear art missing: ${image}`);
}
for (const image of ['helmet', 'amulet', 'armor', 'weapon', 'shield', 'ring', 'boots']) {
  assert(!existsSync(`public/assets/territory/ui/equipment-cartoon/${image}.webp`), `Removed placeholder was restored by mistake: ${image}`);
}
// The hero's 7-slot gallery must use the actual shop/hero artwork shown by the owner,
 // not generic icon emojis or similarly themed master gear from another item.
for (const slot of ['helmet', 'amulet', 'armor', 'weapon', 'shield', 'ring', 'boots']) {
  assert(existsSync(`public/assets/territory/ui/equipment/${slot}.webp`), `Original equipment picture missing: ${slot}`);
  assert(art.includes(` ${slot}: originalSlotArt('${slot}')`), `Original gallery not restored for ${slot}`);
}
assert.match(art, /const originalSlotArt = /, 'The shared slot art should use the approved existing shop catalog');
assert.match(art, /SHOP_EQUIPMENT_ART_BY_NAME/, 'Stock shop equipment art mapping missing');
assert.match(art, /return SLOT_ART\[shopSlot\]/, 'Stock shop art should match the original gallery');
for (const image of ['sword', 'knight-blade', 'hero-sword', 'plate-armor']) {
  assert(art.includes(`originalEquipmentArt('${image}')`), `Original item artwork not wired: ${image}`);
}
assert.match(art, /if \(item\.equipment\) return equipmentArt\(item\.equipment\)/, 'Inventory still shows generic weapon');
assert.match(gear, /equipmentArt\(item\)/, 'Arena gear still shows generic weapon');
assert.match(room, /<ArenaChat\s+roomId=\{roomId\}/, 'Persistent arena chat missing');
assert.match(room, /<BeltBar/, 'Seven-slot item belt missing');
assert.match(room, /<GearStrip/, 'Seven-slot gear missing');
// Arena actions affect real players: do not allow a second transaction before
// React updates the button's disabled state on rapid Android double taps.
assert.match(room, /const actionFlight = useRef\(false\)/, 'Missing synchronous arena action guard');
assert.match(room, /if \(actionFlight\.current\) return;\s*actionFlight\.current = true/, 'Arena actions must lock synchronously');
assert.match(room, /finally \{\s*actionFlight\.current = false;\s*setBusy\(false\)/,
  'Arena action guard must unlock after success or failure');
assert.match(room, /const runBelt = async[\s\S]*?if \(actionFlight\.current \|\| busy\) return;/,
  'Belt action must reject a second debit while another action is pending');
assert.match(room, /const strike = \(\) => \{\s*if \(actionFlight\.current/,
  'Second tap cannot submit the same arena strike again');
assert.match(room, /role="alert" data-testid="arena-action-error"/,
  'Server errors should be visible above elixirs, not buried below the chat');
assert(room.indexOf('data-testid="arena-action-error"') < room.indexOf('<ArenaChat'),
  'Battle errors must be near the fight controls');
assert.doesNotMatch(room, /className="card text-center text-sm text-red-400 py-3 animate-fade-in"/,
  'Do not render duplicate action errors underneath the chat');
const arenaChat = read('src/components/arena/ArenaChat.tsx');
assert.match(arenaChat, /h-\[clamp\(140px,24dvh,224px\)\]/,
  'Keep Arena chat scrollable without consuming most of short mobile screens');
assert.match(effects, /prefers-reduced-motion: reduce/, 'Motion accessibility safeguards missing');

// Regression coverage for the reported Android arena/trials defects.
const figure = read('src/components/arena/FighterFigure.tsx');
const enemyArt = read('src/game/combatArt.ts');
const engine = read('src/game/engine.ts');
const strikes = read('src/game/useStrikeQueue.ts');
assert.match(arena, /dir=\{-1\}\s+mirror\s+alive=\{enemy\.hp > 0\}/, 'PvP enemy must be mirrored toward the hero');
assert.match(figure, /mirror \? 'battle-mirror-art'/, 'Mirroring must affect only the fighter artwork');
assert.match(figure, /battle-swing-\$\{swing\}/, 'Three combat gestures disconnected');
for (const mode of [0, 1, 2]) {
  assert.match(effects, new RegExp('\\.battle-swing-' + mode + '\\s*\\{'), 'Attack movement ' + mode + ' missing');
}
assert.match(pve, /src=\{resolveCombatArtUrl\((?:enemy|activeEnemy)\.art\)\}/, 'PvE may double-prefix a public asset path');
assert.match(enemyArt, /url\.startsWith\(base\)/, 'Combat art prefix must be idempotent');
assert.match(engine, /characters\/bosses\/barrow_guardian\/idle\.webp/, 'Trial guardian needs a six-pose art set');

// Run the actual exported resolver in both URL forms that occur in deployed builds.
const base = '/territory-game-builde/';
const transpiled = await transform(enemyArt.replaceAll('import.meta.env.BASE_URL', JSON.stringify(base)), { loader: 'ts', format: 'esm' });
const { resolveCombatArtUrl } = await import('data:text/javascript;base64,' + Buffer.from(transpiled.code).toString('base64'));
const trialPath = 'assets/territory/characters/bosses/barrow_guardian/idle.webp';
assert.equal(resolveCombatArtUrl('/' + trialPath), base + trialPath, 'Bare trial art gets one prefix');
assert.equal(resolveCombatArtUrl(base + trialPath), base + trialPath, 'Already-prefixed art must not get a second prefix');
assert(existsSync('public/assets/territory/characters/bosses/barrow_guardian/death.webp'), 'Trial guardian poses missing');
assert.match(strikes, /STRIKE_MS = 920/, 'Faster strike FX queue timing missing');

// Living battle is purely visual and shares its fighter component across PvP/PvE.
const fighterMotionCss = read('src/components/arena/fighterEffects.css');
assert.match(figure, /fighter-figure__breath--idle/, 'Hero stance must breathe between real strike events');
assert.match(figure, /fighter-figure__footstep/, 'Attacker must step onto the ground on a real strike');
assert.match(figure, /fighter-impact__flash/, 'Contact flash must be tied to the target impact');
assert.match(figure, /combatSpeed = 1/, 'PvE x2 motion support was removed');
for (const animation of ['fighter-breathe', 'fighter-step-dust', 'fighter-cut', 'fighter-thrust', 'fighter-overhead', 'fighter-recoil', 'fighter-guard', 'fighter-dodge', 'fighter-contact']) {
  assert.ok(fighterMotionCss.includes(`@keyframes ${animation} {`), 'Missing live combat animation: ' + animation);
}
assert.match(fighterMotionCss, /\.fighter-figure__breath--idle \{ animation: none !important; \}/, 'Reduced-motion guard must disable continuous breathing');
assert.match(fighterMotionCss, /\.fighter-figure__footstep, \.fighter-impact__flash \{ display: none; \}/, 'Reduced-motion guard must disable extra FX');

assert.match(figure, /getFighterRig\(combatFrames\?\.idle \?\? src\)/, 'Rig selection must follow actual appearance, not default portrait');
assert.match(figure, /<SkeletalFighter/, 'Shared arena/PvE rendering must use real rig');
assert.match(figure, /img\.decode\(\)/, 'Missing cutout art must fall back safely');
assert.doesNotMatch(figure, /canAnimateRig\s*&&\s*enabledRig/, 'Old Telegram must mount approved joint rigs');
assert.match(figure, /Promise\.resolve\(img\.decode\(\)\)\.catch\(\(\) => loaded\)/, 'Legacy Image.decode must safely fall back to loading');
const skeletalSource = read('src/components/combat2d/SkeletalFighter.tsx');
assert.match(skeletalSource, /joint\.style\.transition =/, 'Legacy SVG must animate each joint with a CSS transition');
assert.match(skeletalSource, /joint\.style\.transform = String\(frames\[i\]/, 'Legacy SVG must move joints through confirmed combat keyframes');
assert.match(skeletalSource, /fallbackTimers\.forEach\(timer => window\.clearTimeout\(timer\)\)/, 'No stale joint timers after combat');
assert.match(skeletalSource, /reduced\?\.matches === true/, 'Honor reduced-motion preference in old Telegram');

// A companion action is a presentation of a resolved PvE hit/heal, never a
// synthetic combat source. Witch keeps its own original keyed attack/heal art.
const companionMotion = read('src/components/pve/pveCompanionMotion.css');
assert.match(pve, /hit\.source === 'companion' && hit\.amount > 0\) setCompanionStrikeKey\(actionKey\)/,
  'Companion attack animation must be driven only by resolved companion damage');
assert.match(pve, /data-action=\{strike\?\.key === companionStrikeKey \? 'attack'/,
  'Unrelated hero and rune events must not animate the companion as attacker');
assert.match(pve, /const companionHealing = res\.healAmount - runeHealing;/,
  'Companion animation must subtract rune-only healing');
assert.match(pve, /setCompanionHeal\(\{ sequence: \+\+keyRef\.current, amount: companionHealing \}\)/,
  'Forest Healer and Battle Cow must react to actual healing');
assert.match(pve, /follower\.id === 'follower_pumpkin_witch_2026' \? <PumpkinWitch/,
  'Never replace the approved Witch attack and heal art');
assert.match(pve, /data-testid="pve-companion-heal"/,
  'Show real confirmed companion heal visibly in PvE');
assert.match(companionMotion, /@keyframes pve-companion-charge/,
  'Melee companion requires its own step-and-recover choreography');
assert.match(companionMotion, /@keyframes pve-companion-cast/,
  'Ranged companion requires a casting motion');
assert.match(companionMotion, /prefers-reduced-motion:reduce/,
  'Companion choreography must honor reduced motion');
// Each stylised projectile or melee contact belongs to a real companion
// hit already resolved by the PvE engine; never add damage by animation.
const strikeFx = read('src/components/pve/PveCompanionStrikeFx.tsx');
const strikeFxCss = read('src/components/pve/pveCompanionStrikeFx.css');
assert.match(pve, /strike && strike\.key === companionStrikeKey/,
  'Companion contact FX must be gated on the currently confirmed hit');
assert.match(pve, /<PveCompanionStrikeFx followerId=\{follower\.id\} eventKey=\{strike\.key\}/,
  'Confirmed hit must drive the current original selected companion FX');
assert.match(strikeFx, /const FOLLOWER_STRIKE: Record<string, StrikeStyle>/,
  'Follower roles must retain distinct melee and ranged presentations');
assert.doesNotMatch(strikeFx, /follower_pumpkin_witch_2026/,
  'Do not duplicate the approved Pumpkin Witch projectile');
assert.match(strikeFxCss, /@keyframes companion-strike-flight/,
  'The archer/rune/healer projectile must visibly travel toward the real foe');
assert.match(strikeFxCss, /@keyframes companion-strike-contact/,
  'The foe must show a confirmed-time impact');
assert.match(strikeFxCss, /prefers-reduced-motion:reduce/,
  'Companion contact FX must honor reduced-motion preferences');

// The animated Battle Cow SVG cutout was reverted after a real Android
// screenshot exposed hero/companion overlap. The original FighterFigure art
// remains; the lower size and distinct right-aligned hero are intentional.
assert.doesNotMatch(pve, /ArticulatedCow|pve-companion-action--jointed/,
  'Rejected joint-cutout Cow must not return to the live PvE renderer');
assert.match(pve, /h-\[58%\] w-\[44%\]/,
  'Battle Cow must stay in a compact companion-only lane');
assert.match(pve, /follower\?\.id === 'follower_6' \? 'right-\[-5%\] w-\[70%\]'/,
  'Hero should retain a separate visible lane with the Cow selected');

console.log('Battle visuals OK: all character poses/assets, opponent, companion, sword, chat and seven-slot UI.');

// Existing review CI invokes this entrypoint, including the real rig contract.
await import('./check-skeletal-contract.mjs');
