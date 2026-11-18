/**
 * 方块对战 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）
 *
 * 规则事实与推导（为什么这样设计）：
 * 1. 双场独立：两人的盘面、出块袋、锁定延迟互不共享。唯一的耦合是「攻击」——
 *    一方消行只往对手的垃圾缓冲槽 push 行，绝不直接改对手盘面，
 *    因此任意时刻两侧都能单独推进，服务端/单机共用同一份规则。
 * 2. 单一 rng 给两场共用：7-bag 每袋恰含 7 种各一次，交错取值不可能让某种长期缺失
 *    （公平由「袋」保证，不依赖取用顺序）；同一 seed + 同一动作序列完全可复现。
 * 3. 垃圾只在「自己落块那一刻」结算（先抵消、后落地），理由：
 *    - 缓冲期间（对手已消行、自己还没落定）玩家有反应窗口去凑消行，这是对战的核心张力；
 *    - 结算点唯一 → 不需要额外计时器，state() 全量可序列化，重放/服务端快照一致。
 * 4. 攻击表 [0,0,1,2,4]：单行不送（否则靠单消磨死对手、节奏拖沓），
 *    双行送 1、三行送 2、四行送 4（风险与回报成正比）。
 * 5. 抵消按「每消 1 行抵 1 行待落垃圾」，从最旧的一行开始（FIFO）：先到的先被消掉。
 * 6. 顶出有两条路径，都判该方负：新块生成位已被占；垃圾把已有方块挤出盘面顶端。
 * 7. 动作词表严格对齐联机服务端实时制白名单
 *    （platform/server/protocol.mjs 的 left|right|up|down|action|action2|rotate|shoot|hold|drop|none），
 *    客户端只发词、不发结果，服务端用本文件当权威逻辑。
 */
import { createRng } from '../../shared/rng.js';
import {
  COLS,
  ROWS,
  TYPES,
  PIECES,
  cellsOf,
  rotateKicks,
  blocked,
  dropY,
  spawnX,
} from './pieces.mjs';
import { aiAction } from './ai.mjs';

export { COLS, ROWS, PIECES, TYPES };

export const STEP = 1 / 60;
export const MAX_SUBSTEPS = 6;
export const LOCK_DELAY = 0.5;
export const MAX_LOCK_RESETS = 15;
/** 垃圾行格子的标记；渲染据此画灰底红缺口。 */
export const GARBAGE = 'G';
/** 消 1/2/3/4 行分别送给对手的垃圾行数。 */
export const ATTACK = Object.freeze([0, 0, 1, 2, 4]);
export const SCORE_TABLE = Object.freeze([0, 100, 300, 500, 800]);
export const SEATS = Object.freeze(['p1', 'p2']);

/** 服务端实时制白名单（多一个 none 表示空动作）。 */
export const ACTION_WORDS = Object.freeze([
  'left', 'right', 'up', 'down', 'action', 'action2', 'rotate', 'shoot', 'hold', 'drop', 'none',
]);

/** 词 → 内部动作。up/action2 是旋转的别名，action/shoot 是硬降的别名（键位与触屏用词不同）。 */
const WORD = {
  left: 'left',
  right: 'right',
  down: 'soft',
  up: 'rotate',
  rotate: 'rotate',
  action2: 'rotate',
  action: 'drop',
  shoot: 'drop',
  drop: 'drop',
  hold: 'hold',
  none: 'none',
};

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

/** 座位归一：shell 传数字下标 0/1，服务端与测试传 'p1'/'p2'。 */
function seatOf(value) {
  if (value === 0 || value === 'p1') return 'p1'; // 数字 0 是 shell 的 p1 下标
  if (value === 1 || value === 'p2') return 'p2';
  return null;
}

function otherSeat(seat) {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const safeMode = ['solo', 'ai', 'local2p', 'online'].includes(mode) ? mode : 'solo';
  const aiEnabled = safeMode === 'solo' || safeMode === 'ai';
  const lv = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  // 等级只影响 AI 出招间隔：等级越低反应越慢（每帧都算反而没人味），规则本身不随等级变。
  const aiEvery = lv >= 3 ? 3 : lv === 2 ? 5 : 7;
  const roster = Array.isArray(players) && players.length > 1 ? players.slice(0, 2) : ['p1'];

  let rng;
  let boards;
  let tick;
  let acc;
  let over;
  let winner;

  /* ── 单场的状态与几何 ─────────────────────────────────── */

  function newBoard(seat) {
    return {
      seat,
      grid: emptyGrid(),
      cur: null,
      queue: [],
      bag: [],
      hold: null,
      holdUsed: false,
      score: 0,
      lines: 0,
      level: 1,
      pieces: 0,
      garbage: [], // [{ gap }]：已判给本场、尚未落地的垃圾行
      over: false,
      lockTimer: 0,
      lockResets: 0,
      justLanded: false,
      dropAcc: 0,
      lastClear: 0,
      aiFail: 0,
    };
  }

  function nextType(b) {
    if (b.bag.length === 0) b.bag.push(...rng.shuffle(TYPES.slice()));
    return b.bag.shift();
  }

  function takeNext(b) {
    const type = b.queue.shift();
    b.queue.push(nextType(b));
    spawn(b, type);
  }

  function spawn(b, type) {
    b.cur = { type, rot: 0, x: spawnX(type), y: 0 };
    b.lockTimer = 0;
    b.lockResets = 0;
    b.justLanded = false;
    b.dropAcc = 0;
    b.aiFail = 0;
    if (blocked(b.grid, type, 0, b.cur.x, 0)) topOut(b);
  }

  function topOut(b) {
    if (b.over) return;
    b.over = true;
    b.cur = null;
    if (!over) {
      over = true;
      winner = otherSeat(b.seat);
    }
  }

  function levelOf(b) {
    return 1 + Math.floor(b.lines / 10);
  }

  /** 重力间隔随等级递减（每 10 行升一级），下限 50ms 防止一步落穿。 */
  function gravityInterval(b) {
    return Math.max(0.05, 0.8 * Math.pow(0.8, b.level - 1));
  }

  function ghostY(b) {
    if (!b.cur) return null;
    const y = dropY(b.grid, b.cur.type, b.cur.rot, b.cur.x, b.cur.y);
    return y == null ? b.cur.y : y;
  }

  /* ── 盘面变化 ─────────────────────────────────────────── */

  function clearRows(b) {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (b.grid[y].every(Boolean)) {
        b.grid.splice(y, 1);
        b.grid.unshift(new Array(COLS).fill(null));
        cleared += 1;
        y += 1;
      }
    }
    return cleared;
  }

  /** 把行判给某一场：缺口位置此刻就用 rng 定死，落地时不再重掷（可复现、可测试）。 */
  function queueGarbage(b, n) {
    for (let i = 0; i < n; i++) b.garbage.push({ gap: rng.int(COLS) });
  }

  /**
   * 垃圾落地：逐行从顶部挤出一行、底部补一行带缺口的灰行。
   * 被挤出盘面顶端的方块说明堆叠已经超过 20 行 → 该方顶出判负。
   */
  function insertGarbage(b, rows) {
    for (const row of rows) {
      const raw = Number.isInteger(row && row.gap) ? row.gap : rng.int(COLS);
      const gap = ((raw % COLS) + COLS) % COLS;
      const lost = b.grid.shift();
      const line = new Array(COLS).fill(GARBAGE);
      line[gap] = null;
      b.grid.push(line);
      if (lost.some(Boolean)) {
        topOut(b);
        return;
      }
    }
  }

  function resetLock(b) {
    if (b.lockTimer > 0 && b.lockResets < MAX_LOCK_RESETS) {
      b.lockTimer = 0;
      b.lockResets += 1;
    }
  }

  function lock(b) {
    if (!b.cur || b.over) return;
    for (const c of cellsOf(b.cur)) {
      if (c.y >= 0 && c.y < ROWS && c.x >= 0 && c.x < COLS) b.grid[c.y][c.x] = b.cur.type;
    }

    const cleared = clearRows(b);
    b.pieces += 1;
    if (cleared > 0) {
      b.score += SCORE_TABLE[cleared] * b.level;
      b.lines += cleared;
      b.lastClear = cleared;
      b.level = levelOf(b);
    } else {
      b.lastClear = 0;
    }

    // 先记下发出的攻击（与抵消互不影响），再抵掉自己的待落垃圾，最后落地。
    const attack = ATTACK[cleared] || 0;
    const other = boards[otherSeat(b.seat)];
    if (attack > 0 && other && !other.over) queueGarbage(other, attack);

    let cancel = cleared;
    while (cancel > 0 && b.garbage.length > 0) {
      b.garbage.shift();
      cancel -= 1;
    }
    if (b.garbage.length > 0) {
      const rows = b.garbage;
      b.garbage = [];
      insertGarbage(b, rows);
      if (b.over) return;
    }

    b.cur = null;
    b.holdUsed = false;
    takeNext(b);
  }

  /* ── 动作 ─────────────────────────────────────────────── */

  function doAction(seat, word) {
    const b = boards[seat];
    if (!b || over || b.over) return false;
    const canon = WORD[word];
    if (!canon || canon === 'none') return false;
    if (!b.cur) return false;

    switch (canon) {
      case 'left':
      case 'right': {
        const probe = { ...b.cur, x: b.cur.x + (canon === 'left' ? -1 : 1) };
        if (blocked(b.grid, probe.type, probe.rot, probe.x, probe.y)) return false;
        b.cur = probe;
        resetLock(b);
        return true;
      }
      case 'rotate': {
        const from = b.cur.rot;
        const to = (from + 1) % 4;
        for (const [dx, dy] of rotateKicks(b.cur.type, from, to)) {
          const x = b.cur.x + dx;
          const y = b.cur.y + dy;
          if (!blocked(b.grid, b.cur.type, to, x, y)) {
            b.cur = { ...b.cur, rot: to, x, y };
            resetLock(b);
            return true;
          }
        }
        return false;
      }
      case 'soft': {
        const probe = { ...b.cur, y: b.cur.y + 1 };
        if (blocked(b.grid, probe.type, probe.rot, probe.x, probe.y)) return false;
        b.cur = probe;
        b.score += 1;
        resetLock(b);
        return true;
      }
      case 'drop': {
        const target = dropY(b.grid, b.cur.type, b.cur.rot, b.cur.x, b.cur.y);
        const dest = target == null ? b.cur.y : target;
        const dist = dest > b.cur.y ? dest - b.cur.y : 0;
        b.cur = { ...b.cur, y: dest };
        b.score += dist * 2;
        lock(b);
        return true;
      }
      case 'hold': {
        if (b.holdUsed) return false;
        const outgoing = b.cur.type;
        if (b.hold == null) {
          b.hold = outgoing;
          b.cur = null;
          takeNext(b);
        } else {
          const incoming = b.hold;
          b.hold = outgoing;
          spawn(b, incoming);
        }
        b.holdUsed = true;
        return true;
      }
      default:
        return false;
    }
  }

  /* ── 时间推进 ─────────────────────────────────────────── */

  function advanceBoard(b) {
    if (b.over || !b.cur) return;
    const interval = gravityInterval(b);
    b.dropAcc += STEP;

    let landed = false;
    let guard = 0;
    while (b.dropAcc >= interval && guard < 24) {
      if (blocked(b.grid, b.cur.type, b.cur.rot, b.cur.x, b.cur.y + 1)) {
        b.dropAcc = 0; // 触底后余量作废，避免攒着到移动时突然再落
        landed = true;
        break;
      }
      b.cur = { ...b.cur, y: b.cur.y + 1 };
      b.dropAcc -= interval;
      guard += 1;
      if (blocked(b.grid, b.cur.type, b.cur.rot, b.cur.x, b.cur.y + 1)) {
        landed = true;
        break;
      }
    }

    const grounded = blocked(b.grid, b.cur.type, b.cur.rot, b.cur.x, b.cur.y + 1);
    if (!grounded) {
      b.lockTimer = 0;
      b.justLanded = false;
      return;
    }
    if (landed) {
      // 本帧刚落到底：锁定延迟从下一帧起算，给玩家约 500ms 反应窗口
      b.justLanded = true;
      b.lockTimer = 0;
    } else if (b.justLanded) {
      b.justLanded = false;
      b.lockTimer += STEP;
    } else {
      b.lockTimer += STEP;
    }
    if (b.lockTimer >= LOCK_DELAY) lock(b);
  }

  /** AI 固定节奏出招（按 tick 计数，不按墙钟 → 可复现）；卡住时兜底硬降。 */
  function maybeAi() {
    if (!aiEnabled || over) return;
    if (tick % aiEvery !== 0) return;
    const b = boards.p2;
    if (!b || b.over || !b.cur) return;
    const word = aiAction({ grid: b.grid, cur: b.cur }, lv);
    if (!word) return;
    if (doAction('p2', word)) {
      b.aiFail = 0;
      return;
    }
    b.aiFail += 1;
    if (b.aiFail >= 4) {
      b.aiFail = 0;
      doAction('p2', 'drop');
    }
  }

  function substep() {
    maybeAi();
    advanceBoard(boards.p1);
    if (over) return;
    advanceBoard(boards.p2);
  }

  function dispatch(actions) {
    if (!actions) return;
    const list = Array.isArray(actions) ? actions : [actions];
    for (const item of list) {
      if (item == null) continue;
      if (typeof item === 'string') {
        doAction('p1', item);
        continue;
      }
      const seat = seatOf(item.seat ?? item.playerId ?? item.player);
      if (!seat) continue;
      if (typeof item.action === 'string') doAction(seat, item.action);
    }
  }

  function step(dt, actions = []) {
    if (over) return;
    const delta = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    // 动作是离散事件：每次 step 只结算一次，避免被 1/60 子步重复消费。
    dispatch(actions);
    if (over) return;
    acc += delta;
    let n = 0;
    while (acc >= STEP && n < MAX_SUBSTEPS && !over) {
      acc -= STEP;
      tick += 1;
      substep();
      n += 1;
    }
  }

  /* ── 对外 ─────────────────────────────────────────────── */

  function submit(playerId, action) {
    const seat = seatOf(playerId);
    if (!seat) return { ok: false, error: '未知玩家' };
    if (over) return { ok: false, error: '本局已结束' };
    if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(WORD, action)) {
      return { ok: false, error: `无效动作：${action}` };
    }
    const b = boards[seat];
    if (b.over) return { ok: false, error: '该方已顶出' };
    if (WORD[action] === 'none') return { ok: true };
    const changed = doAction(seat, action);
    return { ok: true, changed };
  }

  function boardView(b) {
    return {
      seat: b.seat,
      grid: b.grid.map((row) => row.slice()),
      cur: b.cur ? { type: b.cur.type, rot: b.cur.rot, x: b.cur.x, y: b.cur.y } : null,
      ghostY: ghostY(b),
      next: b.queue.slice(0, 3),
      hold: b.hold,
      holdUsed: b.holdUsed,
      score: b.score,
      lines: b.lines,
      level: b.level,
      pieces: b.pieces,
      lastClear: b.lastClear,
      garbage: b.garbage.map((g) => ({ gap: g.gap })),
      incoming: b.garbage.length,
      over: b.over,
      lockTimer: b.lockTimer,
    };
  }

  function state() {
    const p1 = boardView(boards.p1);
    const p2 = boardView(boards.p2);
    return {
      turn: null, // 实时制：没有回合归属，但契约要求字段存在
      mode: safeMode,
      roster: roster.slice(),
      tick,
      cols: COLS,
      rows: ROWS,
      attack: ATTACK.slice(),
      boards: { p1, p2 },
      winner: over ? winner : null,
      over,
      hud: `${p1.score} : ${p2.score}`,
    };
  }

  function result() {
    if (!over) return null;
    const loser = otherSeat(winner);
    const scores = { p1: boards.p1.score, p2: boards.p2.score };
    let title = '对局结束';
    if (safeMode === 'local2p') title = winner === 'p1' ? '左侧获胜' : '右侧获胜';
    else if (safeMode !== 'online') title = winner === 'p1' ? '胜利' : '惜败';
    const score = Math.max(scores.p1, scores.p2);
    return {
      over: true,
      winner,
      loser,
      score,
      scores,
      title,
      text: `左场 ${scores.p1} : ${scores.p2} 右场 · ${loser === 'p1' ? '左场' : '右场'}被顶出`,
    };
  }

  function reset() {
    rng = createRng(seed);
    boards = { p1: newBoard('p1'), p2: newBoard('p2') };
    tick = 0;
    acc = 0;
    over = false;
    winner = null;
    // 顺序固定：p1 先取 4 块（袋 + 3 张预览），再 p2，保证同 seed 的首发一致。
    for (const seat of SEATS) {
      const b = boards[seat];
      b.queue = [nextType(b), nextType(b), nextType(b)];
      takeNext(b);
    }
  }

  /* ── 测试钩子（只写纯数据，正常流程不调用） ───────────── */

  function debugSetCell(seat, x, y, type) {
    const b = boards[seatOf(seat)];
    if (!b) return false;
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    b.grid[y][x] = type == null ? null : type;
    return true;
  }

  function debugClear(seat) {
    const b = boards[seatOf(seat)];
    if (!b) return false;
    b.grid = emptyGrid();
    return true;
  }

  /** rows 为数字时按 rng 掷缺口；为数组时按给定缺口列（用于精确断言）。 */
  function debugGarbage(seat, rows) {
    const b = boards[seatOf(seat)];
    if (!b) return false;
    if (Array.isArray(rows)) {
      for (const g of rows) {
        const raw = Number.isInteger(g) ? g : 0;
        b.garbage.push({ gap: ((raw % COLS) + COLS) % COLS });
      }
    } else {
      const n = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
      for (let i = 0; i < n; i++) b.garbage.push({ gap: rng.int(COLS) });
    }
    return true;
  }

  /** 强制当前块（单测用它构造「I 块竖插四行」这类确定性场面）。 */
  function debugPiece(seat, type, rot = 0, x = null, y = 0) {
    const b = boards[seatOf(seat)];
    if (!b || !PIECES[type]) return false;
    b.cur = { type, rot: ((rot % 4) + 4) % 4, x: x == null ? spawnX(type) : x, y };
    b.lockTimer = 0;
    b.lockResets = 0;
    b.justLanded = false;
    b.dropAcc = 0;
    b.over = false;
    return true;
  }

  function debugSet(seat, patch = {}) {
    const b = boards[seatOf(seat)];
    if (!b || !patch) return false;
    if (Number.isFinite(patch.score)) b.score = patch.score;
    if (Number.isFinite(patch.lines)) {
      b.lines = patch.lines;
      b.level = levelOf(b);
    }
    if (Number.isFinite(patch.hold)) b.hold = patch.hold;
    if (patch.hold === null) b.hold = null;
    return true;
  }

  reset();

  return { submit, step, state, result, reset, debugSetCell, debugClear, debugGarbage, debugPiece, debugSet };
}
