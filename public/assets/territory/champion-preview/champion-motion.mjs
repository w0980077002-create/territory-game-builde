/**
 * TERRITORY champion: isolated articulated 2D combat prototype.
 * Fourteen transparent illustrated pieces are mounted on a nested SVG skeleton.
 * These real joint rotations (not whole-frame sprite swaps) are preview-only.
 */
const spriteRoot = new URL('./rig/', import.meta.url);
const sprite = (name) => new URL(name + '.webp', spriteRoot).href;

// Position (tx/ty) and angles in degrees. All angles are relative to their parent bone.
export const REST = Object.freeze({
  tx: 0, ty: 0, torso: -1, head: 0, scarf: 0,
  hipL: -8, kneeL: 4, hipR: 9, kneeR: -10,
  axeArm: -9, axeElbow: -11, axeWrist: 0,
  shieldArm: -8, shieldElbow: -17, shieldWrist: -12,
  squash: 1, lean: 0,
});

// Set each pose separately: editable animation library for later production work.
const f = (at, values = {}) => ({ at, ...values });
export const CLIPS = Object.freeze({
  idle: { title: 'Дышит и осматривается', duration: 1800, loop: true, frames: [f(0),f(.5,{ty:-3,torso:2,head:-3,scarf:8,axeArm:-13,shieldArm:-12}),f(1)] },
  walk: { title: 'Ходьба', duration: 850, loop: true, frames: [f(0,{hipL:30,hipR:-26,kneeR:20,axeArm:16,shieldArm:-22}),f(.25,{ty:-8,hipL:8,hipR:-12,kneeL:20}),f(.5,{hipL:-24,hipR:27,kneeL:26,axeArm:-18,shieldArm:22}),f(.75,{ty:-8,hipL:-10,hipR:11,kneeR:18}),f(1,{hipL:30,hipR:-26,kneeR:20,axeArm:16,shieldArm:-22})] },
  run: { title: 'Бег и работа ног', duration: 640, loop: true, frames: [f(0,{torso:19,hipL:49,hipR:-43,kneeL:10,kneeR:41,axeArm:25,shieldArm:-32,scarf:25}),f(.25,{ty:-16,torso:16,hipL:10,hipR:6,kneeL:42,kneeR:29}),f(.5,{torso:19,hipL:-41,hipR:48,kneeL:44,kneeR:7,axeArm:-25,shieldArm:32,scarf:-24}),f(.75,{ty:-17,torso:17,hipL:8,hipR:8,kneeL:28,kneeR:42}),f(1,{torso:19,hipL:49,hipR:-43,kneeL:10,kneeR:41,axeArm:25,shieldArm:-32,scarf:25})] },
  dash: { title: 'Стремительный рывок', duration: 730, frames: [f(0),f(.15,{ty:-9,tx:-19,torso:-15,hipL:-36,hipR:33,axeArm:45,scarf:28}),f(.52,{tx:65,ty:-9,torso:33,hipL:45,hipR:-47,kneeR:52,axeArm:-58,shieldArm:15,scarf:-37}),f(.75,{tx:73,torso:14,hipL:-12,hipR:18}),f(1)] },
  slash: { title: 'Быстрый удар топором', duration: 610, impact: .54, damage: 9, frames: [f(0),f(.22,{tx:-13,torso:-20,head:8,axeArm:75,axeElbow:-48,axeWrist:35,shieldArm:18,hipR:24,scarf:26}),f(.5,{tx:42,torso:24,axeArm:-93,axeElbow:25,axeWrist:-33,shieldArm:-23,hipL:29,hipR:-25,scarf:-29}),f(.68,{tx:47,torso:21,axeArm:-115,axeElbow:7,axeWrist:-45,head:-11}),f(1)] },
  slash_alt: { title: 'Удар с другой стороны', duration: 690, impact: .54, damage: 11, frames: [f(0),f(.23,{tx:-18,torso:19,axeArm:-100,axeElbow:-38,axeWrist:-30,shieldArm:20,hipL:23,scarf:19}),f(.52,{tx:54,ty:-11,torso:-26,axeArm:78,axeElbow:35,axeWrist:25,hipR:-30,shieldArm:-29,scarf:-21}),f(.74,{tx:58,axeArm:89,axeElbow:30,head:8}),f(1)] },
  overhead: { title: 'Мощный удар сверху', duration: 1050, impact: .7, damage: 20, frames: [f(0),f(.23,{ty:-15,torso:-19,axeArm:-154,axeElbow:-41,axeWrist:22,shieldArm:18,hipL:-22,scarf:26}),f(.5,{ty:-19,tx:-18,torso:-26,axeArm:-183,axeElbow:-48,axeWrist:5,kneeL:32}),f(.72,{tx:67,ty:12,torso:37,axeArm:39,axeElbow:28,axeWrist:-30,hipL:35,hipR:-38,scarf:-44,squash:.91}),f(.84,{tx:63,ty:17,torso:26,axeArm:56}),f(1)] },
  combo: { title: 'Комбо из трёх ударов', duration: 1400, impacts: [.28,.53,.78], damage: 8, frames: [f(0),f(.14,{tx:-14,torso:-18,axeArm:68,axeElbow:-40}),f(.28,{tx:33,torso:23,axeArm:-93,axeElbow:36,scarf:-26}),f(.38,{tx:14,torso:6,axeArm:-24,axeElbow:-25}),f(.53,{tx:54,torso:-23,axeArm:89,axeElbow:29,hipL:24,hipR:-19}),f(.62,{tx:33,torso:-4,axeArm:-19,axeElbow:-23}),f(.78,{tx:78,ty:-10,torso:37,axeArm:-122,axeElbow:36,shieldArm:27,scarf:-30}),f(.89,{tx:58,torso:21,axeArm:-87}),f(1)] },
  critical: { title: 'Чемпионский критический удар', duration: 1230, impact: .7, damage: 28, frames: [f(0),f(.2,{tx:-26,ty:10,torso:-22,axeArm:114,axeElbow:-42,shieldArm:30,hipR:39}),f(.43,{tx:-35,ty:-37,torso:-35,axeArm:152,axeElbow:-49,head:10,scarf:39,hipL:-45,kneeL:43}),f(.7,{tx:81,ty:-24,torso:51,axeArm:-152,axeElbow:47,axeWrist:-35,shieldArm:-54,hipR:-42,scarf:-48}),f(.84,{tx:83,ty:8,torso:29,axeArm:-104,axeElbow:16}),f(1)] },
  guard: { title: 'Защита щитом', duration: 750, frames: [f(0),f(.24,{ty:10,torso:-11,shieldArm:-57,shieldElbow:-73,shieldWrist:-11,axeArm:35,axeElbow:-45,kneeL:31,kneeR:31,squash:.95}),f(.75,{ty:12,torso:-13,shieldArm:-64,shieldElbow:-79,shieldWrist:-6,axeArm:37,kneeL:34,kneeR:31,squash:.94}),f(1)] },
  parry: { title: 'Отражение атаки', duration: 720, frames: [f(0),f(.23,{torso:-18,shieldArm:-87,shieldElbow:-62,shieldWrist:18,ty:8}),f(.45,{torso:14,shieldArm:-125,shieldElbow:-37,shieldWrist:34,tx:20,head:-9}),f(.73,{torso:-13,shieldArm:-59,shieldElbow:-54,tx:16}),f(1)] },
  counter: { title: 'Контратака после блока', duration: 1020, impact: .68, damage: 16, frames: [f(0),f(.23,{ty:12,torso:-15,shieldArm:-74,shieldElbow:-70,axeArm:59}),f(.48,{torso:-27,tx:-13,axeArm:92,axeElbow:-49,shieldArm:-68}),f(.68,{tx:61,torso:30,axeArm:-103,axeElbow:36,shieldArm:10,hipL:27,scarf:-22}),f(.8,{tx:51,torso:23}),f(1)] },
  dodge: { title: 'Уклонение от удара', duration: 840, frames: [f(0),f(.22,{tx:-46,ty:29,torso:-38,head:20,hipL:48,hipR:-37,kneeL:46,axeArm:45,shieldArm:31,squash:.9}),f(.5,{tx:-74,ty:35,torso:-50,head:28,hipL:61,hipR:-46,kneeL:65,scarf:38,squash:.88}),f(.76,{tx:-43,ty:6,torso:18,hipL:-20,hipR:25}),f(1)] },
  jump: { title: 'Прыжок', duration: 960, frames: [f(0),f(.16,{ty:21,torso:13,hipL:26,hipR:-25,kneeL:40,kneeR:39,squash:.88}),f(.42,{ty:-85,torso:-8,hipL:40,hipR:-30,kneeL:64,kneeR:65,axeArm:-70,shieldArm:-21,scarf:36}),f(.64,{ty:-81,torso:7,hipL:-20,hipR:22,kneeL:43,kneeR:58}),f(.88,{ty:12,torso:19,hipL:30,hipR:-20,kneeL:34,squash:.86}),f(1)] },
  recoil: { title: 'Получает удар', duration: 740, ownDamage: 15, frames: [f(0),f(.16,{tx:-31,ty:-12,torso:-32,head:22,axeArm:38,shieldArm:33,hipR:35,scarf:22}),f(.38,{tx:-48,ty:10,torso:-48,head:30,shieldArm:54,axeArm:57,kneeR:40}),f(.65,{tx:-23,ty:9,torso:-18,axeArm:20}),f(1)] },
  stagger: { title: 'Пошатнулся', duration: 1110, ownDamage: 8, frames: [f(0),f(.18,{tx:-29,torso:-38,head:22,axeArm:39,shieldArm:31}),f(.37,{tx:-45,ty:14,torso:21,head:-22,hipR:41,kneeR:47}),f(.6,{tx:-22,torso:-29,head:20,hipL:-27}),f(.8,{tx:-11,torso:18,head:-15}),f(1)] },
  knockdown: { title: 'Падение', duration: 1400, ownDamage: 24, hold: true, frames: [f(0),f(.24,{tx:-16,ty:18,lean:13,torso:-22,head:13,hipL:32,hipR:-17}),f(.51,{tx:39,ty:90,lean:53,torso:8,head:7,axeArm:41,shieldArm:27,hipR:34,kneeR:37,scarf:32}),f(.77,{tx:96,ty:165,lean:84,torso:0,head:0,axeArm:55,shieldArm:37,hipL:-15,hipR:18,kneeL:30,kneeR:35,scarf:12,squash:.97}),f(1,{tx:96,ty:165,lean:84,torso:0,head:0,axeArm:55,shieldArm:37,hipL:-15,hipR:18,kneeL:30,kneeR:35,scarf:12,squash:.97})] },
  rise: { title: 'Поднимается на ноги', duration: 1280, heal: 16, frames: [f(0,{tx:96,ty:165,lean:84,torso:0,head:0,axeArm:55,shieldArm:37,hipL:-15,hipR:18,kneeL:30,kneeR:35,scarf:12,squash:.97}),f(.3,{tx:54,ty:94,lean:53,torso:-12,head:7,axeArm:58,shieldArm:35,hipL:48,kneeL:48}),f(.61,{tx:15,ty:30,lean:14,torso:-22,head:7,axeArm:39,shieldArm:12,hipL:31,kneeR:38}),f(1)] },
  victory: { title: 'Победа чемпиона!', duration: 1550, frames: [f(0),f(.22,{ty:-16,torso:-13,axeArm:-115,axeElbow:-29,shieldArm:-28,head:-10,scarf:25}),f(.45,{ty:-20,torso:-7,axeArm:-169,axeElbow:-10,axeWrist:25,shieldArm:-55,head:-13,scarf:-18}),f(.8,{ty:-11,torso:-5,axeArm:-169,axeElbow:-10,shieldArm:-59,head:-9}),f(1)] },
  defeat: { title: 'Поражение', duration: 1600, hold: true, frames: [f(0),f(.25,{tx:-9,ty:20,lean:22,torso:-26,head:14,axeArm:42,hipR:29}),f(.52,{tx:50,ty:101,lean:59,torso:5,head:5,axeArm:60,shieldArm:38,hipL:24,hipR:25,kneeR:42}),f(.78,{tx:96,ty:165,lean:84,torso:0,head:0,axeArm:68,shieldArm:42,hipL:-15,hipR:18,kneeL:30,kneeR:35,scarf:12,squash:.97}),f(1,{tx:96,ty:165,lean:84,torso:0,head:0,axeArm:68,shieldArm:42,hipL:-15,hipR:18,kneeL:30,kneeR:35,scarf:12,squash:.97})] },
});

export function sampleClip(clip, progress) {
  if (!clip || !Array.isArray(clip.frames) || clip.frames.length < 2) throw new Error('Invalid animation clip');
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  const frames = clip.frames;
  let a = frames[0];
  let b = frames[frames.length - 1];
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i].at) { a = frames[i - 1]; b = frames[i]; break; }
  }
  const fraction = a === b ? 0 : (t - a.at) / (b.at - a.at);
  // smoothstep avoids harsh mechanical changes when passing a key pose.
  const ease = fraction * fraction * (3 - 2 * fraction);
  const pose = {};
  for (const key of Object.keys(REST)) {
    const left = Number.isFinite(a[key]) ? a[key] : REST[key];
    const right = Number.isFinite(b[key]) ? b[key] : REST[key];
    pose[key] = left + (right - left) * ease;
  }
  return pose;
}

const animationButtons = [
  ['walk', '🚶 Ходьба'], ['run', '🏃 Бег'], ['dash', '💨 Рывок'],
  ['slash', '🪓 Удар I'], ['slash_alt', '⚔️ Удар II'], ['overhead', '💥 Сверху'],
  ['combo', '🔥 Комбо ×3'], ['critical', '🌟 Критический'], ['jump', '🦘 Прыжок'],
  ['guard', '🛡️ Блок'], ['parry', '✨ Парирование'], ['counter', '⚡ Контратака'],
  ['dodge', '🌪 Уклонение'], ['recoil', '🩹 Получил удар'], ['stagger', '😵 Пошатнулся'],
  ['knockdown', '💢 Падение'], ['rise', '💪 Подъём'], ['victory', '🏆 Победа'],
  ['defeat', '☠️ Поражение'], ['idle', '🫁 Дыхание'],
];

export const AUTO_SEQUENCE = Object.freeze([
  'walk', 'run', 'dash', 'slash', 'slash_alt', 'guard', 'parry', 'counter',
  'dodge', 'jump', 'combo', 'recoil', 'overhead', 'stagger', 'critical', 'victory',
]);

function imageMarkup(asset, x, y, w, h) {
  return `<image href="${sprite(asset)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
}

// Back-to-front: legs, rear buckler arm, torso, head/scarf, axe arm.
// Each group is a bone and its nested groups are descendants/joints.
export function buildRigMarkup() {
  return `
    <g id="champion-root">
      <g id="champion-back-leg" transform="translate(-40 66)">
        ${imageMarkup('part-10',-38,-3,88,91)}
        <g id="champion-back-knee" transform="translate(-1 77)">${imageMarkup('part-11',-40,-10,91,89)}</g>
      </g>
      <g id="champion-front-leg" transform="translate(40 68)">
        ${imageMarkup('part-08',-48,-5,90,93)}
        <g id="champion-front-knee" transform="translate(-15 79)">${imageMarkup('part-09',-41,-8,94,88)}</g>
      </g>
      <g id="champion-rear-arm" transform="translate(-68 -60)">
        ${imageMarkup('part-06',-24,-12,91,93)}
        <g id="champion-shield-elbow" transform="translate(49 65)">
          ${imageMarkup('part-07',-38,-4,93,90)}
        </g>
      </g>
      <g id="champion-torso" transform="rotate(-1)">
        ${imageMarkup('part-03',-82,53,165,108)}
        ${imageMarkup('part-01',-84,-104,169,178)}
        <g id="champion-shield-wrist" transform="translate(-82 9)">
          ${imageMarkup('tool-01',-47,-45,92,92)}
        </g>
        <g id="champion-scarf" transform="translate(-9 -99)">
          ${imageMarkup('part-02',-83,-24,174,96)}
        </g>
        <g id="champion-head" transform="translate(19 -88)">
          ${imageMarkup('part-00',-54,-119,115,130)}
        </g>
        <g id="champion-axe-arm" transform="translate(68 -59)">
          ${imageMarkup('part-04',-68,-8,91,93)}
          <g id="champion-axe-elbow" transform="translate(-47 63)">
            ${imageMarkup('part-05',-31,-9,93,95)}
            <g id="champion-axe-wrist" transform="translate(26 64)">
              ${imageMarkup('tool-00',-39,-133,147,145)}
            </g>
          </g>
        </g>
      </g>
    </g>
  `;
}

const rotate = (id, angle) => document.getElementById(id)?.setAttribute('transform', `rotate(${angle.toFixed(2)})`);
const translateRotate = (id, x, y, angle) => document.getElementById(id)?.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)})`);

function drawPose(pose, now) {
  const breathing = Math.sin(now / 480) * 1.55;
  translateRotate('fighter-motion', pose.tx, pose.ty + breathing, pose.lean);
  const root = document.getElementById('champion-root');
  root?.setAttribute('transform', `scale(1 ${pose.squash.toFixed(3)})`);
  translateRotate('champion-back-leg', -40, 66, pose.hipR);
  translateRotate('champion-back-knee', -1, 77, pose.kneeR);
  translateRotate('champion-front-leg', 40, 68, pose.hipL);
  translateRotate('champion-front-knee', -15, 79, pose.kneeL);
  translateRotate('champion-rear-arm', -68, -60, pose.shieldArm);
  translateRotate('champion-shield-elbow', 49, 65, pose.shieldElbow);
  translateRotate('champion-shield-wrist', -82, 9, pose.shieldWrist + pose.shieldArm * .55 + pose.shieldElbow * .2);
  rotate('champion-torso', pose.torso + breathing * .35);
  translateRotate('champion-head', 19, -88, pose.head - breathing * .3);
  translateRotate('champion-scarf', -9, -99, pose.scarf - breathing * 1.3);
  translateRotate('champion-axe-arm', 68, -59, pose.axeArm);
  translateRotate('champion-axe-elbow', -47, 63, pose.axeElbow);
  translateRotate('champion-axe-wrist', 26, 64, pose.axeWrist);
}

function mountPreview() {
  const rigHost = document.getElementById('fighter-motion');
  const controls = document.getElementById('move-buttons');
  if (!rigHost || !controls) return;
  rigHost.innerHTML = buildRigMarkup();
  const demo = document.getElementById('demo-toggle');
  const state = document.getElementById('animation-state');
  const enemyHP = document.getElementById('enemy-hp');
  const championHP = document.getElementById('champion-hp');
  const enemyMotion = document.getElementById('enemy-motion');
  const effects = document.getElementById('hit-effects');
  const buttons = new Map();

  let move = 'idle';
  let start = performance.now();
  let autoplay = false;
  let demoIndex = 0;
  let enemyHealth = 100;
  let heroHealth = 100;
  let registeredHits = 0;
  let impactAt = -Infinity;
  let lastFrameRender = -Infinity;

  for (const [key,label] of animationButtons) {
    const button = document.createElement('button');
    button.className = 'move-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => { setAutoplay(false); play(key,performance.now()); });
    controls.append(button);
    buttons.set(key,button);
  }

  function updateHP() {
    enemyHP.style.width = `${Math.max(0,enemyHealth)}%`;
    championHP.style.width = `${Math.max(0,heroHealth)}%`;
  }

  function setAutoplay(next) {
    autoplay = next;
    demo.classList.toggle('playing',autoplay);
    demo.textContent = autoplay ? '❚❚ ОСТАНОВИТЬ ПОКАЗ' : '▶ СМОТРЕТЬ ЖИВОЙ БОЙ';
    if (autoplay) { demoIndex = 0; enemyHealth = 100; heroHealth = 100; updateHP(); play(AUTO_SEQUENCE[0],performance.now()); }
  }

  function play(key,now) {
    if (!CLIPS[key]) return;
    move = key;
    start = now;
    registeredHits = 0;
    buttons.forEach((button,name) => button.classList.toggle('active',name===move));
    state.textContent = CLIPS[key].title;
    if (CLIPS[key].ownDamage) heroHealth = Math.max(1,heroHealth - CLIPS[key].ownDamage);
    if (CLIPS[key].heal) heroHealth = Math.min(100,heroHealth + CLIPS[key].heal);
    if (key==='defeat') heroHealth=0;
    updateHP();
  }

  demo.addEventListener('click', () => setAutoplay(!autoplay));
  document.getElementById('reset-fight')?.addEventListener('click', () => {
    setAutoplay(false);
    enemyHealth=100; heroHealth=100; updateHP(); play('idle',performance.now());
  });

  function tick(now) {
    // Limit expensive SVG updates to a maximum of 60fps, adapting to device speed.
    if (now - lastFrameRender < 15) { requestAnimationFrame(tick); return; }
    lastFrameRender = now;
    const clip = CLIPS[move];
    const duration = clip.duration;
    let progress = (now-start) / duration;
    if (progress >= 1) {
      if (clip.hold && !autoplay) {
        progress=1;
      } else if (clip.loop && !autoplay) {
        start += Math.floor(progress)*duration;
        progress %= 1;
      } else if (autoplay) {
        if (demoIndex===AUTO_SEQUENCE.length-1) {
          enemyHealth=100; heroHealth=100; updateHP(); demoIndex=0;
        } else demoIndex++;
        play(AUTO_SEQUENCE[demoIndex],now);
        progress=0;
      } else if (move !== 'idle') {
        play('idle',now);
        progress=0;
      } else { start=now; progress=0; }
    }

    const current = CLIPS[move];
    const hits = current.impacts ?? (current.impact===undefined?[]:[current.impact]);
    for (let i=registeredHits;i<hits.length;i++) {
      if (progress<hits[i]) break;
      registeredHits++;
      impactAt=now;
      enemyHealth=Math.max(0,enemyHealth-(current.damage||8));
      updateHP();
    }
    const pose = sampleClip(current,progress);
    // Secondary cloth/head movement lags behind action, rather than rotating the entire picture.
    pose.scarf += Math.sin(now / 123) * (move==='idle'?3:6);
    pose.head += Math.sin(now / 470) * .75;
    drawPose(pose,now);

    const elapsedImpact=now-impactAt;
    if (elapsedImpact>=0 && elapsedImpact<235) {
      const strength=1-elapsedImpact/235;
      effects?.setAttribute('opacity',String(strength));
      enemyMotion?.setAttribute('transform',`translate(${(strength*18).toFixed(1)} ${(-strength*9).toFixed(1)}) rotate(${(strength*8).toFixed(1)} 383 380)`);
    } else {
      effects?.setAttribute('opacity','0');
      enemyMotion?.setAttribute('transform',`translate(0 ${Math.sin(now/480)*1.5})`);
    }
    requestAnimationFrame(tick);
  }

  // Do not run a second frame loop if the page is hidden; resume seamlessly when visible.
  document.addEventListener('visibilitychange',()=> { if (!document.hidden) start=performance.now(); });
  updateHP();
  play('idle',start);
  requestAnimationFrame(tick);
}

if (typeof document !== 'undefined') mountPreview();
