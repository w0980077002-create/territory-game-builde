import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Isolated client contract, with every Supabase call replaced by local data.
const result = await build({
  entryPoints: ['src/game/auctionApi.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm',
  plugins: [{ name: 'no-network-supabase', setup(bundler) {
    bundler.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'mock', namespace: 'mock' }));
    bundler.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
      contents: 'export const supabase = {rpc: (...args) => globalThis.__auctionRpcMock(...args)};',
      loader: 'js',
    }));
  } }],
});
const code = Buffer.from(result.outputFiles[0].text).toString('base64');
const { withAuctionDeadline, submitAuctionAction, AuctionTradeError } = await import('data:text/javascript;base64,' + code);
const op = '20000000-0000-4000-8000-000000000001';
const lot = '30000000-0000-4000-8000-000000000001';

assert.equal(await withAuctionDeadline(Promise.resolve('ok'), 50), 'ok');
await assert.rejects(withAuctionDeadline(Promise.reject(new Error('offline')), 50), /offline/);
await assert.rejects(withAuctionDeadline(new Promise(() => {}), 15), /auction_request_timeout/);

let rpcName = '', args;
globalThis.__auctionRpcMock = (name, payload) => {
  rpcName = name;
  args = payload;
  return Promise.resolve({ data: { success: true, action: 'buy' }, error: null });
};
await submitAuctionAction({ action: 'buy', listingId: lot }, op);
assert.equal(rpcName, 'territory_auction_trade_v1');
assert.deepEqual(args, { p_action: 'buy', p_operation: op, p_listing: lot });
await assert.rejects(submitAuctionAction({ action: 'buy', listingId: 'bad' }, op), /invalid_listing/);

globalThis.__auctionRpcMock = () => Promise.resolve({ data: null, error: { code: 'P0001', message: 'not_listing_owner' } });
await assert.rejects(submitAuctionAction({ action: 'buy', listingId: lot }, op),
  error => error instanceof AuctionTradeError && error.rejected,
  'Explicit SQL rejection is safe to release; ambiguous network failures are not');
globalThis.__auctionRpcMock = () => Promise.reject(new Error('network_down'));
await assert.rejects(submitAuctionAction({ action: 'buy', listingId: lot }, op),
  error => !(error instanceof AuctionTradeError) && /network_down/.test(error.message));

const api = readFileSync('src/game/auctionApi.ts', 'utf8');
const ui = readFileSync('src/components/AuctionScreen.tsx', 'utf8');
assert.match(ui, /const marketUnavailable = !auctionLoading && auction\?\.enabled !== true && !pendingOperation/,
  'Only hide unavailable trade controls after status resolves, preserving pending recoveries');
assert.doesNotMatch(ui, /if \(marketUnavailable && tab !== 'chat'\) setTab\('chat'\)/,
  'Unavailable trading must not force players out of their selected tab');
assert.match(ui, /<div className="grid grid-cols-4 gap-1\.5" role="tablist"/,
  'All four Auction tabs stay navigable even when trading is unavailable');
assert.doesNotMatch(ui, /\{!marketUnavailable && <div/,
  'The tab rail must never disappear based on trade service availability');
assert.match(ui, /if \(tradeLock\.current \|\| !recoveryReady \|\| !auction\?\.enabled\) return;/,
  'Showing the tabs must not unlock trade actions without server permission');
assert.match(ui, /\{marketUnavailable && \([\s\S]*?<p role="status"/,
  'Display honest trading status without inventing listings');

assert.match(api, /withAuctionDeadline\(supabase\.rpc\('territory_auction_overview_v1'/,
  'A hung catalog should not freeze the auction screen');
assert.match(api, /withAuctionDeadline\(supabase\.rpc\('territory_auction_trade_v1'[\s\S]*?15_000\)/,
  'A hung trade must return control with an ambiguous result');
assert.match(ui, /await keepPendingAuction\(op\);[\s\S]*?await submitAuctionAction\(op\.action, op\.id\)/,
  'Persist idempotency UUID before starting the trade');
assert.match(ui, /Result unconfirmed\. Retry the saved operation/,
  'Ambiguous requests must not silently generate a new operation');
assert.doesNotMatch(api, /saveCloudSave|useGame\.set|player\.gold\s*=/,
  'Auction code must not issue client-authoritative wallet mutations');

delete globalThis.__auctionRpcMock;
console.log('Auction client PASS: deadlines, rejected vs ambiguous trades, UUID replay and no client wallet writes.');
