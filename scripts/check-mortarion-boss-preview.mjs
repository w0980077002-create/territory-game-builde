import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const boss = read('src/components/MortarionBossScreen.tsx');
const app = read('src/App.tsx');
const events = read('src/components/EventsScreen.tsx');
const css = read('src/components/mortarionBoss.css');

assert.match(app, /screen === 'mortarion' && isAdmin && <MortarionBossScreen/);
assert.match(events, /bossPreview && onBossPreview && <EventCard/);
assert.match(boss, /MORTARION_HP = 100_000_000/);
assert.match(boss, /MORTARION_EVENT_DAYS = 5/);
assert.match(boss, /MORTARION_HITS_PER_HOUR = 5/);
assert.match(boss, /MORTARION_HIT_COOLDOWN_MS = 60_000/);
assert.match(boss, /Array\.from\(\{ length: 10 \}/);
assert.doesNotMatch(boss, /myRank|myPlace|yourRank|yourPlace|Ваше место|Your rank|localStorage|sessionStorage|supabase\.rpc|saveCloudSave/);
assert.match(boss, /owner-only preview/i);
assert.match(boss, /mortarion-raid-scene\.webp/);
assert.match(boss, /bg-gradient-to-b from-amber-400 via-orange-600 to-red-800/);
assert.match(boss, /from-red-800 via-orange-600 to-amber-400/);
const scene = readFileSync(new URL('../public/assets/territory/events/mortarion-raid-scene.webp', import.meta.url));
assert.ok(scene.length > 5000, 'Cinematic boss art must be shipped');
assert.equal(scene.toString('ascii', 0, 4), 'RIFF');
assert.equal(scene.toString('ascii', 8, 12), 'WEBP');
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /mortarion-raid__arena--striking/);
assert.match(read('src/game/halloweenBoss.ts'), /territory_halloween_boss_state_v1/);

const source = ts.createSourceFile('boss.tsx', boss, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
const pieces = source.statements
  .filter(node => ts.isVariableStatement(node) && /MORTARION_(HITS_PER_HOUR|HIT_COOLDOWN_MS|WINDOW_MS)/.test(node.getText(source))
    || ts.isFunctionDeclaration(node) && node.name?.text === 'mortarionLimitAt')
  .map(node => node.getText(source));
const code = ts.transpileModule(pieces.join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(code, sandbox);
const check = sandbox.exports.mortarionLimitAt;
assert.equal(typeof check, 'function');
const at = 1_000_000;
const empty = { firstHitAt: 0, lastHitAt: 0, hits: 0 };
assert.equal(check(empty, at).canHit, true, 'first hit available');
const once = { firstHitAt: at, lastHitAt: at, hits: 1 };
assert.equal(check(once, at + 59_999).canHit, false, 'cooldown blocks at 59.999s');
assert.equal(check(once, at + 60_000).canHit, true, 'cooldown unlocks at 60s');
const full = { firstHitAt: at, lastHitAt: at + 240_000, hits: 5 };
assert.equal(check(full, at + 300_000).canHit, false, 'sixth hit blocked');
assert.equal(check(full, at + 3_599_999).canHit, false, 'five-hit hourly window still locked');
assert.equal(check(full, at + 3_600_000).canHit, true, 'hourly quota resets exactly at 60min');
assert.equal(check(full, at + 3_600_000).hits, 0);
console.log('Mortarion owner-only preview and attack limits: PASS');
