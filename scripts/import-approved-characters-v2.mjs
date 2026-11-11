#!/usr/bin/env node
/**
 * Import owner-approved TERRITORY v2 art, without replacing any live sprites.
 * Usage: node scripts/import-approved-characters-v2.mjs /path/to/TERRITORY_21_CHARACTERS_QA_PACK_2026-11-11_v2.zip [--dry-run]
 *
 * This script does not animate, wire up gameplay or change economy/progress.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const EXPECTED_ZIP_SHA256 = 'd8bd7c242accd3396232a53cae7fe47478c4b6aae558b95dbad0c68edf5c1fa1';
const folder = 'TERRITORY_ART_PACK_2026-11-11_v2';
const input = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!input || input.startsWith('--')) {
  console.error('Usage: node scripts/import-approved-characters-v2.mjs /absolute/path/to/v2.zip [--dry-run]');
  process.exit(2);
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function fail(message) { throw new Error(message); }
function checkPath(base, path) {
  const dest = resolve(base, path);
  if (!dest.startsWith(resolve(base) + '/')) fail('Unsafe ZIP pathname: ' + path);
  return dest;
}
const source = resolve(input);
if (!existsSync(source)) fail('Missing v2 asset ZIP: ' + source);
const zipSha = sha(readFileSync(source));
if (zipSha !== EXPECTED_ZIP_SHA256) fail('Wrong ZIP SHA256: ' + zipSha + ' (expected v2)');
const temp = mkdtempSync(join(tmpdir(), 'territory-approved-art-'));
try {
  const names = execFileSync('unzip', ['-Z1', source], { encoding: 'utf8', maxBuffer: 3e6 }).trim().split('\n');
  for (const name of names) if (name && !name.endsWith('/')) checkPath(temp, name);
  execFileSync('unzip', ['-qq', source, '-d', temp], { stdio: 'pipe' });
  const root = join(temp, folder);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  if (manifest.files.length !== 21) fail('Expected 21 characters, got ' + manifest.files.length);
  const tasks = [];
  const refs = new Set();
  const seen = new Set();
  for (const item of manifest.files) {
    const { category, id, master, still_preview, owner_reference } = item;
    if (!/^[a-z0-9_]+$/.test(id) || !/^(heroes|companions|enemies|minibosses|bosses|special)$/.test(category)) fail('Bad character id/category');
    if (seen.has(category + '/' + id)) fail('Duplicate character: ' + id);
    seen.add(category + '/' + id);
    const masterPath = checkPath(root, master), webpPath = checkPath(root, still_preview);
    const pngBytes = readFileSync(masterPath), webpBytes = readFileSync(webpPath);
    if (sha(pngBytes) !== item.sha256) fail('Master hash mismatch: ' + category + '/' + id);
    if (pngBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('Not PNG: ' + id);
    if (webpBytes.toString('ascii', 0, 4) !== 'RIFF' || webpBytes.toString('ascii', 8, 12) !== 'WEBP') fail('Not WebP: ' + id);
    tasks.push([masterPath, join('docs/art-reference/approved-characters-20261111', category, id + '.png')]);
    // WebP stop-frame preview is NOT an animation. Use new, non-live namespace.
    tasks.push([webpPath, join('public/assets/territory/cave-expedition/characters-v2', category, id, 'idle-still.webp')]);
    refs.add(owner_reference);
  }
  // Preserve all owner originals, including the excluded crowned-goose reference.
  const originals = readdirSync(join(root, '03_original_owner_references'));
  if (originals.length !== 10) fail('Expected 10 owner originals');
  for (const ref of refs) if (!originals.includes(ref)) fail('Missing reference: ' + ref);
  for (const ref of originals) {
    const file = checkPath(root, '03_original_owner_references/' + ref);
    if (!existsSync(file)) fail('Missing reference: ' + ref);
    tasks.push([file, join('docs/art-reference/approved-characters-20261111/originals', ref)]);
  }
  tasks.push([join(root, 'manifest.json'), 'docs/art-reference/approved-characters-20261111/manifest.json']);
  for (const file of ['qa.csv', 'README_RU.md', 'V2_CHANGELOG_RU.md', 'HANDOFF_CODEX_CLAUDE_RU.md', 'validate_art_pack.py']) {
    tasks.push([join(root, file), join('docs/art-reference/approved-characters-20261111', file)]);
  }
  for (const [, target] of tasks) {
    if (existsSync(target)) fail('Refusing to overwrite existing file: ' + target);
  }
  console.log((dryRun ? 'DRY RUN' : 'IMPORT') + ': verified v2 SHA256, 21 PNG, 21 WebP, ' + originals.length + ' originals (' + refs.size + ' referenced).');
  if (!dryRun) {
    for (const [src, target] of tasks) { mkdirSync(dirname(target), { recursive: true }); copyFileSync(src, target); }
    console.log('Wrote ' + tasks.length + ' NEW files. No existing live assets replaced.');
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
