// Non-mutating regression checks for the Treasury opening presentation.
// In particular, the server receipt remains the only source of reward truth.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const treasury = readFileSync('src/components/TreasuryInventory.tsx', 'utf8');
const css = readFileSync('src/components/fortune.css', 'utf8');
const dialog = readFileSync('src/components/FortuneDialog.tsx', 'utf8');

assert.match(treasury, /playFortune\(userId,kind\)/, 'the existing server reward action must remain');
assert.match(treasury, /acknowledgeFortune\(userId,state\.receipt\.id\)/, 'the existing receipt acknowledgement must remain');
assert.match(treasury, /state\?\.receipt&&<FortuneDialog/, 'only a server-confirmed receipt may open the visual');
assert.match(treasury, /closeDisabled=\{opening\|\|busy\}/, 'do not close while opening or acknowledging');
assert.match(treasury, /fortune-chest-base/, 'the base must have an independent visual layer');
assert.match(treasury, /fortune-chest-lid/, 'the lid must have an independent visual layer');
assert.match(treasury, /fortune-chest-aura/, 'reward light should be visible on opening');
assert.match(treasury, /role="status" aria-live="polite"/, 'screen readers should hear the phase change');
assert.match(treasury, /prefers-reduced-motion: reduce/, 'honor reduced-motion preference');
assert.match(treasury, /!opening&&<h3>/, 'reward label must not be shown during the reveal');

assert.match(css, /\.fortune-chest-base\s*\{[^}]*clip-path:\s*inset\(49% 0 0 0\)/s, 'base must be clipped below the hinge');
assert.match(css, /\.fortune-chest-lid\s*\{[^}]*clip-path:\s*inset\(0 0 51% 0\)/s, 'lid must be clipped above the hinge');
assert.match(css, /\.fortune-chest-reveal\.is-opening \.fortune-chest-lid\s*\{[^}]*animation:\s*fortune-lid-rise/s, 'opening must animate the lid, not shake the whole chest');
assert.match(css, /\.fortune-chest-reveal\.is-open \.fortune-chest-lid\s*\{[^}]*rotateX\(-58deg\)/s, 'open state must keep the lid raised');
assert.match(css, /@media \(max-width:359px\)/, 'narrow WebView layout must be present');
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'reduced motion should still show an open chest');
assert.doesNotMatch(css, /\.fortune-chest-reveal img\s*\{/s, 'old generic image rules must not override the independent layers');
assert.match(dialog, /closeDisabled\?: boolean/, 'closing controls must support a locked reveal');
assert.match(dialog, /disabled=\{closeDisabled\}/, 'close buttons must visibly disable while opening');

console.log('TREASURY CHEST PASS: receipt-only reveal, hinged lid, responsive oak UI, accessible state and safe close lock');
