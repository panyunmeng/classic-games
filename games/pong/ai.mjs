/**
 * 乒乓 · p1（上拍）的确定性 AI。
 *
 * 约束（任务书）：目标 = 球位置 + 固定偏移；禁止随机、禁止时钟。
 * 坐标事实：p1 是顶部的横拍，只沿 x 轴滑动，所以追踪量取球的 x；
 *   若拿球的 y 当目标，上拍会原地不动（球拍根本不在那条轴上）。
 *
 * 追踪规则：
 * - 球朝自己飞来（vy < 0）时才追，目标 x = ball.x + AI_OFFSET；
 * - 球远离时回中线等待（减少无意义的来回抖动）；
 * - 发球阶段：自己发球就贴着球，对手发球就回中线；
 * - 速度由 logic 决定，这里只给方向 -1（左 / up 词）/ 0 / +1（右 / down 词）。
 */

export const AI_OFFSET = 14;
export const AI_DEADZONE = 3;

/** 本步希望拍心落在的 x；null 表示回中线 */
export function aiAimX(state, side = 'p1') {
  if (!state || !state.ball) return null;
  if (state.serving) return state.serverSide === side ? state.ball.x : null;
  const incoming = side === 'p1' ? state.ball.vy < 0 : state.ball.vy > 0;
  if (!incoming) return null;
  return state.ball.x + AI_OFFSET;
}

/** 方向：-1 左（up 词）、0 不动、+1 右（down 词） */
export function aiDirection(state, side = 'p1') {
  const paddle = state && state.paddles ? state.paddles[side] : null;
  if (!paddle) return 0;
  const aim = aiAimX(state, side);
  const target = aim == null ? (state.w || 480) / 2 : aim;
  const diff = target - (paddle.x + paddle.w / 2);
  if (Math.abs(diff) <= AI_DEADZONE) return 0;
  return diff > 0 ? 1 : -1;
}

/**
 * 契约 §7 形态：返回与动作词表兼容的持续动作，已到位返回 null。
 * 实时制的速度/难度由 logic 的 level 决定；这里保留 level 形参以对齐契约签名。
 */
export function chooseMove(state, playerId = 'p1', _level = 1) {
  const side = playerId === 'p2' ? 'p2' : 'p1';
  const d = aiDirection(state, side);
  if (d === 0) return null;
  return `${side}${d < 0 ? 'up' : 'down'}`;
}
