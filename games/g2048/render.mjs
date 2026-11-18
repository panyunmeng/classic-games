/**
 * 2048 · 渲染。
 * 棋盘固定 480×640：4 列 × 104 + 3 × 12 间隙 = 452，左右各留 14。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const CELL = 104;
const GAP = 12;
const OFF_X = (480 - (4 * CELL + 3 * GAP)) / 2;
const OFF_Y = 128;

const COLORS = {
  0: 'rgba(22, 28, 44, 0.82)',
  2: '#e9e4d4',
  4: '#ece0c8',
  8: '#f3b179',
  16: '#f59563',
  32: '#f67c5f',
  64: '#f65e3b',
  128: '#edcf72',
  256: '#edcc61',
  512: '#edc850',
  1024: '#edc53f',
  2048: '#f2b84b',
  4096: '#a07cff',
};

function tileColor(v) {
  return COLORS[v] || '#8b5cf6';
}

function textColor(v) {
  return v <= 4 ? '#26303f' : '#ffffff';
}

function slotRect(x, y) {
  return {
    x: OFF_X + x * (CELL + GAP),
    y: OFF_Y + y * (CELL + GAP),
    w: CELL,
    h: CELL,
  };
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, '#f2b84b');

  // 棋盘底
  ctx.save();
  ctx.shadowColor = 'rgba(242, 184, 75, 0.16)';
  ctx.shadowBlur = 28;
  ctx.fillStyle = 'rgba(9, 13, 24, 0.9)';
  roundRect(ctx, OFF_X - 10, OFF_Y - 10, 4 * CELL + 3 * GAP + 20, 4 * CELL + 3 * GAP + 20, 18);
  ctx.fill();
  ctx.restore();

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const r = slotRect(x, y);
      ctx.fillStyle = 'rgba(24, 32, 50, 0.85)';
      roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
    }
  }

  // 移动时轻微弹一下：以 moves 变化为触发
  const now = view.time;
  if (state.moves !== render._lastMoves) {
    render._lastMoves = state.moves;
    render._lastAt = now;
  }
  const age = now - (render._lastAt || 0);
  const pop = age < 0.14 ? 0.92 + 0.08 * (age / 0.14) : 1;

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = state.grid[y][x];
      if (!v) continue;
      const r = slotRect(x, y);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const scale = pop;
      const digits = String(v).length;
      const size = digits <= 2 ? 42 : digits === 3 ? 34 : 26;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      if (v >= 128) {
        ctx.shadowColor = 'rgba(255, 200, 90, 0.45)';
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = tileColor(v);
      roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 12);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = textColor(v);
      ctx.font = `800 ${size}px -apple-system, "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), 0, 2);
      ctx.restore();
    }
  }

  // 顶部说明
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
  ctx.font = '13px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(state.won ? '已达成 2048，继续挑战更高分' : '滑动合并相同数字', view.w / 2, 76);
  ctx.fillStyle = 'rgba(100, 112, 138, 0.9)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(state.canUndo ? 'U 撤销上一步' : '', view.w / 2, 98);
  ctx.restore();
}
