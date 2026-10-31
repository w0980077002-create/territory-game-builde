import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8');
const arena = read('src/components/ArenaScreen.tsx');
const lobby = read('src/components/arena/ArenaLobby.tsx');
const css = read('src/components/arena/arenaLobby.css');

for (const [path, source] of [
  ['src/components/ArenaScreen.tsx', arena],
  ['src/components/arena/ArenaLobby.tsx', lobby],
]) {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(parsed.parseDiagnostics.length, 0, path + ' must parse as TSX');
}

assert.match(arena, /currentArenaRoom\(\)/, 'Initial arena entry must check server room');
assert.match(arena, /\.catch\(\(\) => \{ if \(mounted\) setCheckError\(true\)/,
  'Failed room lookup must not be interpreted as an empty room');
assert.doesNotMatch(arena, /\.catch\(\(\) => \{ if \(mounted\) setRoomId\(null\)/,
  'Never allow a fresh join merely because room lookup failed');
assert.match(arena, /checkError \? \(/, 'Uncertain server lookup must show a recovery screen');
assert.match(arena, /data-testid="arena-room-check-error"/);
assert.match(arena, /setCheckAttempt\(value => value \+ 1\)/, 'Recovery action must recheck the actual room');
assert.match(arena, /<ArenaRoom key=\{roomId\}/, 'Confirmed room must resume the real battle');
assert.match(arena, /<ArenaLobby onJoined=\{setRoomId\}/, 'Only a verified empty room may show matchmaking');
assert.match(arena, /arena-approved\/stadium\.webp/, 'Use approved Viking Arena art, not placeholders');
assert.match(arena, /onBack && <button/, 'The player must be able to return to the city');

assert.match(lobby, /const joinInFlight = useRef\(false\)/, 'A synchronous guard must prevent double-taps');
assert.match(lobby, /if \(joinInFlight\.current \|\| joining \|\| recovering \|\| recoveryRequired\) return/,
  'Matchmaking must be gated during pending joins and recovery');
assert.match(lobby, /try \{ hapticImpact\('medium'\); \} catch/,
  'Telegram vibration failure must not cancel a real fight');
assert.match(lobby, /try \{ captureGameEvent\('territory_arena_fight_start'/,
  'Analytics failure must not hide a confirmed join');
assert.match(lobby, /const roomId = await secureArenaJoin\(mode\)/,
  'Keep the existing server-authoritative join');
assert.match(lobby, /const activeRoom = await currentArenaRoom\(\)/g,
  'Both uncertain join and manual retry must check the real server room');
assert.match(lobby, /if \(activeRoom\) onJoined\(activeRoom\)/,
  'An already created room must be resumed rather than charged again');
assert.match(lobby, /setRecoveryRequired\(true\)/,
  'Uncertain join must block a second charge until verified');
assert.match(lobby, /disabled=\{!!joining \|\| recovering \|\| recoveryRequired\}/,
  'Mode cards must not start a second fight while recovery is pending');
assert.match(lobby, /data-testid="arena-join-recovery"/, 'Player needs a real recovery action');
assert.match(lobby, /onClick=\{\(\) => void recoverRoom\(\)\}/);
assert.match(lobby, /<ArenaWeeklyBoard \/>/, 'Keep the existing weekly board');
assert.match(lobby, /<RulesModal/, 'Keep the existing rules dialog');
assert.doesNotMatch(lobby, /useGame\.set\(|saveCloudSave\(|supabase\.rpc\(/,
  'UI recovery must not mutate wallets, saves or server state');

for (const cls of ['arena-entry-recovery','arena-entry-recovery__retry','arena-lobby-recovery']) {
  assert.ok(css.includes('.' + cls), 'Missing mobile recovery styling: ' + cls);
}
assert.match(css, /min-height:46px/, 'Recovery touch target must be >=44px');
assert.match(css, /max-width:360px/, 'Recovery layout must support 320px screens');
assert.match(css, /prefers-reduced-motion:reduce/, 'Respect reduced-motion preference');

console.log('Arena entry recovery PASS: verified room before matchmaking, protected uncertain join, synchronous double-tap guard, optional Telegram haptics and analytics, mobile recovery UI.');
console.log('Static TSX guards are not a Telegram WebView test; CI and published Pages SHA must be checked separately.');
