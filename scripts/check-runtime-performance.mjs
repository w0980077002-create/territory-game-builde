import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');
const arena = read('src/game/useArenaRoom.ts');
const live = read('src/game/live.ts');
const app = read('src/App.tsx');
const auth = read('src/game/auth.ts');
const arenaApi = read('src/game/arenaApi.ts');
const clouds = read('src/game/cloud.ts');

assert.match(arena,/const POLL_MS = 2200;/, 'Keep active battle sync under 2.2 seconds');
assert.match(arena,/roomStatus === 'active' \? POLL_MS/, 'Active rooms still sync quickly');
assert.match(arena,/document\.visibilityState !== 'hidden'/, 'Hidden arena pages must not poll');
assert.match(arena,/document\.addEventListener\('visibilitychange', resumed\)/, 'Arena catches up when reopened');
assert.match(arena,/lastId\.current = next\.messages\[next\.messages\.length - 1\]\.id/, 'Chat cursor continuity');
assert.match(arena,/return \{ view, messages, offline, clockOffset, refresh \};/, 'Existing arena API unchanged');
assert.match(arena,/if \(!target\) return;/, 'No clock work when countdown does not exist');
assert.match(arena,/setInterval\(tick, 1_000\)/, 'Second-level countdowns must not render 4x/sec');
assert.doesNotMatch(arena,/setInterval\(\(\) => setNow\(Date\.now\(\)\), 250\)/);

assert.match(arenaApi,/new AbortController\(\)/,'Long arena calls must be cancellable');
assert.match(arenaApi,/controller\.abort\(\), 10_000/,'Cap stalled arena calls at 10 seconds');
assert.match(arenaApi,/window\.clearTimeout\(timeout\)/,'Clear arena timeout on completion');
assert.match(live,/const syncVisible = \(\) =>/);
assert.match(live,/document\.visibilityState === 'visible'/);
assert.match(live,/void heartbeat\(\)/);
assert.match(live,/setInterval\(syncVisible, 20_000\)/);
assert.match(live,/document\.addEventListener\('visibilitychange', syncVisible\)/);
assert.match(live,/supabase\.rpc\('player_heartbeat'\)/, 'Live RPC preserved');

assert.match(app,/useState\(false\)/, 'Start without unverified admin privileges');
assert.match(app,/isVerifiedAdmin\(\)\.then\(setIsAdmin\)/, 'Owner is still verified by server');
assert.doesNotMatch(app,/authState\.status === 'loading' \|\| isAdmin === null/, 'Admin API may not block ordinary player loading');
assert.match(app,/if \(maintenance && !isAdmin\) return <MaintenanceScreen \/>/, 'Maintenance protection retained');
assert.match(app,/createImmediateSaveController\(/, 'Saving must not change');
assert.match(auth,/telegramSignIn\(initData\)/, 'Telegram verification remains in auth flow');
assert.match(clouds,/saveBlocked\.add\(userId\)/, 'Economy conflict prevention untouched');

console.log('Runtime performance checks PASS: safe polling, background suspension, timers, owner verification, maintenance and saves.');
