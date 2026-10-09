import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const base = '/territory-game-builde/';

function fixPublicAssetPaths(): Plugin {
  return {
    name: 'fix-public-asset-paths',
    apply: 'build',
    closeBundle() {
      const publicDir = join(process.cwd(), 'public');
      const distDir = join(process.cwd(), 'dist');
      const assets = new Set<string>();

      function collect(dir: string) {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            collect(full);
          } else {
            assets.add(relative(publicDir, full).split(sep).join('/'));
          }
        }
      }

      function rewrite(dir: string) {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            rewrite(full);
            continue;
          }

          if (!/\.(js|css|html)$/.test(name)) continue;

          const before = readFileSync(full, 'utf8');
          let after = before;

          for (const asset of assets) {
            const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(
              `(["'])/${escaped}\\1`,
              'g'
            );

            after = after.replace(
              pattern,
              (_match, quote) => `${quote}${base}${asset}${quote}`
            );
          }

          if (after !== before) writeFileSync(full, after);
        }
      }

      collect(publicDir);
      rewrite(distDir);
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), fixPublicAssetPaths()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
