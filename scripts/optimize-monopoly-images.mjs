/** Convert bulky, unchanged Monopoly art into browser-friendly WebP at build time.
 * Originals are retained in /public for easy local development and safe rollback.
 * This is purely cosmetic: no game logic, payouts, positioning or server APIs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = ['art-atlas', 'hero-frames', 'lagoon'];
for (const name of files) {
  const from = join('public', 'monopoly', name + '.png');
  const dest = join('dist', 'monopoly', name + '.webp');
  if (!existsSync(from)) throw new Error('Original Monopoly image missing: ' + from);
  mkdirSync(join('dist', 'monopoly'), { recursive: true });
  try {
    // WebP supports alpha. Use high quality to preserve approved icon details.
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', from, '-frames:v', '1', '-c:v', 'libwebp',
      '-q:v', '87', '-compression_level', '6', dest,
    ], { timeout: 120_000, stdio: 'pipe' });
  } catch (error) {
    throw new Error('Failed to optimize Monopoly art. Do not ship missing art: ' + name + ': ' + String(error));
  }
  const original = statSync(from).size, optimized = statSync(dest).size;
  if (optimized < 1024 || optimized >= original) {
    throw new Error(`Unexpected size of ${dest}: source ${original}, output ${optimized}`);
  }
  console.log(`Monopoly artwork: ${name}.png ${Math.round(original / 1024)} KB → ${Math.round(optimized / 1024)} KB WebP`);
}
