/**
 * 数独 · 视图层共享几何与 UI 状态。
 * 棋盘 9×9 网格 432×432，左边距 24、顶边距 122；其余留给标题/状态/底部提示。
 * selected / noteMode 是 UI 状态，不进游戏逻辑 state（state 保持可纯序列化）。
 */
export const W = 480;
export const H = 640;

export const CELL = 48;
export const LEFT = 24;
export const TOP = 122;
export const BOARD = CELL * 9; // 432

export const COLORS = {
  accent: '#a78bfa',
  accent2: '#c4b5fd',
  given: '#e8edf7',
  filled: '#a78bfa',
  note: '#c4b5fd',
  error: '#ef4444',
  grid: 'rgba(167,139,250,0.35)',
  gridBold: 'rgba(196,181,253,0.85)',
};

export const ui = {
  selected: null, // {r,c}
  noteMode: false,
};

export function resetUi() {
  ui.selected = null;
  ui.noteMode = false;
}

export function cellCenter(x, y) {
  return { c: Math.floor((x - LEFT) / CELL), r: Math.floor((y - TOP) / CELL) };
}

export function inBoard(x, y) {
  return x >= LEFT && x < LEFT + BOARD && y >= TOP && y < TOP + BOARD;
}

export function cellRect(r, c) {
  return { x: LEFT + c * CELL, y: TOP + r * CELL };
}
