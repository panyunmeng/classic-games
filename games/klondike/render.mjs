/**
 * 纸牌接龙 · Canvas 渲染（480×640）。
 * 绿色毡布桌面，牌面程序化绘制（花色符号 ♠♥♦♣、A/K/Q/J/数字），
 * tableau 扇形叠放，暗牌用程序化背面图案。render 只读 state，不改状态。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import {
  CARD_W, CARD_H, MARGIN, TOP_Y, TABLEAU_Y, WASTE_FAN,
  colX, fanY, STOCK_RECT, WASTE_RECT, FOUNDATION_RECTS, ui, hitTest,
} from './layout.mjs';
import { SUIT_SYMBOL, rankText, isRed } from './logic.mjs';

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const GREEN = '#0b6b3a';
const GREEN_DARK = '#07542d';
const ACCENT = '#4ade80';
const ACCENT2 = '#86efac';

function drawFelt(ctx, w, h) {
  drawBackdrop(ctx, w, h, ACCENT);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(16,122,66,0.92)');
  g.addColorStop(1, 'rgba(6,74,40,0.96)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 细微毡布噪点（程序化，固定点位，无随机）
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#ffffff';
  for (let y = 4; y < h; y += 7) {
    for (let x = ((y / 7) % 2) * 4; x < w; x += 9) ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawSlot(ctx, r, label) {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(230,255,238,0.38)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = 'rgba(230,255,238,0.30)';
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  }
  ctx.restore();
}

function drawBack(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  const g = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  g.addColorStop(0, '#1d4ed8');
  g.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, CARD_W, CARD_H, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, x + 3, y + 3, CARD_W - 6, CARD_H - 6, 5);
  ctx.stroke();
  // 程序化网格 + 中心菱形
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(191,219,254,0.28)';
  ctx.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 8) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + CARD_H, y + CARD_H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = ACCENT2;
  ctx.lineWidth = 1.6;
  const cx = x + CARD_W / 2;
  const cy = y + CARD_H / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx + 14, cy);
  ctx.lineTo(cx, cy + 14);
  ctx.lineTo(cx - 14, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = ACCENT2;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 画一张正面朝上的牌 */
function drawFace(ctx, card, x, y, highlight) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = highlight ? 14 : 6;
  ctx.shadowColor = highlight ? ACCENT : 'rgba(0,0,0,0.35)';
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#f8fafc';
  roundRect(ctx, x, y, CARD_W, CARD_H, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = highlight ? ACCENT : 'rgba(15,23,42,0.35)';
  ctx.lineWidth = highlight ? 2.4 : 1;
  roundRect(ctx, x, y, CARD_W, CARD_H, 7);
  ctx.stroke();

  const color = isRed(card) ? '#dc2626' : '#111827';
  const sym = SUIT_SYMBOL[card.suit];
  const label = rankText(card.rank);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  // 左上角点数 + 花色
  ctx.textAlign = 'left';
  ctx.font = `700 ${label === '10' ? 13 : 15}px ${FONT}`;
  ctx.fillText(label, x + 5, y + 4);
  ctx.font = `12px ${FONT}`;
  ctx.fillText(sym, x + 6, y + 20);

  // 中央大花色（人头牌用首字 A/K/Q/J，数字牌用大花色）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const face = { 11: 'K', 12: 'Q', 13: 'J' }[card.rank];
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(face || sym, x + CARD_W / 2, y + CARD_H / 2 - 2);
  if (!face) {
    ctx.font = `12px ${FONT}`;
    ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2 + 20);
  }

  // 右下角倒置点数 + 花色
  ctx.save();
  ctx.translate(x + CARD_W - 5, y + CARD_H - 4);
  ctx.rotate(Math.PI);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${label === '10' ? 13 : 15}px ${FONT}`;
  ctx.fillText(label, 0, 0);
  ctx.font = `12px ${FONT}`;
  ctx.fillText(sym, 1, 16);
  ctx.restore();
  ctx.restore();
}

/** 选中源牌堆的可视高亮：返回该源对应顶牌的 (x,y) 或 null */
function selectedTopPos(state, selected) {
  if (!selected) return null;
  if (selected === 'w') {
    if (!state.waste.length) return null;
    return { x: WASTE_RECT.x + (Math.min(state.waste.length, state.drawCount || 1) - 1) * WASTE_FAN, y: TOP_Y };
  }
  if (selected[0] === 'f') {
    const i = Number(selected[1]);
    if (!state.foundations[i]?.length) return null;
    return { x: FOUNDATION_RECTS[i].x, y: TOP_Y };
  }
  if (selected[0] === 't') {
    const m = /^t(\d):(\d+)$/.exec(selected);
    if (!m) return null;
    const col = state.tableau[Number(m[1])];
    const idx = Number(m[2]);
    if (!col || !col[idx]) return null;
    return { x: colX(Number(m[1])), y: fanY(col, idx) };
  }
  return null;
}

export function render(ctx, state, view) {
  drawFelt(ctx, view.w, view.h);

  // 顶栏：标题 / 分数 / 步数
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText('纸牌接龙', view.w / 2, 30);
  ctx.fillStyle = 'rgba(230,255,238,0.85)';
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(`分数 ${state.score} · 步数 ${state.moves} · 回收 ${state.foundationCount}/52`, view.w / 2, 49);
  ctx.restore();

  // 上排槽位
  drawSlot(ctx, STOCK_RECT, state.stock.length ? '' : '↻');
  drawSlot(ctx, WASTE_RECT, '');
  FOUNDATION_RECTS.forEach((r, i) => drawSlot(ctx, r, ['♠', '♥', '♦', '♣'][i]));

  // stock 顶：画一叠背面（最多 3 张示意厚度）
  if (state.stock.length) {
    const layers = Math.min(3, state.stock.length);
    for (let k = 0; k < layers; k++) drawBack(ctx, STOCK_RECT.x - k * 1.5, TOP_Y - k * 1.5);
  }

  // waste：draw-3 时横向错开，只显示最后几张
  const visible = Math.min(state.waste.length, state.drawCount || 1);
  for (let k = 0; k < visible; k++) {
    const idx = state.waste.length - visible + k;
    drawFace(ctx, state.waste[idx], WASTE_RECT.x + k * WASTE_FAN, TOP_Y, false);
  }

  // foundations：每槽只画顶牌
  state.foundations.forEach((f, i) => {
    if (f.length) drawFace(ctx, f[f.length - 1], FOUNDATION_RECTS[i].x, TOP_Y, false);
  });

  // tableau：扇形叠放
  for (let i = 0; i < 7; i++) {
    const col = state.tableau[i];
    for (let j = 0; j < col.length; j++) {
      const x = colX(i);
      const y = fanY(col, j);
      if (col[j].up) drawFace(ctx, col[j], x, y, false);
      else drawBack(ctx, x, y);
    }
  }

  // 选中高亮：在选中牌堆的顶牌上再描一遍金边
  const selPos = selectedTopPos(state, ui.selected);
  if (selPos) {
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 12;
    roundRect(ctx, selPos.x - 2, selPos.y - 2, CARD_W + 4, CARD_H + 4, 9);
    ctx.stroke();
    ctx.restore();
  }

  // 胜利横幅
  if (state.won) {
    ctx.save();
    ctx.fillStyle = 'rgba(3,40,22,0.82)';
    roundRect(ctx, MARGIN, 285, view.w - MARGIN * 2, 86, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT2;
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText('全部回收 · 通关！', view.w / 2, 320);
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(`最终得分 ${state.score}`, view.w / 2, 351);
    ctx.restore();
  }

  // 底部提示
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(220,252,231,0.7)';
  ctx.font = `12px ${FONT}`;
  const hint = ui.selected
    ? '已选源牌堆 · 点目标放置，点别处取消'
    : '点牌选源 → 点目标移动 · 空列只放 K · 双击牌自动收';
  ctx.fillText(hint, view.w / 2, view.h - 16);
  ctx.restore();

  // 记录当前命中表（input 复用 hitTest，这里仅保证 render 无副作用）
  void hitTest;
}
