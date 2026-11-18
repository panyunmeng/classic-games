/**
 * 五子棋 · 渲染（只读 state，不改状态）。坐标系固定 480×640。
 * 木板纹理、棋盘线、黑白子（径向渐变 + 高光）、最后一手标记、胜利连线、回合提示。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { SIZE } from './logic.mjs';
import { cursor } from './cursor.mjs';

const ACCENT = '#e8a33a';
const ACCENT2 = '#5fd08a';
const W = 480;
const H = 640;

// 棋盘几何：15×15 路，四周留白；格子间距 30px，棋盘 14 格 = 420px
const GRID = 30;
const LEFT = 30;
const TOP = 150;
const BOARD_PX = GRID * (SIZE - 1); // 420

function cx(x) { return LEFT + x * GRID; }
function cy(y) { return TOP + y * GRID; }

/** 木质棋盘底色 + 细木纹 */
function drawWood(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  const g = ctx.createLinearGradient(LEFT - 16, TOP - 16, LEFT + BOARD_PX + 16, TOP + BOARD_PX + 16);
  g.addColorStop(0, '#d9a35c');
  g.addColorStop(0.5, '#c68a43');
  g.addColorStop(1, '#b37434');
  ctx.fillStyle = g;
  roundRect(ctx, LEFT - 16, TOP - 16, BOARD_PX + 32, BOARD_PX + 32, 14);
  ctx.fill();
  ctx.restore();

  // 木纹：固定位置的正弦细线，程序化生成（不随机）
  ctx.save();
  roundRect(ctx, LEFT - 16, TOP - 16, BOARD_PX + 32, BOARD_PX + 32, 14);
  ctx.clip();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#5b3a18';
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const y = TOP - 10 + i * 20;
    ctx.beginPath();
    for (let x = LEFT - 16; x <= LEFT + BOARD_PX + 16; x += 6) {
      const yy = y + Math.sin((x - LEFT) * 0.035 + i * 1.7) * 3;
      if (x === LEFT - 16) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(60, 36, 12, 0.72)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(cx(0), cy(i));
    ctx.lineTo(cx(SIZE - 1), cy(i));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx(i), cy(0));
    ctx.lineTo(cx(i), cy(SIZE - 1));
    ctx.stroke();
  }
  // 星位（天元 + 四角）
  const stars = [[7, 7], [3, 3], [11, 3], [3, 11], [11, 11]];
  ctx.fillStyle = 'rgba(50, 30, 10, 0.85)';
  for (const [sx, sy] of stars) {
    ctx.beginPath();
    ctx.arc(cx(sx), cy(sy), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 单颗棋子：径向渐变球体 + 左上高光 */
function drawStone(ctx, x, y, color, isLast) {
  const px = cx(x);
  const py = cy(y);
  const r = GRID * 0.46;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
  if (color === 1) {
    // 黑子
    g.addColorStop(0, '#5b5f66');
    g.addColorStop(0.35, '#2a2d33');
    g.addColorStop(1, '#090a0d');
  } else {
    // 白子
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f0f0ee');
    g.addColorStop(1, '#bfc3c8');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 高光
  ctx.save();
  ctx.globalAlpha = color === 1 ? 0.28 : 0.75;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(px - r * 0.32, py - r * 0.38, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 最后一手标记：小圆环
  if (isLast) {
    ctx.save();
    ctx.strokeStyle = ACCENT2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 胜利连线：荧光高亮 */
function drawWinLine(ctx, line) {
  if (!line || line.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(95, 208, 138, 0.85)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(cx(line[0].x), cy(line[0].y));
  for (let i = 1; i < line.length; i++) ctx.lineTo(cx(line[i].x), cy(line[i].y));
  ctx.stroke();
  ctx.restore();
}

/** 顶部状态栏：当前回合提示 */
function drawStatus(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  if (state.winner) {
    const label = state.winner === 'draw' ? '和棋 · 棋盘已满'
      : (state.winner === 'p1' ? '黑棋获胜' : '白棋获胜');
    ctx.fillStyle = ACCENT2;
    ctx.font = '700 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(label, W / 2, 56);
  } else {
    const isBlack = state.turn === 'p1';
    ctx.fillStyle = isBlack ? '#d8dbe2' : '#2a2d33';
    ctx.font = '600 15px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('当前回合', W / 2 - 52, 50);
    // 小棋子指示
    ctx.beginPath();
    ctx.arc(W / 2 - 6, 45, 10, 0, Math.PI * 2);
    ctx.fillStyle = isBlack ? '#1a1c20' : '#f2f2f0';
    ctx.fill();
    ctx.strokeStyle = isBlack ? '#555' : '#bbb';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.font = '600 15px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(isBlack ? '黑棋 (p1)' : '白棋 (p2)', W / 2 + 14, 50);
  }
  // 步数
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.9)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`第 ${state.moveCount + 1} 手 · 15×15`, W / 2, 76);
  ctx.restore();
}

/** 键盘光标高亮（模块级 UI 状态，不进游戏 state） */
function drawCursor(ctx, state) {
  if (!cursor.visible || state.winner) return;
  const px = cx(cursor.x);
  const py = cy(cursor.y);
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(px - GRID / 2 + 2, py - GRID / 2 + 2, GRID - 4, GRID - 4);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w || W, view.h || H, ACCENT);
  drawStatus(ctx, state);
  drawWood(ctx);
  drawGrid(ctx);

  const last = state.lastMove;
  // 先画胜利连线（在棋子下方），再画棋子、光标
  drawWinLine(ctx, state.winningLine);

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
    ctx.fillStyle = 'rgba(6, 9, 16, 0.5)';
    roundRect(ctx, LEFT - 16, TOP + BOARD_PX - 34, BOARD_PX + 32, 46, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8edf7';
    ctx.font = '600 16px -apple-system, "PingFang SC", sans-serif';
    const t = state.winner === 'draw' ? '棋盘已满 · 和棋'
      : (state.winner === 'p1' ? '✦ 黑棋五连获胜' : '✦ 白棋五连获胜');
    ctx.fillText(t, W / 2, TOP + BOARD_PX - 4);
    ctx.restore();
  }

  // 底部提示
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.75)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('点击交叉点落子 · 方向键移动光标 · Enter 落子 · U 悔棋', W / 2, H - 22);
  ctx.restore();
}
