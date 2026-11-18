/**
 * 纸牌接龙 · 布局与命中检测（render / input 共用）。
 * 画布逻辑坐标固定 480×640，与 game.json.canvas 一致。
 */

export const CARD_W = 56;
export const CARD_H = 78;
export const MARGIN = 20;
export const COL_GAP = 8;
export const COL_STEP = CARD_W + COL_GAP; // 64
export const TOP_Y = 58;
export const TABLEAU_Y = 170;
export const FAN_DOWN = 10; // 暗牌叠距
export const FAN_UP = 19;   // 翻开牌叠距
export const WASTE_FAN = 14; // draw-3 时废牌堆横向错开

/** 纯 UI 选中态（不属于游戏逻辑状态，render 只读它画高亮） */
export const ui = { selected: null };

export function colX(i) {
  return MARGIN + i * COL_STEP;
}

export const STOCK_RECT = { x: colX(0), y: TOP_Y, w: CARD_W, h: CARD_H };
export const WASTE_RECT = { x: colX(1), y: TOP_Y, w: CARD_W + WASTE_FAN * 2, h: CARD_H };
export const FOUNDATION_RECTS = [3, 4, 5, 6].map((i) => ({ x: colX(i), y: TOP_Y, w: CARD_W, h: CARD_H }));

function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** 第 i 列第 index 张牌的 y 坐标（按前面牌的朝向累加叠距） */
export function fanY(col, index) {
  let y = TABLEAU_Y;
  for (let j = 0; j < index; j++) y += col[j] && col[j].up ? FAN_UP : FAN_DOWN;
  return y;
}

/**
 * 命中检测：返回点击落在哪个"逻辑区域"。
 * {kind:'stock'|'waste'|'foundation'|'tableau', i, index}
 */
export function hitTest(x, y, state) {
  if (inRect(x, y, STOCK_RECT)) return { kind: 'stock' };
  if (inRect(x, y, WASTE_RECT)) {
    const n = Math.min(state.waste.length, state.drawCount || 1);
    // 从最上层（最后一张）往下找具体点中哪张
    for (let k = n - 1; k >= 0; k--) {
      const rx = WASTE_RECT.x + k * WASTE_FAN;
      if (x >= rx && x <= rx + CARD_W) return { kind: 'waste', index: state.waste.length - n + k };
    }
    return { kind: 'waste', index: state.waste.length - 1 };
  }
  for (let i = 0; i < 4; i++) {
    if (inRect(x, y, FOUNDATION_RECTS[i])) return { kind: 'foundation', i };
  }
  for (let i = 0; i < 7; i++) {
    const col = state.tableau[i];
    for (let j = col.length - 1; j >= 0; j--) {
      const cx = colX(i);
      const cy = fanY(col, j);
      if (x >= cx && x <= cx + CARD_W && y >= cy && y <= cy + CARD_H) {
        return { kind: 'tableau', i, index: j };
      }
    }
    // 点到列下方空白也视为该列（便于往空列放牌）
    if (x >= colX(i) && x <= colX(i) + CARD_W && y >= TABLEAU_Y && y <= 640) {
      return { kind: 'tableau', i, index: col.length };
    }
  }
  return null;
}

/** 把命中区域解析为"源"字符串；不可选返回 null */
export function hitAsSource(hit, state) {
  if (!hit) return null;
  if (hit.kind === 'stock') return null; // stock 由 draw/recycle 处理
  if (hit.kind === 'waste') return state.waste.length ? 'w' : null;
  if (hit.kind === 'foundation') {
    return state.foundations[hit.i].length ? 'f' + hit.i : null;
  }
  if (hit.kind === 'tableau') {
    const col = state.tableau[hit.i];
    if (hit.index >= col.length) return null;
    if (!col[hit.index].up) return null; // 暗牌不能抓
    return 't' + hit.i + ':' + hit.index;
  }
  return null;
}

/** 把命中区域解析为"目标"字符串 */
export function hitAsDest(hit) {
  if (!hit) return null;
  if (hit.kind === 'tableau') return 't' + hit.i;
  if (hit.kind === 'foundation') return 'f' + hit.i;
  return null;
}
