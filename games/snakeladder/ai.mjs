/**
 * 蛇梯棋 · AI（纯函数，无随机、无 DOM）。
 *
 * 第一性原则：这款游戏的决策空间只有一个元素——「掷骰」。
 * 骰点由种子 rng 给出，落在哪一格、踩到蛇还是梯完全由骰点与固定表决定，
 * 玩家没有任何可选的着法，所以 AI 不存在「选哪一步更好」的问题，
 * 也就不需要搜索或评估函数。
 *
 * 于是 chooseMove 只做两件事：确认现在确实轮到自己、返回 'roll'。
 * level 参数保留是为了和其它棋类共用外壳的 ai:{choose} 接口（外壳会传 level），
 * 这里不代表搜索深度——把它当深度会在一个无分支的游戏里假装有策略。
 */

/** 外壳传数字下标 0～3，联机传 'p1'～'p4'，统一成玩家 id */
function normalizeId(state, playerId) {
  if (!state || !Array.isArray(state.players)) return null;
  if (typeof playerId === 'number') {
    const hit = state.players[Math.trunc(playerId)];
    return hit ? hit.id : null;
  }
  if (typeof playerId !== 'string') return null;
  if (state.players.some((p) => p.id === playerId)) return playerId;
  if (/^\d+$/.test(playerId)) {
    const hit = state.players[Number(playerId)];
    return hit ? hit.id : null;
  }
  return null;
}

/**
 * @param {object} state logic.state() 的快照
 * @param {'p1'|'p2'|'p3'|'p4'|0|1|2|3} playerId
 * @param {1|2|3} [level] 接口占位，不影响结果
 * @returns {'roll'|null} 轮到自己时恒为 'roll'；不是自己回合或已结束返回 null
 */
export function chooseMove(state, playerId, level = 1) {
  const id = normalizeId(state, playerId);
  if (!id) return null;
  if (state.winner) return null;
  if (state.turn !== id) return null;
  return 'roll';
}
