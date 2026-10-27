import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../src/game/config/territory-expansion-v1.json', import.meta.url), 'utf8'));
assert.equal(catalog.schema, 'territory-expansion-v1/1');
assert.equal(catalog.status, 'design_only');
assert.equal(catalog.playerFacingEnabled, false, 'Do not enable unfinished offers in the live game');
assert.equal(catalog.paymentsEnabled, false);
assert.equal(catalog.cashoutEnabled, false);
assert.equal(catalog.originalArtworkRequired, true);
assert.equal(catalog.implementationRequirements.allRewardsServerAuthorized, true);
assert.equal(catalog.implementationRequirements.paidCurrencyToCasinoAllowed, false);
assert.equal(catalog.implementationRequirements.storeSchemaMigrationsAllowed, false);

const unique = (items, label) => {
  const ids = items.map((item) => item.id);
  assert.equal(ids.length, new Set(ids).size, `${label}: duplicate ids`);
  for (const item of items) {
    assert.match(item.id, /^[a-z][a-z0-9_]*$/, `${label}: invalid id`);
    assert.ok(item.nameRu.trim(), `${label}: original name required`);
  }
};

for (const [label, items] of Object.entries({
  builds: catalog.heroBuilds,
  skills: catalog.skills,
  runes: catalog.runes,
  sets: catalog.equipmentSetIdeas,
  companions: catalog.companionRoles,
  events: catalog.eventIdeas,
  offers: catalog.offerDesigns,
})) unique(items, label);

const skills = new Set(catalog.skills.map(x => x.id));
for (const build of catalog.heroBuilds) {
  assert.equal(build.skillIds.length, 3);
  for (const id of build.skillIds) {
    assert.ok(skills.has(id), `${build.id} references missing skill ${id}`);
    assert.ok(catalog.skills.find(x => x.id === id).roles.includes(build.id), `skill ${id} is not allowed for ${build.id}`);
  }
}

const allSlots = new Set(['helmet', 'amulet', 'armor', 'weapon', 'shield', 'ring', 'boots']);
for (const set of catalog.equipmentSetIdeas) {
  assert.ok(set.preferredSlots.length >= 2);
  for (const slot of set.preferredSlots) assert.ok(allSlots.has(slot));
}

assert.equal(catalog.premiumPricingReferenceUsd.length, 10);
const premiumTiers = new Set(catalog.premiumPricingReferenceUsd);
assert.equal(premiumTiers.size, 10);
for (const offer of catalog.offerDesigns) {
  assert.ok(premiumTiers.has(offer.usdTier));
  assert.equal(offer.status, 'disabled_pending_server');
  assert.ok(offer.contentsKeys.length > 0);
  assert.ok(Number.isSafeInteger(offer.purchaseLimit) && offer.purchaseLimit >= 1);
  const forbiddenRewards = new Set(['usdt', 'ton', 'cash', 'cashout', 'withdraw', 'casino_ticket', 'hall_ticket', 'slots_ticket']);
  assert.ok(!offer.contentsKeys.some((key) => forbiddenRewards.has(key)), 'Never create a cashout/paid casino chain');
}

assert.ok(catalog.eventIdeas.every(e => Number.isSafeInteger(e.days) && e.days > 0 && e.freeTrack), 'Every event offers a free path');
console.log('Territory expansion catalog: 4 original builds, 12 skills, 6 runes, 3 sets, 4 events and 10 disabled offers validated.');
