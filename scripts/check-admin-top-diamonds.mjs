import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const tab = read('src/admin/tabs/TopTab.tsx');
const api = read('supabase/functions/admin-api/index.ts');
const sql = read('supabase/migrations/20261029073000_admin_top_red_gems_v1.sql');

assert.match(tab, /type Kind = 'level' \| 'gold' \| 'gems' \| 'red_gems' \| 'donate'/);
assert.match(tab, /id: 'gems', label: 'По синим/);
assert.match(tab, /id: 'red_gems', label: 'По красным/);
assert.match(tab, /adminCall<\{ rows: TopRow\[\] \}>\('top', \{ kind \}\)/);
assert.match(tab, /setRefresh\(\(n\) => n \+ 1\)/);
assert.match(api, /kind === "level" \|\| kind === "gold" \|\| kind === "gems"/);
assert.match(api, /\.order\(kind, \{ ascending: false \}\)/);
assert.match(api, /case "top":/);
assert.match(api, /kind === "red_gems"/);
assert.match(api, /db\.rpc\("territory_admin_top_red_gems_v1"\)/);
assert.match(sql, /game_state->'player'->'redGems'/);
assert.match(sql, /ORDER BY red_gems DESC/);
assert.match(sql, /LIMIT 100/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.territory_admin_top_red_gems_v1\(\) FROM PUBLIC, anon, authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.territory_admin_top_red_gems_v1\(\) TO service_role/);
console.log('Admin Top 100 blue and red diamond rankings PASS');
