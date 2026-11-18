/**
 * 蜘蛛纸牌 · 布局与命中检测（render / input 共用）。
 * 画布逻辑坐标固定 480×640，与 game.json.canvas 一致；10 列竖排。
 */
import { COLUMNS, isMovableRun } from './logic.mjs';

export const CARD_W = 42;
export const CARD_H = 58;
export const MARGIN = 12;
export const GAP = 4;
export const COL_STEP = CARD_W + GAP; // 46
export const TOP_Y = 36;
export const TABLEAU_Y = 112;
export const BOTTOM_LIMIT = 596; // 牌列最低不得越过这条线（下方留给提示文字）
export const FAN_DOWN = 8; // 暗牌叠距
export const FAN_UP = 16; // 翻开牌叠距

export const STOCK_RECT = { x: MARGIN, y: TOP_Y, w: CARD_W, h: CARD_H };

/** 纯 UI 选中态（不属于游戏逻辑状态，render 只读它画高亮） */
export const ui = { selected: null }; // { col, index }

export function colX(i) {
  return MARGIN + i * COL_STEP;
}

/**
 * 一列每张牌的 y 坐标。
 * 正常按 FAN_DOWN / FAN_UP 叠放；牌太多时等比压缩叠距，保证整列不压到底部提示。
 */
export function cardYs(col) {
  const ys = [];
  if (!col.length) return ys;
  const steps = [];
  let total = 0;
  for (let j = 1; j < col.length; j++) {
    const step = col[j - 1].faceUp ? FAN_UP : FAN_DOWN;
    steps.push(step);
    total += step;
  }
  const maxSpan = BOTTOM_LIMIT - TABLEAU_Y - CARD_H;
  const k = total > maxSpan ? maxSpan / total : 1;
  let y = TABLEAU_Y;
  ys.push(y);
  for (const step of steps) {
    y += step * k;
    ys.push(y);
  }
  return ys;
}

function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/**
 * 命中检测：返回点击落在哪个逻辑区域。
 * { kind:'stock' } | { kind:'tableau', i, index }（index 等于列长表示列下方空白）
 */
export function hitTest(x, y, state) {
  if (inRect(x, y, STOCK_RECT)) return { kind: 'stock' };
  if (y < TABLEAU_Y) return null;
  for (let i = 0; i < COLUMNS; i++) {
    const cx = colX(i);
    if (x < cx || x > cx + CARD_W) continue;
    const col = state.tableau[i] || [];
    const ys = cardYs(col);
    for (let j = col.length - 1; j >= 0; j--) {
      if (y >= ys[j] && y <= ys[j] + CARD_H) return { kind: 'tableau', i, index: j };
    }
    return { kind: 'tableau', i, index: col.length };
  }
  return null;
}

/** 命中位置是否是一段可搬牌组的起点；不可搬返回 null */
export function sourceAt(hit, state) {
  if (!hit || hit.kind !== 'tableau') return null;
  const col = state.tableau[hit.i];
  if (!col || hit.index >= col.length) return null;
  if (!col[hit.index].faceUp) return null;
  if (!isMovableRun(col, hit.index)) return null;
  return { col: hit.i, index: hit.index };
}
