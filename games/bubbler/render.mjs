/**
 * 泡泡消消 · 霓虹 Canvas 渲染。
 *
 * 约束：只读 state（logic.state() 快照），不碰游戏内部变量；粒子/飘分这些纯视觉状态放在本模块闭包内，
 * 生命周期由 view.time 驱动（不自己读时钟、不自己步进），刷新/重开时它们会自然过期消失。
 * 坐标一律用 logic.mjs 导出的几何常量：渲染与逻辑只有一份真值，避免两边算错半格。
 */
import { drawBackdrop, glowText, roundRect } from '../../shared/engine.js';
import {
  D,
  R,
  FIELD_L,
  FIELD_R,
  FIELD_TOP,
  PLAYER_LINE_Y,
  DANGER_ROW,
  SHOOTER_X,
  SHOOTER_Y,
  PALETTE,
  cellX,
  cellY,
} from './logic.mjs';

const ACCENT = '#22d3ee';
const ACCENT2 = '#f472b6';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const PARTICLE_LIFE = 0.62;

/* ── 颜色工具 ─────────────────────────────────────────────── */

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, a = 1) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** t>0 提亮（往白混），t<0 压暗 */
function shade(hex, t) {
  const [r, g, b] = hexRgb(hex);
  const f = t > 0 ? (v) => v + (255 - v) * t : (v) => v * (1 + t);
  return `rgb(${Math.round(f(r))},${Math.round(f(g))},${Math.round(f(b))})`;
}

function colorOf(index) {
  return PALETTE[index] || '#e8edf7';
}

/* ── 视觉状态（不进逻辑） ─────────────────────────────────── */

let particles = [];
let prevCells = new Map();
let lastScore = 0;
let scorePop = null;

function spawnBurst(x, y, color, birth, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + (x + y) * 0.013;
    const sp = 55 + ((i * 29) % 75);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 25,
      birth,
      color,
      size: 2 + (i % 3),
    });
  }
  if (particles.length > 320) particles.splice(0, particles.length - 320);
}

/** 对比上一帧的泡泡 id：消失的就在原位炸一簇粒子（坠落与消除都覆盖） */
function syncEffects(state, view) {
  const now = new Map();
  for (const row of state.grid) {
    for (const cell of row) {
      if (!cell) continue;
      now.set(cell.id, {
        x: cellX(cell.r, cell.c, state.phase),
        y: cellY(cell.r),
        color: colorOf(cell.color),
      });
    }
  }
  const time = view.time || 0;
  for (const [id, p] of prevCells) {
    if (!now.has(id)) spawnBurst(p.x, p.y, p.color, time, 8);
  }
  prevCells = now;

  if (Number.isFinite(state.score) && state.score !== lastScore) {
    const gain = state.score - lastScore;
    if (gain > 0) scorePop = { text: `+${gain}`, birth: time };
    lastScore = state.score;
  }
}

/* ── 基本图形 ─────────────────────────────────────────────── */

/** 霓虹泡泡：径向渐变（左上高光 → 本色 → 压暗边缘）+ 高光点 + 外发光 */
function drawBubble(ctx, x, y, radius, color, pulse = 0) {
  const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
  g.addColorStop(0, 'rgba(255,255,255,0.98)');
  g.addColorStop(0.26, shade(color, 0.5));
  g.addColorStop(0.68, color);
  g.addColorStop(1, shade(color, -0.52));

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 + pulse * 6;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 左上高光
  ctx.beginPath();
  ctx.ellipse(
    x - radius * 0.33,
    y - radius * 0.38,
    radius * 0.32,
    radius * 0.21,
    -0.7,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();

  // 边缘描一圈本色，让相邻泡泡有分隔
  ctx.strokeStyle = rgba(color, 0.8);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x, y, radius - 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ── 场地边框 ─────────────────────────────────────────────── */

function bottomRowOf(state) {
  for (let r = state.grid.length - 1; r >= 0; r--) {
    const row = state.grid[r];
    if (row && row.some(Boolean)) return r;
  }
  return -1;
}

function drawField(ctx, state, time) {
  const bottom = bottomRowOf(state);
  const dangerHot = bottom >= DANGER_ROW - 3;

  ctx.save();
  // 顶棚横梁
  ctx.strokeStyle = rgba(ACCENT, 0.65);
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(FIELD_L, FIELD_TOP);
  ctx.lineTo(FIELD_R, FIELD_TOP);
  ctx.stroke();

  // 顶棚齿（挂泡泡的“天花板”）
  ctx.shadowBlur = 0;
  ctx.strokeStyle = rgba(ACCENT, 0.3);
  ctx.lineWidth = 1;
  for (let x = FIELD_L; x <= FIELD_R; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, FIELD_TOP);
    ctx.lineTo(x, FIELD_TOP + 6);
    ctx.stroke();
  }

  // 左右侧墙
  ctx.strokeStyle = rgba(ACCENT, 0.22);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(FIELD_L, FIELD_TOP);
  ctx.lineTo(FIELD_L, PLAYER_LINE_Y + 24);
  ctx.moveTo(FIELD_R, FIELD_TOP);
  ctx.lineTo(FIELD_R, PLAYER_LINE_Y + 24);
  ctx.stroke();

  // 危险线：越接近越亮，并用流动虚线
  const alpha = dangerHot ? 0.55 + 0.35 * Math.sin(time * 6) : 0.3;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -time * 26;
  ctx.strokeStyle = rgba(ACCENT2, Math.max(0.18, alpha));
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = dangerHot ? 14 : 6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(FIELD_L, PLAYER_LINE_Y);
  ctx.lineTo(FIELD_R, PLAYER_LINE_Y);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACCENT2, dangerHot ? 0.9 : 0.45);
  ctx.fillText('危险线', FIELD_L + 2, PLAYER_LINE_Y - 6);
  ctx.restore();
}

/* ── 瞄准虚线 ─────────────────────────────────────────────── */

/** 用与逻辑相同的几何推一条预测弹道（只读，不改状态） */
function aimPath(state) {
  const a = (state.shooter.angle * Math.PI) / 180;
  let x = SHOOTER_X + Math.sin(a) * (R + 12);
  let y = SHOOTER_Y - Math.cos(a) * (R + 12);
  let vx = Math.sin(a);
  let vy = -Math.cos(a);

  const cells = [];
  for (const row of state.grid) {
    for (const cell of row) {
      if (cell) cells.push({ x: cellX(cell.r, cell.c, state.phase), y: cellY(cell.r) });
    }
  }

  const pts = [{ x, y }];
  const limit = (D * 0.95) ** 2;
  for (let i = 0; i < 320; i++) {
    x += vx * 6;
    y += vy * 6;
    if (x - R < FIELD_L) {
      x = FIELD_L + R;
      vx = -vx;
      pts.push({ x, y });
    } else if (x + R > FIELD_R) {
      x = FIELD_R - R;
      vx = -vx;
      pts.push({ x, y });
    }
    if (y - R <= FIELD_TOP) {
      y = FIELD_TOP + R;
      pts.push({ x, y });
      return { pts, hit: { x, y } };
    }
    for (const cell of cells) {
      const dx = cell.x - x;
      const dy = cell.y - y;
      if (dx * dx + dy * dy <= limit) {
        pts.push({ x, y });
        return { pts, hit: { x, y } };
      }
    }
  }
  pts.push({ x, y });
  return { pts, hit: null };
}

function drawAim(ctx, state, time) {
  if (state.over) return;
  const color = colorOf(state.shooter.color);
  const { pts, hit } = aimPath(state);

  ctx.save();
  ctx.setLineDash([7, 9]);
  ctx.lineDashOffset = -time * 34;
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();

  if (hit) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    drawBubble(ctx, hit.x, hit.y, R * 0.92, color);
    ctx.restore();
  }
}

/* ── 发射口 ───────────────────────────────────────────────── */

function drawShooter(ctx, state, time) {
  const a = (state.shooter.angle * Math.PI) / 180;
  const color = colorOf(state.shooter.color);

  ctx.save();
  ctx.translate(SHOOTER_X, SHOOTER_Y);

  // 底座光晕
  const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 78);
  halo.addColorStop(0, rgba(ACCENT, 0.26));
  halo.addColorStop(1, rgba(ACCENT, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 78, 0, Math.PI * 2);
  ctx.fill();

  // 炮管：沿瞄准角旋转
  ctx.save();
  ctx.rotate(a);
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 16;
  ctx.fillStyle = 'rgba(12,20,34,0.95)';
  roundRect(ctx, -10, -R - 14, 20, R + 22, 8);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = rgba(ACCENT, 0.9);
  ctx.lineWidth = 2;
  roundRect(ctx, -10, -R - 14, 20, R + 22, 8);
  ctx.stroke();
  ctx.restore();

  // 炮台底座
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 18;
  const base = ctx.createLinearGradient(-54, 0, 54, 0);
  base.addColorStop(0, rgba(ACCENT2, 0.16));
  base.addColorStop(0.5, rgba(ACCENT, 0.92));
  base.addColorStop(1, rgba(ACCENT2, 0.16));
  ctx.fillStyle = base;
  roundRect(ctx, -54, -6, 108, 22, 11);
  ctx.fill();
  ctx.restore();

  // 待发射泡泡（贴在炮口）
  if (!state.flying.active) {
    const mx = SHOOTER_X + Math.sin(a) * (R + 12);
    const my = SHOOTER_Y - Math.cos(a) * (R + 12);
    drawBubble(ctx, mx, my, R, color, 0.5 + 0.5 * Math.sin(time * 4));
  }

  // 下一发预览
  const nx = SHOOTER_X + 80;
  const ny = SHOOTER_Y + 4;
  drawBubble(ctx, nx, ny, R * 0.6, colorOf(state.shooter.nextColor));
  ctx.save();
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.75)';
  ctx.fillText('下一发', nx, ny - R * 0.6 - 7);
  ctx.restore();
}

/* ── 飞行泡泡与拖尾 ───────────────────────────────────────── */

function drawFlying(ctx, state) {
  const f = state.flying;
  if (!f || !f.active) return;
  const color = colorOf(f.color);
  for (let i = 0; i < f.trail.length; i++) {
    const k = (i + 1) / f.trail.length;
    ctx.save();
    ctx.globalAlpha = k * 0.4;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(f.trail[i].x, f.trail[i].y, R * (0.28 + 0.55 * k), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawBubble(ctx, f.x, f.y, R, color);
}

/* ── 粒子 / 飘分（都按 view.time 老化） ────────────────────── */

function drawParticles(ctx, time) {
  particles = particles.filter((p) => time - p.birth < PARTICLE_LIFE);
  for (const p of particles) {
    const age = time - p.birth;
    if (age < 0) continue;
    const x = p.x + p.vx * age;
    const y = p.y + p.vy * age + 0.5 * 320 * age * age;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age / PARTICLE_LIFE);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

function drawScorePop(ctx, time) {
  if (!scorePop) return;
  const age = time - scorePop.birth;
  if (age < 0 || age > 0.9) {
    scorePop = null;
    return;
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - age / 0.9);
  ctx.font = `700 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#f8fbff';
  ctx.fillText(scorePop.text, 240, FIELD_TOP + 54 - age * 34);
  ctx.restore();
}

/* ── 主入口 ───────────────────────────────────────────────── */

export function render(ctx, state, view) {
  const time = view.time || 0;
  syncEffects(state, view);

  drawBackdrop(ctx, view.w, view.h, ACCENT);
  drawField(ctx, state, time);

  // 顶部 HUD
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = 'rgba(232,237,247,0.94)';
  ctx.fillText(`分数 ${state.score}`, 16, 28);

  ctx.textAlign = 'right';
  if (state.combo > 1) {
    ctx.fillStyle = ACCENT2;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 12;
    ctx.fillText(`连消 ×${state.combo}`, view.w - 16, 28);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = 'rgba(147,160,184,0.9)';
    ctx.fillText(`落行 ${state.dropRows}`, view.w - 16, 28);
  }

  ctx.textAlign = 'center';
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = 'rgba(147,160,184,0.82)';
  const clearInfo = state.clears > 0 ? ` · 清台 ×${state.clears}` : '';
  ctx.fillText(`${state.colors} 色 · 已落 ${state.dropRows} 行${clearInfo}`, view.w / 2, 48);
  ctx.restore();

  drawAim(ctx, state, time);

  // 蜂窝泡泡
  for (const row of state.grid) {
    for (const cell of row) {
      if (!cell) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time * 2 + cell.c * 0.5 + cell.r * 0.7);
      drawBubble(ctx, cellX(cell.r, cell.c, state.phase), cellY(cell.r), R - 1, colorOf(cell.color), pulse);
    }
  }

  drawShooter(ctx, state, time);
  drawFlying(ctx, state);
  drawParticles(ctx, time);
  drawScorePop(ctx, time);

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,16,0.64)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
    glowText(ctx, '本局结束', view.w / 2, view.h / 2 - 16, { size: 30, color: '#e8edf7', glow: ACCENT2 });
    glowText(ctx, `得分 ${state.score}  ·  最高连消 ×${state.maxCombo}`, view.w / 2, view.h / 2 + 24, {
      size: 15,
      color: 'rgba(147,160,184,0.95)',
    });
    glowText(ctx, `落行 ${state.dropRows} 行`, view.w / 2, view.h / 2 + 52, {
      size: 13,
      color: 'rgba(147,160,184,0.8)',
    });
  }
}
