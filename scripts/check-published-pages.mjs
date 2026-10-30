// Public HTTP smoke check only: does not log in or mutate real player accounts.
import assert from 'node:assert/strict';
const base = 'https://w0980077002-create.github.io/territory-game-builde/';
let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch(base, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    assert.equal(response.status, 200, 'Published homepage must respond successfully');
    const html = await response.text();
    const expectedSha = process.env.EXPECTED_PAGES_SHA;
    if (expectedSha) {
      assert.match(expectedSha, /^[a-f0-9]{40}$/i, 'Expected Pages revision must be a Git SHA');
      const identityTag = html.match(/<meta\b[^>]*\bname=["']territory-build-sha["'][^>]*>/i)?.[0];
      const publishedSha = identityTag?.match(/\bcontent=["']([a-f0-9]{40})["']/i)?.[1];
      assert.equal(publishedSha, expectedSha,
        'Published Pages revision does not match the completed deploy workflow (stale or missing release)');
    }
    const entry = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]).find(src => { const url = new URL(src, base); return url.origin === new URL(base).origin && /\/assets\/.*\.js$/.test(url.pathname); });
    assert.ok(entry, 'Published page must reference a JavaScript entry');
    const url = new URL(entry, base);
    assert.equal(url.origin, new URL(base).origin, 'Entry must use the Pages origin');
    const asset = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert.equal(asset.status, 200, 'Published JavaScript must exist');
    const source = await asset.text();
    assert.ok(source.length > 10_000, 'Entry must contain the built game');
    assert.ok(source.includes('wmyrdpbwlkzsktnhookx.supabase.co'), 'Published game must use the V1 database');
    console.log(`Published Pages HTTP smoke PASS: ${base}, entry ${url.pathname}, revision ${expectedSha || 'not enforced'}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5_000));
  }
}
throw lastError;
