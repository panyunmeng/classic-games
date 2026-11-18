/**
 * 国际跳棋 · 渲染（只读 state，不改状态）。坐标系固定 480×640。
 * 木板棋盘（深/浅格）+ 圆形棋子（径向渐变）+ 王冠标记 + 可走点提示 + 选中高亮 + 键盘光标。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { SIZE, pieceOwner, isKing, genTurnMoves } from './logic.mjs';
import { cursor } from './cursor.mjs';

const ACCENT = '#f87171';
const ACCENT2 = '#fca5a5';
const W = 480;
const H = 640;

// 棋盘几何：8×8，格边长 52px，棋盘 416px，居中留白
const CELL = 52;
const LEFT = (W - CELL * SIZE) / 2;   // 32
const TOP = 120;
const BOARD_PX = CELL * SIZE;          // 416

const LIGHT = '#e9d4ab';
const DARK = '#7a4a2b';

function cx(col) { return LEFT + col * CELL + CELL / 2; }
function cy(row) { return TOP + row * CELL + CELL / 2; }

/** 木质边框 + 棋盘深/浅格 */
function drawBoard(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  const g = ctx.createLinearGradient(LEFT - 14, TOP - 14, LEFT + BOARD_PX + 14, TOP + BOARD_PX + 14);
  g.addColorStop(0, '#b98a4e');
  g.addColorStop(0.5, '#a06f39');
  g.addColorStop(1, '#7c4f27');
  ctx.fillStyle = g;
  roundRect(ctx, LEFT - 14, TOP - 14, BOARD_PX + 28, BOARD_PX + 28, 12);
  ctx.fill();
  ctx.restore();

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const dark = (row + col) % 2 === 1;
      ctx.fillStyle = dark ? DARK : LIGHT;
      ctx.fillRect(LEFT + col * CELL, TOP + row * CELL, CELL, CELL);
    }
  }

  // 细格线
  ctx.save();
  ctx.strokeStyle = 'rgba(40,20,8,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(LEFT + i * CELL, TOP);
    ctx.lineTo(LEFT + i * CELL, TOP + BOARD_PX);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(LEFT, TOP + i * CELL);
    ctx.lineTo(LEFT + BOARD_PX, TOP + i * CELL);
    ctx.stroke();
  }
  ctx.restore();

  // 坐标标记 a~h / 1~8
  ctx.save();
  ctx.fillStyle = 'rgba(232,237,247,0.65)';
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let col = 0; col < SIZE; col++) {
    ctx.fillText(String.fromCharCode(97 + col), LEFT + col * CELL + CELL / 2, TOP - 7);
  }
  ctx.textAlign = 'right';
  for (let row = 0; row < SIZE; row++) {
    ctx.fillText(String(SIZE - row), LEFT - 8, TOP + row * CELL + CELL / 2);
  }
  ctx.restore();
}

/** 单颗棋子：径向渐变球体 + 王冠 */
function drawPiece(ctx, row, col, v) {
  const px = cx(col);
  const py = cy(row);
  const r = CELL * 0.40;
  const owner = pieceOwner(v);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;

  const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
  if (owner === 'p1') {
    g.addColorStop(0, '#6b6f78');
    g.addColorStop(0.4, '#2b2e35');
    g.addColorStop(1, '#0c0d11');
  } else {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#ececea');
    g.addColorStop(1, '#b8bcc2');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 外圈描边区分双方
  ctx.save();
  ctx.strokeStyle = owner === 'p1' ? 'rgba(248,113,113,0.55)' : 'rgba(120,130,145,0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, r * 0.94, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 高光
  ctx.save();
  ctx.globalAlpha = owner === 'p1' ? 0.25 : 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(px - r * 0.3, py - r * 0.38, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 王冠标记（程序化绘制两顶尖角）
  if (isKing(v)) {
    ctx.save();
    ctx.fillStyle = owner === 'p1' ? '#fca5a5' : '#c0392b';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cw = r * 0.9;
    const ch = r * 0.5;
    const baseY = py - ch * 0.2;
    ctx.moveTo(px - cw / 2, baseY + ch * 0.4);
    ctx.lineTo(px - cw / 2, baseY - ch * 0.25);
    ctx.lineTo(px - cw * 0.22, baseY + ch * 0.1);
    ctx.lineTo(px, baseY - ch * 0.45);
    ctx.lineTo(px + cw * 0.22, baseY + ch * 0.1);
    ctx.lineTo(px + cw / 2, baseY - ch * 0.25);
    ctx.lineTo(px + cw / 2, baseY + ch * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** 可走点提示：选中起点后，在目标格中心画半透明圆点；吃子目标用红色 */
function drawHints(ctx, state, selected) {
  if (selected < 0 || state.winner) return;
  const moves = genTurnMoves(state.board, state.turn === 'p1' ? 'p1' : 'p2', state.continueFrom)
    .filter((m) => m.from === selected);
  ctx.save();
  for (const m of moves) {
    const px = cx(m.to % SIZE);
    const py = cy(Math.floor(m.to / SIZE));
    ctx.fillStyle = m.capture ? 'rgba(248,113,113,0.55)' : 'rgba(252,165,165,0.35)';
    ctx.beginPath();
    ctx.arc(px, py, CELL * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = m.capture ? '#f87171' : '#fca5a5';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/** 选中高亮 + 键盘光标 */
function drawMarks(ctx, state) {
  if (selectedIndex >= 0) {
    const px = LEFT + (selectedIndex % SIZE) * CELL;
    const py = TOP + Math.floor(selectedIndex / SIZE) * CELL;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
    ctx.restore();
  }
  if (cursor.visible && !state.winner) {
    const px = LEFT + cursor.x * CELL;
    const py = TOP + cursor.y * CELL;
    ctx.save();
    ctx.strokeStyle = ACCENT2;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
    ctx.restore();
  }
}

// 选中格由 input.mjs 写；模块单例 UI 状态，不进游戏 state
export const selection = { index: -1 };
let selectedIndex = -1;

/** 顶部状态栏 */
function drawStatus(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  if (state.winner) {
    const label = state.winner === 'p1' ? '黑棋获胜' : '白棋获胜';
    ctx.fillStyle = ACCENT;
    ctx.font = '700 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(label, W / 2, 54);
  } else {
    const isBlack = state.turn === 'p1';
    ctx.fillStyle = ACCENT;
    ctx.font = '600 16px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    const must = state.mustJump ? '（必须吃子）' : '';
    ctx.fillText(`${isBlack ? '黑棋 p1' : '白棋 p2'} 走棋${must}`, W / 2, 52);
  }
  ctx.fillStyle = 'rgba(147,160,184,0.9)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  const pc = state.pieceCount || { p1: 0, p2: 0 };
  ctx.fillText(`黑 ${pc.p1} · 白 ${pc.p2} · 第 ${state.moveCount + 1} 手`, W / 2, 78);
  ctx.restore();
}

export function render(ctx, state, view) {
  // 同步 UI 选中状态（input 可能改 selection.index）
  selectedIndex = selection.index;

  drawBackdrop(ctx, view.w || W, view.h || H, ACCENT);
  drawStatus(ctx, state);
  drawBoard(ctx);

  // 棋子
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = state.board[i];
    if (v === 0) continue;
    drawPiece(ctx, Math.floor(i / SIZE), i % SIZE, v);
  }

  drawHints(ctx, state, selectedIndex);
  drawMarks(ctx, state);

  if (state.winner) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,16,0.55)';
    roundRect(ctx, LEFT, TOP + BOARD_PX - 36, BOARD_PX, 44, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8edf7';
    ctx.font = '600 16px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(state.winner === 'p1' ? '✦ 黑棋获胜' : '✦ 白棋获胜', W / 2, TOP + BOARD_PX - 8);
    ctx.restore();
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.75)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('点起点再点终点走棋 · 方向键移光标 · Enter 确认 · U 撤销', W / 2, H - 18);
  ctx.restore();
}

/** 供 input 调用的选中状态重置 */
export function clearSelection() {
  selection.index = -1;
  selectedIndex = -1;
}
