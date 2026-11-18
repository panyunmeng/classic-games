/**
 * 飞行棋 · AI（纯函数：不掷骰、不看时钟、不碰 DOM，同一局面恒定出招）。
 *
 * 设计（第一性原则）：回合制棋类的“着法”只由当前骰点决定，骰点已经由 rng 定好，
 * 所以 AI 不需要搜索树，只需要在 legalMoves 里按价值排序挑一颗子。价值排序来自
 * 规则本身的收益结构，按收益从大到小逐级比较：
 *   1. 能撞他子 —— 直接把对手整子送回基地，一步换 58 格进度，收益最大；
 *   2. 能进终点 —— 该子永久退出棋盘，少一颗子拖后腿；
 *   3. 能出子 —— 让基地里的子进入跑道，增加后续可选子数；
 *   4. 前进最远 —— 同档里选走得最远的一步，最快接近终点。
 * 四级之间用档位权重隔开（1e6 级差），保证低档永远压不过高档；同档内用 to 排，
 * 再同分取棋子序号最小的，因此同一局面恒定出招、可回放、可单测。
 *
 * 复杂度 O(n)，n = 当前骰点下的合法着法数（≤4）。
 */

/** 档位权重：档与档之间差一个量级，任何同档内的 to（≤57）都无法越档 */
const TIER = {
  capture: 4000000,
  goal: 3000000,
  deploy: 2000000,
  advance: 0,
};

/**
 * 单步着法评分。move 为 logic.mjs 产生的着法对象：
 * { action, piece, from, to, deploy, goal, capture[], ringIndex, safe }
 */
export function scoreMove(move, level = 1) {
  if (!move) return -Infinity;
  const to = Number.isFinite(move.to) ? move.to : 0;
  const captures = move.capture ? move.capture.length : 0;
  let score;
  if (captures > 0) score = TIER.capture + to;
  else if (move.goal) score = TIER.goal + to;
  else if (move.deploy) score = TIER.deploy + to;
  else score = TIER.advance + to;

  // 二级以上：同档内优先落在安全格（安全格不会被踩，也不容易被堵）
  if (level >= 2 && move.safe && !move.goal) score += 300;
  return score;
}

/** 从合法着法里挑最优的一步；没有着法返回 null（调用方据此走 'skip'） */
export function pickMove(moves, level = 1) {
  if (!Array.isArray(moves) || moves.length === 0) return null;
  let best = moves[0];
  let bestScore = scoreMove(best, level);
  for (let i = 1; i < moves.length; i++) {
    const s = scoreMove(moves[i], level);
    if (s > bestScore) {
      bestScore = s;
      best = moves[i];
    }
  }
  return best;
}

/**
 * shell 每 0.4 s 调一次：掷骰阶段返回 'roll'，走子阶段返回 'move:i'，
 * 无子可走返回 'skip'。动作字符串与 logic.submit 的 action 完全一致。
 */
export function chooseMove(state, playerId, level = 1) {
  if (!state || state.winner || state.phase === 'over' || !state.turn) return null;
  const me = playerId === 'p1' || playerId === 0 || playerId === '0' ? 'p1' : 'p2';
  if (state.turn !== me) return null;
  if (state.phase === 'roll' || state.dice == null) return 'roll';

  const moves = Array.isArray(state.moves) ? state.moves : [];
  if (moves.length === 0) return 'skip';
  const best = pickMove(moves, level);
  return best ? best.action : 'skip';
}
