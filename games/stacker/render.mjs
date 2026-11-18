/**
 * 方块坠落 · 渲染。只读 logic.state()，不改状态。
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 * 配色：accent #7aa2ff / accent2 #ffd166。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const COLS = 10;
const ROWS = 20;
const CELL = 24;
const BOARD_X = 40;
const BOARD_Y = 48;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const ACCENT = '#7aa2ff';
const ACCENT2 = '#ffd166';

// 每种方块的霓虹主色/亮色/暗色。
const COLORS = {
  I: ['#4be1ff', '#b8f6ff', '#0a5c78'],
  O: ['#ffd166', '#fff0b8', '#7a5a06'],
  T: ['#b78bff', '#e2ccff', '#4a2a80'],
  S: ['#5ce6a5', '#c2ffe1', '#0f6b46'],
  Z: ['#ff7a9c', '#ffc7d6', '#7a1639'],
  J: ['#7aa2ff', '#c9d9ff', '#1f3f8a'],
  L: ['#ff9f5c', '#ffd8b8', '#8a3f0a'],
};

const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [2, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

function cellSize(type) {
  return type === 'T' || type === 'S' || type === 'Z' || type === 'J' || type === 'L' ? 3 : 4;
}

/** 画一个方块单元：圆角 + 渐变 + 霓虹发光边框 + 高光。 */
function drawCell(ctx, px, py, size, type, { ghost = false } = {}) {
  const [base, light, dark] = COLORS[type] || [ACCENT, '#ffffff', '#223355'];
  const pad = 1.5;
  const x = px + pad;
  const y = py + pad;
  const w = size - pad * 2;
  const h = size - pad * 2;

  ctx.save();
  if (ghost) {
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = base;
    ctx.lineWidth = 2;
    ctx.shadowColor = base;
    ctx.shadowBlur = 8;
    roundRect(ctx, x, y, w, h, 4);
    ctx.stroke();
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, light);
    grad.addColorStop(0.35, base);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.shadowColor = base;
    ctx.shadowBlur = 10;
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = light;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 4);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(ctx, x + 3, y + 3, w - 6, Math.max(2, h * 0.18), 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPieceAt(ctx, type, rot, ox, oy, ghost = false) {
  const cells = SHAPES[type]?.[rot] || [];
  for (const [cx, cy] of cells) {
    drawCell(ctx, ox + cx * CELL, oy + cy * CELL, CELL, type, { ghost });
  }
}

function drawBoard(ctx, state) {
  ctx.save();
  ctx.shadowColor = 'rgba(122, 162, 255, 0.22)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(6, 10, 20, 0.92)';
  roundRect(ctx, BOARD_X - 8, BOARD_Y - 8, BOARD_W + 16, BOARD_H + 16, 14);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(122, 162, 255, 0.10)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(BOARD_X + x * CELL, BOARD_Y);
    ctx.lineTo(BOARD_X + x * CELL, BOARD_Y + BOARD_H);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(BOARD_X, BOARD_Y + y * CELL);
    ctx.lineTo(BOARD_X + BOARD_W, BOARD_Y + y * CELL);
    ctx.stroke();
  }
  ctx.restore();

  // 已落定格
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = state.board[y][x];
      if (t) drawCell(ctx, BOARD_X + x * CELL, BOARD_Y + y * CELL, CELL, t);
    }
  }

  const a = state.active;
  if (a) {
    // 幽灵落点
    if (state.ghostY > a.y) {
      drawPieceAt(ctx, a.type, a.rot, BOARD_X + a.x * CELL, BOARD_Y + state.ghostY * CELL, true);
    }
    // 活动块
    drawPieceAt(ctx, a.type, a.rot, BOARD_X + a.x * CELL, BOARD_Y + a.y * CELL);
  }
}

function drawPreview(ctx, type, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(10, 16, 30, 0.72)';
  ctx.strokeStyle = 'rgba(122, 162, 255, 0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (!type) return;
  const size = cellSize(type);
  const cells = SHAPES[type][0];
  const scale = 18;
  const pw = size * scale;
  const ph = size * scale;
  const ox = x + (w - pw) / 2;
  const oy = y + (h - ph) / 2;
  ctx.save();
  for (const [cx, cy] of cells) {
    drawCell(ctx, ox + cx * scale, oy + cy * scale, scale, type);
  }
  ctx.restore();
}

function panelText(ctx, label, x, y) {
  ctx.save();
  ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
  ctx.font = '600 12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y);
  ctx.restore();
}

function drawSide(ctx, state) {
  const x = 300;
  let y = 60;

  panelText(ctx, '下一块', x, y);
  drawPreview(ctx, state.next?.[0], x, y + 8, 132, 74);
  y += 100;
  panelText(ctx, '其后', x, y);
  drawPreview(ctx, state.next?.[1], x, y + 8, 132, 62);
  y += 84;
  panelText(ctx, 'HOLD 暂存', x, y);
  drawPreview(ctx, state.hold, x, y + 8, 132, 74);
  ctx.save();
  ctx.fillStyle = state.holdUsed ? 'rgba(255, 122, 156, 0.9)' : 'rgba(122, 162, 255, 0.75)';
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(state.holdUsed ? '本块已用，落定后恢复' : '可暂存当前块', x + 4, y + 92);
  ctx.restore();

  // 数据面板
  y += 126;
  const stats = [
    ['分数', String(state.score)],
    ['消行', String(state.lines)],
    ['等级', String(state.level)],
  ];
  for (const [label, value] of stats) {
    ctx.save();
    ctx.fillStyle = 'rgba(147, 160, 184, 0.85)';
    ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 4, y);
    ctx.fillStyle = label === '分数' ? ACCENT2 : '#e8edf7';
    ctx.font = '700 18px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(value, x + 128, y + 2);
    ctx.restore();
    y += 36;
  }
}

function flashCleared(ctx, state, time) {
  if (!state.lastClear) return;
  const pulse = 0.5 + 0.5 * Math.sin(time * 12);
  ctx.save();
  ctx.globalAlpha = 0.25 * pulse;
  ctx.fillStyle = ACCENT2;
  const names = ['', '单行消除', '双行消除', '三行消除', '四行消除！'];
  ctx.font = '700 26px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(names[state.lastClear] || '', BOARD_X + BOARD_W / 2, BOARD_Y + 28);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = ACCENT;
  ctx.font = '700 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 12;
  ctx.fillText('方块坠落', BOARD_X - 2, 32);
  ctx.restore();

  drawBoard(ctx, state);
  drawSide(ctx, state);
  flashCleared(ctx, state, view.time);

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.62)';
    ctx.fillRect(BOARD_X - 8, BOARD_Y - 8, BOARD_W + 16, BOARD_H + 16);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8edf7';
    ctx.font = '700 28px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('堆叠到顶', BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2 - 8);
    ctx.fillStyle = ACCENT2;
    ctx.font = '16px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(`得分 ${state.score}`, BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2 + 24);
    ctx.restore();
  }
}
