import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(new URL('..', import.meta.url).pathname);
const read = path => readFileSync(join(root, path), 'utf8');
function load(path, deps={}) {
  const source = read(path);
  const compiled = ts.transpileModule(source, { fileName: path, reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2020, module:ts.ModuleKind.CommonJS} });
  const fatals = (compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(fatals.length,0, `${path}: ${fatals.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(';')}`);
  const module={exports:{}};
  vm.runInNewContext(compiled.outputText,{module,exports:module.exports,
    require:(name)=>{assert.ok(name in deps,`Unexpected import ${name} in ${path}`);return deps[name];},
    console,Intl,Date,Math,Number,RangeError,Boolean,String}, {filename:path});
  return module.exports;
}
const weekly=load('src/game/weeklyQuests.ts');
const season=load('src/game/seasonCalendar.ts',{'./weeklyQuests':weekly});
const pvp=load('src/game/pvpBalance.ts');
const localIso = ms => new Date(ms).toISOString();
assert.equal(season.kyivMidnightUtc('2026-10-18'),Date.parse('2026-10-17T21:00:00Z'));
assert.equal(season.kyivMidnightUtc('2026-10-25'),Date.parse('2026-10-24T21:00:00Z'));
assert.equal(season.kyivMidnightUtc('2026-11-01'),Date.parse('2026-10-31T22:00:00Z'));
assert.equal(season.kyivMidnightUtc('2026-03-29'),Date.parse('2026-03-28T22:00:00Z'));
assert.equal(season.kyivMidnightUtc('2026-04-05'),Date.parse('2026-04-04T21:00:00Z'));
assert.throws(()=>season.kyivMidnightUtc('2026-02-30'),RangeError);
assert.throws(()=>season.kyivMidnightUtc('sunday'),RangeError);
for(const near of ['2026-10-17T20:59:59Z','2026-10-17T21:00:00Z','2026-10-24T21:00:00Z',
                   '2026-10-31T21:59:59Z','2026-10-31T22:00:00Z','2026-03-28T21:59:59Z',
                   '2026-03-28T22:00:00Z','2026-04-04T20:59:59Z','2026-04-04T21:00:00Z']) {
  const now=Date.parse(near);const w=season.seasonWindow(now);
  assert.ok(w.startsAt<=now&&now<w.endsAt,`${near}: not in own Kyiv week`);
  assert.equal(w.remainingMs,w.endsAt-now);
  assert.equal(w.weekKey,weekly.weeklyQuestKey(now));
  assert.ok(w.endsAt-w.startsAt>=6*86_400_000&&w.endsAt-w.startsAt<=8*86_400_000);
}
assert.equal(season.seasonCountdown(0),'0д 0ч 0м');
assert.equal(season.seasonCountdown(86400000+3600000+60000,'en'),'1d 1h 1m');
console.log('Stage3 Kyiv seasons: midnight, DST, countdown and week boundaries: PASS');

const a=pvp.normalizePvpEntry(1,20);
const b=pvp.normalizePvpEntry(5,25);
const c=pvp.normalizePvpEntry(81,1000000000);
assert.deepEqual(JSON.parse(JSON.stringify(a)),{attack:70,defense:24,maxHp:420,critChance:7});
for(const n of [a,b,c,pvp.normalizePvpEntry(Infinity,Infinity),pvp.normalizePvpEntry(-9,-500)]){
  assert.ok(n.attack>=70&&n.attack<=Math.round(70*1.05));
  assert.ok(n.defense>=24&&n.defense<=Math.round(24*1.05));
  assert.ok(n.maxHp>=420&&n.maxHp<=Math.round(420*1.05));
  assert.equal(n.critChance,7);
}
assert.ok(c.attack<=Math.round(a.attack*1.05));
console.log('Stage3 staged PvP entry budgets: overpowered level 81 capped at ~5%: PASS');

const recipes=load('src/game/professions.ts',{'./equipmentBalance':{prepareNewEquipment:x=>x}}).PROFESSION_RECIPES;
const canonical=JSON.parse(read('supabase/staged/territory_craft_catalog.json'));
assert.equal(recipes.length,17);
assert.equal(canonical.length,recipes.length);
for(let i=0;i<recipes.length;i++) {
  const r=recipes[i];const c=canonical[i];
  for(const prop of ['id','profession','requiredLevel','masteryXp','ingredients','output'])
    assert.deepEqual(JSON.parse(JSON.stringify(c[prop])),JSON.parse(JSON.stringify(r[prop])),`catalog drift in ${r.id}.${prop}`);
  assert.ok(r.ingredients.length>0);
  assert.ok(r.ingredients.every(x=>x.qty>0));
}
const sql=read('supabase/staged/territory_stage3_backend.sql');
for(const recipe of canonical) assert.ok(sql.includes(`'${recipe.id}'`),`Server catalog missing ${recipe.id}`);
assert.equal((sql.match(/INSERT INTO public\.territory_craft_catalog_v1\(id,/g)||[]).length,17);
for(const expression of [
  'craft_enabled boolean NOT NULL DEFAULT false',
  'season_enabled boolean NOT NULL DEFAULT false',
  'shop_enabled boolean NOT NULL DEFAULT false',
  'mastery_not_verified','wallet_not_verified','operation_id_conflict',
  'pg_catalog.pg_advisory_xact_lock', 'public.territory_resource_wallet',
  'quantity=quantity-v_needed','territory_craft_receipts_v1',
  'stone_daily_limit','stone_bought','shop_stone_5',
  'territory_season_events_v1', 'event_conflict','daily_season_cap',
  'TO service_role', 'FROM PUBLIC, anon, authenticated',
])assert.ok(sql.includes(expression),`Missing guard ${expression}`);
assert.ok(sql.includes("'shop_stone_1' THEN 2 WHEN 'shop_stone_5' THEN 8"));
assert.ok(!sql.includes('GRANT UPDATE ON TABLE public.territory_wallet_v1 TO authenticated'));
const pvpSql=read('supabase/staged/territory_stage3_pvp_normalize.sql');
assert.ok(pvpSql.includes('IF NOT arena_bots_on() THEN'), 'keep bot toggle');
assert.ok(pvpSql.includes('territory_pvp_normalized_stats_v1(v_pl.level, v_pl.attack)'));
assert.ok(pvpSql.includes('territory_pvp_normalized_stats_v1(v_lvl,20+(v_lvl-1)*5)'));
assert.ok(!pvpSql.includes('GREATEST(1, COALESCE(v_pl.attack, 20))'));
console.log('Stage3 staged backend: 17 canonical recipes, atomic crafting, receipts, season server boundaries, stone price caps and fair PvP bots: PASS');

const leaderboard=read('src/components/LeaderboardScreen.tsx');
const cloud=read('src/game/cloud.ts');
assert.ok(cloud.includes("'arena_wins' |"));
assert.ok(leaderboard.includes("kind === 'rating' ? 'arena_rating' : 'arena_wins'"));
assert.ok(leaderboard.includes('ticket !== requestId.current'));
assert.ok(leaderboard.includes('<SeasonScreen user={user} />'));
console.log('Stage3 leaderboard: server-sorted wins, race-safe updates, and seasons preview: PASS');

function walk(dir){for(const name of readdirSync(dir)){const file=join(dir,name);if(statSync(file).isDirectory()){walk(file);continue;}if(!/\.tsx?$/.test(file) || /\.d\.ts$/.test(file))continue;
 const source=readFileSync(file,'utf8');const compiled=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0, `${file}: syntax errors: ${errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '))}`);
}}
walk(join(root,'src'));
console.log('Stage3 whole project .ts/.tsx syntax parse: PASS');
