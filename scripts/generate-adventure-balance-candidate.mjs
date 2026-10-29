import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/game/idleContent/adventureBalanceCandidate.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { buildAdventureBalanceCandidate } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const data = {
  status: 'REVIEW_REQUIRED_NOT_FOR_DEPLOYMENT',
  mapping: 'New stage N -> legacy floor N; old chapter-clear rewards omitted; elite uses ordinary enemy.',
  source: 'Legacy src/game/engine.ts stats/gold/xp; PR #96 laboratory crit/block/dodge probabilities.',
  limitations: 'Mapping and balance not approved; no boss abilities, elite multipliers or item rewards; not an SQL seed.',
  stages: buildAdventureBalanceCandidate(),
};
await writeFile('docs/adventure-balance-candidate.staged.json', JSON.stringify(data, null, 2) + '\n');
