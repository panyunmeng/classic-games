/**
 * 陨石带 · 渲染。只读 logic.state()，不修改游戏状态。
 *
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 * 视觉状态（星尘、爆炸线段粒子、上一帧的陨石表）全部在本模块闭包内，
 * 用 view.time / view.dt 驱动，刷新或重开由自身寿命自然消退。
 * 环绕场地意味着实体在边界处会"半个身子"露出来：所有实体都按 forEachWrap 画接缝副本。
 */
import { drawBackdrop, glowText } from '../../shared/engine.js';

const W = 480;
const H = 640;
const TAU = Math.PI * 2;
const ACCENT = '#e2e8f0';
const ACCENT2 = '#94a3b8';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/* ── 确定性散列：形状/粒子角度都不吃随机数，重绘同帧同貌 ── */

function hash01(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 2246822507) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 3266489909) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/* ── 星尘背景（模块级固定表，随时间缓慢漂移 + 呼吸） ── */

const STAR_COUNT = 120;
const stars = [];
{
  let s = 0x51ed270b;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: next() * W,
      y: next() * H,
      r: 0.5 + next() * 1.4,
      depth: 0.25 + next() * 0.75,
      phase: next() * TAU,
      speed: 0.5 + next() * 1.7,
    });
  }
}

function drawStars(ctx, time) {
  for (const st of stars) {
    const y = (((st.y + time * 9 * st.depth) % H) + H) % H;
    const twinkle = 0.5 + 0.5 * Math.sin(time * st.speed + st.phase);
    ctx.globalAlpha = 0.14 + twinkle * 0.4 * st.depth;
    ctx.fillStyle = st.depth > 0.7 ? '#e2e8f0' : '#94a3b8';
    ctx.beginPath();
    ctx.arc(st.x, y, st.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ── 爆炸：线段粒子（纯视觉，不进逻辑状态） ── */

let particles = [];

function emitBurst(x, y, r, color, n) {
  const count = n ?? Math.round(7 + r * 0.85);
  for (let i = 0; i < count; i++) {
    const base = (TAU * i) / count;
    const jitter = hash01(i * 31 + Math.round(x) * 13 + Math.round(y) * 7) * 0.7;
    const ang = base + jitter;
    const sp = 45 + hash01(i * 97 + Math.round(r) * 11) * 150;
    const life = 0.32 + hash01(i * 53) * 0.46;
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life,
      max: life,
      len: 3 + hash01(i * 29) * 9,
      color,
    });
  }
  if (particles.length > 320) particles.splice(0, particles.length - 320);
}

function updateParticles(dt) {
  particles = particles.filter((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.994;
    p.vy *= 0.994;
    p.life -= dt;
    return p.life > 0;
  });
}

function drawParticles(ctx) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const p of particles) {
    const k = Math.max(0, p.life / p.max);
    const speed = Math.hypot(p.vx, p.vy) || 1;
    const ux = p.vx / speed;
    const uy = p.vy / speed;
    ctx.globalAlpha = k * 0.9;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1 + k * 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - ux * p.len, p.y - uy * p.len);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ── 接缝副本：实体靠近边界时在对侧再画一份 ── */

function forEachWrap(x, y, pad, fn) {
  const xs = [x];
  const ys = [y];
  if (x < pad) xs.push(x + W);
  else if (x > W - pad) xs.push(x - W);
  if (y < pad) ys.push(y + H);
  else if (y > H - pad) ys.push(y - H);
  for (const px of xs) for (const py of ys) fn(px, py);
}

/* ── 陨石：程序化不规则多边形 ── */

const ROCK_FILL = {
  3: 'rgba(30, 41, 59, 0.94)',
  2: 'rgba(51, 65, 85, 0.94)',
  1: 'rgba(71, 85, 105, 0.94)',
};

function rockPath(ctx, rock) {
  const n = rock.size === 3 ? 11 : rock.size === 2 ? 9 : 7;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 0.74 + hash01(rock.seed * 131 + i * 977) * 0.46;
    const rr = rock.r * k;
    const vx = Math.cos(a) * rr;
    const vy = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
}

function drawRock(ctx, rock) {
  forEachWrap(rock.x, rock.y, rock.r + 16, (px, py) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rock.angle);

    rockPath(ctx, rock);
    ctx.fillStyle = ROCK_FILL[rock.size] || ROCK_FILL[3];
    ctx.fill();

    ctx.shadowColor = '#cbd5e1';
    ctx.shadowBlur = rock.size === 3 ? 16 : rock.size === 2 ? 12 : 8;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
    ctx.lineWidth = rock.size === 1 ? 1 : 1.4;
    ctx.stroke();

    // 表面坑洼：位置由种子固定，不随帧抖动
    ctx.shadowBlur = 0;
    const craters = rock.size === 3 ? 3 : 2;
    for (let i = 0; i < craters; i++) {
      const a = hash01(rock.seed * 7 + i * 457) * TAU;
      const d = rock.r * (0.2 + hash01(rock.seed * 11 + i * 233) * 0.45);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, rock.r * (0.12 + hash01(rock.seed + i) * 0.1), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  });
}

/* ── 子弹：带拖尾的发光短线 ── */

function drawBullet(ctx, b) {
  const tx = b.vx * 0.035;
  const ty = b.vy * 0.035;
  forEachWrap(b.x, b.y, 28, (px, py) => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - tx, py - ty);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  });
}

/* ── 飞船：三角线框 + 发光 + 引擎焰 ── */

function drawShipAt(ctx, x, y, ship, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ship.angle);

  const blinking = ship.invuln > 0 && Math.floor(time * 14) % 2 === 0;
  ctx.globalAlpha = blinking ? 0.32 : 1;

  if (ship.thrust) {
    const flame = 11 + Math.sin(time * 46) * 4;
    const grad = ctx.createLinearGradient(-8, 0, -9 - flame, 0);
    grad.addColorStop(0, 'rgba(226, 232, 240, 0.9)');
    grad.addColorStop(1, 'rgba(148, 163, 184, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-7, -4);
    ctx.lineTo(-9 - flame, 0);
    ctx.lineTo(-7, 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.shadowColor = '#f8fafc';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-9, 8.5);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-9, -8.5);
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
  ctx.beginPath();
  ctx.arc(2, 0, 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ── 屏幕效果：陨石消失 → 爆炸；掉命 → 在上一帧船位炸开 ── */

let prevRocks = new Map();
let prevShip = { x: W / 2, y: H / 2 };
let prevLives = 3;

function syncEffects(state) {
  const alive = new Set(state.rocks.map((r) => r.id));
  for (const [id, rock] of prevRocks) {
    if (!alive.has(id)) {
      emitBurst(rock.x, rock.y, rock.r, rock.size === 3 ? '#e2e8f0' : '#cbd5e1');
    }
  }
  if (state.lives < prevLives) emitBurst(prevShip.x, prevShip.y, 26, '#fca5a5', 22);
  prevRocks = new Map(state.rocks.map((r) => [r.id, { x: r.x, y: r.y, r: r.r, size: r.size }]));
  prevLives = state.lives;
  prevShip = { x: state.ship.x, y: state.ship.y };
}

/* ── HUD ── */

function drawHud(ctx, state, w) {
  ctx.save();
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(226, 232, 240, 0.94)';
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(String(state.score).padStart(6, '0'), 18, 30);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('分数', 18, 49);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText(`第 ${state.wave} 波`, w / 2, 30);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`弹 ${state.bullets.length}/${state.maxBullets}`, w / 2, 49);

  // 命：右上角三枚小三角，失去的点暗
  for (let i = 0; i < 3; i++) {
    const alive = i < state.lives;
    ctx.save();
    ctx.translate(w - 24 - i * 20, 36);
    ctx.rotate(-Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.strokeStyle = alive ? '#e2e8f0' : 'rgba(148, 163, 184, 0.25)';
    ctx.shadowColor = alive ? '#e2e8f0' : 'transparent';
    ctx.shadowBlur = alive ? 10 : 0;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/* ── 入口 ── */

export function render(ctx, state, view) {
  const dt = Math.min(0.05, view.dt || 0);
  updateParticles(dt);
  syncEffects(state);

  drawBackdrop(ctx, view.w, view.h, ACCENT);
  drawStars(ctx, view.time);

  for (const rock of state.rocks) drawRock(ctx, rock);
  for (const b of state.bullets) drawBullet(ctx, b);
  forEachWrap(state.ship.x, state.ship.y, 40, (px, py) => drawShipAt(ctx, px, py, state.ship, view.time));
  drawParticles(ctx);
  drawHud(ctx, state, view.w);

  if (!state.over && state.waveTimer < 1.4) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (1.4 - state.waveTimer) / 0.45));
    glowText(ctx, `第 ${state.wave} 波`, view.w / 2, view.h * 0.26, {
      size: 22,
      color: '#e2e8f0',
      glow: ACCENT2,
    });
    ctx.restore();
  }
}
