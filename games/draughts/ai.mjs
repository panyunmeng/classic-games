/**
 * 国际跳棋 · AI（纯函数，禁用 Math.random）。
 *
 * 设计（第一性原则）：
 * - 规则事实只有一个来源：走法生成完全复用 logic.mjs 的 genTurnMoves / applyAction，
 *   AI 不另写一份走子规则，避免"AI 认为合法但 submit 拒绝"的偏差；
 * - 强制吃子由 genTurnMoves 统一保证，故搜索树天然只遍历合法着法；
 * - 着法排序：吃子优先、吃多子优先、升王优先、推进优先——alpha-beta 剪枝效率依赖好排序；
 * - 评估函数：子力(兵100/王175) + 推进(兵靠近升王行) + 中心控制 + 后排保王；
 * - negamax + alpha-beta，level 1/2/3 = 2/3/3 层；层内只操作 board 副本，不改传入 state；
 * - 无随机、无 Date.now，同局面恒定出招（联机回放可复现）。
 */

import {
  CELLS, SIZE, BLACK, WHITE, BLACK_KING, WHITE_KING,
  genTurnMoves, applyAction, pieceOwner, isKing, normalizePlayer,
} from './logic.mjs';

const INF = 1e15;
const PIECE_VALUE = { [BLACK]: 100, [WHITE]: 100, [BLACK_KING]: 175, [WHITE_KING]: 175 };

function rowOf(i) { return Math.floor(i / SIZE); }
function colOf(i) { return i % SIZE; }

/** 把 player 颜色转成用于评估的 me/opp 兵种编码 */
function sideCodes(player) {
  return player === 'p1'
    ? { me: BLACK, meKing: BLACK_KING, opp: WHITE, oppKing: WHITE_KING, forward: 1 }
    : { me: WHITE, meKing: WHITE_KING, opp: BLACK, oppKing: BLACK_KING, forward: -1 };
}

/** 整盘静态评估：从 me 视角，正分对己有利 */
function evaluate(board, me) {
  const codes = sideCodes(me);
  let score = 0;
  const center = (SIZE - 1) / 2;
  for (let i = 0; i < CELLS; i++) {
    const v = board[i];
    if (v === 0) continue;
    const sign = pieceOwner(v) === me ? 1 : -1;
    let val = PIECE_VALUE[v] || 0;
    if (!isKing(v)) {
      // 推进奖励：兵越靠近升王行价值越高（最多 +40）
      const progress = codes.forward > 0 ? rowOf(i) : (SIZE - 1 - rowOf(i));
      val += progress * 5;
      // 后排守卫：本方底行的兵守住根基，小加成
      const backRow = codes.forward > 0 ? 0 : SIZE - 1;
      if (rowOf(i) === backRow) val += 6;
    }
    // 中心控制：越靠中间越好
    val += (center - Math.abs(colOf(i) - center)) * 2;
    score += sign * val;
  }
  return score;
}

/** 着法排序打分：吃子 > 升王 > 推进；大者先搜 */
function moveScore(m, board, who) {
  let s = 0;
  if (m.capture) s += 10000 + 200 * (m.captured >= 0 ? 1 : 0);
  if (m.promote) s += 5000;
  const v = board[m.from];
  if (!isKing(v)) {
    const f = who === 'p1' ? 1 : -1;
    s += f * (rowOf(m.to) - rowOf(m.from)) * 10;
  }
  return s;
}

/** 把合法着法按静态优先级排序（不修改原数组的元素内容，只返回新数组） */
function orderedMoves(board, who, continueFrom) {
  const moves = genTurnMoves(board, who, continueFrom).slice();
  moves.sort((a, b) => moveScore(b, board, who) - moveScore(a, board, who));
  return moves;
}

/**
 * negamax：返回从 side 视角的分数。
 * 注意：连吃状态 continueFrom 必须参与搜索，否则连吃着的搜索会漏步。
 */
function search(board, side, me, depth, alpha, beta, continueFrom) {
  const opp = side === 'p1' ? 'p2' : 'p1';
  const moves = orderedMoves(board, side, continueFrom);
  if (moves.length === 0) {
    // 轮到 side 却无着可走（含被吃光）→ side 负；negamax 从 side 视角返回大负分
    return -(INF + depth);
  }
  if (depth <= 0) return evaluate(board, me);

  let best = -INF;
  for (const m of moves) {
    const next = applyAction(board, side, `move:${m.from},${m.to}`, continueFrom);
    if (!next) continue;
    const nextContinue = next.continueFrom;
    const nextSide = nextContinue >= 0 ? side : opp;
    const val = -search(next.board, nextSide, me, depth - 1, -beta, -alpha, nextContinue);
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * @param {{board:number[], turn:string, continueFrom?:number}} state
 * @param {'p1'|'p2'} playerId
 * @param {1|2|3} level
 * @returns {string|null} 'move:from,to' 或无可走时 null
 */
export function chooseMove(state, playerId, level = 1) {
  const lv = Math.max(1, Math.min(3, Number(level) || 1));
  const depth = lv === 1 ? 2 : 3;
  const me = normalizePlayer(playerId);
  if (!me) return null;

  // 必须当前回合属于我，否则不替对手走（联机/异常保护）
  if (state.turn) {
    const t = normalizePlayer(state.turn);
    if (t && t !== me) return null;
  }

  const board = state.board.slice();
  const continueFrom = Number.isInteger(state.continueFrom) ? state.continueFrom : -1;
  const opp = me === 'p1' ? 'p2' : 'p1';
  const moves = orderedMoves(board, me, continueFrom);
  if (!moves.length) return null;

  let bestMove = moves[0];
  let bestVal = -INF;
  let alpha = -INF;
  const beta = INF;

  for (const m of moves) {
    const next = applyAction(board, me, `move:${m.from},${m.to}`, continueFrom);
    if (!next) continue;
    const nextSide = next.continueFrom >= 0 ? me : opp;
    const val = -search(next.board, nextSide, me, depth - 1, -beta, -alpha, next.continueFrom);
    if (val > bestVal) {
      bestVal = val;
      bestMove = m;
    }
    if (val > alpha) alpha = val;
  }

  return `move:${bestMove.from},${bestMove.to}`;
}
