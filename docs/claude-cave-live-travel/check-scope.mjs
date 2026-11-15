#!/usr/bin/env node
/**
 * CLAUDE CAVE: fail-fast guard for the isolated preview PR.
 * Run: node docs/claude-cave-live-travel/check-scope.mjs
 * Checks both branch commits and uncommitted changes; no server connections.
 * This is a scope guard, not a substitute for human review.
 */
import { execFileSync } from 'node:child_process';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function allow(p) {
  return p.startsWith('docs/claude-cave-live-travel/') ||
    p === 'docs/TERRITORY_CAVE_VISUAL_OWNER_REFERENCE_20261115_RU.md' ||
    p === 'docs/TERRITORY_OWNER_DECISIONS_20261114_RU.md' ||
    p.startsWith('src/game/cavePreviewWorld/') ||
    p === 'src/components/pve/CaveExpeditionPreview.tsx' ||
    p.startsWith('src/components/pve/cavePreview/') ||
    p === 'src/components/pve/cave/CaveUmbraScreen.tsx' ||
    p.startsWith('public/assets/territory/cave-expedition/') ||
    p.startsWith('public/assets/territory/cave/playtest/') ||
    /^scripts\/check-cave-[^/]+\.(mjs|py)$/.test(p) ||
    p === 'scripts/build-cave-expedition-preview.mjs';
}
try {
  // Do not let a syntactically valid cave-only change slip into main or the second game.
  const expectedBranch = 'feat/cave-live-travel-claude';
  const actualBranch = git('branch', '--show-current');
  if (actualBranch !== expectedBranch) {
    throw new Error(`WRONG BRANCH: expected ${expectedBranch}, got ${actualBranch || '(detached HEAD)'}`);
  }
  const repoOrigin = git('remote', 'get-url', 'origin');
  if (!repoOrigin.includes('w0980077002-create/territory-game-builde')) {
    throw new Error(`WRONG REPOSITORY: expected territory-game-builde; origin is ${repoOrigin}`);
  }
  let base;
  for (const ref of ['origin/main','main']) {
    try { base = git('merge-base', ref, 'HEAD'); if (base) break; } catch { /* try next ref */ }
  }
  if (!base) throw new Error('main/origin/main unavailable; fetch main first');
  const all = new Set(git('diff', '--name-only', '--diff-filter=ACDMRT', base, 'HEAD').split('\n').filter(Boolean));
  const status = git('status','--porcelain','--untracked-files=all');
  for (const line of status.split('\n').filter(Boolean)) {
    let file = line.slice(3).trim();
    if (file.includes(' -> ')) file = file.split(' -> ').at(-1);
    if (file) all.add(file);
  }
  const bad = [...all].filter(p => !allow(p));
  if (bad.length) {
    console.error('CLAUDE CAVE SCOPE VIOLATION:');
    for (const p of bad) console.error('  NOT ALLOWED:', p);
    console.error('STOP. Do not commit or merge. Ask owner before changing files outside cave preview scope.');
    process.exit(1);
  }
  console.log(`Claude cave scope OK: ${all.size} changed file(s), no prohibited paths.`);
} catch (e) {
  console.error('Cannot prove cave scope:', e.message);
  process.exit(1);
}
