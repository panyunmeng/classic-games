/**
 * 贪吃蛇大作战 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 规则事实与推导：
 * - 棋盘 29×35 格（CELL=16）：宽 464 铺满 480 减左右各 8，高 560 让出顶部 64 的 HUD；
 * - 2～4 条蛇同场：单机 p1 玩家 + 3 条 AI，双人同屏 p1/p2，联机按服务端给的座位；
 * - 只有一个网格时钟（0.15 s 一步）推进所有蛇。原因是对撞必须在同一步里同时裁决：
 *   如果每条蛇各自计时，「谁先动」会直接决定生死，规则就不公平，也无法两端复现；
 * - 吃食物：+1 节、+10 分；同时把全局步进间隔从 0.15 s 压到 0.09 s（全场节奏加快，
 *   长蛇越多、局面越紧）。这是对「吃食加速」的落地方式，理由同上：单时钟才能谈同时判定；
 * - 存活：每走一步 +1 分；撞墙 / 撞自己 / 撞他蛇身体 / 两头进入同一格 → 该蛇出局；
 * - 出局蛇的全部身体格变成食物（活蛇身上的格子除外），本局其他蛇可以抢食；
 * - 最后一条存活者胜；90 s 到按体长判（再比分数，完全并列算平局）；
 * - 单机里玩家 p1 一出局就结算，否则玩家只能干看着 3 条 AI 跑完剩余秒数。
 */
import { createRng } from '../../shared/rng.js';
import { chooseMove } from './ai.mjs';

export const W = 480;
export const H = 640;
export const CELL = 16;
export const COLS = 29;
export const ROWS = 35;
export const OFF_X = 8;
export const OFF_Y = 64;

export const INTERVAL = 0.15;
export const MIN_INTERVAL = 0.09;
export const ACCEL_PER_FOOD = 0.0015;
export const TIME_TOTAL = 90;
export const START_LENGTH = 4;
export const FOOD_TARGET = 6;
export const FOOD_MAX = 160;
export const FOOD_SCORE = 10;
export const SURVIVE_SCORE = 1;

export const DIRS = Object.freeze({
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
});

/** 联机动作词表白名单：只认这四个转向指令 */
export const ACTIONS = Object.freeze(['left', 'right', 'up', 'down']);

const MODES = ['solo', 'ai', 'local2p', 'online'];

// 出生点：四角沿边逆时针排布，两两不同行/列，直线出发不会一开局就迎面撞死；
// 四条边各留 5 格余量，玩家/AI 都有足够反应距离。
const SPAWNS = {
  p1: { x: 5, y: 5, dir: 'right' },
  p2: { x: 23, y: 5, dir: 'down' },
  p3: { x: 23, y: 29, dir: 'left' },
  p4: { x: 5, y: 29, dir: 'up' },
};

const SEAT_META = {
  p1: { color: '#4ade80' },
  p2: { color: '#22d3ee' },
  p3: { color: '#fbbf24' },
  p4: { color: '#a78bfa' },
};

const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

function cellKey(x, y) {
  return `${x},${y}`;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function isOpposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

/** 'p1'..'p4' 或 shell.submit 传来的 0..3 索引 → 座位号；非法返回 null */
export function normalizeSeat(playerId) {
  if (typeof playerId === 'number' && Number.isInteger(playerId) && playerId >= 0 && playerId < 4) {
    return `p${playerId + 1}`;
  }
  if (typeof playerId === 'string') {
    const m = /^p([1-4])$/i.exec(playerId.trim());
    if (m) return `p${m[1]}`;
  }
  return null;
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const safeMode = MODES.includes(mode) ? mode : 'solo';
  const lv = Math.max(1, Math.min(3, Math.round(Number(level) || 1)));

  let rng = createRng(seed);
  let seats = [];
  let snakes = [];
  let foods = [];
  let foodSeq = 0;
  let interval = INTERVAL;
  let timeLeft = TIME_TOTAL;
  let tick = 0;
  let over = false;
  let winner = null;
  let acc = 0;

  /* ── 座位与身份 ──────────────────────────────────────── */

  function pickSeats() {
    if (safeMode === 'solo' || safeMode === 'ai') return ['p1', 'p2', 'p3', 'p4'];
    if (safeMode === 'local2p') return ['p1', 'p2'];
    const list = [];
    for (const raw of Array.isArray(players) ? players : []) {
      const seat = normalizeSeat(raw);
      if (seat && !list.includes(seat)) list.push(seat);
    }
    if (list.length < 2) return ['p1', 'p2'];
    return list.slice(0, 4);
  }

  function isAiSeat(seat) {
    if (safeMode === 'local2p' || safeMode === 'online') return false;
    return seat !== 'p1';
  }

  function seatName(seat) {
    if (isAiSeat(seat)) return `AI ${Number(seat.slice(1)) - 1}`;
    if (safeMode === 'solo' || safeMode === 'ai') return '你';
    return seat.toUpperCase();
  }

  function findSnake(seat) {
    return snakes.find((s) => s.id === seat) || null;
  }

  function aliveSnakes() {
    return snakes.filter((s) => s.alive);
  }

  /* ── 食物 ────────────────────────────────────────────── */

  function spawnFood(count = 1) {
    for (let i = 0; i < count; i++) {
      const used = new Set();
      for (const s of snakes) {
        if (!s.alive) continue;
        for (const c of s.segments) used.add(cellKey(c.x, c.y));
      }
      for (const f of foods) used.add(cellKey(f.x, f.y));
      const free = [];
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (!used.has(cellKey(x, y))) free.push({ x, y });
        }
      }
      if (!free.length) return;
      const cell = rng.pick(free);
      foods.push({ x: cell.x, y: cell.y, id: ++foodSeq });
    }
  }

  /** 出局蛇身体落食物：不覆盖已有食物，也不落在活蛇身上 */
  function addFood(x, y, liveOcc) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
    if (liveOcc && liveOcc.has(cellKey(x, y))) return;
    if (foods.some((f) => f.x === x && f.y === y)) return;
    foods.push({ x, y, id: ++foodSeq });
  }

  /* ── 开局 ────────────────────────────────────────────── */

  function reset() {
    rng = createRng(seed);
    seats = pickSeats();
    snakes = seats.map((seat) => {
      const spawn = SPAWNS[seat];
      const dir = spawn.dir;
      const vec = DIRS[dir];
      const segments = [];
      for (let k = 0; k < START_LENGTH; k++) {
        segments.push({ x: spawn.x - vec.x * k, y: spawn.y - vec.y * k });
      }
      return {
        id: seat,
        name: seatName(seat),
        color: SEAT_META[seat].color,
        ai: isAiSeat(seat),
        dir,
        pending: [],
        segments,
        alive: true,
        score: 0,
        eaten: 0,
        survived: 0,
        bestLength: START_LENGTH,
        deathAt: null,
        cause: null,
      };
    });
    foods = [];
    foodSeq = 0;
    interval = INTERVAL;
    timeLeft = TIME_TOTAL;
    tick = 0;
    over = false;
    winner = null;
    acc = 0;
    spawnFood(FOOD_TARGET);
  }

  /* ── 输入 ────────────────────────────────────────────── */

  function submit(playerId, action) {
    if (playerId === undefined || playerId === null) playerId = 'p1';
    const seat = normalizeSeat(playerId);
    if (!seat) return { ok: false, error: '未知座位' };
    if (typeof action !== 'string' || !DIRS[action]) return { ok: false, error: '未知动作' };
    if (over) return { ok: false, error: '本局已结束' };
    const snake = findSnake(seat);
    if (!snake) return { ok: false, error: '该座位未入场' };
    if (!snake.alive) return { ok: false, error: '该蛇已出局' };
    const last = snake.pending.length ? snake.pending[snake.pending.length - 1] : snake.dir;
    if (action === last) return { ok: true };
    if (OPPOSITE[action] === last) return { ok: false, error: '不能直接反向' };
    if (snake.pending.length >= 2) return { ok: false, error: '转向指令积压' };
    snake.pending.push(action);
    return { ok: true };
  }

  /** 联机服务端把输入攒成 [{seat, action}] 再调 step；本地裸词归 p1 */
  function applyActions(actions) {
    if (!Array.isArray(actions)) return;
    for (const item of actions) {
      if (!item) continue;
      if (typeof item === 'string') {
        submit('p1', item);
        continue;
      }
      if (typeof item !== 'object') continue;
      submit(item.seat ?? item.playerId ?? item.id ?? 'p1', item.action);
    }
  }

  /* ── AI ──────────────────────────────────────────────── */

  function aiView() {
    return {
      cols: COLS,
      rows: ROWS,
      snakes: snakes.map((s) => ({
        id: s.id,
        dir: s.dir,
        alive: s.alive,
        segments: s.segments.map((c) => ({ x: c.x, y: c.y })),
      })),
      foods: foods.map((f) => ({ x: f.x, y: f.y })),
    };
  }

  function decideAi() {
    if (!snakes.some((s) => s.alive && s.ai)) return;
    const view = aiView();
    for (const snake of snakes) {
      if (!snake.alive || !snake.ai) continue;
      const dir = chooseMove(view, snake.id, lv, rng);
      if (!dir || !DIRS[dir]) continue;
      if (OPPOSITE[dir] === snake.dir) continue;
      snake.dir = dir;
    }
  }

  /* ── 单步推进 ────────────────────────────────────────── */

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  /** 体长（并列时比分数）判胜；全并列算平局 */
  function judge(list) {
    if (!list.length) return 'draw';
    let best = list[0];
    for (const s of list) {
      if (s.segments.length > best.segments.length) best = s;
      else if (s.segments.length === best.segments.length && s.score > best.score) best = s;
    }
    const ties = list.filter((s) => s.segments.length === best.segments.length && s.score === best.score);
    return ties.length > 1 ? 'draw' : best.id;
  }

  /**
   * 单机玩家出局时的收尾：这不是「时间到按体长判」，不该判平局，
   * 所以只取当前最长的一条（同长同分按座位先后），保证一定有一个胜者。
   */
  function leader(list) {
    if (!list.length) return 'draw';
    let best = list[0];
    for (const s of list) {
      if (s.segments.length > best.segments.length) best = s;
      else if (s.segments.length === best.segments.length && s.score > best.score) best = s;
    }
    return best.id;
  }

  function advance(dt) {
    if (over) return;

    decideAi();

    // 待转方向：一步只消费一个，防止一帧两次转向直接自撞
    for (const snake of snakes) {
      if (!snake.alive) continue;
      while (snake.pending.length) {
        const dir = snake.pending.shift();
        if (!DIRS[dir] || OPPOSITE[dir] === snake.dir) continue;
        snake.dir = dir;
        break;
      }
    }

    const alive = aliveSnakes();
    const heads = new Map();
    for (const snake of alive) {
      const vec = DIRS[snake.dir];
      const head = snake.segments[0];
      heads.set(snake.id, { x: head.x + vec.x, y: head.y + vec.y });
    }

    const cause = new Map();
    const dead = new Set();

    // 1) 撞墙
    for (const snake of alive) {
      const head = heads.get(snake.id);
      if (!inBounds(head.x, head.y)) {
        dead.add(snake.id);
        cause.set(snake.id, 'wall');
      }
    }

    // 2) 两头进入同一格：双方都出局（谁撞谁没有意义）
    const byCell = new Map();
    for (const snake of alive) {
      if (dead.has(snake.id)) continue;
      const head = heads.get(snake.id);
      const k = cellKey(head.x, head.y);
      const list = byCell.get(k) || [];
      list.push(snake.id);
      byCell.set(k, list);
    }
    for (const list of byCell.values()) {
      if (list.length < 2) continue;
      for (const id of list) {
        dead.add(id);
        cause.set(id, 'head');
      }
    }

    // 3) 吃食假设：决定这一步谁的尾巴不动（变长），进而决定哪些格是障碍
    const foodAt = new Map();
    for (const f of foods) foodAt.set(cellKey(f.x, f.y), f);
    const grows = new Set();
    for (const snake of alive) {
      if (dead.has(snake.id)) continue;
      const head = heads.get(snake.id);
      if (foodAt.has(cellKey(head.x, head.y))) grows.add(snake.id);
    }

    const blocked = new Set();
    for (const snake of alive) {
      const keep = grows.has(snake.id) ? snake.segments.length : snake.segments.length - 1;
      for (let i = 0; i < keep; i++) {
        blocked.add(cellKey(snake.segments[i].x, snake.segments[i].y));
      }
    }
    for (const snake of alive) {
      if (dead.has(snake.id)) continue;
      const head = heads.get(snake.id);
      if (blocked.has(cellKey(head.x, head.y))) {
        dead.add(snake.id);
        cause.set(snake.id, 'body');
      }
    }

    // 4) 只移动存活者；吃到食物才长一节
    for (const snake of alive) {
      if (dead.has(snake.id)) continue;
      const head = heads.get(snake.id);
      const food = grows.has(snake.id) ? foodAt.get(cellKey(head.x, head.y)) : null;
      snake.segments.unshift({ x: head.x, y: head.y });
      if (!food) {
        snake.segments.pop();
      } else {
        foods = foods.filter((f) => f.id !== food.id);
        snake.score += FOOD_SCORE;
        snake.eaten += 1;
        interval = Math.max(MIN_INTERVAL, interval - ACCEL_PER_FOOD);
      }
      snake.score += SURVIVE_SCORE;
      snake.survived += dt;
      if (snake.segments.length > snake.bestLength) snake.bestLength = snake.segments.length;
    }

    // 5) 出局：身体全部变食物（不落在活蛇身上）
    const dying = alive.filter((s) => dead.has(s.id));
    for (const snake of dying) {
      snake.alive = false;
      snake.deathAt = tick + 1;
      snake.cause = cause.get(snake.id) || 'body';
      snake.pending.length = 0;
    }
    const liveOcc = new Set();
    for (const snake of snakes) {
      if (!snake.alive) continue;
      for (const c of snake.segments) liveOcc.add(cellKey(c.x, c.y));
    }
    for (const snake of dying) {
      for (const c of snake.segments) addFood(c.x, c.y, liveOcc);
      snake.segments = [];
    }
    while (foods.length > FOOD_MAX) foods.shift();

    tick += 1;
    timeLeft = Math.max(0, timeLeft - dt);
    if (!over && foods.length < FOOD_TARGET) spawnFood(FOOD_TARGET - foods.length);

    const remain = aliveSnakes();
    if (remain.length <= 1) {
      over = true;
      winner = remain.length === 1 ? remain[0].id : 'draw';
    } else if (timeLeft <= 0) {
      over = true;
      winner = judge(remain);
    } else if (safeMode === 'solo' || safeMode === 'ai') {
      const p1 = findSnake('p1');
      if (p1 && !p1.alive) {
        over = true;
        winner = leader(remain);
      }
    }
  }

  function step(dt, actions = []) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    applyActions(actions);
    acc += Math.min(dt, 0.5);
    let guard = 0;
    while (acc >= interval && !over && guard < 12) {
      acc -= interval;
      advance(interval);
      guard += 1;
    }
  }

  /* ── 只读快照 ────────────────────────────────────────── */

  function primarySeat() {
    if (safeMode === 'local2p') {
      const a = findSnake('p1');
      const b = findSnake('p2');
      if (a && b) return a.score >= b.score ? 'p1' : 'p2';
      return a ? 'p1' : 'p2';
    }
    return 'p1';
  }

  function state() {
    const primary = findSnake(primarySeat());
    const aliveCount = snakes.filter((s) => s.alive).length;
    const out = {
      turn: null, // 实时制：没有回合归属，但契约要求字段存在
      mode: safeMode,
      w: W,
      h: H,
      cell: CELL,
      cols: COLS,
      rows: ROWS,
      offX: OFF_X,
      offY: OFF_Y,
      interval,
      speed: round2(1 / interval),
      snakes: snakes.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        ai: s.ai,
        dir: s.dir,
        segments: s.segments.map((c) => ({ x: c.x, y: c.y })),
        alive: s.alive,
        score: s.score,
        length: s.segments.length,
        bestLength: s.bestLength,
        eaten: s.eaten,
        survived: round2(s.survived),
        deathAt: s.deathAt,
        cause: s.cause,
        pending: s.pending.slice(),
      })),
      foods: foods.map((f) => ({ x: f.x, y: f.y, id: f.id })),
      timeLeft: round2(timeLeft),
      timeTotal: TIME_TOTAL,
      elapsed: round2(TIME_TOTAL - timeLeft),
      aliveCount,
      total: snakes.length,
      seats: seats.slice(),
      over,
      winner,
      tick,
      hud: `${aliveCount}/${snakes.length} 存活`,
    };
    // 联机是同一份服务端快照给所有座位看，没有“我的分”，交给客户端按 seat 取；
    // 单机/同屏才给一个主分数，shell 顶栏用它显示与记录最高分。
    if (safeMode !== 'online') out.score = primary ? primary.score : 0;
    return out;
  }

  function statsText(champ) {
    if (safeMode === 'solo' || safeMode === 'ai') {
      const p1 = findSnake('p1');
      const parts = [];
      if (p1) parts.push(`你存活 ${round2(p1.survived).toFixed(1)} s · 长度 ${p1.bestLength} · 吃掉 ${p1.eaten} 个`);
      if (champ && champ.id !== 'p1') parts.push(`${champ.name} 成为最后的蛇`);
      return parts.join(' · ');
    }
    const parts = snakes.map((s) => `${s.id.toUpperCase()} ${s.bestLength} 节`);
    if (champ) parts.push(`${champ.id.toUpperCase()} 胜`);
    else parts.push('同归于尽');
    return `${parts.join(' · ')} · 用时 ${round2(TIME_TOTAL - timeLeft).toFixed(1)} s`;
  }

  function result() {
    if (!over) return null;
    const scores = {};
    for (const s of snakes) scores[s.id] = s.score;
    const champ = winner === 'draw' ? null : findSnake(winner);
    const p1 = findSnake('p1');
    const values = Object.values(scores);
    let score;
    if (safeMode === 'local2p') score = values.length ? Math.max(...values) : 0;
    else if (safeMode === 'online') score = champ ? champ.score : values.length ? Math.max(...values) : 0;
    else score = p1 ? p1.score : champ ? champ.score : 0;

    let title;
    if (winner === 'draw') title = '同归于尽';
    else if (safeMode === 'solo' || safeMode === 'ai') title = winner === 'p1' ? '存活到最后' : '惜败';
    else title = `${winner.toUpperCase()} 获胜`;

    return {
      over: true,
      winner,
      score,
      scores,
      title,
      text: statsText(champ),
      alive: snakes.filter((s) => s.alive).map((s) => s.id),
    };
  }

  /* ── 测试专用钩子（只写纯数据，不引入 DOM/随机/时钟） ── */

  function debugSet(opts = {}) {
    const { snakes: patch, foods: patchFoods, timeLeft: tl, interval: iv, tick: tk, acc: ac, over: ov, winner: wn } = opts;
    if (patch) {
      for (const seat of Object.keys(patch)) {
        const snake = findSnake(seat);
        if (!snake) continue;
        const p = patch[seat] || {};
        if (p.dir && DIRS[p.dir]) {
          snake.dir = p.dir;
          snake.pending = [];
        }
        if (p.segments) snake.segments = p.segments.map((c) => ({ x: c.x, y: c.y }));
        if (p.pending) snake.pending = p.pending.slice();
        if (p.alive !== undefined) snake.alive = Boolean(p.alive);
        if (p.ai !== undefined) snake.ai = Boolean(p.ai);
        if (p.score !== undefined) snake.score = p.score;
        if (p.eaten !== undefined) snake.eaten = p.eaten;
        if (p.survived !== undefined) snake.survived = p.survived;
        if (p.bestLength !== undefined) snake.bestLength = p.bestLength;
        if (p.cause !== undefined) snake.cause = p.cause;
      }
    }
    if (patchFoods) {
      foods = patchFoods.map((f, i) => ({ x: f.x, y: f.y, id: f.id ?? 9000 + i }));
      foodSeq = 9000 + foods.length;
    }
    if (tl !== undefined) timeLeft = tl;
    if (iv !== undefined) interval = iv;
    if (tk !== undefined) tick = tk;
    if (ac !== undefined) acc = ac;
    if (ov !== undefined) over = Boolean(ov);
    if (wn !== undefined) winner = wn;
  }

  reset();

  return { submit, step, state, result, reset, debugSet };
}
