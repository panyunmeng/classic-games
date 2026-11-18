/**
 * 麻将消除 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 关键事实与推导：
 * - 牌堆几何在 layout.mjs 里定义（4 层梯形、每层少一圈、居中），遮挡关系也是纯几何：
 *   一张牌「被压住」⇔ 存在层数更高、矩形有正面积重叠且未移除的牌。符合「上面有牌就抽不出」。
 * - 计时不能用墙钟：turnBased 下 shell 不跑固定步长，但每帧会调 input.update(dt)，
 *   由输入层把 dt 喂给 step(dt)（与 linkup 一致）。逻辑只吃确定性 dt，可回放、可单测。
 * - 洗牌必须「保证有解」，仅打乱图案做不到：还剩 2 张时若一上一下压着，任何图案都消不掉。
 *   所以洗牌用「先求一条合法消除顺序，再按该顺序两两分配图案」：
 *   每一步都从当前可点的牌里取两张（因此必定合法），把同一图案发给这一对，
 *   于是照这条顺序走就能清空整盘——洗牌后整盘可解，而不仅是「有一对能消」。
 * - 消除后若没有可消对，自动洗牌；若连两张可点牌都凑不出（几何压死），判残局结束。
 */
import { createRng } from '../../shared/rng.js';
import { LAYERS, layoutTiles, buildBlockers, isFree } from './layout.mjs';

/** 图案种类数：● ◆ ▲ ■ ★ ♥ ♠ */
export const SYMBOL_KINDS = 7;
/** 初始倒计时（秒） */
export const START_TIME = 30;
/** 每消除一对加时（秒） */
export const BONUS_TIME = 3;

/** 校验并规范化层规格；非法输入回退默认分层 */
function normalizeLayers(layers) {
  if (!Array.isArray(layers) || layers.length === 0) return LAYERS.map((l) => ({ ...l }));
  const ok = layers.every(
    (l) => l && Number.isInteger(l.cols) && Number.isInteger(l.rows) && l.cols > 0 && l.rows > 0
  );
  if (!ok) return LAYERS.map((l) => ({ ...l }));
  return layers.map((l) => ({ cols: l.cols, rows: l.rows }));
}

export function createGame({
  seed = 1,
  mode = 'solo',
  players = ['p1'],
  level = 1,
  layers = LAYERS,
  kinds = SYMBOL_KINDS,
  startTime = START_TIME,
  bonus = BONUS_TIME,
} = {}) {
  const specs = normalizeLayers(layers);
  const K = Math.max(2, Math.min(SYMBOL_KINDS, Math.floor(kinds) || SYMBOL_KINDS));
  const START = Math.max(1, Math.floor(startTime));
  const BONUS = Math.max(0, Math.floor(bonus));

  // 牌数必须为偶数：万一自定义分层凑出奇数，丢掉最后一张（最顶层末尾），保证严格成对。
  const geo = layoutTiles(specs);
  if (geo.length % 2 === 1) geo.pop();
  const total = geo.length;
  const blockers = buildBlockers(geo);

  let rng = createRng(seed);

  const sym = new Array(total).fill(0);
  const removed = new Array(total).fill(false);

  let selected = null;
  let steps = 0;
  let timeLeft = START;
  let over = false;
  let solved = false;
  let dead = false;
  let remaining = total;
  let shuffles = 0;
  let autoShuffles = 0;
  let lastRemoved = null;

  /** 当前未移除的牌 id 列表 */
  function aliveIds() {
    const out = [];
    for (let i = 0; i < total; i++) if (!removed[i]) out.push(i);
    return out;
  }

  /** 给定移除位图下的可点牌（不依赖闭包里的 removed，洗牌推演要用） */
  function freeUnder(removedMap) {
    const out = [];
    for (let i = 0; i < total; i++) {
      if (removedMap[i]) continue;
      if (isFree(i, removedMap, blockers)) out.push(i);
    }
    return out;
  }

  function freeIds() {
    return freeUnder(removed);
  }

  /** 是否还存在一对「图案相同且都能点」的牌 */
  function hasFreePair() {
    const seen = new Set();
    for (const id of freeIds()) {
      if (seen.has(sym[id])) return true;
      seen.add(sym[id]);
    }
    return false;
  }

  /**
   * 求一条合法清除顺序：每一步从当前可点牌里取两张（最高层优先，id 稳定），
   * 直到清空。返回 [[id,id], ...] 或 null（几何压死时凑不出两张可点牌）。
   */
  function planRemovalOrder() {
    const tmp = removed.slice();
    const order = [];
    let left = remaining;
    while (left > 0) {
      const free = freeUnder(tmp);
      if (free.length < 2) return null;
      free.sort((a, b) => geo[b].layer - geo[a].layer || a - b);
      const a = free[0];
      const b = free[1];
      order.push([a, b]);
      tmp[a] = true;
      tmp[b] = true;
      left -= 2;
    }
    return order;
  }

  /**
   * 洗牌：把当前剩余图案重新分配给剩余牌，保证整盘存在一条清空路线。
   * 做法 = 合法顺序 + 按对发图案：顺序里每一对同时可点，发同一图案即可消。
   * 图案多重集严格不变（只换位置），所以「成对」性质保持。
   */
  function reshuffle({ auto = false, silent = false } = {}) {
    const ids = aliveIds();
    if (ids.length < 2) return false;
    const order = planRemovalOrder();
    if (!order) return false; // 几何上已压死，任何图案都救不了

    const counts = new Map();
    for (const id of ids) counts.set(sym[id], (counts.get(sym[id]) || 0) + 1);
    const tokens = [];
    for (const [s, c] of counts) {
      for (let k = 0; k < Math.floor(c / 2); k++) tokens.push(s);
    }
    const bag = rng.shuffle(tokens);
    for (let i = 0; i < order.length; i++) {
      const s = bag[i % bag.length];
      sym[order[i][0]] = s;
      sym[order[i][1]] = s;
    }
    selected = null;
    // 发牌阶段的那次「保证开局有解」不算玩家洗牌，也不计入洗牌次数
    if (!silent) {
      shuffles += 1;
      if (auto) autoShuffles += 1;
    }
    return true;
  }

  /** 发牌：先按对生成图案池，再整体打乱铺到固定位置；开局没有可消对就自动洗一次 */
  function deal() {
    const bag = [];
    for (let i = 0; i < total / 2; i++) {
      const s = i % K;
      bag.push(s, s);
    }
    const ordered = rng.shuffle(bag);
    for (let i = 0; i < total; i++) sym[i] = ordered[i];
    removed.fill(false);
    selected = null;
    lastRemoved = null;
    remaining = total;
    if (!hasFreePair()) reshuffle({ auto: true, silent: true });
  }

  function reset() {
    rng = createRng(seed);
    steps = 0;
    timeLeft = START;
    over = false;
    solved = false;
    dead = false;
    shuffles = 0;
    autoShuffles = 0;
    deal();
  }

  function score() {
    const base = steps * 100;
    return solved ? base + Math.round(Math.max(0, timeLeft)) * 10 : base;
  }

  /** 消除一对：记步、加时、判断胜利 / 自动重排 / 残局 */
  function removePair(a, b) {
    removed[a] = true;
    removed[b] = true;
    remaining -= 2;
    steps += 1;
    timeLeft += BONUS;
    lastRemoved = { ids: [a, b], symbol: sym[a] };
    selected = null;

    if (remaining === 0) {
      solved = true;
      over = true;
      return;
    }
    if (!hasFreePair()) {
      if (!reshuffle({ auto: true })) {
        dead = true;
        over = true;
      }
    }
  }

  function pick(id) {
    if (over) return { ok: false, error: '本局已结束' };
    if (!Number.isInteger(id) || id < 0 || id >= total) return { ok: false, error: '无效选择' };
    if (removed[id]) return { ok: false, error: '该牌已消除' };
    if (!isFree(id, removed, blockers)) return { ok: false, error: '该牌被上层压住' };

    if (selected == null) {
      selected = id;
      return { ok: true, selected: id };
    }
    if (selected === id) {
      selected = null; // 再点同一张 = 取消选择
      return { ok: true, selected: null };
    }

    const a = selected;
    const b = id;
    if (sym[a] !== sym[b]) {
      selected = b; // 图案不同：把新点的牌当作新起点（常见手感）
      return { ok: false, error: '图案不同，已改选', selected: b };
    }

    const symbol = sym[a];
    removePair(a, b);
    return {
      ok: true,
      removed: [a, b],
      symbol,
      steps,
      remaining,
      timeLeft,
      solved,
      over,
    };
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效操作' };

    if (action === 'shuffle') {
      if (over) return { ok: false, error: '本局已结束' };
      if (remaining < 2) return { ok: false, error: '无需重排' };
      if (!reshuffle({ auto: false })) return { ok: false, error: '当前无法重排' };
      return { ok: true, shuffles };
    }

    if (action.startsWith('pick:')) {
      const raw = action.slice(5);
      if (!/^-?\d+$/.test(raw)) return { ok: false, error: '无效选择' };
      return pick(Number(raw));
    }

    return { ok: false, error: '无效操作' };
  }

  /** 由输入层每帧喂 dt 推进倒计时；归零判负 */
  function step(dt) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      over = true;
      solved = false;
    }
  }

  function state() {
    const free = new Set(freeIds());
    return {
      turn: 'p1',
      tiles: geo.map((t) => ({
        id: t.id,
        symbol: sym[t.id],
        layer: t.layer,
        col: t.col,
        row: t.row,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        removed: removed[t.id],
        free: !removed[t.id] && free.has(t.id),
      })),
      layers: specs.map((l) => ({ cols: l.cols, rows: l.rows })),
      selected,
      steps,
      timeLeft,
      startTime: START,
      bonus: BONUS,
      remaining,
      total,
      pairsLeft: remaining / 2,
      over,
      solved,
      dead,
      shuffles,
      autoShuffles,
      lastRemoved: lastRemoved
        ? { ids: lastRemoved.ids.slice(), symbol: lastRemoved.symbol }
        : null,
      score: score(),
      kinds: K,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: solved ? 'p1' : 'p2',
      score: score(),
      scores: { p1: score() },
      text: solved ? '全部消除，通关！' : dead ? '残局无解，本局结束' : '时间耗尽，本局结束',
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
