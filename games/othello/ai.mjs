/**
 * 黑白棋 · AI（纯函数，禁用 Math.random / Date.now）。
 *
 * 设计（第一性原则）：
 * - 角不可被翻，是永久据点 → 最高权重；角旁（X 位/C 位）早期给己方角留缺口，故为负权重；
 * - 边权重高于中腹，是因为边同样难以被翻转；稳定子（不可翻）比单纯子数更值钱；
 * - “动作数最小化”= 尽早压缩对手合法着法、保住自己的选择权：
 *   eval 中加入 mobility = (我方合法数 − 对手合法数)，并随终局阶段递减权重；
 * - 终局子数直接决定胜负 → 棋盘接近填满时，子数差权重迅速放大；
 * - level 1/2/3 = 2/2/3 层 alpha-beta（level 1 用更窄的候选数换速度）；
 *   搜索只在 board 工作副本上进行，绝不修改传入 state。
 *
 * 候选排序保证 alpha-beta 高效：权重表分 × 翻转数与历史启发式排序。
 */

import {
  SIZE, EMPTY, BLACK, WHITE,
  normalizePlayer, playerColor, otherPlayer, otherColor,
  legalMoves, flipsFor, applyMove,
} from './logic.mjs';

/**
 * 经典位置权重表（原创数值）：
 *   角 = 120；角旁负分；边 = 10～20；中腹 = 1～5。
 * 行索引为 y，列索引为 x。
 */
const WEIGHT = [
  [120, -20, 20,  5,  5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [ 20,  -5, 15,  3,  3, 15,  -5,  20],
  [  5,  -5,  3,  3,  3,  3,  -5,   5],
  [  5,  -5,  3,  3,  3,  3,  -5,   5],
  [ 20,  -5, 15,  3,  3, 15,  -5,  20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20,  5,  5, 20, -20, 120],
];

const CORNERS = [[0, 0], [0, 7], [7, 0], [7, 7]];
const INF = 1e9;
const WIN_SCORE = 1e7;

function countDiscs(board) {
  let n = 0;
  for (const row of board) {
    for (const v of row) if (v !== EMPTY) n++;
  }
  return n;
}

/** 候选着法的静态排序分：位置权重 + 少量翻转数奖励（后期更看重子数） */
function moveOrderScore(move, empties) {
  let s = WEIGHT[move.y][move.x];
  // 越接近终局，翻转数越重要；早期仍以位置为主
  s += move.flips.length * (empties <= 12 ? 3 : 0.4);
  return s;
}

/** 角占用情况：己方独占角加分，对方独占角减分 */
function cornerScore(board, me, opp) {
  let s = 0;
  for (const [x, y] of CORNERS) {
    const v = board[y][x];
    if (v === me) s += 25;
    else if (v === opp) s -= 25;
  }
  return s;
}

/** 整盘静态评估（从 me 视角）：位置 + 动作数差 + 角 + 终局子数 */
function evaluate(board, me, opp, empties) {
  let pos = 0;
  let mine = 0;
  let theirs = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = board[y][x];
      if (v === me) {
        mine++;
        pos += WEIGHT[y][x];
      } else if (v === opp) {
        theirs++;
        pos -= WEIGHT[y][x];
      }
    }
  }

  const myMoves = legalMoves(board, me).length;
  const oppMoves = legalMoves(board, opp).length;
  const mobility = (myMoves - oppMoves) / (myMoves + oppMoves + 1); // 归一到 [-1,1]

  // 终局接近时子数权重大幅提高（8×8 = 64，empties 从 64 递减到 0）
  const endgame = 1 - empties / 64;
  const discWeight = 2 + 60 * endgame * endgame;
  const mobilityWeight = 12 * (1 - endgame);

  return pos
    + cornerScore(board, me, opp)
    + mobility * mobilityWeight * 10
    + (mine - theirs) * discWeight;
}

/**
 * alpha-beta 搜索：board 为工作副本，turn 为当前行棋方颜色。
 * 采用“无着法即跳过”的规则：当前方无着法则换手，双方都无着法则以子数判终局。
 */
function search(board, turn, me, depth, alpha, beta, passed, empties, width) {
  if (depth <= 0) return evaluate(board, me, otherColor(me), empties);

  const opp = otherColor(turn);
  let moves = legalMoves(board, turn);
  if (!moves.length) {
    if (passed) {
      // 双方连续无着法 → 终局：大分 ± 子数差
      const p1 = countColor(board, BLACK);
      const p2 = countColor(board, WHITE);
      const diff = me === BLACK ? p1 - p2 : p2 - p1;
      return diff > 0 ? WIN_SCORE + diff : diff < 0 ? -WIN_SCORE + diff : 0;
    }
    return search(board, opp, me, depth, alpha, beta, true, empties, width); // 跳过不消耗深度
  }

  moves.sort((a, b) => moveOrderScore(b, empties) - moveOrderScore(a, empties));
  if (width && moves.length > width) moves.length = width; // level 1 只展开高分候选

  if (turn === me) {
    let best = -INF;
    for (const m of moves) {
      const nb = applyMove(board, m.x, m.y, turn).board;
      const v = search(nb, opp, me, depth - 1, alpha, beta, false, empties - 1, width);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = INF;
  for (const m of moves) {
    const nb = applyMove(board, m.x, m.y, turn).board;
    const v = search(nb, me, me, depth - 1, alpha, beta, false, empties - 1, width);
    if (v < best) best = v;
    if (v < beta) beta = v;
    if (alpha >= beta) break;
  }
  return best;
}

function countColor(board, c) {
  let n = 0;
  for (const row of board) {
    for (const v of row) if (v === c) n++;
  }
  return n;
}

/**
 * @param {{board:number[][], turn:string, validMoves?:{x:number,y:number}[]}} state
 * @param {'p1'|'p2'|0|1} playerId
 * @param {1|2|3} level
 * @returns {string} 'place:x,y' 或 'pass'（纯函数，不改 state）
 */
export function chooseMove(state, playerId, level = 1) {
  const lv = Math.max(1, Math.min(3, Number(level) || 1));
  // 浅/中/深：level 1 = 2 层窄候选(4)，level 2 = 2 层全宽，level 3 = 3 层全宽
  const depth = lv === 3 ? 3 : 2;
  const width = lv === 1 ? 4 : 0;
  const who = normalizePlayer(playerId);
  const me = who ? playerColor(who) : BLACK;
  const opp = otherColor(me);

  const board = state.board.map((row) => row.slice());
  const empties = 64 - countDiscs(board);

  // 当前回合不属于我时不替对手出招（联机保护）；无合法着法则返回 pass
  if (state.turn) {
    const t = normalizePlayer(state.turn);
    if (t && t !== who) return 'pass';
  }
  const moves = legalMoves(board, me);
  if (!moves.length) return 'pass';

  // 只剩一着或空位很少时无需搜索，直接返回（终局子数已由搜索评估）
  if (moves.length === 1 || empties <= 2) return `place:${moves[0].x},${moves[0].y}`;

  moves.sort((a, b) => moveOrderScore(b, empties) - moveOrderScore(a, empties));

  let best = moves[0];
  let bestVal = -INF;
  let alpha = -INF;
  const beta = INF;
  for (const m of moves) {
    const nb = applyMove(board, m.x, m.y, me).board;
    const v = search(nb, opp, me, depth - 1, alpha, beta, false, empties - 1, width);
    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
    if (v > alpha) alpha = v;
  }
  return `place:${best.x},${best.y}`;
}
