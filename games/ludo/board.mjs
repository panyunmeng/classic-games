/**
 * 飞行棋 · 棋盘几何（render.mjs 与 input.mjs 共用同一份坐标）。
 *
 * 为什么单独一个模块：点击选子必须和画出来的圆片严格重合，两边各写一份坐标
 * 迟早错位；这里只放纯几何（无 DOM、无随机），渲染与输入都从它取点。
 *
 * 坐标事实：15×15 格、每格 CELL=26 px、棋盘 390×390、左上角 (45, 114)。
 * 环道 52 格是绕十字外沿一圈的闭合折线，终点跑道是四条中线的 6 格。
 */
import { COLORS, PIECES, RING, LANE, GOAL } from './logic.mjs';

export const CELL = 26;
export const COLS = 15;
export const ROWS = 15;
export const BOARD_X = 45;
export const BOARD_Y = 114;
export const BOARD_PX = CELL * COLS;
export const DICE = { x: 192, y: 522, w: 96, h: 96 };

/** 52 格环形跑道：顺时针，从底臂左列开始。红起点 = 12，之后每色 +13 */
export const RING_PATH = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
];

/** 终点跑道 6 格，方向都指向中心 (7,7) 一侧 */
export const LANES = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]], // 红：左臂中线
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]], // 蓝：上臂中线
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]], // 绿：右臂中线
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]], // 黄：下臂中线
];

/** 四个基地的 6×6 象限左上角（格坐标） */
export const BASE_ORIGIN = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];

/** 基地 4 个洞在象限内的中心（格坐标，以象限左上角为原点） */
export const BASE_HOLES = [
  [1.5, 1.5],
  [3.5, 1.5],
  [1.5, 3.5],
  [3.5, 3.5],
];

/** 每个象限内 4 个洞的落点（含象限偏移） */
export const BASE_SLOTS = BASE_ORIGIN.map(([ox, oy]) =>
  BASE_HOLES.map(([hx, hy]) => [ox + hx, oy + hy])
);

/** 终点格（lane 最后一格）上 4 子并排的展开方向：横向跑道竖排、纵向跑道横排 */
const GOAL_AXIS = [
  [0, 1],
  [1, 0],
  [0, 1],
  [1, 0],
];

/** 格坐标（可为小数）→ 画布像素；整数格用 cellCenter 取中心 */
export function cellPoint(col, row) {
  return { x: BOARD_X + col * CELL, y: BOARD_Y + row * CELL };
}

export function cellCenter(col, row) {
  return cellPoint(col + 0.5, row + 0.5);
}

export function ringCell(index) {
  return RING_PATH[((index % RING) + RING) % RING];
}

export function laneCenter(playerIndex, laneIndex) {
  const [col, row] = LANES[playerIndex][laneIndex];
  return cellCenter(col, row);
}

export function baseHole(playerIndex, hole) {
  const [col, row] = BASE_SLOTS[playerIndex][hole];
  return cellPoint(col, row);
}

/** 已到终点的子：挤在 lane 最后一格，按横/纵向展开，避免互相遮住 */
export function goalSlot(playerIndex, piece) {
  const base = laneCenter(playerIndex, LANE - 1);
  const [ax, ay] = GOAL_AXIS[playerIndex];
  const off = (piece - (PIECES - 1) / 2) * 6;
  return { x: base.x + ax * off, y: base.y + ay * off };
}

/** 环上第 i 格属于哪一色（每色 13 格，用于四色跑道着色） */
export function quadrantOfRing(index) {
  for (let c = 0; c < COLORS.length; c++) {
    const d = (((index - COLORS[c].start) % RING) + RING) % RING;
    if (d < RING / COLORS.length) return c;
  }
  return 0;
}

/** 某方所有棋子的像素位置（基地洞 / 环格 / 终点跑道 / 终点），可叠格做横向错位 */
export function piecePositions(state, playerIndex) {
  const row = state.players[playerIndex].pieces;
  const start = state.players[playerIndex].start;
  const keyOf = (p, k) => (p.home ? `h${k}` : p.progress === GOAL ? `g${k}` : `p${p.progress}`);
  const counts = new Map();
  for (let k = 0; k < row.length; k++) {
    const key = keyOf(row[k], k);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seen = new Map();
  const out = [];
  for (let k = 0; k < row.length; k++) {
    const p = row[k];
    const key = keyOf(p, k);
    const total = counts.get(key) || 1;
    const i = seen.get(key) || 0;
    seen.set(key, i + 1);

    let pos;
    if (p.home) pos = baseHole(playerIndex, k);
    else if (p.progress === GOAL) pos = goalSlot(playerIndex, k);
    else if (p.progress >= RING) pos = laneCenter(playerIndex, p.progress - RING);
    else pos = cellCenter(...ringCell(start + p.progress));

    let { x, y } = pos;
    let r = p.progress === GOAL ? 6.5 : 9;
    if (total > 1 && !p.home && p.progress !== GOAL) {
      const spread = total >= 3 ? 4.5 : 6;
      x += (i - (total - 1) / 2) * spread;
      r = total >= 3 ? 7 : 8;
    }
    out.push({ piece: k, x, y, r, home: p.home, progress: p.progress });
  }
  return out;
}

/** 着法的落点（用于高亮）：环格 / 终点跑道格 */
export function targetPos(playerIndex, move) {
  if (move.to <= RING - 1) return cellCenter(...ringCell(COLORS[playerIndex].start + move.to));
  return laneCenter(playerIndex, move.to - RING);
}
