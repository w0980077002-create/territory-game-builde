/** Ship smaller world-map art to Telegram mobile without modifying originals.
 * Region cards render at 64px and their modals under 430px; huge source
 * textures cost megabytes and slow navigation in Android/iOS WebViews.
 * This runs after Vite copies public files into dist and ffmpeg is installed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const names = ['map-bg', 'map-chamber', 'map-forest', 'map-mountain', 'map-herbs', 'map-hunting', 'map-rare'];
for (const name of names) {
  const original = join('public', name + '.webp');
  const target = join('dist', name + '.webp');
  const temp = join('dist', name + '.optimized.webp');
  if (!existsSync(original) || !existsSync(target)) throw new Error('Missing world-map art: ' + name);
  try {
    const dimensions = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height', '-of', 'csv=p=0:s=x', original,
    ], { encoding: 'utf8', timeout: 15_000 }).trim();
    const [width, height] = dimensions.split('x').map(Number);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error('Invalid source dimensions: ' + dimensions);
    }
    const maxSide = name === 'map-bg' ? 1200 : name === 'map-chamber' ? 900 : 720;
    const ratio = Math.min(1, maxSide / Math.max(width, height));
    const scaledW = Math.max(2, Math.floor(width * ratio / 2) * 2);
    const scaledH = Math.max(2, Math.floor(height * ratio / 2) * 2);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', original, '-frames:v', '1',
      '-vf', 'scale=' + scaledW + ':' + scaledH + ':flags=lanczos',
      '-c:v', 'libwebp', '-q:v', '80', '-compression_level', '5', temp,
    ], { timeout: 90_000, stdio: 'pipe' });
    const sourceBytes = statSync(target).size;
    const optimizedBytes = statSync(temp).size;
    if (optimizedBytes >= 1024 && optimizedBytes < sourceBytes) {
      renameSync(temp, target);
      console.log('Map ' + name + ': ' + Math.round(sourceBytes / 1024) + ' KB -> ' +
        Math.round(optimizedBytes / 1024) + ' KB');
    } else {
      console.log('Map ' + name + ': original retained (no improvement)');
    }
  } finally {
    if (existsSync(temp)) rmSync(temp);
  }
}
