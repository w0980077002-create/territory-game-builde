// Regression tests for deterministic, isolated TERRITORY 2.0 battle engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = readFileSync('src/v2/core/autoBattle.ts', 'utf8');
const executableCode = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert(!/\bsupabase\b|\bfetch\s*\(|grantGold|walletVersion|saveCloudSave/.test(executableCode),
  'Preview combat must never access production database, wallet or rewards');
const output = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal((output.diagnostics ?? []).length, 0);
const module = { exports: {} };
vm.runInNewContext(output.outputText, { exports: module.exports, module, console });
const { encounterForChapter, startPreviewEncounter, nextPreviewTick, previewTimeline } = module.exports;

for (const heroClass of ['berserker', 'runemage', 'ranger']) {
  for (const rune of ['flame', 'frost', 'thunder', 'guardian']) {
    for (const follower of ['guardian', 'warrior', 'healer', 'hunter', 'mage']) {
      const base = encounterForChapter(1, 1, heroClass);
      const config = { ...base, rune, companion: follower };
      let state = startPreviewEncounter(config);
      assert.equal(state.stonesSpent, 0);
      assert.equal(state.tick, 0);
      let count = 0;
      while (!state.finished && count < 300) {
        const rng = ((count * 214013 + 2531011) >>> 0) / 4294967296;
        state = nextPreviewTick(state, rng);
        count++;
        assert.equal(state.stonesSpent, 0);
        assert(Number.isFinite(state.heroHp) && state.heroHp >= 0 && state.heroHp <= config.hero.hp);
        assert(Number.isFinite(state.enemyHp) && state.enemyHp >= 0 && state.enemyHp <= config.enemy.hp);
        assert(Number.isFinite(state.mana) && state.mana >= 0 && state.mana <= 100);
        assert(state.events.length <= 6);
      }
      assert(state.finished === 'victory' || state.finished === 'defeat', 'battle must end within bounded ticks');
      assert.equal(nextPreviewTick(state, 0.5), state, 'finished battle must be stable');
    }
  }
}

for (let wave = 1; wave <= 5; wave++) {
  const fight = encounterForChapter(5, wave);
  assert.equal(fight.boss, wave === 5);
  const timeline = previewTimeline(fight, 453451, 300);
  assert(timeline.finished === 'victory' || timeline.finished === 'defeat');
  assert.equal(JSON.stringify(timeline), JSON.stringify(previewTimeline(fight, 453451, 300)),
    'seeded simulation must be deterministic');
}

const initial = startPreviewEncounter(encounterForChapter(3, 1));
assert.equal(nextPreviewTick(initial, Number.NaN).tick, 1);
assert.equal(nextPreviewTick(initial, Number.POSITIVE_INFINITY).tick, 1);
console.log('TERRITORY 2.0: 60 class/rune/companion builds + 5 stages deterministic, finite, no stone/wallet writes');
