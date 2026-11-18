/**
 * 中国象棋 · AI（纯函数，禁用 Math.random）。
 *
 * 设计（第一性原则）：
 * - 棋类评估的本质是「子力 + 位置 + 威胁」。子力价值决定交换是否划算；
 *   位置表把「车占中路/马踏卧槽/兵过河/炮镇当头」这些长期经验固化成查表；
 *   将军与将帅照面是象棋特有的强制手段，用少量常数奖励/惩罚体现在叶子评估里。
 * - 走子规则不在这里重写：合法着法全部来自 logic.genLegalMoves，
 *   所以 AI 永远不会走出「送将 / 照面」的非法着法，规则只有一份事实来源。
 * - 搜索用极小极大 + alpha-beta：层数 2～3 层（level 1 = 2 层，level 2/3 = 3 层），
 *   节点内把着法按「吃子价值 + 位置增益」排序，只展开前 width 个，控制分支因子；
 *   根节点不截断（保证不吃漏明显的杀着/保子着法），并先检测一步绝杀。
 * - 不用随机数：同一局面同 level 恒定出招，测试可复现。
 *
 * 复杂度上界（level 1，开局）：根 44 着 × 18 应着 ≈ 800 个叶子，
 * 每个叶子一次合法着法生成；实测单步远小于 1 秒。
 */

import {
  CELLS, COLS, ROWS, sideOf, kindOf, otherSide, normalizePlayer,
  genLegalMoves, inCheck,
} from './logic.mjs';

const RED = 'p1';

/** 子力价值。帅/将不赋值：它被吃不可能出现在合法局面里，胜负由「无着法」判定 */
const VAL = [0, 0, 180, 180, 400, 900, 450, 100];

const MATE = 100000;

/** 把 10×9 的二维表压成 90 长度数组（索引 = row*9+col） */
function table(rows) {
  const t = new Array(CELLS).fill(0);
  for (let r = 0; r < ROWS; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < COLS; c++) t[r * COLS + c] = row[c] || 0;
  }
  return t;
}

/*
 * 位置表统一按「红方视角、row 0 为敌方底线」书写；
 * 黑方取 9-r 的镜像，于是同一张表双方通用。
 */

/** 兵/卒：越靠前、越靠中路越好；过河（row ≤ 4）是质变 */
const PST_P = table([
  [80, 90, 100, 110, 110, 110, 100, 90, 80],
  [70, 80, 90, 100, 100, 100, 90, 80, 70],
  [50, 60, 70, 80, 80, 80, 70, 60, 50],
  [30, 40, 50, 60, 60, 60, 50, 40, 30],
  [20, 25, 30, 35, 35, 35, 30, 25, 20],
  [8, 10, 12, 15, 15, 15, 12, 10, 8],
  [4, 6, 8, 10, 10, 10, 8, 6, 4],
  [],
  [],
  [],
]);

/** 马：中路与推进位置价值高，边角低 */
const PST_N = table([
  [0, 4, 8, 10, 10, 10, 8, 4, 0],
  [4, 8, 12, 16, 16, 16, 12, 8, 4],
  [6, 12, 18, 22, 22, 22, 18, 12, 6],
  [8, 16, 22, 26, 26, 26, 22, 16, 8],
  [6, 14, 20, 24, 24, 24, 20, 14, 6],
  [4, 10, 16, 20, 20, 20, 16, 10, 4],
  [2, 6, 10, 14, 14, 14, 10, 6, 2],
  [0, 4, 8, 10, 10, 10, 8, 4, 0],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 4, 4, 4, 2, 0, 0],
]);

/** 车：越靠前、越居中越好，边角略低 */
const PST_R = table([
  [10, 12, 14, 16, 16, 16, 14, 12, 10],
  [10, 12, 14, 16, 16, 16, 14, 12, 10],
  [10, 12, 14, 16, 16, 16, 14, 12, 10],
  [10, 12, 14, 16, 16, 16, 14, 12, 10],
  [10, 12, 14, 16, 16, 16, 14, 12, 10],
  [8, 10, 12, 14, 14, 14, 12, 10, 8],
  [6, 8, 10, 12, 12, 12, 10, 8, 6],
  [4, 6, 8, 10, 10, 10, 8, 6, 4],
  [4, 6, 8, 10, 10, 10, 8, 6, 4],
  [4, 6, 8, 10, 10, 10, 8, 6, 4],
]);

/** 炮：中炮、巡河炮价值高，底线炮低 */
const PST_C = table([
  [6, 6, 8, 10, 10, 10, 8, 6, 6],
  [4, 6, 8, 10, 12, 10, 8, 6, 4],
  [4, 8, 10, 12, 14, 12, 10, 8, 4],
  [4, 6, 8, 10, 12, 10, 8, 6, 4],
  [2, 4, 6, 8, 10, 8, 6, 4, 2],
  [0, 2, 4, 6, 8, 6, 4, 2, 0],
  [0, 2, 4, 6, 8, 6, 4, 2, 0],
  [4, 6, 8, 10, 12, 10, 8, 6, 4],
  [2, 4, 6, 8, 10, 8, 6, 4, 2],
  [0, 2, 4, 6, 8, 6, 4, 2, 0],
]);

/** 士：守九宫中心 (8,4) 最好 */
const PST_A = table([
  [], [], [], [], [], [], [],
  [0, 0, 0, 10, 0, 10, 0, 0, 0],
  [0, 0, 0, 0, 12, 0, 0, 0, 0],
  [0, 0, 0, 12, 0, 12, 0, 0, 0],
]);

/** 相/象：守家与中路的田字点 */
const PST_B = table([
  [], [], [], [], [],
  [0, 0, 8, 0, 0, 0, 8, 0, 0],
  [],
  [8, 0, 0, 0, 10, 0, 0, 0, 8],
  [],
  [0, 0, 8, 0, 0, 0, 8, 0, 0],
]);

/** 帅/将：待在底线中路最安全，主动上二楼扣分 */
const PST_K = table([
  [], [], [], [], [], [], [],
  [0, 0, 0, 0, -10, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 0, 0, 0, 0],
  [0, 0, 0, 6, 10, 6, 0, 0, 0],
]);

const PST = [null, PST_K, PST_A, PST_B, PST_N, PST_R, PST_C, PST_P];

/** 取某方某子在棋盘索引 i 处的位置分（黑方镜像行） */
function pstAt(kind, side, i) {
  if (side === RED) return PST[kind][i];
  const r = (i / COLS) | 0;
  return PST[kind][(ROWS - 1 - r) * COLS + (i % COLS)];
}

/** 叶子评估：子力 + 位置 + 将军/被将军，返回 me 视角分值 */
function evaluate(b, me) {
  let score = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = b[i];
    if (!v) continue;
    const side = sideOf(v);
    const k = kindOf(v);
    const val = VAL[k] + pstAt(k, side, i);
    score += side === me ? val : -val;
  }
  const opp = otherSide(me);
  if (inCheck(b, opp)) score += 45;   // 对方被将军：我先手
  if (inCheck(b, me)) score -= 70;    // 自己被将军：风险更大，惩罚重于奖励
  return score;
}

/** 着法排序分：吃子 > 推进 > 走到更好的位置 */
function moveScore(b, m, side) {
  const moving = b[m.from];
  const captured = b[m.to];
  const k = kindOf(moving);
  let s = 0;
  if (captured) s += 600 + 10 * VAL[kindOf(captured)] - VAL[k];
  s += pstAt(k, side, m.to) - pstAt(k, side, m.from);
  return s;
}

function orderMoves(b, side, moves) {
  for (const m of moves) m.score = moveScore(b, m, side);
  moves.sort((x, y) => y.score - x.score);
  return moves;
}

/**
 * 极小极大 + alpha-beta。side 为当前行棋方，me 为根节点一方。
 * 返回 me 视角分值。
 */
function search(b, side, me, depth, alpha, beta, width) {
  const moves = genLegalMoves(b, side);
  if (moves.length === 0) {
    // 无着法：被将军即绝杀，否则困毙 —— 象棋两者都判负
    return side === me ? -(MATE + depth) : MATE + depth;
  }
  if (depth <= 0) return evaluate(b, me);

  orderMoves(b, side, moves);
  const limit = Math.min(moves.length, width);
  const maximizing = side === me;
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < limit; i++) {
    const m = moves[i];
    const moving = b[m.from];
    const captured = b[m.to];
    b[m.to] = moving;
    b[m.from] = 0;
    const v = search(b, otherSide(side), me, depth - 1, alpha, beta, width);
    b[m.from] = moving;
    b[m.to] = captured;

    if (maximizing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

/** level → 搜索层数与节点展开宽度（层数固定 2～3，宽度换强度） */
const LEVELS = {
  1: { depth: 2, width: 18 },
  2: { depth: 3, width: 10 },
  3: { depth: 3, width: 16 },
};

/**
 * 选一步棋。
 * @param {object} state  logic.state() 的快照
 * @param {'p1'|'p2'|0|1} playerId 本方
 * @param {1|2|3} level
 * @returns {string|null} 'move:from,to'，无合法着法时 null
 */
export function chooseMove(state, playerId, level = 1) {
  const me = normalizePlayer(playerId);
  if (!me || !state || !state.board || state.board.length !== CELLS) return null;
  if (state.winner) return null;
  // 不是本方回合就不替对手走（联机/异常保护）
  if (state.turn && normalizePlayer(state.turn) && normalizePlayer(state.turn) !== me) return null;

  const lv = LEVELS[Math.max(1, Math.min(3, Number(level) || 1))];
  const b = Uint8Array.from(state.board); // 工作副本，绝不改传入 state

  const moves = genLegalMoves(b, me);
  if (!moves.length) return null;
  orderMoves(b, me, moves);

  const opp = otherSide(me);
  let best = null;
  let bestVal = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const m of moves) {
    const moving = b[m.from];
    const captured = b[m.to];
    b[m.to] = moving;
    b[m.from] = 0;

    let v;
    if (genLegalMoves(b, opp).length === 0) {
      v = MATE + lv.depth; // 一步绝杀 / 困毙，直接取最大
    } else {
      v = search(b, opp, me, lv.depth - 1, alpha, beta, lv.width);
    }

    b[m.from] = moving;
    b[m.to] = captured;

    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
    if (v > alpha) alpha = v;
  }

  if (!best) return null;
  return `move:${best.from},${best.to}`;
}
