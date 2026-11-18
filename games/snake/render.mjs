/**
 * 贪吃蛇 · 渲染。只读 logic.state()，不改状态。
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const CELL = 20;
const OFF_X = 40;
const OFF_Y = 80;
const ACCENT = '#6cf0a8';

function cellRect(x, y) {
  return { x: OFF_X + x * CELL, y: OFF_Y + y * CELL, w: CELL, h: CELL };
}

function drawBoard(ctx) {
  const w = 20 * CELL;
  const h = 24 * CELL;

  ctx.save();
  ctx.shadowColor = 'rgba(108, 240, 168, 0.18)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.9)';
  roundRect(ctx, OFF_X - 8, OFF_Y - 8, w + 16, h + 16, 14);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(108, 240, 168, 0.14)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 20; x++) {
    ctx.beginPath();
    ctx.moveTo(OFF_X + x * CELL, OFF_Y);
    ctx.lineTo(OFF_X + x * CELL, OFF_Y + h);
    ctx.stroke();
  }
  for (let y = 0; y <= 24; y++) {
    ctx.beginPath();
    ctx.moveTo(OFF_X, OFF_Y + y * CELL);
    ctx.lineTo(OFF_X + w, OFF_Y + y * CELL);
    ctx.stroke();
  }
}

function drawFood(ctx, food, time) {
  if (food.x < 0) return;
  const r = cellRect(food.x, food.y);
  const cx = r.x + CELL / 2;
  const cy = r.y + CELL / 2;
  const pulse = 1 + Math.sin(time * 5) * 0.08;

  ctx.save();
  ctx.shadowColor = '#ff8a5c';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ff8a5c';
  ctx.beginPath();
  ctx.arc(cx, cy, (CELL / 2 - 3) * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 3, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSnake(ctx, snake, dir) {
  for (let i = snake.length - 1; i >= 0; i--) {
    const s = snake[i];
    const r = cellRect(s.x, s.y);
    const t = i / Math.max(1, snake.length - 1);
    const pad = i === 0 ? 1.5 : 2.5;

    ctx.save();
    if (i === 0) {
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = i === 0 ? '#b9ffd4' : `rgba(108, 240, 168, ${0.9 - t * 0.5})`;
    roundRect(ctx, r.x + pad, r.y + pad, CELL - pad * 2, CELL - pad * 2, 6);
    ctx.fill();
    ctx.restore();
  }

  // 眼睛：跟随朝向
  const head = snake[0];
  const r = cellRect(head.x, head.y);
  const cx = r.x + CELL / 2;
  const cy = r.y + CELL / 2;
  const ex = dir.y !== 0 ? 4 : 3.2;
  const ey = dir.x !== 0 ? 4 : 3.2;
  const ox = dir.x * 3;
  const oy = dir.y * 3;

  ctx.fillStyle = '#071018';
  ctx.beginPath();
  ctx.arc(cx + ox - (dir.x === 0 ? ex : 0), cy + oy - (dir.y === 0 ? ey : 0), 2.1, 0, Math.PI * 2);
  ctx.arc(cx + ox + (dir.x === 0 ? ex : 0), cy + oy + (dir.y === 0 ? ey : 0), 2.1, 0, Math.PI * 2);
  ctx.fill();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232, 237, 247, 0.9)';
  ctx.font = '600 15px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(state.wrap ? '穿墙模式' : '撞墙结束', view.w / 2, 44);
  ctx.fillStyle = 'rgba(147, 160, 184, 0.85)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`速度 ${(0.13 / state.interval).toFixed(1)}×  ·  长度 ${state.snake.length}`, view.w / 2, 64);
  ctx.restore();

  drawBoard(ctx);
  drawFood(ctx, state.food, view.time);
  drawSnake(ctx, state.snake, state.dir);

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8edf7';
    ctx.font = '700 30px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('本局结束', view.w / 2, view.h / 2 - 10);
    ctx.fillStyle = 'rgba(147, 160, 184, 0.95)';
    ctx.font = '14px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(`得分 ${state.score}`, view.w / 2, view.h / 2 + 22);
    ctx.restore();
  }
}
