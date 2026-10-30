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
assert.match(app, /import \{ MapScreen \} from '@\/components\/MapScreen'/,
  'Map must be included in the main bundle to avoid stale Telegram lazy chunk 404s');
assert.doesNotMatch(app, /const MapScreen = lazy\(/,
  'Map should not rely on a deferred chunk across rapid production deployments');
assert.match(boundary, /Открыть раздел повторно/,
  'A transient failure must offer an in-app retry without losing unsaved progress');
assert.match(readFileSync('src/components/WorldMapCanvas.tsx', 'utf8'), /typeof ResizeObserver === 'undefined'/,
  'The world map needs an older WebView resize fallback');
assert.match(boundary, /role="alert"/,
  'A failed chunk needs a readable, accessible fallback');
assert.match(boundary, /Вернуться в город/,
  'Recovery path must remain understandable to Russian players');
assert.doesNotMatch(boundary, /window\.location\.(?:reload|replace)|location\.reload/,
  'Never reload a player with potentially unsaved progress');

console.log('Section recovery PASS: lazy-screen errors stay navigable without automatic reload.');
