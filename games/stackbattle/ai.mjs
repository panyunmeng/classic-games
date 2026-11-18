/**
 * 方块对战 · p2 的确定性 AI（简化策略：优先消行，其次贴边、低堆、少洞）
 *
 * 为什么是纯函数而不是带随机的启发式：
 * - 契约 §7 要求 AI 出招可复现；联机不跑 AI，单机只要「同 seed 同盘面 → 同动作」即可回放。
 * - 拟人化的强弱差异交给逻辑层的出招节奏（level 决定每几 tick 算一次），
 *   而不是在决策里掺随机，这样单测能确定地断言动作合法。
 *
 * 决策只做两件事：
 * 1. 对「四种旋转态 × 每个可落列」做一次自由落体推演，用启发式给结果打分；
 * 2. 把「当前块怎么走到最优落点」翻译成**一个**白名单动作词
 *    （rotate / left / right / drop），由逻辑层下一 tick 继续推。
 *    这样 AI 的输出天然是服务端白名单里的词，不需要为 AI 另开通道。
 *
 * 启发式权重（为什么这些数）：
 * - 消行 ×120 压过一切：能消就消是对战的第一目标（单消不送垃圾，但能清自己的堆）；
 * - 每洞 ×12、总高 ×1.2、最高 ×3、锯齿 ×0.7：高度与洞是对战里最致命的两个量；
 * - 贴墙 +2：让堆叠从两侧生长、中间留出竖向深井，后续 I 块才有四消空间。
 */
import { COLS, ROWS, PIECES, rotateKicks, blocked, dropY } from './pieces.mjs';

/** AI 只会输出这四个词，全部在服务端实时制白名单内。 */
export const AI_WORDS = Object.freeze(['left', 'right', 'rotate', 'drop']);

function widthOf(type, rot) {
  let max = 0;
  for (const [cx] of PIECES[type][rot]) if (cx > max) max = cx;
  return max + 1;
}

/** 当前姿态能否原地顺时针转过去（含踢墙），供「转不动就别转」判断。 */
function canRotateCW(grid, cur) {
  const to = (cur.rot + 1) % 4;
  for (const [dx, dy] of rotateKicks(cur.type, cur.rot, to)) {
    if (!blocked(grid, cur.type, to, cur.x + dx, cur.y + dy)) return true;
  }
  return false;
}

/**
 * 把某块以 (rot, x) 落到底后的盘面指标算成一个分数。
 * 先消行再统计高度/洞，否则消掉的行会被算成「洞」。
 */
function evaluate(grid, type, rot, x, y) {
  const g = grid.map((row) => row.slice());
  for (const [cx, cy] of PIECES[type][rot]) {
    const bx = x + cx;
    const by = y + cy;
    if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) g[by][bx] = type;
  }

  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (g[r].every(Boolean)) {
      g.splice(r, 1);
      g.unshift(new Array(COLS).fill(null));
      cleared += 1;
      r += 1;
    }
  }

  const heights = new Array(COLS).fill(0);
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      if (g[r][c]) {
        if (!seen) {
          seen = true;
          heights[c] = ROWS - r;
        }
      } else if (seen) {
        holes += 1;
      }
    }
  }

  const agg = heights.reduce((a, b) => a + b, 0);
  const maxH = heights.reduce((a, b) => (b > a ? b : a), 0);
  let bump = 0;
  for (let c = 0; c < COLS - 1; c++) bump += Math.abs(heights[c] - heights[c + 1]);
  const wallHug = x <= 0 || x + widthOf(type, rot) >= COLS ? 1 : 0;

  return {
    cleared,
    value: cleared * 120 - holes * 12 - agg * 1.2 - maxH * 3 - bump * 0.7 + wallHug * 2,
    wall: Math.min(x, COLS - (x + widthOf(type, rot))),
  };
}

/**
 * 契约 §7 形态：返回一个与 submit 兼容的动作词；无法决策时返回 null。
 * state 可以是整局快照（取 boards[seat]），也可以直接是一块单场快照。
 */
export function chooseMove(state, playerId = 'p2', level = 1) {
  const seat = playerId === 'p1' ? 'p1' : 'p2';
  const board = state && state.boards ? state.boards[seat] : state;
  return aiAction(board, level);
}

/**
 * 单板快照 → 下一个动作词。
 * 顺序固定：先转到目标姿态（转不动就认栽硬降）→ 再一列一列挪 → 到位就硬降。
 * 因为目标只由「盘面 + 当前块类型」决定，方块下落期间目标不变，所以不会来回抖。
 */
export function aiAction(snapshot, level = 1) {
  const grid = snapshot && snapshot.grid;
  const cur = snapshot && snapshot.cur;
  if (!Array.isArray(grid) || !cur || !PIECES[cur.type]) return null;

  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < COLS; x++) {
      const y = dropY(grid, cur.type, rot, x, 0);
      if (y == null) continue;
      const res = evaluate(grid, cur.type, rot, x, y);
      const better =
        !best ||
        res.value > best.value ||
        (res.value === best.value && res.wall < best.wall) ||
        (res.value === best.value && res.wall === best.wall && x < best.x);
      if (better) best = { rot, x, value: res.value, wall: res.wall };
    }
  }
  if (!best) return 'drop'; // 无处可放：直接落定，别把 AI 卡死

  if (cur.rot !== best.rot) {
    // 只差姿态就先转；转不动说明上方空间已经不够，认栽落定
    return canRotateCW(grid, cur) ? 'rotate' : 'drop';
  }
  if (cur.x !== best.x) {
    const step = best.x < cur.x ? -1 : 1;
    if (blocked(grid, cur.type, cur.rot, cur.x + step, cur.y)) return 'drop';
    return step < 0 ? 'left' : 'right';
  }
  return 'drop';
}
