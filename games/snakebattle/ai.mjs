/**
 * 贪吃蛇大作战 · AI 蛇的确定性策略。
 *
 * 事实与推导：
 * - 逻辑层禁止 Math.random，AI 也不能自己造随机：所有抖动都由调用方传进来的
 *   种子 rng（createRng(seed)）提供，同种子同局面得到同一决策，联机/回放才可比对。
 * - 棋盘是离散格，一步只动一格，所以 AI 的决策就是「三选一转向」；
 *   反向被规则禁止（一步自撞，不是走法），候选里直接剔除。
 * - 撞墙/撞身体立即出局，因此「这一步能不能走」是硬约束；在能走的候选里，
 *   再按「离最近食物更近 + 周围空地更大 + 少原地打转」排序。
 * - 空地用限深洪水填充估计：只看眼前十几格，避免为了追一颗远处食物钻进死胡同。
 */

const DIRS = {
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const ORDER = ['up', 'left', 'down', 'right'];
const NO_FOOD = 1e6;

function clampLevel(level) {
  const n = Math.round(Number(level) || 1);
  return n < 1 ? 1 : n > 3 ? 3 : n;
}

function cellKey(x, y) {
  return `${x},${y}`;
}

/** 所有活蛇的身体格（含头）。尾巴也按障碍算：宁可绕开，不赌对撞。 */
function blockedSet(state) {
  const blocked = new Set();
  for (const snake of state.snakes || []) {
    if (!snake || snake.alive === false) continue;
    for (const seg of snake.segments || []) blocked.add(cellKey(seg.x, seg.y));
  }
  return blocked;
}

/** 从 (sx,sy) 出发的连通空地上限（限深 BFS，只看眼前） */
function openSpace(state, blocked, sx, sy, limit) {
  const cols = state.cols || 29;
  const rows = state.rows || 35;
  const seen = new Set([cellKey(sx, sy)]);
  const queue = [{ x: sx, y: sy }];
  let head = 0;
  let count = 0;
  while (head < queue.length && count < limit) {
    const cur = queue[head++];
    count += 1;
    for (const name of ORDER) {
      const d = DIRS[name];
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      const k = cellKey(nx, ny);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return count;
}

function nearestFoodDistance(foods, x, y) {
  let best = NO_FOOD;
  for (const food of foods || []) {
    const d = Math.abs(food.x - x) + Math.abs(food.y - y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 契约 §7 形态：返回与 submit 兼容的动作词（left/right/up/down），无路可走返回 null。
 * rng 可选：传了就用它打破同分（可复现），不传则完全确定。
 */
export function chooseMove(state, playerId = 'p1', level = 1, rng = null) {
  if (!state || !Array.isArray(state.snakes) || !state.snakes.length) return null;
  const me = state.snakes.find((s) => s && s.id === playerId) || state.snakes[0];
  if (!me || me.alive === false) return null;
  const segments = me.segments || [];
  if (!segments.length) return null;

  const head = segments[0];
  const dir = DIRS[me.dir] ? me.dir : 'right';
  const cols = state.cols || 29;
  const rows = state.rows || 35;
  const blocked = blockedSet(state);
  const foods = state.foods || [];
  const lv = clampLevel(level);
  const vision = 12 + lv * 18;
  const spaceWeight = 0.35 + 0.25 * lv;

  const candidates = [];
  for (const name of ORDER) {
    if (name === OPPOSITE[dir]) continue;
    const d = DIRS[name];
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    if (blocked.has(cellKey(nx, ny))) continue;
    candidates.push({
      name,
      space: openSpace(state, blocked, nx, ny, vision),
      food: nearestFoodDistance(foods, nx, ny),
      turn: name === dir ? 0 : 1,
    });
  }
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    let score = -c.food * 2 + c.space * spaceWeight - c.turn * 0.4;
    if (c.space < 3) score -= 60; // 死胡同：强惩罚，但仍有兜底可走
    if (rng && typeof rng.next === 'function') score += rng.next() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = c.name;
    }
  }
  return best;
}

export { DIRS as AI_DIRS, OPPOSITE as AI_OPPOSITE };
