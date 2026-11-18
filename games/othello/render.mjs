/**
 * 黑白棋 · 渲染（只读 state，不改状态）。坐标系固定 480×640。
 * 绿色棋桌 + 黑白子径向渐变 + 合法落点提示 + 最后一手标记 + 回合/比分状态栏。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { SIZE, BLACK, WHITE } from './logic.mjs';
import { cursor } from './cursor.mjs';

const ACCENT = '#34d399';
const ACCENT2 = '#a7f3d0';
const W = 480;
const H = 640;

// 棋盘几何：8×8 格，格宽 52px → 棋盘 416px，居中于 480 宽
const GRID = 52;
const LEFT = 32;
const TOP = 150;
const BOARD_PX = GRID * SIZE; // 416

function cx(x) { return LEFT + x * GRID + GRID / 2; }
function cy(y) { return TOP + y * GRID + GRID / 2; }

/** 绿色棋桌：深绿边框 + 毡面渐变 + 细网格 */
function drawTable(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  const frame = ctx.createLinearGradient(LEFT, TOP, LEFT + BOARD_PX, TOP + BOARD_PX);
  frame.addColorStop(0, '#1f6b4a');
  frame.addColorStop(0.5, '#15563a');
  frame.addColorStop(1, '#0f422d');
  ctx.fillStyle = frame;
  roundRect(ctx, LEFT - 14, TOP - 14, BOARD_PX + 28, BOARD_PX + 28, 16);
  ctx.fill();
  ctx.restore();

  // 毡面
  ctx.save();
  const felt = ctx.createRadialGradient(W / 2, TOP + BOARD_PX / 2, 30, W / 2, TOP + BOARD_PX / 2, BOARD_PX * 0.75);
  felt.addColorStop(0, '#1f8a5b');
  felt.addColorStop(1, '#0f6b43');
  ctx.fillStyle = felt;
  roundRect(ctx, LEFT, TOP, BOARD_PX, BOARD_PX, 8);
  ctx.fill();

  // 格线
  ctx.strokeStyle = 'rgba(6, 42, 28, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(LEFT + i * GRID, TOP);
    ctx.lineTo(LEFT + i * GRID, TOP + BOARD_PX);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(LEFT, TOP + i * GRID);
    ctx.lineTo(LEFT + BOARD_PX, TOP + i * GRID);
    ctx.stroke();
  }
  // 四个星位
  ctx.fillStyle = 'rgba(6, 42, 28, 0.7)';
  for (const [gx, gy] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
    ctx.beginPath();
    ctx.arc(LEFT + gx * GRID, TOP + gy * GRID, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 合法落点提示：半透明小圆点 */
function drawValidMoves(ctx, state) {
  if (state.winner || !state.validMoves) return;
  ctx.save();
  ctx.fillStyle = 'rgba(167, 243, 208, 0.55)';
  for (const { x, y } of state.validMoves) {
    ctx.beginPath();
    ctx.arc(cx(x), cy(y), 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 单颗棋子：径向渐变球体 + 高光 */
function drawStone(ctx, x, y, color, isLast) {
  const px = cx(x);
  const py = cy(y);
  const r = GRID * 0.42;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
  if (color === BLACK) {
    g.addColorStop(0, '#5b5f66');
    g.addColorStop(0.4, '#23262c');
    g.addColorStop(1, '#05060a');
  } else {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f2f2f0');
    g.addColorStop(1, '#b8bcc2');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 左上高光
  ctx.save();
  ctx.globalAlpha = color === BLACK ? 0.3 : 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(px - r * 0.3, py - r * 0.38, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 最后一手标记：小圆环
  if (isLast) {
    ctx.save();
    ctx.strokeStyle = ACCENT2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 顶部状态栏：比分 + 当前回合（含跳过提示） */
function drawStatus(ctx, state) {
  const s = state.scores || { p1: 2, p2: 2 };
  ctx.save();
  ctx.textAlign = 'center';

  if (state.winner) {
    const label = state.winner === 'draw' ? '和棋'
      : (state.winner === 'p1' ? '黑棋获胜' : '白棋获胜');
    ctx.fillStyle = ACCENT;
    ctx.font = '700 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(label, W / 2, 52);
  } else {
    const isBlack = state.turn === 'p1';
    ctx.fillStyle = ACCENT2;
    ctx.font = '600 15px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${isBlack ? '黑棋' : '白棋'}回合`, W / 2, 46);
  }

  // 比分胶囊：黑 : 白
  ctx.font = '600 18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#d8dbe2';
  ctx.fillText(`黑 ${s.p1}  :  ${s.p2} 白`, W / 2, 82);
  ctx.fillStyle = 'rgba(147,160,184,0.85)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  const skipped = state.passCount ? ` · 已跳过 ${state.passCount} 次` : '';
  ctx.fillText(`8×8${skipped}`, W / 2, 106);
  ctx.restore();
}

/** 键盘光标高亮 */
function drawCursor(ctx, state) {
  if (!cursor.visible || state.winner) return;
  const px = LEFT + cursor.x * GRID;
  const py = TOP + cursor.y * GRID;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(px + 2, py + 2, GRID - 4, GRID - 4);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w || W, view.h || H, ACCENT);
  drawStatus(ctx, state);
  drawTable(ctx);
  drawValidMoves(ctx, state);

  const last = state.lastMove;
  const board = state.board;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = board[y][x];
      if (v === 0) continue;
      const isLast = Boolean(last && last.x === x && last.y === y);
      drawStone(ctx, x, y, v, isLast);
    }
  }

  drawCursor(ctx, state);

  if (state.winner) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 24, 16, 0.55)';
    roundRect(ctx, LEFT, TOP + BOARD_PX - 40, BOARD_PX, 34, 8);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT2;
    ctx.font = '600 15px -apple-system, "PingFang SC", sans-serif';
    const s = state.scores || { p1: 0, p2: 0 };
    ctx.fillText(`终局 ${s.p1} : ${s.p2} · 子多者胜`, W / 2, TOP + BOARD_PX - 18);
    ctx.restore();
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.75)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('点击亮点落子 · 方向键移动光标 · Enter 确定', W / 2, H - 22);
  ctx.restore();
}
