// Ensures the Pages artifact is tied to the exact commit GitHub Actions built.
// Does not touch accounts, Supabase or runtime game state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sha = process.env.GITHUB_SHA;
if (!sha) {
  console.log('Pages revision check skipped outside GitHub Actions (GITHUB_SHA not set).');
} else {
  assert.match(sha, /^[a-f0-9]{40}$/i, 'GitHub build SHA must be a full commit ID');
  const html = readFileSync('dist/index.html', 'utf8');
  const tag = html.match(/<meta\b[^>]*\bname=["']territory-build-sha["'][^>]*>/i)?.[0];
  assert.ok(tag, 'Built Pages HTML must include a source revision meta tag');
  const actual = tag.match(/\bcontent=["']([a-f0-9]{40})["']/i)?.[1];
  assert.equal(actual, sha, 'Pages artifact must identify the exact GitHub commit being built');
  console.log(`Pages artifact revision PASS: ${actual}`);
}
