import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const result = await build({entryPoints:['src/game/eventsBoard.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {eventCalendar,questAction,readyQuestCount} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const at = (date) => Date.parse(date);

const ordinary = eventCalendar(at('2026-10-26T12:00:00Z'));
assert.equal(ordinary.today,'2026-10-26');
assert.equal(ordinary.dailyResetAt,at('2026-10-26T22:00:00Z'));
assert.ok(ordinary.weeklyResetAt > ordinary.dailyResetAt);
assert.ok(ordinary.dailyRemaining>0);

// DST transitions must count actual Kyiv hours, not a hardcoded UTC+2/3 day.
const autumn = eventCalendar(at('2026-10-25T00:00:00Z'));
assert.equal(autumn.today,'2026-10-25');
assert.equal(autumn.dailyResetAt-at('2026-10-24T21:00:00Z'),25*3600_000);
const spring = eventCalendar(at('2027-03-28T00:00:00Z'));
assert.equal(spring.dailyResetAt-at('2027-03-27T22:00:00Z'),23*3600_000);

assert.deepEqual(questAction({id:'q_daily_1',type:'daily'}),{destination:'battle',label:'В поход'});
assert.deepEqual(questAction({id:'q_daily_3',type:'daily'},true),{destination:'arena',label:'To arena'});
assert.equal(questAction({id:'unrecognized',type:'story'}),null);
const tasks=[{type:'daily',current:3,target:3,claimed:false},{type:'daily',current:5,target:5,claimed:true},{type:'weekly',current:1,target:3,claimed:false}];
assert.equal(readyQuestCount(tasks),1);
assert.equal(readyQuestCount(tasks,'weekly'),0);

const read = path => readFileSync(path,'utf8');
const screen=read('src/components/EventsScreen.tsx'),home=read('src/components/HomeScreen.tsx'),app=read('src/App.tsx');
const quests=read('src/components/QuestsScreen.tsx'),analytics=read('src/game/analytics.ts'),styles=read('src/components/eventsBoard.css');
assert.ok(existsSync('public/ic-events.webp'));
for(const artwork of ['ic-daily.webp','ic-quests.webp','ic-blessing.webp','nav-map-parchment.webp','ic-mail.webp','ic-arena.webp','ic-trophy.webp','nav-clan.webp','hall-art/dice-mobile.webp']){
 assert.ok(existsSync('public/'+artwork),'Event image missing: '+artwork);
}
assert.match(app,/const EventsScreen = lazy\(/,'Lazy-load Events instead of adding them to initial login');
assert.match(app,/<EventsScreen onNavigate=\{setScreen\} onDaily=\{\(\) => setEventDailyOpen\(true\)\} onSeason=/);
assert.match(app,/setLeaderboardInitialTab\('season'\); setScreen\('leaderboard'\)/,'Champion card must open the season tab directly');
assert.match(app,/\{eventDailyOpen && <DailySheet/,'Events daily gift must open the genuine existing reward sheet');
assert.match(home,/label=\{t\('events'\)\} badge=\{questAlerts\.readyCount > 0\} onClick=\{\(\) => onOpen\('events'\)\}/,'The Events button must be live on the home city');
assert.match(quests,/const action = questAction\(q, language === 'en'\)/,'Existing quests should deep-link into gameplay');
assert.match(quests,/onNavigate\(action\.destination\)/);
assert.match(screen,/Promise\.allSettled\(checks\)/,'Live cards must tolerate partial backend failures');
for(const serverRead of ['hallStatus()','fetchSeasonStatus()','getArenaWeeklyStatus()'])assert.ok(screen.includes(serverRead));
assert.doesNotMatch(screen,/hallDaily\(|hallStart\(|hallFinish\(|useGame\.set\(|supabase\.rpc\(/,'Event hub must never grant rewards itself');
assert.match(screen,/season\.week === seasonWindow\(clock\)\.weekKey/,'Never show last week as a live season');
assert.match(screen,/currentRequest\.current \+= 1/,'Ignore stale server replies after unmount');
assert.match(analytics,/'messages','events'/,'Anonymous screen analytics must include new event hub and inbox');
assert.match(analytics,/'territory_events_action'/,'Track only whitelisted event navigation, never player identity');
assert.match(styles,/max-width:\s*360px/,'Compact Android/iPhone screens must remain usable');
assert.match(styles,/prefers-reduced-motion/,'Honor reduced-motion setting');
console.log('Events board PASS: real existing bonuses, DST-safe Kyiv countdowns, server-only status, live navigation, first-hour quest actions, anonymous analytics and compact mobile layout.');
