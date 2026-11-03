import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(path, 'utf8');
const visualsSource = read('src/game/mailRewardVisuals.ts');
const generated = ts.transpileModule(visualsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
const sandbox = { exports: {} };
runInNewContext(generated.outputText, sandbox, { filename: 'mailRewardVisuals.js' });
const { mailRewardVisuals, MAIL_ITEM_VISUALS } = sandbox.exports;
assert.equal(typeof mailRewardVisuals, 'function');

const admin = read('src/admin/api.ts');
const resources = admin.match(/export const RESOURCES:[\s\S]*?\n];/)?.[0];
assert.ok(resources, 'Admin resource list is present');
const adminKeys = [...resources.matchAll(/key: '([^']+)', label:/g)].map((m) => m[1]);
const expected = [
  'gold', 'gems', 'redGems', 'stones', 'shop_stone_5', 'forgeMaterials',
  'shop_potion_hp', 'shop_potion_hp_large', 'shop_elixir_atk',
  'shop_elixir_def', 'shop_elixir_crit', 'shop_arena_time', 'shop_arena_adrenaline',
];
assert.equal(adminKeys.length, expected.length, 'Every admin grant type must be covered');
assert.deepEqual([...adminKeys].sort(), [...expected].sort(), 'Unexpected grant type in admin');
const visualItemKeys = Object.keys(MAIL_ITEM_VISUALS);
assert.equal(visualItemKeys.length, 8, 'Seven shop consumables plus the Halloween raid trophy');
const pumpkin = mailRewardVisuals({ items: { halloween_horned_pumpkin_2026: 1 } });
assert.equal(pumpkin.length, 1);
assert.equal(pumpkin[0].key, 'halloween_horned_pumpkin_2026');
assert.equal(pumpkin[0].amount, 1);
assert.ok(existsSync('public/' + pumpkin[0].image), 'Approved Halloween helmet art must be shipped');
for (const key of expected) {
  const payload = key.startsWith('shop_') ? { items: { [key]: 2 } } : { [key]: 2 };
  const rewards = mailRewardVisuals(payload);
  assert.equal(rewards.length, 1, `Grant ${key} has exactly one visible badge`);
  assert.ok(rewards[0].amount > 0, `Grant ${key} has positive quantity`);
  assert.ok(existsSync('public/' + rewards[0].image), `Artwork missing: ${rewards[0].image}`);
}
const selected = mailRewardVisuals({ gems: 200, stones: 30, items: { shop_potion_hp_large: 20 } });
assert.equal(selected.length, 3, 'Existing letter should display three award icons');
const large = selected.find((r) => r.key === 'shop_potion_hp_large');
assert.equal(large?.amount, 20);
assert.equal(large?.image, 'potion-hp-large-viking.webp');
const bundle = mailRewardVisuals({ stones: 2, items: { shop_stone_5: 4 } });
assert.equal(bundle.length, 1);
assert.equal(bundle[0].key, 'stones');
assert.equal(bundle[0].amount, 22, 'Bundles award five stones each');
const material = mailRewardVisuals({ forgeMaterials: 13 });
assert.equal(material[0].image, 'forge-material.webp', 'Forge materials must no longer disappear');
assert.equal(material[0].amount, 13);
assert.equal(mailRewardVisuals({ gems: 0, items: { shop_elixir_atk: -2 } }).length, 0);

const mail = read('src/components/home/HomeSheets.tsx');
assert.match(mail, /mailRewardVisuals\(m\.payload\)/);
assert.match(mail, /reward\.image/);
assert.match(mail, /reward\.amount/);
assert.doesNotMatch(mail, /grantItemsText\(/);
const localizationSource = read('src/game/halloweenMailLocalization.ts');
const localizedCode = ts.transpileModule(localizationSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
const localeSandbox = { exports: {} };
runInNewContext(localizedCode.outputText, localeSandbox, { filename: 'halloweenMailLocalization.js' });
const { localizedHalloweenMail } = localeSandbox.exports;
const prizeMail = {
  subject: '🎃 Награда за место в топ-20 рейда!',
  body: 'Поздравляем! Ты занял 3-е место в Хэллоуинском рейде TERRITORY!',
  payload: { gold: 3000, gems: 150, stones: 5 },
};
const enPrize = localizedHalloweenMail(prizeMail, 'en');
assert.ok(enPrize.subject.includes('Top 20'));
assert.ok(enPrize.body.includes('#3'));
for (const text of ['3000','150','5','Horned Pumpkin']) {
  assert.ok(enPrize.body.includes(text), 'English bonus mail missing '+text);
}
assert.equal(localizedHalloweenMail(prizeMail,'ru').body,prizeMail.body,
  'RU bonus mail must keep approved original copy');
const notice = {
  subject: '🎃 Твоя награда за Хэллоуинский рейд!',
  body: 'Поздравляем с победой!\n\nCongratulations on defeating the Pumpkin King!',
  payload: {},
};
assert.equal(localizedHalloweenMail(notice,'en').body,
  'Congratulations on defeating the Pumpkin King!');
assert.equal(localizedHalloweenMail(notice,'ru').body,notice.body);
assert.equal(localizedHalloweenMail({subject:'Unrelated',body:'Hello',payload:{}},'en').body,'Hello',
  'Other player mail must remain unmodified');
const finalSubject = localeSandbox.exports.HALLOWEEN_FINAL_SUBJECT;
assert.equal(finalSubject, '🎃 Поздравляем! Награды за Хэллоуин 2026');
const oldHalloweenLetter = { subject: finalSubject, body: 'Легендарная Тыквенная ведьма', payload: {} };
assert.equal(localizedHalloweenMail(oldHalloweenLetter, 'ru').body, 'Эпическая Тыквенная ведьма',
  'Read-only mail display must use current owner-approved Epic rarity');
assert.equal(oldHalloweenLetter.body, 'Легендарная Тыквенная ведьма',
  'Old stored messages must not be mutated');
const finalWinner = {
  subject: finalSubject,
  body: '🎃 Поздравляем! Ты занял 3-е место в Хэллоуинском рейде. Шлем и спутник получены.',
  payload: { gold: 3000, gems: 150, stones: 5, items: { halloween_horned_pumpkin_2026: 1 } },
};
const finalEn = localizedHalloweenMail(finalWinner, 'en');
assert.ok(finalEn.subject.includes('Congratulations'));
for (const text of ['#3', '3000', '150', '5', 'Pumpkin Witch', 'Horned Pumpkin']) {
  assert.ok(finalEn.body.includes(text), 'Unified English Halloween prize letter missing '+text);
}
assert.equal(localizedHalloweenMail(finalWinner, 'ru').body, finalWinner.body);
const finalParticipant = {
  subject: finalSubject,
  body: 'Поздравляем! Тыквенная ведьма закреплена за героем.',
  payload: {},
};
const participantEnglish = localizedHalloweenMail(finalParticipant,'en');
assert.ok(participantEnglish.body.includes('Pumpkin Witch'));
assert.ok(!participantEnglish.body.includes('Horned Pumpkin'));
assert.ok(!participantEnglish.body.includes('Top-20 prizes are separate'));
assert.match(mail, /m\.subject === HALLOWEEN_FINAL_SUBJECT/, 'Final letter shows companion art');
assert.match(mail, /getFollowerArt\('follower_pumpkin_witch_2026'\)/, 'Use original confirmed companion portrait');
assert.match(mail, /localizedHalloweenMail\(m, language\)/,
  'The live mailbox must call localized prize copy');
assert.match(mail, /copy\.subject/);
assert.match(mail, /copy\.body/);
const translations = read('src/game/i18n.tsx');
assert.match(translations, /'Рогатая тыква · Хэллоуин 2026': 'Horned Pumpkin · Halloween 2026'/);
assert.match(read('src/components/ForgeScreen.tsx'), /localizeRarity\(selectedCurrent\.rarity, language\)/);
assert.match(read('src/components/InventoryScreen.tsx'), /localizeRarity\(selected\.rarity, language\)/);
const art = read('src/game/art.ts');
assert.match(art, /e\.value >= 150/);
assert.match(art, /potion-hp-large-viking\.webp/);
assert.match(read('src/components/home/HomeSheets.tsx'), /taps\.current\.count >= 5/, 'Five-tap admin entrance must remain untouched');
console.log('Mail rewards PASS: all 13 admin rewards, 3-icon existing letter, bundle x5, forge material, health potion art.');
