/**
 * 蜘蛛纸牌 · Canvas 渲染（480×640）。
 * 绿毡桌面，牌面程序化绘制（花色符号 + 点数），10 列扇形叠放，
 * 暗牌画程序化背纹，顶部发牌堆与已收组数。render 只读 state，不改状态。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import {
  CARD_W,
  CARD_H,
  MARGIN,
  TOP_Y,
  TABLEAU_Y,
  colX,
  cardYs,
  STOCK_RECT,
  ui,
} from './layout.mjs';
import { SUIT_SYMBOL, rankText, COLUMNS } from './logic.mjs';

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const AMBER = '#f59e0b';
const AMBER2 = '#fbbf24';
const FELT_TOP = 'rgba(17,124,74,0.95)';
const FELT_BOTTOM = 'rgba(5,63,35,0.97)';
const INK = '#0f172a';
const RED = '#dc2626';

function drawFelt(ctx, w, h) {
  drawBackdrop(ctx, w, h, AMBER);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, FELT_TOP);
  g.addColorStop(1, FELT_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 毡布细纹：固定步距，无随机
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#ffffff';
  for (let y = 4; y < h; y += 7) {
    for (let x = ((y / 7) % 2) * 4; x < w; x += 9) ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawSlot(ctx, x, y, label) {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(236,253,245,0.32)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, y, CARD_W, CARD_H, 7);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = 'rgba(236,253,245,0.28)';
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2);
  }
  ctx.restore();
}

/** 程序化牌背：深靛蓝渐变 + 斜纹 + 琥珀内框 */
function drawBack(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  const g = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  g.addColorStop(0, '#1e3a8a');
  g.addColorStop(1, '#172554');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, CARD_W, CARD_H, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x + 3, y + 3, CARD_W - 6, CARD_H - 6, 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(191,219,254,0.22)';
  ctx.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 7) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + CARD_H, y + CARD_H);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(251,191,36,0.75)';
  ctx.lineWidth = 1.3;
  roundRect(ctx, x + 3, y + 3, CARD_W - 6, CARD_H - 6, 4);
  ctx.stroke();
  ctx.restore();
}

/** 画一张正面朝上的牌；hi=true 时用琥珀色描边表示被选中 */
function drawFace(ctx, card, x, y, hi) {
  const color = card.suit === 'H' ? RED : INK;
  const sym = SUIT_SYMBOL[card.suit];
  const label = rankText(card.rank);

  ctx.save();
  if (hi) {
    ctx.shadowColor = AMBER;
    ctx.shadowBlur = 12;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = 5;
  }
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#f8fafc';
  roundRect(ctx, x, y, CARD_W, CARD_H, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = hi ? AMBER : 'rgba(15,23,42,0.35)';
  ctx.lineWidth = hi ? 2.2 : 1;
  roundRect(ctx, x, y, CARD_W, CARD_H, 6);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${label === '10' ? 11 : 13}px ${FONT}`;
  ctx.fillText(label, x + 4, y + 3);
  ctx.font = `10px ${FONT}`;
  ctx.fillText(sym, x + 5, y + 16);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (card.rank >= 11) {
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2 + 3);
  } else {
    ctx.font = `18px ${FONT}`;
    ctx.fillText(sym, x + CARD_W / 2, y + CARD_H / 2 + 4);
  }
  ctx.restore();
}

/** 顶部已收组数：8 个小格，收满一组点亮一格 */
function drawSetPips(ctx, completed, w) {
  const pipW = 14;
  const pipH = 20;
  const gap = 4;
  const total = 8 * pipW + 7 * gap;
  const startX = w - MARGIN - total;
  const y = TOP_Y + 14;
  for (let i = 0; i < 8; i++) {
    const x = startX + i * (pipW + gap);
    ctx.save();
    if (i < completed) {
      ctx.fillStyle = AMBER;
      roundRect(ctx, x, y, pipW, pipH, 3);
      ctx.fill();
      ctx.fillStyle = '#3b2504';
      ctx.font = `700 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', x + pipW / 2, y + pipH / 2 + 1);
    } else {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(251,191,36,0.45)';
      ctx.lineWidth = 1.2;
      roundRect(ctx, x, y, pipW, pipH, 3);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 选中牌组时，画出该段牌的位置（用于高亮判断） */
function selectedRange(state) {
  const sel = ui.selected;
  if (!sel) return null;
  const col = state.tableau[sel.col];
  if (!col || sel.index >= col.length) return null;
  return { col: sel.col, index: sel.index };
}

export function render(ctx, state, view) {
  const w = view.w;
  const h = view.h;
  drawFelt(ctx, w, h);

  // 顶部信息
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AMBER2;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(`得分 ${state.score}`, w / 2 - 96, 20);
  ctx.fillStyle = 'rgba(236,253,245,0.88)';
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(`已收 ${state.completedSets}/8`, w / 2, 20);
  ctx.fillText(`步数 ${state.moves}`, w / 2 + 96, 20);
  ctx.restore();

  // 发牌堆
  drawSlot(ctx, STOCK_RECT.x, STOCK_RECT.y, state.stock > 0 ? '' : '空');
  if (state.stock > 0) {
    const layers = Math.min(4, state.stock);
    for (let k = 0; k < layers; k++) drawBack(ctx, STOCK_RECT.x - k * 1.5, TOP_Y - k * 1.5);
  }
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AMBER2;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText(`发牌 ${state.stock} 轮`, STOCK_RECT.x + CARD_W + 10, TOP_Y + 18);
  ctx.fillStyle = 'rgba(236,253,245,0.7)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`剩 ${state.stockCards} 张 · 每轮 10 张`, STOCK_RECT.x + CARD_W + 10, TOP_Y + 34);
  ctx.fillText('点牌堆发一轮', STOCK_RECT.x + CARD_W + 10, TOP_Y + 49);
  ctx.restore();

  // 已收组数
  drawSetPips(ctx, state.completedSets, w);

  // tableau
  const sel = selectedRange(state);
  for (let i = 0; i < COLUMNS; i++) {
    const col = state.tableau[i];
    const x = colX(i);
    if (!col.length) {
      drawSlot(ctx, x, TABLEAU_Y, '');
      continue;
    }
    const ys = cardYs(col);
    for (let j = 0; j < col.length; j++) {
      const hi = !!sel && sel.col === i && j >= sel.index;
      if (col[j].faceUp) drawFace(ctx, col[j], x, ys[j], hi);
      else drawBack(ctx, x, ys[j]);
    }
  }

  // 胜利横幅
  if (state.won) {
    ctx.save();
    ctx.fillStyle = 'rgba(3,32,18,0.86)';
    roundRect(ctx, MARGIN, 268, w - MARGIN * 2, 92, 14);
    ctx.fill();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    roundRect(ctx, MARGIN, 268, w - MARGIN * 2, 92, 14);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = AMBER2;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText('8 组收齐 · 通关！', w / 2, 303);
    ctx.fillStyle = 'rgba(236,253,245,0.9)';
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(`最终得分 ${state.score} · 步数 ${state.moves}`, w / 2, 336);
    ctx.restore();
  }

  // 底部提示
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220,252,231,0.72)';
  ctx.font = `12px ${FONT}`;
  const hint = sel
    ? '已选牌组 · 点目标列放下（点同列空白取消）'
    : '点牌选源 → 点目标移动 · 同花色连续递减序列可整体拖动';
  ctx.fillText(hint, w / 2, h - 14);
  ctx.restore();
}
