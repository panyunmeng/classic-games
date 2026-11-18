/**
 * 空气曲棍球 · p1（上拍）的确定性 AI。
 *
 * 任务约束：确定性追踪球的 x / y，禁止真随机、禁止读时钟。
 * 事实推导：
 * - 拍是圆盘，击球方向 = 两圆心连线方向（法向），所以想把球打向下方 p2 球门，
 *   拍就必须位于球的「上方」（y 更小）去推；落在球下方反而会把球顶进自己球门。
 *   → 追球目标 = 球的预判位置再沿 -y 让出 HIT_OFFSET，拍从上方压下去。
 * - 球朝自己飞来时用 vy 做线性预判，拍提前站到拦截点，避免被高速球穿过；
 * - 球在对手半场且远离时回守位（只做半程横向跟随），减少无意义往返。
 * - 全部是纯函数：只读传入的纯数据快照，不持有状态、不用随机、不看时钟。
 */

export const AI_HOME = { x: 240, y: 150 };
/** 让位量：拍心比球心再靠上这么多，等于从上方接触（DISC_R + PADDLE_R ≈ 43） */
export const HIT_OFFSET = 34;
/** 线性预判时长（s） */
const LEAD = 0.1;

/**
 * 本步希望拍心到达的位置。返回 {x, y}，已按拍的可达半场夹过边界。
 * state 需要：disc{x,y,vx,vy}、paddles{p1{x,y,r}}、serving、serveSide、centerY。
 */
export function aiTarget(state) {
  if (!state || !state.disc) return { ...AI_HOME };
  const disc = state.disc;
  if (state.serving) return { ...AI_HOME };

  const center = Number.isFinite(state.centerY) ? state.centerY : 320;
  const bounds = state.paddleBounds && state.paddleBounds.p1 ? state.paddleBounds.p1 : null;
  const clampX = (v) => (bounds ? Math.min(bounds.xMax, Math.max(bounds.xMin, v)) : v);
  const clampY = (v) => (bounds ? Math.min(bounds.yMax, Math.max(bounds.yMin, v)) : v);

  const incoming = disc.vy < -10;
  const ownHalf = disc.y < center;

  if (!incoming && !ownHalf) {
    // 球在对手半场且远离：回守位，横向只跟随一半
    return {
      x: clampX(AI_HOME.x + (disc.x - AI_HOME.x) * 0.35),
      y: clampY(AI_HOME.y),
    };
  }

  // 追球：x 用 vx 预判，y 用 vy 预判后从上方让出 HIT_OFFSET
  return {
    x: clampX(disc.x + disc.vx * LEAD),
    y: clampY(disc.y + disc.vy * LEAD - HIT_OFFSET),
  };
}

/**
 * 契约 §7 形态：返回与动作词表兼容的持续动作（p1 方向的 left/right/up/down）。
 * 实时制的移动由 logic 直接按 aiTarget 连续驱动，这里给需要离散动作的调用方用。
 */
export function chooseMove(state, playerId = 'p1', _level = 1) {
  const side = playerId === 'p2' ? 'p2' : 'p1';
  const paddle = state && state.paddles ? state.paddles[side] : null;
  if (!paddle) return null;
  const aim = aiTarget(state);
  const dx = aim.x - paddle.x;
  const dy = aim.y - paddle.y;
  if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return `${side}${dx > 0 ? 'right' : 'left'}`;
  return `${side}${dy > 0 ? 'down' : 'up'}`;
}
