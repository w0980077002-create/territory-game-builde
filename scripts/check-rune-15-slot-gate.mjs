import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const visual = JSON.parse(readFileSync('src/game/config/territory-rune-skill-book-v1.json', 'utf8'));
const skills = visual.groups.flatMap(group => group.skills);
assert.equal(skills.length, 15);
assert.equal(new Set(skills.map(skill => skill.id)).size, 15);
assert(skills.every(skill => skill.runes.length >= 2 && skill.runes.length <= 3));
assert.equal(new Set(skills.flatMap(skill => skill.runes.map(rune => rune.id))).size, 45);

// Exercise the actual existing validator: fifteen skill-bound rune selections
// cannot be represented as a valid loadout in this five-skill contract.
const compiled = await build({ entryPoints: ['src/game/idleEngine/index.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { validateIdleLoadout } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const catalog = { skills: visual.groups.flatMap(group => group.skills.map(skill => ({ id: skill.id,
  category: group.id, unlockLevel: 1, priority: 1, levels: [{ multiplier: 1, energyCost: 0, cooldownMs: 0, windupMs: 0, effects: [] }] }))), runes: [], passives: [] };
const fifteen = { skills: skills.map(skill => ({ skillId: skill.id, level: 1, runes: [] })), passives: [] };
assert(validateIdleLoadout(fifteen, catalog).includes('slot_limit'));

// Render the real component with the build flag effectively irrelevant. It
// must not expose the old editable book for either language while gated.
const ui = await build({ entryPoints: ['src/components/builds/ServerRuneBook.tsx'], bundle: true,
  platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent', external: ['react'], alias: { '@': resolve('src') },
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'test-dependencies', setup(b) {
    b.onResolve({ filter: /^@\/game\/supabase$|^@\/game\/combatV1\/api$|^\.\/RuneSkillBook$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path.endsWith('supabase')
      ? 'export const supabase = { rpc() { throw new Error("unexpected RPC") } };'
      : args.path.endsWith('/api') ? 'export const requestCombat = () => { throw new Error("unexpected write") }; export const pendingCombatCommand = () => null;'
      : 'export function RuneSkillBook() { throw new Error("editable book exposed") }', loader: 'js' }));
  }}] });
const Module = (await import('node:module')).default;
const require = createRequire(import.meta.url);
const testModule = new Module('rune-gate-test');
testModule.paths = Module._nodeModulePaths(process.cwd());
testModule.require = require;
testModule._compile(ui.outputFiles[0].text, 'rune-gate-test.cjs');
for (const [language, expected] of [['ru', '15 слотов рун пока недоступна'], ['en', '15-slot rune system is not available yet']]) {
  const html = renderToStaticMarkup(React.createElement(testModule.exports.ServerRuneBook, { language }));
  assert(html.includes(expected), `${language} must explain the gate`);
  assert(!html.includes('<button'), `${language} must not offer an editable choice`);
}
console.log('Rune gate OK: 15 visual candidates cannot fit the current five-skill loadout; RU/EN stay unavailable.');
