/**
 * 星际入侵 · 渲染。只读 logic.state()，不改状态。
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 * 敌机为程序化像素风（5 种行色），掩体逐格绘制，爆炸帧用 view.time 驱动。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#f43f5e';
const ACCENT2 = '#fb923c';
const ROW_COLORS = [
  '#f472b6',
  '#c084fc',
  '#60a5fa',
  '#22d3ee',
  '#6cf0a8',
];

// 5×5 像素位图，行序从上到下；1 = 点亮
const SPRITE_A = [
  [0, 0, 1, 0, 0],
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1],
  [0, 1, 0, 1, 0],
];
const SPRITE_B = [
  [0, 0, 1, 0, 0],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [1, 0, 1, 0, 1],
  [0, 1, 0, 1, 0],
];
const SPRITE_C = [
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1],
  [0, 1, 0, 1, 0],
];

function spriteFor(row, frame) {
  const s = row % 2 === 0 ? SPRITE_A : SPRITE_B;
  return frame % 2 === 0 ? s : SPRITE_C;
}

function drawEnemy(ctx, e, time) {
  if (!e.alive) return;
  const color = ROW_COLORS[e.row % ROW_COLORS.length];
  const frame = Math.floor(time * 4) + e.col;
  const px = Math.max(2, Math.floor(e.w / 5));
  const py = Math.max(2, Math.floor(e.h / 5));
  const ox = e.x + (e.w - px * 5) / 2;
  const oy = e.y + (e.h - py * 5) / 2;
  const bitmap = spriteFor(e.row, frame);

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!bitmap[r][c]) continue;
      ctx.fillRect(ox + c * px, oy + r * py, px - 0.5, py - 0.5);
    }
  }
  ctx.restore();
}

function drawPlayer(ctx, state, time) {
  if (state.over) return;
  const p = state.player;
  const blink = state.invuln > 0 && Math.floor(time * 12) % 2 === 0;
  ctx.save();
  if (blink) ctx.globalAlpha = 0.35;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 14;

  // 炮台底座
  ctx.fillStyle = ACCENT2;
  roundRect(ctx, p.x, p.y, p.w, p.h, 4);
  ctx.fill();
  // 顶部炮口
  ctx.fillStyle = '#ffe8d6';
  ctx.fillRect(p.x + p.w / 2 - 3, p.y - 6, 6, 8);
  // 舷窗像素
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(p.x + 8, p.y + 6, 4, 4);
  ctx.fillRect(p.x + p.w - 12, p.y + 6, 4, 4);
  ctx.restore();
}

function drawBunkers(ctx, bunkers) {
  for (const bu of bunkers) {
    for (let r = 0; r < bu.grid.length; r++) {
      for (let c = 0; c < bu.grid[r].length; c++) {
        if (!bu.grid[r][c]) continue;
        ctx.fillStyle = (r + c) % 2 === 0 ? '#34d399' : '#22d3ee';
        ctx.fillRect(bu.x + c * bu.cell, bu.y + r * bu.cell, bu.cell - 0.5, bu.cell - 0.5);
      }
    }
  }
}

function drawBullets(ctx, state) {
  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#fff7ed';
  ctx.fillStyle = '#fff7ed';
  for (const b of state.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.shadowColor = ACCENT;
  ctx.fillStyle = ACCENT;
  for (const b of state.enemyBullets) ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

function drawExplosions(ctx, state, time) {
  for (const e of state.explosions) {
    const t = Math.min(1, (time - (state.clock - e.age)) / e.ttl);
    const frame = Math.min(3, Math.floor(t * 4));
    const size = [10, 16, 22, 28][frame];
    const alpha = Math.max(0, 1 - t);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = frame < 2 ? '#fde68a' : ACCENT;
    ctx.shadowBlur = 16;
    ctx.fillStyle = frame < 2 ? '#fde68a' : ACCENT2;
    // 十字像素爆裂
    ctx.fillRect(e.x - 2, e.y - size / 2, 4, size);
    ctx.fillRect(e.x - size / 2, e.y - 2, size, 4);
    ctx.fillRect(e.x - 4, e.y - 4, 8, 8);
    ctx.restore();
  }
}

function drawHud(ctx, state, view) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(232, 237, 247, 0.9)';
  ctx.font = '600 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`波次 ${state.wave}`, 24, 26);
  ctx.textAlign = 'right';
  ctx.fillText(`生命 ${'♥'.repeat(state.lives)}`, view.w - 24, 26);
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = '700 16px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`得分 ${state.score}`, view.w / 2, 26);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  drawHud(ctx, state, view);

  const f = state.field;
  ctx.save();
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(f.left, f.top, f.right - f.left, f.bottom - f.top);
  ctx.restore();

  for (const e of state.enemies) drawEnemy(ctx, e, view.time);
  drawBunkers(ctx, state.bunkers);
  drawBullets(ctx, state);
  drawPlayer(ctx, state, view.time);
  drawExplosions(ctx, state, view.time);

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.62)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8edf7';
    ctx.font = '700 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('星域失守', view.w / 2, view.h / 2 - 10);
    ctx.fillStyle = ACCENT2;
    ctx.font = '15px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(`坚守至第 ${state.wave} 波 · 得分 ${state.score}`, view.w / 2, view.h / 2 + 24);
    ctx.restore();
  }
}
