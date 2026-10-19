import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const viewport = read('src/game/telegram.ts');
const app = read('src/App.tsx');
const base = read('src/index.css');
const monopoly = read('src/components/monopoly/monopoly.css');
const portal = read('src/components/ui/Modal.tsx');
const forge = read('src/components/ForgeScreen.tsx');
const inventory = read('src/components/InventoryScreen.tsx');

// Read the live Telegram sheet geometry, not only a stale "stable" snapshot.
assert.match(viewport, /tg\.viewportHeight,[\s\S]*?tg\.viewportStableHeight,/);
assert.match(viewport, /window\.visualViewport\?\.height/);
assert.match(viewport, /Math\.floor\(Math\.min\(\.\.\.candidates\)\)/);
assert.match(app, /--territory-viewport-height/);
assert.match(base, /html\.territory-telegram-webapp body,[\s\S]*?overflow: hidden/);
assert.match(base, /\.territory-screen > :where\(div, section, article\)/);
assert.match(base, /\.territory-modal-panel > div:last-child\s*\{[\s\S]*?overflow-y: auto/);
assert.match(base, /\.territory-shell :where\(button, \[role="button"\]\)/);

// iOS portals are anchored to the actual game shell, never behind navigation.
assert.match(portal, /createPortal\(children, host\)/);
for (const [name, source] of [['forge', forge], ['inventory', inventory]]) {
  assert.match(source, /<IosGamePortal>/, name + ' must use shell-bound dialogs');
}
assert.match(monopoly, /\.territory-shell > \.mono-overlay\s*\{[\s\S]*?position: absolute/);
assert.match(monopoly, /\.territory-shell > \.mono-overlay \.mono-panel-body\s*\{[\s\S]*?overflow-y: auto/);
assert.match(monopoly, /\.territory-shell > \.mono-overlay \.mono-panel\s*\{[\s\S]*?overflow: hidden/);
assert.doesNotMatch(monopoly, /max\(105px|\+ 68px\)|max\(84px/);
assert.match(monopoly, /height: clamp\(280px, calc\(var\(--territory-viewport-height/);
assert.match(monopoly, /\.mono-roll-row\s*\{[\s\S]*?justify-content: center/);
assert.match(monopoly, /\.mono-celebration \.mono-cta\s*\{[\s\S]*?position: sticky/);
assert.match(forge, /className="forge-upgrade-actions"/);
assert.match(inventory, /inventory-current-section/);
console.log('Viewport layout contracts PASS: Telegram geometry, shell bounds, scrollable dialogs, centered dice, stable actions.');
