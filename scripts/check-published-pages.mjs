// Public HTTP smoke check only: does not log in or mutate real player accounts.
import assert from 'node:assert/strict';
const base = 'https://w0980077002-create.github.io/territory-game-builde/';
let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch(base, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    assert.equal(response.status, 200, 'Published homepage must respond successfully');
    const html = await response.text();
    const entry = /<script\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html)?.[1];
    assert.ok(entry, 'Published page must reference a JavaScript entry');
    const url = new URL(entry, base);
    assert.equal(url.origin, new URL(base).origin, 'Entry must use the Pages origin');
    const asset = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert.equal(asset.status, 200, 'Published JavaScript must exist');
    const source = await asset.text();
    assert.ok(source.length > 10_000, 'Entry must contain the built game');
    assert.ok(source.includes('wmyrdpbwlkzsktnhookx.supabase.co'), 'Published game must use the V1 database');
    console.log(`Published Pages HTTP smoke PASS: ${base}, entry ${url.pathname}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5_000));
  }
}
throw lastError;
