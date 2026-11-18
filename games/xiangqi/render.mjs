/**
 * 中国象棋 · 渲染（只读 state，不改状态）。坐标系固定 480×640。
 *
 * 画面结构（自上而下）：状态栏 → 木纹棋盘（9 列 × 10 行格点、九宫斜线、
 * 楚河汉界断线）→ 棋子圆盘（程序化木色渐变 + 红/黑汉字）→ 可落点提示 / 最后一步 / 被将高亮 / 键盘光标。
 * 棋盘线与落子点同一套几何（GEOM 导出给 input.mjs 复用），保证点击命中与画面一致。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { COLS, ROWS, KIND, PIECE_CHARS, sideOf, kindOf, pieceOf, RED } from './logic.mjs';
import { cursor, selection } from './cursor.mjs';

const ACCENT = '#ef4444';
const ACCENT2 = '#fca5a5';
const W = 480;
const H = 640;

// 格子间距 44px：横 8 格 = 352，纵 9 格 = 396；四周留出棋子半径与木边
const GRID = 44;
const LEFT = (W - GRID * (COLS - 1)) / 2; // 64
const TOP = 104;
const RADIUS = 19;
const BOARD_W = GRID * (COLS - 1);
const BOARD_H = GRID * (ROWS - 1);

/** 棋盘几何，input.mjs 复用同一组常量（点击换算必须与画面一致） */
export const GEOM = { grid: GRID, left: LEFT, top: TOP, radius: RADIUS };

const cx = (c) => LEFT + c * GRID;
const cy = (r) => TOP + r * GRID;

/** 木纹棋盘底：渐变面板 + 固定正弦木纹（程序化，不用随机数） */
function drawPanel(ctx) {
  const x = LEFT - 22;
  const y = TOP - 22;
  const w = BOARD_W + 44;
  const h = BOARD_H + 44;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 9;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#e0bb85');
  g.addColorStop(0.5, '#cfa268');
  g.addColorStop(1, '#b6844c');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.clip();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#5b3a18';
  ctx.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    const yy = y + 8 + i * 19;
    ctx.beginPath();
    for (let xx = x; xx <= x + w; xx += 7) {
      const wave = yy + Math.sin((xx - x) * 0.031 + i * 1.9) * 2.6;
      if (xx === x) ctx.moveTo(xx, wave);
      else ctx.lineTo(xx, wave);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** 棋盘线：10 条横线、9 条竖线（中间 7 条在楚河汉界处断开）、九宫斜线、外框 */
function drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(62, 36, 12, 0.78)';
  ctx.lineWidth = 1.2;

  // 横线：每行通长
  for (let r = 0; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(cx(0), cy(r));
    ctx.lineTo(cx(COLS - 1), cy(r));
    ctx.stroke();
  }
  // 竖线：左右边线通长，中间在河界断开
  for (let c = 0; c < COLS; c++) {
    if (c === 0 || c === COLS - 1) {
      ctx.beginPath();
      ctx.moveTo(cx(c), cy(0));
      ctx.lineTo(cx(c), cy(ROWS - 1));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx(c), cy(0));
      ctx.lineTo(cx(c), cy(4));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx(c), cy(5));
      ctx.lineTo(cx(c), cy(ROWS - 1));
      ctx.stroke();
    }
  }

  // 九宫斜线：黑 (3,0)-(5,2) 与 (5,0)-(3,2)；红 (3,7)-(5,9) 与 (5,7)-(3,9)
  for (const row of [0, 7]) {
    ctx.beginPath();
    ctx.moveTo(cx(3), cy(row));
    ctx.lineTo(cx(5), cy(row + 2));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx(5), cy(row));
    ctx.lineTo(cx(3), cy(row + 2));
    ctx.stroke();
  }

  // 外框加粗
  ctx.strokeStyle = 'rgba(58, 32, 10, 0.92)';
  ctx.lineWidth = 2.4;
  ctx.strokeRect(cx(0), cy(0), BOARD_W, BOARD_H);
  ctx.restore();
}

/** 炮位小刻痕（传统棋盘标记，纯装饰） */
function drawPointMarks(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(62, 36, 12, 0.7)';
  ctx.lineWidth = 1.4;
  const off = 5;
  const len = 7;
  for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7]]) {
    const px = cx(c);
    const py = cy(r);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(px + sx * off, py + sy * (off + len));
        ctx.lineTo(px + sx * off, py + sy * off);
        ctx.lineTo(px + sx * (off + len), py + sy * off);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** 楚河汉界：河界两侧的断线之间写四个字 */
function drawRiver(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(58, 32, 10, 0.62)';
  ctx.font = '600 20px "KaiTi", "STKaiti", "Microsoft YaHei", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = (cy(4) + cy(5)) / 2;
  ctx.fillText('楚 河', cx(2), y);
  ctx.fillText('漢 界', cx(6), y);
  ctx.restore();
}

/** 单颗棋子：圆盘 + 双圈 + 汉字（红方红字、黑方黑字） */
function drawPiece(ctx, index, value) {
  const side = sideOf(value);
  const kind = kindOf(value);
  const px = cx(index % COLS);
  const py = cy((index / COLS) | 0);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.42)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  const g = ctx.createRadialGradient(px - RADIUS * 0.36, py - RADIUS * 0.42, RADIUS * 0.1, px, py, RADIUS);
  g.addColorStop(0, '#fdf6e3');
  g.addColorStop(0.55, '#f0dcb8');
  g.addColorStop(1, '#d3b183');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = side === RED ? 'rgba(192, 57, 43, 0.9)' : 'rgba(38, 44, 54, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, RADIUS - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120, 84, 42, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(px, py, RADIUS - 4.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = side === RED ? '#c62828' : '#222a34';
  ctx.font = '700 23px "KaiTi", "STKaiti", "Microsoft YaHei", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(PIECE_CHARS[side][kind], px, py + 1);
  ctx.restore();
}

/** 交叉点四角括号：标记最后一步的起止点 */
function drawCornerTicks(ctx, index, color) {
  const px = cx(index % COLS);
  const py = cy((index / COLS) | 0);
  const a = 13;
  const b = 21;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px + sx * a, py + sy * b);
      ctx.lineTo(px + sx * a, py + sy * a);
      ctx.lineTo(px + sx * b, py + sy * a);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 可选落点提示：空点小圆点、吃子点用红圈 */
function drawHints(ctx, state) {
  if (selection.index < 0 || state.winner) return;
  const moves = (state.legalMoves || []).filter((m) => m.from === selection.index);
  if (!moves.length) return;
  ctx.save();
  for (const m of moves) {
    const px = cx(m.to % COLS);
    const py = cy((m.to / COLS) | 0);
    if (m.capture) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(px, py, RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(252, 165, 165, 0.55)';
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 选中格高亮 */
function drawSelection(ctx) {
  if (selection.index < 0) return;
  const px = cx(selection.index % COLS);
  const py = cy((selection.index / COLS) | 0);
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2.8;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(px, py, RADIUS + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 被将军的帅/将：红色脉冲光圈（view.time 驱动） */
function drawCheck(ctx, state, time) {
  if (!state.inCheck) return;
  const target = pieceOf(state.turn, KIND.K);
  let at = -1;
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] === target) {
      at = i;
      break;
    }
  }
  if (at < 0) return;
  const px = cx(at % COLS);
  const py = cy((at / COLS) | 0);
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);
  ctx.save();
  ctx.fillStyle = `rgba(239, 68, 68, ${0.16 + 0.2 * pulse})`;
  ctx.beginPath();
  ctx.arc(px, py, RADIUS + 8 + 3 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.55 + 0.35 * pulse})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(px, py, RADIUS + 5 + 2 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 键盘光标 */
function drawCursor(ctx, state) {
  if (!cursor.visible || state.winner) return;
  const px = cx(cursor.x);
  const py = cy(cursor.y);
  ctx.save();
  ctx.strokeStyle = ACCENT2;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(px - RADIUS - 3, py - RADIUS - 3, (RADIUS + 3) * 2, (RADIUS + 3) * 2);
  ctx.restore();
}

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/** 顶部状态栏：轮到谁、将军提示、手数、子力数；终局显示胜负文案 */
function drawStatus(ctx, state, time) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (state.winner) {
    const label = state.winner === 'draw'
      ? '和棋'
      : (state.winner === RED ? '红方胜' : '黑方胜');
    ctx.fillStyle = state.winner === 'draw' ? ACCENT2 : ACCENT;
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(label, W / 2, 42);
    ctx.fillStyle = 'rgba(200, 208, 224, 0.92)';
    ctx.font = `13px ${FONT}`;
    const detail = state.reason === 'checkmate' ? '绝杀 · 无子可应'
      : state.reason === 'stalemate' ? '困毙 · 无子可走'
        : state.reason === 'repetition' ? '同一局面三次出现，判和'
          : '连续 60 回合无吃子，判和';
    ctx.fillText(detail, W / 2, 66);
    ctx.restore();
    return;
  }

  const isRed = state.turn === RED;
  const who = isRed ? '红方' : '黑方';
  // 小圆盘 + 文字
  ctx.fillStyle = isRed ? '#c62828' : '#222a34';
  ctx.beginPath();
  ctx.arc(W / 2 - 74, 32, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isRed ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8edf7';
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(`${who}走棋`, W / 2 - 56, 38);

  if (state.inCheck) {
    const pulse = 0.55 + 0.45 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(239, 68, 68, ${0.65 + 0.35 * pulse})`;
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText('将军！', W / 2 + 26, 38);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.92)';
  ctx.font = `12px ${FONT}`;
  const pc = state.pieceCount || { p1: 16, p2: 16 };
  ctx.fillText(`第 ${state.moveCount + 1} 手 · 红 ${pc.p1} 子 · 黑 ${pc.p2} 子`, W / 2, 68);
  ctx.restore();
}

/** 底部提示 */
function drawFooter(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.72)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText('点自己的棋子，再点落点走棋 · 方向键移光标 · Enter 确认', W / 2, H - 42);
  ctx.fillStyle = 'rgba(147, 160, 184, 0.5)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText(
    state.winner ? 'R 再来一局 · 返回大厅在左上角' : 'U 悔棋 · R 重开 · 象不过河、马蹩腿、炮隔子打',
    W / 2,
    H - 20,
  );
  ctx.restore();
}

export function render(ctx, state, view) {
  const time = typeof view.time === 'number' ? view.time : 0;
  drawBackdrop(ctx, view.w || W, view.h || H, ACCENT);
  drawStatus(ctx, state, time);
  drawPanel(ctx);
  drawGrid(ctx);
  drawPointMarks(ctx);
  drawRiver(ctx);

  // 最后一步：起点淡、落点强调（画在棋子下面，避免遮挡）
  if (state.lastMove) {
    drawCornerTicks(ctx, state.lastMove.from, 'rgba(252, 165, 165, 0.55)');
    drawCornerTicks(ctx, state.lastMove.to, ACCENT);
  }

  for (let i = 0; i < state.board.length; i++) {
    const v = state.board[i];
    if (v) drawPiece(ctx, i, v);
  }

  // 可落点画在棋子之上：吃子点的红圈要压在敌子上才看得见
  drawHints(ctx, state);
  drawSelection(ctx);
  drawCheck(ctx, state, time);
  drawCursor(ctx, state);
  drawFooter(ctx, state);
}
