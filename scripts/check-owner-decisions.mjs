import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Live rule guards only: no DB connections, no writes or entitlements.
const read = name => readFileSync(name, 'utf8');
const vip = read('src/game/vipProgram.ts');
const screen = read('src/components/VipMobileShowcase.tsx');
const agents = read('AGENTS.md');
const requirements = read('docs/GAME_REQUIREMENTS_RU.md');
const quests = read('src/game/weeklyQuests.ts');
const season = read('src/game/seasonCalendar.ts');
const policy = read('docs/WEEKLY_SEASONS_RELEASE_RU.md');
const approved = [0, 1, 10, 100, 300, 500, 1000, 3000, 5000, 8000, 10000];

const prices = vip.match(/VIP_SPEND_THRESHOLDS_USD = \[([^\]]+)\]/);
assert.ok(prices, 'Canonical VIP thresholds missing');
assert.deepEqual(prices[1].split(',').map(x => Number(x.trim())), approved);
const tiers = Array.from(vip.matchAll(/\{\s*level:(\d+), usd:(\d+),/g), m => [Number(m[1]), Number(m[2])]);
assert.deepEqual(tiers, approved.map((usd, level) => [level, usd]));
assert.match(screen, /VIP_SPEND_THRESHOLDS_USD\[tier\]/, 'VIP screen must use single table');
assert.doesNotMatch(screen, /const plannedPrices\s*=/, 'No duplicate VIP pricing');
assert.match(vip, /VIP_AUTO_BELT_LEVEL = 3/);
assert.ok(agents.includes('docs/GAME_REQUIREMENTS_RU.md'), 'Agent instructions must link the current game requirements');
assert.ok(requirements.includes('VIP 3+') && requirements.includes('VIP 0–2 пополняют пояс вручную'), 'VIP-only auto belt must remain explicit');
assert.match(quests, /Weekly quests use Monday 00:00 UTC/);
assert.match(season, /Arena TOP-50 runs Monday-to-Monday, 00:00 UTC/);
assert.ok(policy.includes('понедельник 00:00 UTC → следующий понедельник 00:00 UTC'));
assert.ok(policy.includes('НЕ ЗАПУЩЕН И ОТКЛЮЧЁН'));
assert.ok(!existsSync('supabase/staged/arena_weekly_sunday_utc_restore.sql'), 'Never restore rejected rollback SQL');
assert.ok(!existsSync('supabase/staged/territory_weekly_seasons_activate_v1.sql'),
  'Disabled championship activation must exist only as isolated test fixture');
assert.ok(!existsSync('supabase/staged/territory_weekly_seasons_cron_v1.sql'),
  'Disabled championship cron must never return to staged SQL');
console.log('Approved VIP tiers, belt privileges and Monday calendar: OK');
