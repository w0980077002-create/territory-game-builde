import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const boundary = readFileSync('src/components/SectionErrorBoundary.tsx', 'utf8');

assert.match(app, /<SectionErrorBoundary key=\{screen\}/,
  'A crash in one game section must not poison the next section');
assert.match(app, /onBack=\{\(\) => setScreen\('city'\)\}/,
  'Player must be able to return to the reliable city screen');
assert.match(boundary, /getDerivedStateFromError/,
  'Actual render and lazy import errors must be caught');
assert.match(boundary, /role="alert"/,
  'A failed chunk needs a readable, accessible fallback');
assert.match(boundary, /Вернуться в город/,
  'Recovery path must remain understandable to Russian players');
assert.doesNotMatch(boundary, /window\.location\.(?:reload|replace)|location\.reload/,
  'Never reload a player with potentially unsaved progress');

console.log('Section recovery PASS: lazy-screen errors stay navigable without automatic reload.');
