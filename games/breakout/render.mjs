/**
 * 打砖块 · 霓虹渲染。只读 logic.state()，不改游戏状态。
 * 粒子/拖尾的"视觉状态"全部在本模块闭包内维护，用 view.time 做动画；刷新/重开由粒子自身寿命自然消退。
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 */
import { roundRect, drawBackdrop, glowText } from '../../shared/engine.js';

const ACCENT = '#4fc7ff';
const ACCENT2 = '#63f2b6';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const POWER_STYLE = {
  multiball: { color: '#ff5d8f', label: 'M' },
  widen: { color: '#4fc7ff', label: 'W' },
  slow: { color: '#a97bff', label: 'S' },
};

// 视觉粒子（不进逻辑状态）
let particles = [];
let prevBalls = [];
let prevBricks = [];
let prevPowerups = [];

function emit(x, y, color, n = 8, speed = 90) {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + x * 0.01;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * speed * (0.5 + ((i * 37) % 10) / 12),
      vy: Math.sin(a) * speed * (0.5 + ((i * 19) % 10) / 12),
      life: 0.5,
      max: 0.5,
      color,
      size: 2 + (i % 3),
    });
  }
  if (particles.length > 260) particles.splice(0, particles.length - 260);
}

function updateParticles(dt) {
  particles = particles.filter((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt; // 轻微重力
    p.life -= dt;
    return p.life > 0;
  });
}

function drawParticles(ctx) {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

function drawBricks(ctx, bricks, time) {
  for (const b of bricks) {
    const pulse = b.armor > 1 ? 0.75 + Math.sin(time * 3 + b.x * 0.02) * 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = b.armor > 1 ? 20 : 12;
    ctx.fillStyle = b.color;
    roundRect(ctx, b.x, b.y, b.w, b.h, 5);
    ctx.fill();
    // 顶部高光条
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, b.x + 3, b.y + 2, b.w - 6, 4, 2);
    ctx.fill();
    // 装甲砖内嵌标记
    if (b.armor > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, b.x + 5, b.y + 5, b.w - 10, b.h - 10, 3);
      ctx.stroke();
      if (b.hp === 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(b.x + b.w / 2 - 1, b.y + 6, 2, b.h - 12);
      }
    }
    ctx.restore();
  }
}

function drawPowerups(ctx, powerups, time) {
  for (const p of powerups) {
    const st = POWER_STYLE[p.kind] || POWER_STYLE.widen;
    const rot = Math.sin(time * 4 + p.x) * 0.12;
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.rotate(rot);
    ctx.shadowColor = st.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = st.color;
    roundRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a0d18';
    ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.label, 0, 1);
    ctx.restore();
  }
}

function drawBalls(ctx, balls) {
  for (const b of balls) {
    // 拖尾：越旧越淡越小
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      const k = (i + 1) / b.trail.length;
      ctx.save();
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = ACCENT2;
      ctx.shadowColor = ACCENT2;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(t.x, t.y, b.r * k * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPaddle(ctx, paddle, time) {
  ctx.save();
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 20;
  const grad = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
  grad.addColorStop(0, ACCENT);
  grad.addColorStop(0.5, '#ffffff');
  grad.addColorStop(1, ACCENT2);
  ctx.fillStyle = grad;
  roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 6);
  ctx.fill();
  ctx.restore();
}

/** 检测上一帧到这一帧消失的砖块/道具，喷粒子 */
function syncEffects(state, view) {
  const ids = new Set(state.bricks.map((b) => b.id));
  for (const b of prevBricks) {
    if (!ids.has(b.id)) emit(b.x + b.w / 2, b.y + b.h / 2, b.color, 10, 110);
  }
  const pids = new Set(state.powerups.map((p) => p.id));
  for (const p of prevPowerups) {
    if (!pids.has(p.id)) {
      const st = POWER_STYLE[p.kind] || POWER_STYLE.widen;
      emit(p.x + p.w / 2, p.y + p.h / 2, st.color, 14, 130);
    }
  }
  // 球落底：balls 数量减少或丢命时，在底部喷一簇
  const ballCount = state.balls ? state.balls.length : state.ball ? 1 : 0;
  if (ballCount < prevBalls.length) emit(prevBalls[0].x, view.h - 12, '#ff5d8f', 16, 150);

  prevBricks = state.bricks.map((b) => ({ ...b }));
  prevPowerups = state.powerups.map((p) => ({ ...p }));
  prevBalls = (state.balls || (state.ball ? [state.ball] : [])).map((b) => ({ x: b.x, y: b.y }));
}

export function render(ctx, state, view) {
  updateParticles(view.dt || 0);
  syncEffects(state, view);

  drawBackdrop(ctx, view.w, view.h, ACCENT);

  // 顶部 HUD
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(232,237,247,0.92)';
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText(`分数 ${state.score}`, 16, 26);
  ctx.textAlign = 'right';
  ctx.fillStyle = state.combo > 1 ? ACCENT2 : 'rgba(147,160,184,0.9)';
  ctx.fillText(`连击 ×${state.combo}`, view.w - 16, 26);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.9)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText(`第 ${state.level} 关   命 ${state.lives}`, view.w / 2, 46);
  ctx.restore();

  // 侧墙与底线（霓虹边框）
  ctx.save();
  ctx.strokeStyle = 'rgba(79,199,255,0.25)';
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(8, 56);
  ctx.lineTo(8, view.h - 8);
  ctx.lineTo(view.w - 8, view.h - 8);
  ctx.lineTo(view.w - 8, 56);
  ctx.stroke();
  ctx.restore();

  drawBricks(ctx, state.bricks, view.time);
  drawPowerups(ctx, state.powerups, view.time);
  drawBalls(ctx, state.balls || (state.ball ? [state.ball] : []));
  drawPaddle(ctx, state.paddle, view.time);
  drawParticles(ctx);

  if (state.stuck && !state.over) {
    glowText(ctx, '按 空格 / 点击 发球', view.w / 2, view.h / 2 + 40, {
      size: 16,
      color: 'rgba(232,237,247,0.85)',
      glow: ACCENT,
    });
  }

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,16,0.62)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
    glowText(ctx, '本局结束', view.w / 2, view.h / 2 - 12, { size: 30, color: '#e8edf7', glow: '#ff5d8f' });
    glowText(ctx, `得分 ${state.score}  ·  最高连击 ×${state.maxCombo}`, view.w / 2, view.h / 2 + 26, {
      size: 15,
      color: 'rgba(147,160,184,0.95)',
    });
  }
}
