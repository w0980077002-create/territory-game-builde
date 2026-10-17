import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const req = createRequire(import.meta.url);
let ts;
try { ts = req('typescript'); } catch {
  const tscPath = fs.realpathSync(execFileSync('which', ['tsc'], { encoding: 'utf8' }).trim());
  ts = req(path.resolve(path.dirname(tscPath), '..', 'lib', 'typescript.js'));
}
const root = process.cwd();
const src = fs.readFileSync('src/game/questAttention.ts', 'utf8');
const transpiled = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true,
});
assert.equal((transpiled.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'territory-quest-alerts-'));
try {
  const output = path.join(tmp, 'questAttention.cjs');
  fs.writeFileSync(output, transpiled.outputText);
  const { availableQuestKeys, getQuestAlerts, rememberSeenQuests, readSeenQuests } = req(output);
  const quest = (id, type, current = 0, target = 1, claimed = false) =>
    ({ id, type, current, target, claimed });
  const game = {
    quests: [quest('daily', 'daily'), quest('weekly', 'weekly'), quest('story', 'story')],
    dailyResetDay: 'Oct 17', weeklyResetWeek: '2026-W42',
  };
  const social = { chat: false, news: false };
  assert.deepEqual(getQuestAlerts(game, social, []), { count: 5, newCount: 5, readyCount: 0 });
  const seen = availableQuestKeys(game, social);
  assert.deepEqual(getQuestAlerts(game, social, seen), { count: 0, newCount: 0, readyCount: 0 },
    'seen ongoing quests should not show a permanent alert');
  const ready = { ...game, quests: [quest('daily', 'daily', 1), ...game.quests.slice(1)] };
  assert.deepEqual(getQuestAlerts(ready, social, seen), { count: 1, newCount: 0, readyCount: 1 },
    'completed quest alerts until claimed, even when viewed');
  const claimed = { ...ready, quests: [quest('daily', 'daily', 1, 1, true), ...game.quests.slice(1)] };
  assert.equal(getQuestAlerts(claimed, social, seen).count, 0,
    'after reward claimed, the dot disappears');
  assert.equal(getQuestAlerts({ ...game, dailyResetDay: 'Oct 18' }, social, seen).count, 1,
    'next-day daily quests should be new again');
  assert.equal(getQuestAlerts({ ...game, weeklyResetWeek: '2026-W43' }, social, seen).count, 1,
    'next-week weekly quests should be new again');
  assert.equal(getQuestAlerts(game, { chat: true, news: false }, seen).count, 0,
    'claimed social task should not create a badge');
  assert.equal(getQuestAlerts(game, social, seen.filter(s => s !== 'social:chat')).count, 1,
    'new social quest should create a badge');
  const data = new Map();
  globalThis.window = { localStorage: {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  } };
  assert.deepEqual(rememberSeenQuests('player_one', game, social), seen);
  assert.deepEqual(readSeenQuests('player_one'), seen);
  assert.deepEqual(readSeenQuests('player_two'), [], 'seen state must be per player');
  const home = fs.readFileSync('src/components/HomeScreen.tsx', 'utf8');
  const main = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(home, /badge=\{questAlerts\.count > 0\}/, 'main quest button shows red dot');
  assert.match(home, /questAlerts\.readyCount/, 'home prioritizes claim-ready quests');
  assert.match(main, /rememberSeenQuests/, 'visiting quests marks new tasks as viewed');
  assert.match(main, /onSocialStatusChange/, 'social claims update the home indicator');
  console.log('Quest attention checks passed: new daily/weekly/story/social, ready claim, seen, per-player storage');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
