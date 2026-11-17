import { useEffect, useRef } from 'react';
import frames from '@/game/goose/frames.json';
import type { GooseAction } from '@/game/goose/brain';
import './gooseCompanion.css';

const artCache = new Map<string, HTMLImageElement>();
function cachedArt(name: string): HTMLImageElement {
  let img = artCache.get(name);
  if (!img) { img = new Image(); img.src = import.meta.env.BASE_URL + `art/${name}.webp`; artCache.set(name, img); }
  return img;
}

/** Original VIKING atlas rectangles AND foot pivots: no collage crop, no
 * stretching cells to the same width. Animation never resolves combat. */
export function GooseCompanion({ action = 'idle', sequence = 0, speed = 1, en = false, portrait = false }: {
  action?: GooseAction; sequence?: number; speed?: number; en?: boolean; portrait?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const pose = cachedArt('animation-allies'); const run = cachedArt('run-goose_aviator');
    const fallback = cachedArt('goose_aviator');
    let raf = 0; let lastDraw = -Infinity; const start = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (now: number) => {
      if (now - lastDraw < (action === 'idle' ? 66 : 32)) { raf = requestAnimationFrame(draw); return; }
      lastDraw = now;
      const t = Math.max(0, now - start) / 1000 * Math.min(4, Math.max(.5, speed));
      const moving = action === 'run' || ((action === 'attack' || action === 'commotion') && t < .22);
      const set = moving ? frames.run : frames.poses;
      let index = moving ? Math.floor(t * 12) % 8 : 0;
      if (!moving) {
        if (['attack', 'dive', 'commotion'].includes(action) && t < .8) index = t < .32 ? 3 : t < .52 ? 4 : 5;
        else if (['hug', 'honk', 'victory'].includes(action)) index = 3;
        else if (action === 'hit' && t < .7) index = 6;
        else if (action === 'defeat') index = 7;
        else if (action === 'cower' && t < 1.2) index = 6;
        else index = reduced ? 0 : Math.floor(t * 1.7) % 9 === 4 ? 2 : 0;
      }
      const f = set.frames[index]; const img = moving ? run : pose;
      ctx.clearRect(0, 0, c.width, 360);
      if (img.complete && img.naturalWidth) {
        const [x, y, w, h] = f.rect; const scale = 245 / set.height;
        const travel = reduced ? 0 : ['attack', 'commotion'].includes(action) ? Math.sin(Math.min(1, t / .8) * Math.PI) * 35 : action === 'dive' ? Math.sin(Math.min(1, t / .8) * Math.PI) * 52 : 0;
        const bob = reduced || action === 'defeat' ? 0 : Math.sin(t * 3) * 2;
        ctx.save(); ctx.translate((portrait ? 154 : 220) + travel, 330 + bob - (action === 'dive' ? travel : 0));
        if (action === 'victory' && !reduced) ctx.translate(0, -Math.abs(Math.sin(t * 5)) * 9);
        ctx.drawImage(img, x, y, w, h, -f.pivot[0] * scale, -f.pivot[1] * scale, w * scale, h * scale);
        ctx.restore();
      } else if (fallback.complete && fallback.naturalWidth) {
        const width = 245 * fallback.naturalWidth / fallback.naturalHeight;
        ctx.drawImage(fallback, (portrait ? 154 : 220) - width / 2, 85, width, 245);
      }
      if (reduced && img.complete && img.naturalWidth) return;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); };
  }, [action, sequence, speed, portrait]);
  const label = action === 'hug' ? (en ? 'Hug!' : 'Обнимусь!') : action === 'dive' ? (en ? 'Dive!' : 'Пике!') : action === 'commotion' ? (en ? 'Commotion!' : 'Переполох!') : ['honk', 'victory'].includes(action) ? (en ? 'HONK!' : 'ГА-ГА!') : action === 'cower' ? '?!' : '';
  return <span className="goose-companion" data-action={action} data-sequence={sequence}>
    <canvas ref={canvas} width={portrait ? 320 : 480} height={360} role="img" aria-label={en ? 'Goose Hugger' : 'Гусь-Обнимусь'} />
    {label && <b key={`${action}-${sequence}`} className="goose-companion__call">{label}</b>}
  </span>;
}
