import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Pure Dark Cave rules: floors, gems, Umbra gear, cave blessing, fund and the
// idempotent test sandbox. No network, no database, no player account.
const entry = `
export * as floors from './src/game/cave/floors.ts';
export * as gems from './src/game/cave/gems.ts';
export * as umbra from './src/game/cave/umbra.ts';
export * as blessing from './src/game/cave/blessing.ts';
export * as fund from './src/game/cave/fund.ts';
export * as sandbox from './src/game/cave/sandbox.ts';
export * as rng from './src/game/cave/rng.ts';
export * as campaign from './src/game/idleContent/campaign.ts';
`;
const out = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent', alias: { '@': resolve('src') } });
const { floors, gems, umbra, blessing, fund, sandbox, rng, campaign } =
  await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

// ---- Floors: 100 original cave floors in parity with the server encounter contract.
const all = floors.buildCaveFloors();
assert.equal(all.length, 100);
for (const floor of all) {
  const stage = campaign.getCampaignStage(floor.index);
  assert.equal(floor.kind, stage.kind, `floor ${floor.index} kind must match encounter adventure_v1_stage_${floor.index}`);
  assert.equal(floor.enemyArt, stage.enemyArt, `floor ${floor.index} keeps the encounter's combat sprite`);
  assert.notEqual(floor.enemyRu, stage.enemyName, `floor ${floor.index} must have a cave-specific enemy, not the Campaign name`);
  assert.ok(existsSync(`public/assets/territory/characters/${floor.enemyArt}/idle.webp`), 'missing art ' + floor.enemyArt);
  assert.ok(floor.enemyRu && floor.enemyEn && floor.depth.ru && floor.depth.en);
}
assert.equal(new Set(all.filter(f => f.kind === 'boss').map(f => f.enemyId)).size, 10, 'ten distinct bosses');
assert.equal(new Set(all.map(f => f.depth.id)).size, 5);
for (const bad of [0, 101, 1.5, -1, Number.NaN]) assert.throws(() => floors.getCaveFloor(bad), /invalid_cave_floor/);
// Repeat farm proposal: only cleared floors, max depth is never changed.
assert.deepEqual(floors.planCaveRepeat(10, 10), { ok: true });
assert.deepEqual(floors.planCaveRepeat(10, 11), { ok: false, reason: 'not_cleared' });
assert.deepEqual(floors.planCaveRepeat(100, 101), { ok: false, reason: 'invalid_floor' });
assert.equal(floors.settleCaveRepeat(37, 3), 37);
assert.throws(() => floors.settleCaveRepeat(5, 6), /cave_repeat_not_cleared/);

// ---- Gems: owner rules of 2026-11-10.
let inv = {};
assert.deepEqual(gems.addGemDrop(inv, 'ruby', 0), { ok: false, reason: 'invalid_drop_level' }, 'Lv.0 drop rejected');
for (const level of [1, 2, 3]) assert.equal(gems.addGemDrop(inv, 'ruby', level).ok, true, `Lv.${level} drop allowed`);
for (const level of [4, 5, 9, 1.5, '1', null]) assert.equal(gems.addGemDrop(inv, 'ruby', level).ok, false, `direct drop Lv.${level} forbidden`);
assert.deepEqual(gems.addGemDrop(inv, 'diamond', 1), { ok: false, reason: 'invalid_type' });
const give = (source, type, level, n) => { let i = source; for (let k = 0; k < n; k++) i = { ...i, [`${type}:${level}`]: (i[`${type}:${level}`] ?? 0) + 1 }; return i; };
assert.equal(gems.synthesizeGem(give({}, 'ruby', 1, 2), 'ruby', 1).ok, false, '2×Lv.1 do not combine');
assert.equal(gems.synthesizeGem(give(give({}, 'ruby', 1, 2), 'azure', 1, 1), 'ruby', 1).ok, false, 'mixed colours do not combine');
assert.equal(gems.synthesizeGem(give(give({}, 'ruby', 1, 2), 'ruby', 2, 1), 'ruby', 1).ok, false, 'mixed levels do not combine');
assert.deepEqual(gems.synthesizeGem(give({}, 'ruby', 1, 3), 'ruby', 1), { ok: true, inventory: { 'ruby:2': 1 }, made: 'ruby:2' });
assert.deepEqual(gems.synthesizeGem(give({}, 'ruby', 3, 3), 'ruby', 3), { ok: true, inventory: { 'ruby:4': 1 }, made: 'ruby:4' },
  'Lv.4 is reachable by synthesis and is not capped at Lv.3');
assert.deepEqual(gems.synthesizeGem(give({}, 'moon', 7, 4), 'moon', 7).inventory, { 'moon:7': 1, 'moon:8': 1 }, 'no invented level cap');
// Quick synthesis cascades every triple and conserves gem mass.
inv = give(give(give({}, 'ruby', 1, 29), 'azure', 1, 2), 'storm', 2, 3);
const quick = gems.quickSynthesizeGems(inv);
assert.deepEqual(quick.inventory, { 'ruby:1': 2, 'ruby:4': 1, 'azure:1': 2, 'storm:3': 1 });
assert.equal(gems.gemMass(quick.inventory), gems.gemMass(inv), 'quick synthesis creates and destroys nothing');
assert.deepEqual(gems.quickSynthesizeGems(quick.inventory).made, [], 'a second quick synthesis has nothing to do');
// Sockets: insert / replace / remove conserve gems; totals aggregate all frames.
let sockets = gems.emptySockets();
assert.equal(gems.GEM_FRAMES.length * gems.SOCKETS_PER_FRAME, 18);
assert.equal(gems.insertGem({}, sockets, 'weapon', 0, 'ruby:1').reason, 'not_owned');
assert.equal(gems.insertGem({ 'ruby:1': 1 }, sockets, 'weapon', 3, 'ruby:1').reason, 'invalid_socket');
assert.equal(gems.insertGem({ 'ruby:1': 1 }, sockets, 'cloak', 0, 'ruby:1').reason, 'invalid_socket');
let step = gems.insertGem({ 'ruby:1': 1, 'ruby:2': 1 }, sockets, 'weapon', 0, 'ruby:1');
assert.deepEqual(step.inventory, { 'ruby:2': 1 });
step = gems.insertGem(step.inventory, step.sockets, 'weapon', 0, 'ruby:2');
assert.deepEqual(step.inventory, { 'ruby:1': 1 }, 'a replaced gem returns to the inventory');
assert.deepEqual(gems.gemTotals(step.sockets), { attack: gems.gemValue('ruby', 2) });
step = gems.removeGem(step.inventory, step.sockets, 'weapon', 0);
assert.deepEqual(step.inventory, { 'ruby:1': 1, 'ruby:2': 1 });
assert.equal(gems.removeGem(step.inventory, step.sockets, 'weapon', 0).reason, 'empty_socket');
for (const type of gems.GEM_TYPES) for (let level = 1; level < 9; level++)
  assert.ok(gems.gemValue(type.id, level + 1) > gems.gemValue(type.id, level), 'a higher gem is always stronger');

// ---- Umbra gear: 12 separate slots, sets of different sizes, honest comparison.
assert.equal(umbra.UMBRA_SLOTS.length, 12);
assert.equal(new Set(umbra.UMBRA_SLOTS.map(s => s.id)).size, 12);
for (const slot of umbra.UMBRA_SLOTS) assert.ok(umbra.UMBRA_TEMPLATES.some(t => t.slot === slot.id), 'slot without an item: ' + slot.id);
for (const template of umbra.UMBRA_TEMPLATES) assert.ok(existsSync('public/' + template.art), 'missing item art ' + template.art);
const setSizes = umbra.UMBRA_SETS.map(s => s.slots.length);
assert.ok(setSizes.includes(7) && new Set(setSizes).size > 1, 'sets must not all share one hard-coded size');
const roll = rng.seededRng('items');
const drops = Array.from({ length: 400 }, (_, i) => umbra.rollUmbraItem(roll, { id: 'i' + i, floor: 1 + (i % 100), boss: i % 10 === 0, source: 't' }));
for (const item of drops) {
  assert.equal(umbra.umbraTemplate(item.templateId).slot, item.slot);
  assert.ok(item.rank >= 1 && item.rank <= 5 && item.main.value > 0);
  assert.equal(new Set([item.main.stat, ...item.affixes.map(a => a.stat)]).size, item.affixes.length + 1, 'no duplicated attribute lines');
  if (item.setId) {
    assert.ok(item.level >= 41, 'set pieces only from floor 41');
    assert.ok(umbra.umbraSet(item.setId).slots.includes(item.slot), 'a set piece belongs to a slot of its set');
  }
}
assert.ok(drops.some(i => i.setId) && drops.some(i => i.rank === 5) && drops.some(i => i.rank === 1));
const sameKind = drops.filter(i => i.templateId === 'void_axe' && i.level > 60);
assert.ok(new Set(sameKind.map(i => JSON.stringify(i.affixes))).size > 1, 'same item type rolls different attributes');
const weapon = drops.find(i => i.slot === 'weapon');
const better = { ...weapon, id: 'better', main: { ...weapon.main, value: weapon.main.value * 3 } };
const cmp = umbra.compareCandidate([weapon, better], { weapon: weapon.id }, better);
assert.equal(cmp.current.id, weapon.id);
assert.ok(cmp.powerDelta > 0);
assert.ok(umbra.compareCandidate([weapon, better], { weapon: better.id }, weapon).powerDelta < 0, 'a worse candidate shows a negative delta');
const piece = slot => ({ ...drops.find(i => i.slot === slot), id: 'set-' + slot, setId: 'void_sovereign', level: 50 });
const two = [piece('helmet'), piece('amulet')];
const progress = umbra.setProgress(two)[0];
assert.deepEqual([progress.have, progress.size, progress.active], [2, 7, [2]], '2/7 set progress from worn Umbra pieces only');
assert.ok(umbra.loadoutPower(two) > umbra.itemPower(two[0]) + umbra.itemPower(two[1]), 'an active set bonus adds power');

// ---- Cave blessing: separate from the city blessing, only owned elixirs, no invented rates.
const blessSource = readFileSync('src/game/cave/blessing.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(blessSource, /claimBlessing|GameState|\d\s*%|price|chance:/i, 'cave blessing has no city-blessing link, prices or percentages');
assert.equal(blessing.CAVE_BLESSING_SLOTS, 3);
assert.equal(new Set(blessing.CAVE_ELIXIRS.map(e => e.category)).size, blessing.CAVE_ELIXIRS.length, 'each elixir boosts a different loot category');
for (const elixir of blessing.CAVE_ELIXIRS) assert.ok(existsSync('public/' + elixir.art), 'missing elixir art ' + elixir.art);
assert.equal(blessing.placeElixir({}, blessing.emptyBlessing(), 0, 'cave_bless_gems').reason, 'not_owned');
assert.equal(blessing.placeElixir({ cave_bless_gems: 1 }, blessing.emptyBlessing(), 3, 'cave_bless_gems').reason, 'invalid_slot');
let bless = blessing.placeElixir({ cave_bless_gems: 1, cave_bless_gear: 1 }, blessing.emptyBlessing(), 1, 'cave_bless_gems');
assert.deepEqual([bless.stock, bless.slots], [{ cave_bless_gear: 1 }, [null, 'cave_bless_gems', null]]);
bless = blessing.placeElixir(bless.stock, bless.slots, 1, 'cave_bless_gear');
assert.deepEqual(bless.stock, { cave_bless_gems: 1 }, 'replacing returns the previous elixir');
assert.deepEqual(blessing.boostedCategories(bless.slots), ['gear']);
assert.deepEqual(blessing.takeElixirBack(bless.stock, bless.slots, 1).stock, { cave_bless_gems: 1, cave_bless_gear: 1 });

// ---- Fund: one claim per threshold, only for reached depth, free track only.
assert.deepEqual(fund.FUND_THRESHOLDS.slice(0, 3), [5, 10, 15]);
assert.equal(fund.FUND_THRESHOLDS.at(-1), 100);
assert.deepEqual(fund.planFundClaim([], 10, 9), { ok: false, reason: 'not_reached' });
assert.deepEqual(fund.planFundClaim([10], 10, 50), { ok: false, reason: 'already_claimed' });
assert.deepEqual(fund.planFundClaim([], 7, 50), { ok: false, reason: 'invalid_threshold' });
for (const t of fund.FUND_THRESHOLDS) { const g = fund.fundReward(t).gem; if (g) assert.ok(g.level >= 1 && g.level <= 3, 'fund gems obey the Lv.1–3 grant rule'); }
assert.doesNotMatch(readFileSync('src/game/cave/fund.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), /premium|price|usd|payment/i);

// ---- Sandbox reducer: idempotent, protected, conserving.
const op = (() => { let n = 0; return () => 'op-000000-' + (++n); })();
const act = (state, action, id = op()) => sandbox.applyCaveAction(state, action, id);
let s = sandbox.emptySandbox();
assert.equal(act(s, { type: 'loot', floor: 1, boss: false }, 'x').reason, 'invalid_operation');
const first = act(s, { type: 'loot', floor: 50, boss: true }, 'victory-session-1');
assert.ok(first.ok && first.state.items.length === 2 && first.state.lastLoot.gems.length === 2);
const again = act(first.state, { type: 'loot', floor: 50, boss: true }, 'victory-session-1');
assert.ok(again.replay && again.state === first.state, 'the same victory can never be looted twice');
assert.deepEqual(act(s, { type: 'loot', floor: 50, boss: true }, 'victory-session-1').state.items, first.state.items, 'loot is deterministic per operation');
assert.equal(act(s, { type: 'loot', floor: 5, boss: false }).state.lastLoot.gems.length, 0, 'no gems before floor 6');
s = first.state;
for (let i = 0; i < 300; i++) s = act(s, { type: 'loot', floor: 1 + (i % 100), boss: false }).state;
assert.equal(s.items.length, umbra.UMBRA_STORAGE_CAP, 'the warehouse never exceeds its capacity');
assert.ok(s.lastLoot.overflow > 0 && s.lastLoot.items.length === 0, 'overflowing items are reported, not silently stored');
for (const key of Object.keys(s.gems)) assert.ok(gems.parseGemKey(key).level <= 3, 'sandbox drops are Lv.1–3 only');
const [a, b] = s.items;
s = act(s, { type: 'equip', itemId: a.id }).state;
assert.equal(act(s, { type: 'equip', itemId: 'ghost' }).reason, 'not_owned');
assert.equal(act(s, { type: 'dismantle', itemIds: [a.id] }).reason, 'item_equipped', 'a worn item is protected');
s = act(s, { type: 'lock', itemId: b.id, locked: true }).state;
assert.equal(act(s, { type: 'dismantle', itemIds: [b.id, s.items[5].id] }).reason, 'item_locked', 'a locked item refuses the whole batch');
assert.equal(act(s, { type: 'reforge', itemId: b.id }).reason, 'item_locked');
const before = { n: s.items.length, e: s.essence };
const batch = [s.items[5], s.items[6], s.items[7]];
const dis = act(s, { type: 'dismantle', itemIds: batch.map(i => i.id) }, 'dismantle-batch-1');
assert.equal(dis.state.items.length, before.n - 3);
assert.equal(dis.state.essence - before.e, batch.reduce((sum, i) => sum + umbra.dismantleYield(i), 0));
assert.equal(act(dis.state, { type: 'dismantle', itemIds: batch.map(i => i.id) }, 'dismantle-batch-1').state.essence, dis.state.essence, 'double submit grants once');
assert.equal(act(dis.state, { type: 'dismantle', itemIds: batch.map(i => i.id) }).reason, 'not_owned');
s = dis.state;
const enh = act(s, { type: 'enhance', itemId: a.id });
assert.equal(enh.state.essence, s.essence - umbra.enhanceCost(a));
assert.equal(enh.state.items.find(i => i.id === a.id).enhance, 1);
assert.ok(umbra.enhancedMain(enh.state.items.find(i => i.id === a.id)) > a.main.value);
assert.equal(act({ ...s, essence: 0 }, { type: 'enhance', itemId: a.id }).reason, 'not_enough_essence', 'no enhancement without materials');
const allUp = act(s, { type: 'enhanceAll' });
assert.ok(allUp.ok && allUp.count > 0 && allUp.state.essence >= 0 && allUp.state.essence < s.essence);
assert.equal(act({ ...s, loadout: {} }, { type: 'enhanceAll' }).reason, 'nothing_equipped');
const reforged = act(s, { type: 'reforge', itemId: a.id }).state.items.find(i => i.id === a.id);
assert.deepEqual(reforged.main, a.main, 'reforge keeps the main attribute');
assert.equal(reforged.affixes.length, a.affixes.length);
s = act(s, { type: 'unequip', slot: a.slot }).state;
assert.equal(act(s, { type: 'unequip', slot: a.slot }).reason, 'empty_slot');
// Synthesis through the sandbox: exactly one debit for a repeated request.
s = { ...sandbox.emptySandbox(), gems: { 'ruby:1': 4 } };
const syn = act(s, { type: 'synth', gem: 'ruby', level: 1 }, 'synth-request-1');
assert.deepEqual(syn.state.gems, { 'ruby:1': 1, 'ruby:2': 1 });
assert.deepEqual(act(syn.state, { type: 'synth', gem: 'ruby', level: 1 }, 'synth-request-1').state.gems, syn.state.gems, 'two identical requests debit once');
assert.equal(act(syn.state, { type: 'synth', gem: 'ruby', level: 1 }).reason, 'not_enough');
assert.equal(act(syn.state, { type: 'quickSynth' }).reason, 'not_enough');
// Cave blessing through the sandbox: owned elixirs only; consumed by one looted victory.
s = sandbox.emptySandbox();
assert.equal(act(s, { type: 'bless', slot: 0, elixir: 'cave_bless_gear' }).reason, 'not_owned', '3 slots are not 3 free bonuses');
s = act(s, { type: 'takeElixir', elixir: 'cave_bless_gear' }).state;
assert.equal(act(s, { type: 'takeElixir', elixir: 'city_blessing' }).reason, 'invalid_elixir');
s = act(s, { type: 'bless', slot: 0, elixir: 'cave_bless_gear' }).state;
assert.deepEqual([s.elixirs, s.blessSlots], [{}, ['cave_bless_gear', null, null]]);
const blessed = act(s, { type: 'loot', floor: 3, boss: false }).state;
assert.deepEqual([blessed.lastLoot.boosted, blessed.lastLoot.items.length, blessed.blessSlots], [['gear'], 2, [null, null, null]]);
// Fund through the sandbox.
s = sandbox.emptySandbox();
assert.equal(act(s, { type: 'fundClaim', threshold: 10, maxFloor: 9 }).reason, 'not_reached');
const claim = act(s, { type: 'fundClaim', threshold: 10, maxFloor: 12 }, 'fund-claim-10');
assert.deepEqual([claim.state.fundClaimed, claim.state.essence], [[10], fund.fundReward(10).essence]);
assert.equal(act(claim.state, { type: 'fundClaim', threshold: 10, maxFloor: 12 }).reason, 'already_claimed');
// Stored sandbox survives a round trip; garbage starts clean and cannot inject items.
assert.deepEqual(sandbox.decodeSandbox(JSON.parse(JSON.stringify(first.state))), first.state);
assert.deepEqual(sandbox.decodeSandbox({ v: 1, items: [{ id: 'x', templateId: 'excalibur', slot: 'weapon' }], gems: { 'ruby:0': 5, 'gold:1': 2 }, essence: -5 }),
  sandbox.emptySandbox());
assert.deepEqual(sandbox.decodeSandbox('nonsense'), sandbox.emptySandbox());

// ---- Existing 16 cave-loot paintings stay in the game and the staged settlement is unchanged.
const lootArt = readdirSync('public/assets/territory/cave-loot/2026-11-06').filter(f => f.endsWith('.webp'));
assert.equal(lootArt.length, 16, 'all 16 original cave-loot images are kept');
const usedArt = new Set([...umbra.UMBRA_TEMPLATES.map(t => t.art), 'assets/territory/cave-loot/2026-11-06/14-essence-flask.webp']);
assert.ok(lootArt.filter(f => usedArt.has('assets/territory/cave-loot/2026-11-06/' + f)).length >= 13, 'gear and essence paintings are used by real item types');
for (const type of gems.GEM_TYPES) assert.ok(existsSync('public/' + gems.gemArt(type.id)), 'missing gem art ' + type.id);
assert.match(readFileSync('supabase/staged/territory_v1_adventure_settlement.sql', 'utf8'), /r\.items <> '\[\]'::jsonb/,
  'Staged settlement must still reject unsupported gear grants');

// ---- Isolation: the sandbox and cave UI never touch real player data.
const caveSources = [...readdirSync('src/game/cave').map(f => 'src/game/cave/' + f),
  ...readdirSync('src/components/pve/cave').map(f => 'src/components/pve/cave/' + f)];
for (const file of caveSources) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(text, /claimBlessing|\.blessing\b(?!\))|useGame\.set|supabase|fetch\(|player\.equipped\s*=|battleStones|gems\s*:\s*state\.gems\s*\+/,
    file + ' must stay isolated from the save, wallets, city blessing and the network');
}
assert.match(readFileSync('src/game/cave/sandboxStore.ts', 'utf8'), /'territory_cave_sandbox_v1'/, 'sandbox uses its own storage key');

console.log('Dark Cave systems PASS: 100 cave floors, gems Lv.1-3 + 3:1 synthesis, 12 Umbra slots, sets, cave blessing, fund, idempotent sandbox.');
