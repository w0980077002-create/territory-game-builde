import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/game/gooseCompanionDemo.ts', 'utf8');
assert.doesNotMatch(source, /from ['"](?:.*(?:actions|store|supabase|cloud|inventory|progression))/,
  'An isolated preview must never import real state or economy');
assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|useGame|Math\.random/,
  'Sandbox may not read or mutate the player's data');
const built = ts.transpileModule(source, {
  fileName: 'gooseCompanionDemo.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  reportDiagnostics: true,
});
assert.equal((built.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const m = await import('data:text/javascript;base64,' + Buffer.from(built.outputText).toString('base64'));

const initial = m.createGooseDemo();
assert.equal(m.GOOSE_DEMO_ROLE.rarity, 'legendary');
assert.equal(m.GOOSE_DEMO_ROLE.activeFollowerSlots, 2);
assert.equal(m.GOOSE_DEMO_ROLE.mode, 'preview-only');
assert.equal(initial.enemyHp, 600);
const hugged = m.useGooseDemoSkill(initial, 'hug');
assert.equal(initial.shield, 0, 'input object must remain unchanged');
assert.equal(hugged.shield, 90);
assert.equal(hugged.shieldUntil, 4);
assert.equal(m.useGooseDemoSkill(hugged, 'hug'), hugged, 'no shield re-cast or double spend');
const firstHit = m.stepGooseDemo(hugged, 3);
assert.equal(firstHit.heroHp, 500, 'Goose shield absorbs the incoming hit');
assert.equal(firstHit.shield, 30);
const secondHit = m.stepGooseDemo(firstHit, 3);
assert.equal(secondHit.heroHp, 440, 'expired shield never works on a later hit');
assert.equal(secondHit.shield, 0);
assert.equal(m.useGooseDemoSkill(secondHit, 'hug'), secondHit, 'cooldown persists');
assert.notEqual(m.useGooseDemoSkill(m.stepGooseDemo(secondHit, 2), 'hug'), secondHit,
  'cooldown eventually expires');

const honk = m.useGooseDemoSkill(initial, 'honk');
assert.equal(honk.honkUntil, 5);
assert.equal(m.useGooseDemoSkill(honk, 'honk'), honk, 'cannot stack an active honk');
const charged = m.useGooseDemoSkill(honk, 'commotion');
const uncharged = m.useGooseDemoSkill(initial, 'commotion');
assert.equal(charged.enemyHp, 495, 'honk buffs the next attack');
assert.equal(uncharged.enemyHp, 530, 'base attack is lower');
assert.equal(m.useGooseDemoSkill(charged, 'commotion'), charged, 'no same-tick ability spam');
assert.equal(initial.enemyHp, 600, 'no mutation of input HP');
assert.equal(m.stepGooseDemo(initial, Number.NaN), initial, 'invalid delta is rejected');
assert.equal(m.stepGooseDemo(initial, 100), initial, 'unbounded tab-sleep delta rejected');

const auto = m.setGooseDemoAuto(m.createGooseDemo(), true);
const afterAuto = m.stepGooseDemo(auto, 1);
assert.equal(afterAuto.shield, 90, 'auto can protect the hero');
assert.equal(auto.shield, 0, 'toggle must not affect prior state');
assert.equal(m.setGooseDemoAuto(afterAuto, false).auto, false);

let lost = m.createGooseDemo();
for (let i = 0; i < 20; i++) lost = m.stepGooseDemo(lost, 3);
assert.equal(lost.heroHp, 0, 'a test battle can end in defeat');
assert.equal(m.stepGooseDemo(lost, 1), lost, 'defeat stays terminal');
assert.equal(m.createGooseDemo().heroHp, 500, 'retry starts a fresh isolated test');
console.log('PASS legendary goose: isolation, guard, cooldowns, hit, buff, auto, defeat, retry');
