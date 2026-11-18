/**
 * 豆豆迷宫 · 渲染（只读 state，不改状态）。
 * 坐标系固定 480×640，与 game.json.canvas 一致。
 * 造型原创：玩家为「青橙双色星瓣小怪」（圆 + 楔形缺口，非原作黄色吃豆人）；
 * 四鬼为圆头三角裙摆的「小精灵」，颜色各异 + 方向眼睛。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#fbbf24';
const CELL = 24;
const OFF_X = (480 - 19 * CELL) / 2; // 12
const OFF_Y = 84;

function cellRect(x, y) {
  return { x: OFF_X + x * CELL, y: OFF_Y + y * CELL, w: CELL, h: CELL };
}

/** 把字符地图中相邻墙格合并为圆角蓝色墙块（描边） */
function drawMaze(ctx, maze) {
  const w = 19 * CELL;
  const h = 21 * CELL;

  ctx.save();
  ctx.shadowColor = 'rgba(96, 165, 250, 0.16)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = 'rgba(8, 13, 26, 0.92)';
  roundRect(ctx, OFF_X - 10, OFF_Y - 10, w + 20, h + 20, 16);
  ctx.fill();
  ctx.restore();

  // 先画每条墙格的蓝色描边矩形（圆角），相邻格接缝由填充同色掩盖
  ctx.save();
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(96,165,250,0.55)';
  ctx.shadowBlur = 6;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 19; x++) {
      if (maze[y][x] !== '#') continue;
      const r = cellRect(x, y);
      roundRect(ctx, r.x + 1, r.y + 1, CELL - 2, CELL - 2, 5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBeans(ctx, maze, time) {
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 19; x++) {
      const ch = maze[y][x];
      if (ch !== '.' && ch !== 'o') continue;
      const r = cellRect(x, y);
      const cx = r.x + CELL / 2;
      const cy = r.y + CELL / 2;
      if (ch === '.') {
        ctx.fillStyle = '#fcd9a0';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 能量豆闪烁
        const pulse = 0.65 + 0.35 * Math.sin(time * 6);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 14;
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

function drawPlayer(ctx, p, time, power) {
  const r = cellRect(p.x, p.y);
  const cx = r.x + CELL / 2;
  const cy = r.y + CELL / 2;
  const ang = Math.atan2(p.dir.y, p.dir.x);
  const mouth = (0.18 + 0.12 * Math.abs(Math.sin(time * 10))) * Math.PI;
  const radius = CELL / 2 - 3;
  const blink = p.invuln > 0 && Math.floor(time * 12) % 2 === 0;

  ctx.save();
  if (blink) ctx.globalAlpha = 0.4;
  ctx.shadowColor = power > 0 ? ACCENT : '#67e8f9';
  ctx.shadowBlur = power > 0 ? 20 : 12;
  // 主体：青色圆 + 楔形缺口（原创「开口星瓣」，非黄吃豆人）
  ctx.fillStyle = power > 0 ? '#fde68a' : '#67e8f9';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, ang + mouth, ang - mouth + Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // 橙色小星核（第二色彩，区别于原作）
  ctx.fillStyle = '#fb923c';
  ctx.beginPath();
  ctx.arc(cx - p.dir.x * 3, cy - p.dir.y * 3, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGhost(ctx, g, time) {
  const r = cellRect(g.x, g.y);
  const cx = r.x + CELL / 2;
  const cy = r.y + CELL / 2;
  const returning = g.mode === 'returning';
  const frightened = g.mode === 'frightened';
  const bob = Math.sin(time * 8 + g.x) * 1.2;
  const color = frightened ? '#6d28d9' : g.color;

  ctx.save();
  if (returning) ctx.globalAlpha = 0.7;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  if (returning) {
    // 回巢态：只画一双眼睛（原创简化）
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 圆头 + 裙摆三角（原创小精灵造型）
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy - 2 + bob, 8, Math.PI, 0);
    ctx.lineTo(cx + 8, cy + 7 + bob);
    ctx.lineTo(cx + 4, cy + 3 + bob);
    ctx.lineTo(cx, cy + 7 + bob);
    ctx.lineTo(cx - 4, cy + 3 + bob);
    ctx.lineTo(cx - 8, cy + 7 + bob);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // 方向眼睛：看向行进方向
  const ex = g.dir.x * 2;
  const ey = g.dir.y * 2;
  const eyeColor = frightened ? (Math.floor(time * 8) % 2 ? '#fca5a5' : '#ffffff') : '#ffffff';
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(cx - 3.2 + ex, cy - 3 + ey + bob, 2.6, 0, Math.PI * 2);
  ctx.arc(cx + 3.2 + ex, cy - 3 + ey + bob, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1e3a8a';
  ctx.beginPath();
  ctx.arc(cx - 3.2 + ex * 1.4, cy - 3 + ey * 1.4 + bob, 1.2, 0, Math.PI * 2);
  ctx.arc(cx + 3.2 + ex * 1.4, cy - 3 + ey * 1.4 + bob, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232, 237, 247, 0.92)';
  ctx.font = '600 15px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`剩余豆 ${state.beansLeft}`, view.w / 2, 36);
  ctx.fillStyle = state.powerTimer > 0 ? ACCENT : 'rgba(147, 160, 184, 0.85)';
  ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(
    state.powerTimer > 0 ? `能量状态 ${state.powerTimer.toFixed(1)}s` : '吃掉能量豆可反吃四鬼',
    view.w / 2,
    58
  );
  ctx.restore();

  drawMaze(ctx, state.maze);
  drawBeans(ctx, state.maze, view.time);
  for (const g of state.ghosts) drawGhost(ctx, g, view.time);
  drawPlayer(ctx, state.player, view.time, state.powerTimer);

  // 生命图标（小星瓣）
  ctx.save();
  ctx.fillStyle = '#67e8f9';
  for (let i = 0; i < state.lives; i++) {
    ctx.beginPath();
    ctx.arc(24 + i * 20, 624, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.62)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8edf7';
    ctx.font = '700 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.win ? '迷宫通关！' : '游戏结束', view.w / 2, view.h / 2 - 8);
    ctx.fillStyle = 'rgba(147, 160, 184, 0.95)';
    ctx.font = '14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`得分 ${state.score} · 剩余豆 ${state.beansLeft}`, view.w / 2, view.h / 2 + 24);
    ctx.restore();
  }
}
