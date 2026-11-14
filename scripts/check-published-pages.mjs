// Public HTTP smoke check only: does not log in or mutate real player accounts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    if (expectedSha) {
      // Real published binary check, not a source-code or CI-green assumption.
      const frameUrl = new URL('assets/territory/ui/honors/mortarion-lord-approved.avif',base);
      const frameResponse = await fetch(frameUrl,{ signal:AbortSignal.timeout(20_000), cache:'no-store' });
      assert.equal(frameResponse.status,200,'Approved transparent Mortarion frame missing from published game');
      const bytes = Buffer.from(await frameResponse.arrayBuffer());
      assert.equal(bytes.length,10787);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),
        '7830e264d961ba609d62f87fbee9b80258e34600f52ca1a15955a38f1b936624',
        'Published Mortarion frame must be the owner-approved pixels, not previous art');
    }
    console.log(`Published Pages HTTP smoke PASS: ${base}, entry ${url.pathname}, revision ${expectedSha || 'not enforced'}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5_000));
  }
}
throw lastError;
