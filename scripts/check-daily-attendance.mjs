import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const requireNode = createRequire(import.meta.url);
const ts = requireNode('typescript');
const dayKey = at => new Date(at).toISOString().slice(0, 10);
const prevDay = at => {
  const [y,m,d] = dayKey(at).split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d-1)).toISOString().slice(0,10);
};
const calendar = { calendarDayKey: dayKey, previousCalendarDayKey: prevDay };

function runSource(file, modules) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length,0,`TS syntax error in ${file}`);
  const exported = {};
  vm.runInNewContext(result.outputText,{
    module: { exports: exported }, exports: exported, Date, Math, Error,
    require: (id) => {
      assert(id in modules, `Unknown dependency ${id} from ${file}`);
      return modules[id];
    },
  },{filename:file});
  return exported;
}
const attendance = runSource('src/game/dailyAttendance.ts',{ './weeklyQuests':calendar });
const progression = runSource('src/game/progression.ts', {
  './weeklyQuests': calendar,
  './dailyAttendance': attendance,
  './actions': {grantRewards:()=>{throw Error('unused')}, updateProgress:()=>{throw Error('unused')}},
  './trialLoot': {trialChestTier:()=>null},
  './live': {useLive:{get:()=>({goldX2:false})}},
});
const {preserveDailyRewardStreakOnAttendance:preserve,canContinueDailyRewardStreak:canContinue} = attendance;
const {dailyStatus,claimDaily} = progression;
const now = Date.parse('2026-11-12T04:32:00Z');
const original = {player:{gold:100,gems:20,redGems:3},inventory:[],battleStones:9,
 dailyReward:{streak:2,lastDay:'2026-11-10'},dailyResetDay:'2026-11-11'};
const preserved = preserve(original.dailyReward,original.dailyResetDay,now);
assert.equal(preserved.streak,2,'attendance alone must never create a claim or advance a streak');
assert.equal(preserved.lastDay,'2026-11-10','the actual claimed day must remain intact');
assert.equal(preserved.attendanceGraceDay,'2026-11-11','yesterday was a real active day');
assert.equal(original.player.gold,100,'no resources are granted by attendance');
const eligible={...original,dailyReward:preserved,dailyResetDay:'2026-11-12'};
assert.equal(canContinue(eligible.dailyReward,now),true);
assert.equal(dailyStatus(eligible,now).dayIndex,2,'next reward must be day 3, not day 1');
const collected=claimDaily(eligible,now);
assert.equal(collected.dailyReward.streak,3);
assert.equal(collected.dailyReward.lastDay,'2026-11-12');
assert.equal(collected.player.gems,25,'day 3 has five blue gems');
assert.equal(collected.battleStones,12,'day 3 has three stones');
assert.equal(claimDaily(collected,now),null,'UTC daily claim cannot be repeated');
assert.equal(preserve(preserved,'2026-11-11',now).attendanceGraceDay,'2026-11-11','safe on retry');

const notPresent=preserve(original.dailyReward,'2026-11-10',now);
assert.equal(notPresent,original.dailyReward,'missing BOTH login and claim must reset as before');
assert.equal(dailyStatus({...original,dailyReward:notPresent},now).dayIndex,0);
assert.equal(claimDaily({...original,dailyReward:notPresent},now).dailyReward.streak,1);
const day13=Date.parse('2026-11-13T04:00:00Z');
const day12Preserved=preserve(preserved,'2026-11-12',day13);
assert.equal(day12Preserved.attendanceGraceDay,'2026-11-12','consecutive active but unclaimed days remain connected');
assert.equal(dailyStatus({...original,dailyReward:day12Preserved},day13).dayIndex,2);
assert.equal(preserve({streak:2,lastDay:'2026-11-10'},'2026-11-09',now).attendanceGraceDay,undefined);

const beforeUtcMidnight=Date.parse('2026-11-11T23:59:59Z');
const afterUtcMidnight=Date.parse('2026-11-12T00:00:01Z');
assert.equal(dailyStatus({...original,dailyReward:{streak:2,lastDay:'2026-11-11'}},beforeUtcMidnight).claimedToday,true);
assert.equal(dailyStatus({...original,dailyReward:{streak:2,lastDay:'2026-11-11'}},afterUtcMidnight).dayIndex,2);

const actions=fs.readFileSync('src/game/actions.ts','utf8');
const shop=fs.readFileSync('src/components/ShopScreen.tsx','utf8');
const types=fs.readFileSync('src/game/types.ts','utf8');
assert(actions.indexOf('preserveDailyRewardStreakOnAttendance(state.dailyReward, state.dailyResetDay, now)')<
 actions.indexOf('const today = calendarDayKey(now)'), 'attendance must be protected BEFORE active day resets');
assert.match(types,/attendanceGraceDay\?: string/,'persisted optional grace remains compatible with old saves');
assert.match(shop,/stoneOptions\.map\(/,'both stone packs must have in-dialog navigation');
assert.match(shop,/Math\.max\(0, Math\.min\(MAX_SHOP_PURCHASE_QTY, maxByBalance, maxByStoneLimit\)\)/,
 'no selectable unit may be forged with zero daily quota or insufficient balance');
assert.match(shop,/dailyCapExplainsMaximum/,'disabled increment must have a visible explanation');
console.log('Daily attendance and shop stones PASS: active-but-unclaimed grace, actual claim receipts, UTC rollover, one claim/day, two pack choices, zero quota.');
