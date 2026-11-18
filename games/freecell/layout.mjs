/**
 * 空当接龙 · 布局与命中检测（render / input 共用）。
 * 画布逻辑坐标固定 480×640，与 game.json.canvas 一致。
 *
 * 版式：上方 8 个槽位——左 4 个自由格、右 4 个基础堆；下方 8 列扇形牌列。
 * 牌列叠距随列长自适应（列越长叠得越紧），保证 52 张全堆一列也画得下。
 */
import { isValidRun } from './logic.mjs';

export const VIEW_W = 480;
export const VIEW_H = 640;
export const CARD_W = 52;
export const CARD_H = 72;
export const MARGIN = 18;
export const GAP = 4;
export const COL_STEP = CARD_W + GAP; // 56
export const COLUMNS = 8;
export const TOP_Y = 68;
export const TABLEAU_Y = 166;
export const BOTTOM_PAD = 34;
export const FAN_MAX = 32;
const FAN_MIN = 5;

export function colX(i) {
  return MARGIN + i * COL_STEP;
}

export const FREE_RECTS = [0, 1, 2, 3].map((i) => ({ x: colX(i), y: TOP_Y, w: CARD_W, h: CARD_H }));
export const FOUNDATION_RECTS = [4, 5, 6, 7].map((i) => ({ x: colX(i), y: TOP_Y, w: CARD_W, h: CARD_H }));

/** 纯 UI 选中态（不属于游戏逻辑状态，render 只读它画高亮） */
export const ui = { selected: null };

export function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** 一列牌的纵向叠距：列越长越紧，最紧 FAN_MIN */
export function fanStep(len) {
  if (len <= 1) return 0;
  const avail = VIEW_H - BOTTOM_PAD - TABLEAU_Y - CARD_H;
  return Math.max(FAN_MIN, Math.min(FAN_MAX, avail / (len - 1)));
}

/** 第 i 列第 index 张牌的 y 坐标 */
export function fanY(col, index) {
  return TABLEAU_Y + index * fanStep(col.length);
}

/**
 * 命中检测：返回点击落在哪个逻辑区域。
 * 同列内从末张往前找——扇形叠放时后画的牌在上层，先命中的就是看得见的那张。
 * {kind:'free'|'foundation'|'tableau', i, index}
 */
export function hitTest(x, y, state) {
  for (let i = 0; i < 4; i++) if (inRect(x, y, FREE_RECTS[i])) return { kind: 'free', i };
  for (let i = 0; i < 4; i++) if (inRect(x, y, FOUNDATION_RECTS[i])) return { kind: 'foundation', i };
  for (let i = 0; i < COLUMNS; i++) {
    const col = state.tableau[i];
    for (let j = col.length - 1; j >= 0; j--) {
      const cy = fanY(col, j);
      if (x >= colX(i) && x <= colX(i) + CARD_W && y >= cy && y <= cy + CARD_H) {
        return { kind: 'tableau', i, index: j };
      }
    }
    if (x >= colX(i) && x <= colX(i) + CARD_W && y >= TABLEAU_Y && y <= VIEW_H) {
      return { kind: 'tableau', i, index: col.length }; // 列下方空白：当作"这一列"的目标
    }
  }
  return null;
}

/** 命中区域 → 可选的源字符串；不可选返回 null */
export function hitAsSource(hit, state) {
  if (!hit) return null;
  if (hit.kind === 'free') return state.freeCells[hit.i] ? 'f' + hit.i : null;
  if (hit.kind === 'foundation') return state.foundations[hit.i].length ? 'd' + hit.i : null;
  const col = state.tableau[hit.i];
  if (hit.index >= col.length) return null;
  return `t${hit.i}:${hit.index}`;
}

/** 命中区域 → 目标字符串 */
export function hitAsDest(hit) {
  if (!hit) return null;
  if (hit.kind === 'tableau') return 't' + hit.i;
  if (hit.kind === 'foundation') return 'd' + hit.i;
  if (hit.kind === 'free') return 'f' + hit.i;
  return null;
}

/** 解析 't3:2' / 'f1' / 'd0' */
export function parseSelected(sel) {
  if (typeof sel !== 'string') return null;
  let m = /^t([0-7]):(\d+)$/.exec(sel);
  if (m) return { type: 't', i: Number(m[1]), idx: Number(m[2]) };
  m = /^f([0-3])$/.exec(sel);
  if (m) return { type: 'f', i: Number(m[1]) };
  m = /^d([0-3])$/.exec(sel);
  if (m) return { type: 'd', i: Number(m[1]) };
  return null;
}

/**
 * 当前选中要搬的牌，返回 [{card, x, y}]（render 画高亮、input 判断"同源取消"都用它）。
 * 选中列时按逻辑层的 runStart 规则取整组；选中后状态若已变（撤销/自动收），返回空数组。
 */
export function selectedRun(state, selected = ui.selected) {
  const sel = parseSelected(selected);
  if (!sel || !state) return [];
  if (sel.type === 'f') {
    const card = state.freeCells[sel.i];
    if (!card) return [];
    return [{ card, x: FREE_RECTS[sel.i].x, y: FREE_RECTS[sel.i].y, h: CARD_H }];
  }
  if (sel.type === 'd') {
    const stack = state.foundations[sel.i];
    return stack.length
      ? [{ card: stack[stack.length - 1], x: FOUNDATION_RECTS[sel.i].x, y: FOUNDATION_RECTS[sel.i].y, h: CARD_H }]
      : [];
  }
  const col = state.tableau[sel.i];
  if (!col || sel.idx < 0 || sel.idx >= col.length) return [];
  if (!isValidRun(col, sel.idx)) return [];
  const step = fanStep(col.length);
  const out = [];
  for (let k = sel.idx; k < col.length; k++) {
    // 非末张只露出顶部一条，高亮就画这条可见带，避免盖住下面叠着的牌
    const h = k < col.length - 1 ? Math.min(CARD_H, step) : CARD_H;
    out.push({ card: col[k], x: colX(sel.i), y: fanY(col, k), h });
  }
  return out;
}
