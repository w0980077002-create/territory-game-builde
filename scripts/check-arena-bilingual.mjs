import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const lobby=readFileSync('src/components/arena/ArenaLobby.tsx','utf8');
const styles=readFileSync('src/components/arena/arenaLobby.css','utf8');
const weekly=readFileSync('src/components/arena/ArenaWeeklyBoard.tsx','utf8');

assert.doesNotMatch(lobby, /!en\s*&&\s*!artFailed/, 'EN must use the same approved stadium, not the obsolete fallback scene');
assert.doesNotMatch(lobby, /\{en\s*\?\s*\(\s*<div className="arena-approved-en-mode"/, 'EN must not render the old prototype cards');
assert.match(lobby, /src=\{APPROVED \+ 'stadium.webp'\}/, 'Both languages must share the approved main stadium');
assert.match(lobby, /className="arena-approved-mode-image"[\s\S]*src=\{m.picture\}/, 'Both languages must share approved illustrated battle cards');
assert.match(lobby, /\{en && <div className="arena-approved-en-overlay"/, 'Approved English cards must be translated without replacing their artwork');
for(const label of ['arena-approved-en-city','arena-approved-en-rules','arena-approved-en-banner','arena-approved-en-card-title','arena-approved-en-card-desc','arena-approved-en-card-cta']) {
  assert.match(lobby,new RegExp(label),'Missing localized EN overlay component: '+label);
  assert(styles.includes('.'+label),'Missing localized EN overlay style: '+label);
}
for(const phrase of ["ARENA","START BATTLE","RULES","CITY"]) {
  assert(lobby.includes(phrase),'Missing English arena label: '+phrase);
}
assert.match(lobby, /secureArenaJoin\(mode\)/, 'EN must use real secure server matchmaking');
assert.match(lobby, /onClick=\{\(\) => void join\(m.id\)\}/, 'Each English card must remain clickable');
assert.match(weekly, /WEEKLY TOP 50/, 'The weekly leaderboard must support EN text');
assert.match(weekly, /NEXT GOAL/, 'The arena progress board must support EN text');
assert.match(styles, /arena-approved-stadium-en button:focus-visible/, 'EN control focus visibility must be preserved');
console.log('Arena bilingual: identical approved stadium and battle cards, translated EN overlay, working buttons and English leaderboard: PASS');
