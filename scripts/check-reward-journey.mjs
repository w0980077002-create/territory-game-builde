import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8');
const paths = [
  'src/App.tsx',
  'src/components/RewardJourney.tsx',
  'src/components/MessagesScreen.tsx',
  'src/components/QuestsScreen.tsx',
  'src/components/home/HomeSheets.tsx',
];
for (const path of paths) {
  const tree = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(tree.parseDiagnostics.length, 0, path + ': valid TSX syntax');
}
const journey = read(paths[1]);
const app = read(paths[0]);
const mail = read(paths[4]);
assert.match(journey, /dailyStatus\(state\)/, 'daily status must come from saved game');
assert.match(journey, /state\.quests\.filter\(q => !q\.claimed && q\.current >= q\.target\)/, 'ready quests must be real');
assert.match(journey, /liveMail\.length \+ MAIL\.filter/, 'mail must include live and built-in letters');
assert.match(journey, /state\.mailClaimed\.includes/, 'already claimed built-in letters must not appear as new');
assert.match(journey, /onClick=\{item\.action\}/, 'destination must call an existing route');
assert.match(journey, /disabled=\{!item\.action\}/, 'current destination cannot open a fake route');
assert.doesNotMatch(journey, /useGame\.set|claimDaily\(|claimQuest\(|claimMail\(|claimMailGrant\(|saveCloudSave\(/, 'overview cannot issue rewards or mutate saves');
assert.match(app, /<MessagesScreen notify=\{notify\} onQuests=\{\(\) => setScreen\('quests'\)\} onDaily=\{\(\) => setEventDailyOpen\(true\)\}/, 'mail routes to existing quests and daily sheet');
assert.match(app, /<QuestsScreen[^>]+onMail=\{\(\) => setScreen\('messages'\)\} onDaily=\{\(\) => setEventDailyOpen\(true\)\}/, 'quests route to existing mail and daily sheet');
assert.match(read(paths[2]), /<RewardJourney active="messages"/, 'mailbox shows the reward loop');
assert.match(read(paths[3]), /<RewardJourney active="quests"/, 'quests show the reward loop');
assert.match(mail, /failedHistoryOffset\.current = offset/, 'failed history page offset must be retained');
assert.match(mail, /loadHistory\(failedHistoryOffset\.current\)/, 'retry must replay the failed page, not skip it');
assert.match(mail, /claimInFlight\.current = true/, 'repeated mail taps must not launch parallel claims');
assert.match(mail, /claimInFlight\.current = false/, 'claim guard must release after success or failure');
assert.match(mail, /getClaimedMailHistory\(offset\)/, 'history remains backed by the existing server API');
assert.match(mail, /claimMailGrant\(id\)/, 'mail grants remain server-controlled');
assert.match(mail, /claimMail\(useGame\.get\(\), id\)/, 'existing built-in mail claim remains intact');
assert.match(mail, /min-h-11/, 'touch controls must be reachable on narrow phones');
console.log('Reward journey PASS: existing daily / quests / mail routes, live status, safe claims, exact-page retry and mobile touch targets.');
console.log('Browser simulation is not a Telegram WebView verification; release still requires CI and published SHA.');
