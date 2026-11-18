/**
 * 空当接龙 · Canvas 渲染（480×640）。
 * 绿毡桌面 + 程序化牌面（无图片资源）；上方 4 自由格 + 4 基础堆，下方 8 列扇形叠。
 * render 只读 state 与 layout.ui（纯 UI 选中态），不改游戏状态。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { SUIT_SYMBOL, rankText, isRed } from './logic.mjs';
import {
  CARD_W, CARD_H, MARGIN, TOP_Y, TABLEAU_Y, COLUMNS,
  FREE_RECTS, FOUNDATION_RECTS, colX, fanY,
  selectedRun, VIEW_W, VIEW_H,
} from './layout.mjs';

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const ACCENT = '#60a5fa';
const ACCENT2 = '#93c5fd';
const FELT_TOP = '#0f7a47';
const FELT_BOTTOM = '#064a29';
const FOUNDATION_SUITS = ['♠', '♥', '♦', '♣'];

function drawFelt(ctx, w, h) {
  drawBackdrop(ctx, w, h, ACCENT);
  const g = ctx.createLinearGradient(0, 0, w * 0.7, h);
  g.addColorStop(0, FELT_TOP);
  g.addColorStop(0.55, '#0a6139');
  g.addColorStop(1, FELT_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 毡布纹理：固定点位、无随机（同 klondike 做法，保证每帧一致）
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = '#ffffff';
  for (let y = 6; y < h; y += 9) {
    for (let x = ((y / 9) % 2) * 5; x < w; x += 13) ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawSlot(ctx, r, label, fontSize = 11) {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(226,240,255,0.34)';
  ctx.lineWidth = 1.3;
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = 'rgba(226,240,255,0.30)';
    ctx.font = `600 ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  }
  ctx.restore();
}

/** 程序化牌面：角标点数+花色、中央大花色（人头牌用字母），右下角倒置角标 */
function drawCard(ctx, card, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  const g = ctx.createLinearGradient(x, y, x, y + CARD_H);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e9eff8');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, CARD_W, CARD_H, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(15,23,42,0.32)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, CARD_W, CARD_H, 7);
  ctx.stroke();

  const red = isRed(card);
  const color = red ? '#c81e3c' : '#16233b';
  const sym = SUIT_SYMBOL[card.suit];
  const label = rankText(card.rank);
  const cx = x + CARD_W / 2;
  const cy = y + CARD_H / 2;

  // 左上角
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${label === '10' ? 13 : 15}px ${FONT}`;
  ctx.fillText(label, x + 5, y + 4);
  ctx.font = `12px ${FONT}`;
  ctx.fillText(sym, x + 6, y + 20);

  // 中央
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const face = { 11: 'J', 12: 'Q', 13: 'K' }[card.rank];
  if (face) {
    ctx.font = `700 23px ${FONT}`;
    ctx.fillText(face, cx, cy - 6);
    ctx.font = `15px ${FONT}`;
    ctx.fillText(sym, cx, cy + 16);
  } else {
    ctx.font = `27px ${FONT}`;
    ctx.fillText(sym, cx, cy + 1);
  }

  // 右下角（倒置）
  ctx.save();
  ctx.translate(x + CARD_W - 5, y + CARD_H - 4);
  ctx.rotate(Math.PI);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText(label, 0, 0);
  ctx.font = `10px ${FONT}`;
  ctx.fillText(sym, 1, 14);
  ctx.restore();
  ctx.restore();
}

function drawHeader(ctx, state, w) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText('空当接龙', w / 2, 28);
  ctx.fillStyle = 'rgba(226,240,255,0.82)';
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(
    `分数 ${state.score} · 步数 ${state.moves} · 回收 ${state.foundationCount}/52`,
    w / 2,
    47,
  );
  ctx.restore();

  // 槽位分组标签
  ctx.save();
  ctx.fillStyle = 'rgba(226,240,255,0.55)';
  ctx.font = `600 10px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('自由格', FREE_RECTS[0].x, TOP_Y - 7);
  ctx.textAlign = 'right';
  ctx.fillText('基础堆 A → K', colX(COLUMNS - 1) + CARD_W, TOP_Y - 7);
  ctx.restore();
}

function drawTopRow(ctx, state) {
  for (let i = 0; i < 4; i++) {
    const card = state.freeCells[i];
    if (card) drawCard(ctx, card, FREE_RECTS[i].x, FREE_RECTS[i].y);
    else drawSlot(ctx, FREE_RECTS[i], '自由');
  }
  for (let i = 0; i < 4; i++) {
    const stack = state.foundations[i];
    if (stack.length) drawCard(ctx, stack[stack.length - 1], FOUNDATION_RECTS[i].x, FOUNDATION_RECTS[i].y);
    else drawSlot(ctx, FOUNDATION_RECTS[i], FOUNDATION_SUITS[i], 20);
  }
}

function drawTableau(ctx, state) {
  for (let i = 0; i < COLUMNS; i++) {
    const col = state.tableau[i];
    if (!col.length) {
      drawSlot(ctx, { x: colX(i), y: TABLEAU_Y, w: CARD_W, h: CARD_H }, '空列');
      continue;
    }
    for (let j = 0; j < col.length; j++) drawCard(ctx, col[j], colX(i), fanY(col, j));
  }
}

function drawSelection(ctx, state) {
  const run = selectedRun(state);
  for (const item of run) {
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.6;
    roundRect(ctx, item.x - 1, item.y - 1, CARD_W + 2, item.h + 2, 7);
    ctx.stroke();
    ctx.restore();
  }
}

function drawFooter(ctx, state, w, h) {
  const run = selectedRun(state);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(226,240,255,0.72)';
  ctx.font = `12px ${FONT}`;
  let hint;
  if (run.length) {
    hint = `已选 ${run.length} 张 · 点目标放置，点自己取消`;
  } else {
    hint = `点牌选源 → 点目标 · 空格 ${state.freeCellEmpty} · 空列 ${state.emptyColumnCount}`;
  }
  ctx.fillText(hint, w / 2, h - 14);
  ctx.restore();
}

function drawWinBanner(ctx, state, w) {
  const x = MARGIN;
  const y = 286;
  const bw = w - MARGIN * 2;
  ctx.save();
  ctx.fillStyle = 'rgba(3,32,20,0.86)';
  roundRect(ctx, x, y, bw, 92, 14);
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.6;
  roundRect(ctx, x, y, bw, 92, 14);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText('52 张归位 · 通关！', w / 2, y + 38);
  ctx.fillStyle = 'rgba(226,240,255,0.86)';
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText(`得分 ${state.score} · 步数 ${state.moves}`, w / 2, y + 66);
  ctx.restore();
}

export function render(ctx, state, view) {
  const w = view.w || VIEW_W;
  const h = view.h || VIEW_H;
  drawFelt(ctx, w, h);
  drawHeader(ctx, state, w);
  drawTopRow(ctx, state);
  drawTableau(ctx, state);
  drawSelection(ctx, state);
  drawFooter(ctx, state, w, h);
  if (state.won) drawWinBanner(ctx, state, w);
}
