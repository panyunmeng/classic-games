/**
 * 连连看 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 关键事实与推导：
 * - 默认 8×6 偶数网格，共 48 格 = 24 对；每对图案从 kinds(8~12) 种里取，保证偶数出现。
 * - 连通判定：在网格外扩一圈「空气带」上做 BFS，只允许最多 2 次拐弯（方向改变计一次），
 *   空气带使「绕棋盘外侧一圈」成为合法路径。拐弯数作为 BFS 状态维度，按 0/1/2 扩展。
 * - 两步计时「每一步限时」：turnBased 下 shell 不跑 game.step，但每帧都会调用
 *   input.update(dt)，因此计时由 input 把 dt 喂给 step(dt) 推进，逻辑层不碰 Date.now。
 *   超时置 over，result() 判负；胜负与计时完全由确定性 dt 驱动，可回放、可单测。
 * - 洗牌：用 rng 打乱剩余图案并重新铺到原占用格；循环重排直到存在至少一对可连
 *   （或达到上限兜底），保证洗完有解。提示：找出一对可连格高亮，消耗次数。
 */
import { createRng } from '../../shared/rng.js';

export const DEFAULT_COLS = 8;
export const DEFAULT_ROWS = 6;
export const MAX_TURNS = 2;
export const DEFAULT_STEP_TIME = 12; // 每一步的限时（秒）

/** 空格判定：null 与 0 都视为空（图案种类从 1 开始，0 永不作图案） */
const isEmpty = (v) => v == null || v === 0;

/** 方向：右、左、下、上 */
const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/**
 * ≤2 折连通判定（外扩一圈边界可走）。
 * board 为一维数组，空用 null / undefined 表示；cols/rows 为内网格尺寸。
 * 返回找到的路径点数组（含首尾格中心坐标），不可连返回 null。
 */
export function findPath(board, cols, rows, a, b) {
  if (a === b) return null;
  const va = board[a];
  const vb = board[b];
  if (isEmpty(va) || isEmpty(vb) || va !== vb) return null;

  const W = cols + 2;
  const H = rows + 2;
  const toX = (i) => (i % cols) + 1;
  const toY = (i) => Math.floor(i / cols) + 1;
  const sx = toX(a);
  const sy = toY(a);
  const tx = toX(b);
  const ty = toY(b);

  // 状态：(x, y, dir, turns)。turns=已拐弯次数；dir=-1 表示起点未定方向。
  // visited[x][y][dir+1] = 到达该状态的最小 turns（剪枝）。
  const INF = 1 << 28;
  const visited = new Array(W * H * 5).fill(INF);
  const prev = new Array(W * H * 5).fill(-1);
  const stateId = (x, y, dir) => (y * W + x) * 5 + (dir + 1);
  const inBoard = (x, y) => x >= 1 && x <= cols && y >= 1 && y <= rows;
  const passable = (x, y) => {
    if (!inBoard(x, y)) return true; // 外圈空气带
    const idx = (y - 1) * cols + (x - 1);
    return idx === a || idx === b || isEmpty(board[idx]); // 仅两端与空格可穿
  };

  const startId = stateId(sx, sy, -1);
  visited[startId] = 0;
  const queue = [{ x: sx, y: sy, dir: -1, turns: 0, id: startId }];
  let head = 0;
  let goalId = -1;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.x === tx && cur.y === ty && cur.turns <= MAX_TURNS) {
      goalId = cur.id;
      break;
    }
    for (let d = 0; d < DIRS.length; d++) {
      const nd = d;
      const nt = cur.dir === -1 || cur.dir === nd ? cur.turns : cur.turns + 1;
      if (nt > MAX_TURNS) continue;
      const nx = cur.x + DIRS[nd].dx;
      const ny = cur.y + DIRS[nd].dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!passable(nx, ny)) continue;
      const nid = stateId(nx, ny, nd);
      if (nt >= visited[nid]) continue;
      visited[nid] = nt;
      prev[nid] = cur.id;
      queue.push({ x: nx, y: ny, dir: nd, turns: nt, id: nid });
    }
  }

  if (goalId < 0) return null;

  // 回溯路径（stateId → 坐标）
  const path = [];
  let id = goalId;
  while (id !== -1) {
    const cell = Math.floor(id / 5);
    path.push({ x: (cell % W) - 1, y: Math.floor(cell / W) - 1 });
    id = prev[id];
  }
  path.reverse();
  return path;
}

/** isConnectable：只判定是否可连，不关心路径本身 */
export function isConnectable(board, cols, rows, a, b) {
  return findPath(board, cols, rows, a, b) !== null;
}

/** 在给定图案多重集下，是否还存在任意一对可连（用于洗牌有解判定） */
function hasAnyMove(board, cols, rows) {
  const byKind = new Map();
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (isEmpty(v)) continue;
    if (!byKind.has(v)) byKind.set(v, []);
    byKind.get(v).push(i);
  }
  for (const cells of byKind.values()) {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (isConnectable(board, cols, rows, cells[i], cells[j])) return true;
      }
    }
  }
  return false;
}

/** 找出一对可连的格索引与路径；无解返回 null（提示功能用） */
function findHint(board, cols, rows) {
  const byKind = new Map();
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (isEmpty(v)) continue;
    if (!byKind.has(v)) byKind.set(v, []);
    byKind.get(v).push(i);
  }
  for (const cells of byKind.values()) {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const path = findPath(board, cols, rows, cells[i], cells[j]);
        if (path) return { a: cells[i], b: cells[j], path };
      }
    }
  }
  return null;
}

export function createGame({
  seed = 1,
  mode = 'solo',
  players = ['p1'],
  level = 1,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  kinds = 8,
  stepTime = DEFAULT_STEP_TIME,
  hints = 3,
} = {}) {
  // 偶数网格、偶数种类、图案数足够铺满棋盘是硬性前提。
  const C = cols % 2 === 0 ? cols : DEFAULT_COLS;
  const R = rows % 2 === 0 ? rows : DEFAULT_ROWS;
  const N = C * R;
  const K = Math.max(2, Math.min(12, Math.floor(kinds)));
  const HINTS = Math.max(0, Math.floor(hints));

  const rng = createRng(seed);
  let board;
  let selected; // 当前选中的格索引，null 表示未选
  let hintPair; // {a,b,path} 高亮中的提示对
  let hintLeft;
  let remain; // 剩余格数
  let score;
  let over;
  let won;
  let timeLeft; // 当前步剩余时间（秒）
  let turns; // 已走的步数
  let lastPath; // 最近一次成功消除的连线路径（渲染动画用）

  /** 生成一对对图案的初始布局，并洗到有解 */
  function deal() {
    const pairCount = N / 2;
    const tiles = [];
    for (let i = 0; i < pairCount; i++) {
      const kind = i % K + 1; // 1..K 循环分配，保证每种成对出现
      tiles.push(kind, kind);
    }
    // 用 rng 洗牌，循环到存在至少一对可连，保证开局有解。
    let layout;
    for (let attempt = 0; attempt < 200; attempt++) {
      layout = rng.shuffle(tiles);
      if (hasAnyMove(layout, C, R)) break;
    }
    board = layout;
  }

  function reset() {
    deal();
    selected = null;
    hintPair = null;
    hintLeft = HINTS;
    remain = N;
    score = 0;
    over = false;
    won = false;
    timeLeft = stepTime;
    turns = 0;
    lastPath = null;
  }

  /** 洗牌：只重排剩余格上的图案，洗到至少存在一对可连 */
  function shuffle() {
    if (over) return { ok: false, error: '本局已结束' };
    const occupied = [];
    const tiles = [];
    for (let i = 0; i < board.length; i++) {
      if (!isEmpty(board[i])) {
        occupied.push(i);
        tiles.push(board[i]);
      }
    }
    if (occupied.length < 2) return { ok: false, error: '无需洗牌' };

    let arranged = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      const candidate = rng.shuffle(tiles);
      const probe = board.slice();
      occupied.forEach((idx, k) => {
        probe[idx] = candidate[k];
      });
      if (hasAnyMove(probe, C, R)) {
        arranged = candidate;
        break;
      }
    }
    if (!arranged) {
      // 极端兜底：找一对同行左右相邻的占用格，把某一种成对图案摆上去，保证直线可连。
      // 用「从 tiles 里取出该对、其余原样填回」的方式，严格保持多重集不变。
      let pairA = -1;
      let pairB = -1;
      for (let k = 0; k + 1 < occupied.length; k++) {
        if (
          occupied[k + 1] === occupied[k] + 1 &&
          Math.floor(occupied[k] / C) === Math.floor(occupied[k + 1] / C)
        ) {
          pairA = k;
          pairB = k + 1;
          break;
        }
      }
      if (pairA >= 0) {
        const counts = new Map();
        for (const t of tiles) counts.set(t, (counts.get(t) || 0) + 1);
        const kind = [...counts.entries()].find(([, n]) => n >= 2)[0];
        const rest = tiles.slice();
        // 从 rest 里删掉两个 kind，作为相邻两格的值；剩余填到其它格。
        let removed = 0;
        const filler = [];
        for (const t of rest) {
          if (t === kind && removed < 2) {
            removed++;
          } else {
            filler.push(t);
          }
        }
        arranged = new Array(tiles.length);
        arranged[pairA] = kind;
        arranged[pairB] = kind;
        let f = 0;
        for (let k = 0; k < tiles.length; k++) {
          if (k === pairA || k === pairB) continue;
          arranged[k] = filler[f++];
        }
      } else {
        arranged = tiles.slice(); // 无相邻格可构造时，退化为任意排列
      }
    }
    occupied.forEach((idx, k) => {
      board[idx] = arranged[k];
    });
    selected = null;
    hintPair = null;
    timeLeft = stepTime; // 洗牌重置本步计时
    lastPath = null;
    return { ok: true };
  }

  /** 提示：消耗一次，高亮一对可连格 */
  function hint() {
    if (over) return { ok: false, error: '本局已结束' };
    if (hintLeft <= 0) return { ok: false, error: '提示次数已用完' };
    const h = findHint(board, C, R);
    if (!h) return { ok: false, error: '当前无可提示的配对，请洗牌' };
    hintLeft -= 1;
    hintPair = { a: h.a, b: h.b, path: h.path };
    lastPath = h.path;
    return { ok: true, hintLeft, pair: [h.a, h.b] };
  }

  /** 选格 / 配对主逻辑 */
  function select(index) {
    if (over) return { ok: false, error: '本局已结束' };
    if (!Number.isInteger(index) || index < 0 || index >= N) {
      return { ok: false, error: '无效选择' };
    }
    if (isEmpty(board[index])) return { ok: false, error: '该位置已消除' };

    if (selected == null) {
      selected = index;
      hintPair = null;
      return { ok: true, selected: index };
    }
    if (selected === index) {
      selected = null; // 再次点击取消选择
      return { ok: true, selected: null };
    }

    const a = selected;
    const b = index;
    if (board[a] !== board[b]) {
      // 图案不同：把新格作为新的起点，符合连连看常见手感。
      selected = index;
      hintPair = null;
      return { ok: false, error: '图案不同，已改选', selected: index };
    }

    const path = findPath(board, C, R, a, b);
    if (!path) {
      // 图案相同但连不上：改选新格。
      selected = index;
      hintPair = null;
      return { ok: false, error: '无法连通，已改选', selected: index };
    }

    // 成功消除：清空格、清空选择、重置本步计时、加分。
    board[a] = null;
    board[b] = null;
    selected = null;
    hintPair = null;
    lastPath = path;
    remain -= 2;
    turns += 1;
    timeLeft = stepTime;
    score += 100;

    if (remain === 0) {
      won = true;
      over = true;
    } else if (!hasAnyMove(board, C, R)) {
      // 死局：没有可连对且未清空——自动判定为失败，避免玩家卡死。
      over = true;
    }
    return { ok: true, removed: [a, b], path, remain, won };
  }

  function submit(playerId, action) {
    if (action === 'shuffle') return shuffle();
    if (action === 'hint') return hint();
    if (typeof action === 'string' && action.startsWith('select:')) {
      const idx = Number(action.slice('select:'.length));
      return select(idx);
    }
    return { ok: false, error: '无效操作' };
  }

  /** 由输入层每帧喂 dt 推进本步计时；超时判负 */
  function step(dt) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      over = true;
      won = false;
    }
  }

  function state() {
    return {
      board: board.slice(),
      cols: C,
      rows: R,
      kinds: K,
      selected,
      hintPair: hintPair ? { a: hintPair.a, b: hintPair.b } : null,
      hintLeft,
      remain,
      score,
      over,
      won,
      timeLeft,
      stepTime,
      turns,
      lastPath: lastPath ? lastPath.map((p) => ({ ...p })) : null,
      turn: 'p1',
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: won ? 'p1' : 'p2',
      scores: { p1: score },
      score,
      text: won ? '全部消除，通关！' : timeLeft <= 0 ? '时间耗尽，本局结束' : '已无可连配对',
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
