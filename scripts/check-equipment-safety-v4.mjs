import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20261017_equipment_guard_v4.sql','utf8');
const js = fs.readFileSync('src/game/equipmentBalance.ts','utf8');
const client = fs.readFileSync('src/game/cloud.ts','utf8');
const expected = [
  ['Меч воина', 'weapon', 'common'], ['Клинок рыцаря', 'weapon', 'rare'],
  ['Героический меч', 'weapon', 'epic'], ['Кожаная броня', 'armor', 'common'],
  ['Латные доспехи', 'armor', 'rare'], ['Железный шлем', 'helmet', 'common'],
  ['Сапоги скорости', 'boots', 'rare'], ['Кольцо силы', 'ring', 'epic'],
  ['Дубовый щит', 'shield', 'common'], ['Амулет ворона', 'amulet', 'rare'],
];
for (const [name,slot,rarity] of expected) {
 assert(sql.includes(`('${name}','${slot}','${rarity}'`), 'Missing server gear template: '+name);
}
assert.match(js, /EQUIPMENT_BALANCE_VERSION = 4/, 'Client must migrate to v4');
assert.match(js, /normalizeEquipmentV4\(item\.equipment\)/, 'Inventory migration required');
assert.match(js, /normalizeEquipmentV4\(eq\)/, 'Equipped gear migration required');
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.territory_normalize_gear_v4/, 'Server normalizer required');
assert.match(sql, /territory_normalize_gear_v4\(x\.value->'equipment'\)/, 'Guard inventory');
assert.match(sql, /territory_normalize_gear_v4\(e\.value\)/, 'Guard equipped items');
assert.match(sql, /CREATE TRIGGER territory_gear_guard_before_v4/, 'Must normalize every player save');
assert.match(sql, /BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance/, 'Guard direct stat-column updates');
assert.match(sql, /RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'/, 'Private normalizer must be callable from authenticated trigger');
assert.match(sql, /NEW\.attack:=/, 'Recompute server attack from normalized gear');
assert.match(sql, /NEW\.max_hp:=/, 'Recompute server HP from normalized gear');
assert.match(sql, /NEW\.game_state:=public\.territory_normalize_state_v4/, 'Never trust client gear statistics');
assert.match(sql, /'baseStats',v_base,'upgradeCount'/, 'Overwrite forged legacy forge baselines');
assert(!/DELETE\s+FROM\s+public\.players/i.test(sql), 'Never delete players');
assert(!/UPDATE\s+public\.players/i.test(sql), 'Mass edit occurs only after preview and backup');
assert.match(client,/migrateGameStateBalance/, 'Cloud load must run item normalization');
console.log('Equipment v4 safety: 10 canonical catalog items, saved inventory and equipped guard, forged stat columns and non-loss guarantees: PASS');
