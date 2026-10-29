/** Offline TypeScript check of new Deno entrypoints using a minimal runtime shim.
 * This does not replace staging deployment or a real Telegram webhook test. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('work', { recursive: true });
writeFileSync('work/v1-edge-runtime.d.ts', `
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
declare module 'npm:@supabase/supabase-js@2.57.4' {
  export const createClient: typeof import('@supabase/supabase-js').createClient;
}
`);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict',
  '--target', 'ES2020', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--allowImportingTsExtensions', '--skipLibCheck', '--lib', 'ES2020,DOM',
  'work/v1-edge-runtime.d.ts', 'supabase/functions/territory-combat/index.ts',
  'supabase/functions/territory-stars/index.ts'], { stdio: 'inherit' });
console.log('PASS: combat/Stars Edge entrypoints offline TypeScript check; runtime staging remains required.');
