/**
 * 数独 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 9×9 标准数独：每行/每列/每个 3×3 宫各含 1～9 且不重复。
 * - 唯一解生成分两步：① 用带洗牌的回溯填满一个完整解；② 按随机顺序挖洞，
 *   每挖一格都用「最多数出 2 个解」的计数器验证，若解数 != 1 则回填该格。
 * - 计数器用行/列/宫位掩码 + 最少候选（MRV）选格，典型局面亚毫秒级，
 *   81 次挖洞验证远低于 300ms 预算。
 * - 给定格（puzzle != 0）不可修改；玩家输入只写 values。
 * - notes 是每格候选数字数组；hint 揭示一格且消耗次数；undo 用快照栈。
 *
 * action 格式：
 *   'set:r,c,n'   n=1～9 落子，n=0 表示擦除（兼容别名 'erase:r,c'）
 *   'note:r,c,n'  切换候选数
 *   'hint'        揭示一格
 *   'undo'        撤销一步
 *   'level:N'     N=1/2/3 切换难度并重新生成
 */
import { createRng } from '../../shared/rng.js';

export const SIZE = 9;
export const CELLS = SIZE * SIZE;
export const FULL = 0x1ff; // 低 9 位全置 1，表示 1～9 都可选

/** 难度 → 挖洞数与提示次数（挖洞越多给定越少，难度越高） */
export const LEVELS = {
  1: { name: '简单', holes: 40, hints: 5 },
  2: { name: '中等', holes: 48, hints: 3 },
  3: { name: '困难', holes: 54, hints: 2 },
};

const BIT_COUNT = new Uint8Array(512);
for (let i = 1; i < 512; i++) BIT_COUNT[i] = BIT_COUNT[i >> 1] + (i & 1);

function boxOf(r, c) {
  return ((r / 3) | 0) * 3 + ((c / 3) | 0);
}

function digitsOf(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) out.push(d);
  return out;
}

function emptyMasks() {
  return {
    rm: new Array(SIZE).fill(0),
    cm: new Array(SIZE).fill(0),
    bm: new Array(SIZE).fill(0),
  };
}

/** 把 d 的位写入三套掩码（不改变 grid） */
function maskOn(rm, cm, bm, r, c, d) {
  const bit = 1 << (d - 1);
  rm[r] |= bit;
  cm[c] |= bit;
  bm[boxOf(r, c)] |= bit;
}

function maskOff(rm, cm, bm, r, c, d) {
  const bit = ~(1 << (d - 1));
  rm[r] &= bit;
  cm[c] &= bit;
  bm[boxOf(r, c)] &= bit;
}

/** 选候选最少的空格；dead=true 表示该空格无候选（死局） */
function findCell(grid, rm, cm, bm) {
  let best = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let i = 0; i < CELLS; i++) {
    if (grid[i] !== 0) continue;
    const r = (i / SIZE) | 0;
    const c = i % SIZE;
    const mask = FULL & ~(rm[r] | cm[c] | bm[boxOf(r, c)]);
    const cnt = BIT_COUNT[mask];
    if (cnt === 0) return { i: -1, mask: 0, dead: true };
    if (cnt < bestCount) {
      bestCount = cnt;
      best = i;
      bestMask = mask;
      if (cnt === 1) break;
    }
  }
  return { i: best, mask: bestMask, dead: false };
}

/** 用注入的 rng 洗牌候选，回溯生成一个完整合法解 */
function generateSolution(rng) {
  const grid = new Array(CELLS).fill(0);
  const { rm, cm, bm } = emptyMasks();

  function place(i, d) {
    grid[i] = d;
    maskOn(rm, cm, bm, (i / SIZE) | 0, i % SIZE, d);
  }
  function unplace(i, d) {
    grid[i] = 0;
    maskOff(rm, cm, bm, (i / SIZE) | 0, i % SIZE, d);
  }

  function rec() {
    const f = findCell(grid, rm, cm, bm);
    if (f.dead) return false;
    if (f.i < 0) return true;
    for (const d of rng.shuffle(digitsOf(f.mask))) {
      place(f.i, d);
      if (rec()) return true;
      unplace(f.i, d);
    }
    return false;
  }

  rec();
  return grid;
}

/** 数解，最多数到 limit 个即返回（MRV 剪枝） */
function countSolutions(grid, limit = 2) {
  const { rm, cm, bm } = emptyMasks();
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i];
    if (v) maskOn(rm, cm, bm, (i / SIZE) | 0, i % SIZE, v);
  }

  function rec() {
    const f = findCell(grid, rm, cm, bm);
    if (f.dead) return 0;
    if (f.i < 0) return 1;
    let total = 0;
    for (const d of digitsOf(f.mask)) {
      const r = (f.i / SIZE) | 0;
      const c = f.i % SIZE;
      grid[f.i] = d;
      maskOn(rm, cm, bm, r, c, d);
      total += rec();
      grid[f.i] = 0;
      maskOff(rm, cm, bm, r, c, d);
      if (total >= limit) return total;
    }
    return total;
  }

  return rec();
}

/**
 * 生成唯一解题目。
 * @returns {{puzzle:number[], solution:number[], level:number, givens:number, holes:number}}
 */
export function generatePuzzle(seed = 1, level = 1) {
  const lv = LEVELS[level] ? level : 1;
  const rng = createRng(seed);
  const solution = generateSolution(rng);
  const puzzle = solution.slice();
  const order = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  const target = LEVELS[lv].holes;
  let holes = 0;

  for (const idx of order) {
    if (holes >= target) break;
    const v = puzzle[idx];
    if (v === 0) continue;
    puzzle[idx] = 0;
    if (countSolutions(puzzle, 2) === 1) holes++;
    else puzzle[idx] = v; // 挖洞会破坏唯一解，回填
  }

  return {
    puzzle: puzzle.slice(),
    solution: solution.slice(),
    level: lv,
    givens: CELLS - holes,
    holes,
  };
}

function grid9() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
}

function toGrid(flat) {
  const out = grid9();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) out[r][c] = flat[r * SIZE + c];
  }
  return out;
}

function cloneGrid(g) {
  return g.map((row) => row.slice());
}

function cloneNotes(n) {
  return n.map((row) => row.map((cell) => cell.slice()));
}

/** 解析 'set:2,3,5' / 'note:2,3,5' / 'erase:2,3'，失败返回 null */
function parseCellAction(action, kind) {
  if (typeof action !== 'string') return null;
  const m = new RegExp(`^${kind}:(\\d+),(\\d+)(?:,(\\d+))?$`).exec(action);
  if (!m) return null;
  const r = Number(m[1]);
  const c = Number(m[2]);
  const n = m[3] === undefined ? null : Number(m[3]);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
  if (n !== null && !Number.isInteger(n)) return null;
  if (n !== null && (n < 0 || n > 9)) return null;
  return { r, c, n };
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const activePlayers = players && players.length ? players.slice() : ['p1'];
  let lv = LEVELS[level] ? level : 1;
  let puzzle;
  let solution;
  let values;
  let notes;
  let mistakes;
  let hintsLeft;
  let solved;
  let history;
  let turn = 'p1';

  function deal() {
    const gen = generatePuzzle(seed, lv);
    puzzle = toGrid(gen.puzzle);
    solution = toGrid(gen.solution);
    values = grid9();
    notes = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => [])
    );
    mistakes = 0;
    hintsLeft = LEVELS[lv].hints;
    solved = false;
    history = [];
    turn = 'p1';
  }

  function checkSolved() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = puzzle[r][c] || values[r][c];
        if (v !== solution[r][c]) return false;
      }
    }
    return true;
  }

  function setCell(r, c, n) {
    if (solved) return { ok: false, error: '本题已完成' };
    if (puzzle[r][c] !== 0) return { ok: false, error: '给定数字不可修改' };
    const old = values[r][c];
    if (old === n) return { ok: true, changed: false };

    history.push({
      values: cloneGrid(values),
      notes: cloneNotes(notes),
      mistakes,
      hintsLeft,
      solved,
    });
    values[r][c] = n;
    notes[r][c] = [];
    if (n !== 0 && n !== solution[r][c]) mistakes++;
    solved = checkSolved();
    return { ok: true, changed: true, r, c, n };
  }

  function noteCell(r, c, n) {
    if (solved) return { ok: false, error: '本题已完成' };
    if (puzzle[r][c] !== 0) return { ok: false, error: '给定格不能写笔记' };
    if (values[r][c] !== 0) return { ok: false, error: '先擦除该格数字再写笔记' };
    if (n < 1 || n > 9) return { ok: false, error: '候选数须为 1～9' };

    history.push({
      values: cloneGrid(values),
      notes: cloneNotes(notes),
      mistakes,
      hintsLeft,
      solved,
    });
    const list = notes[r][c];
    const at = list.indexOf(n);
    if (at >= 0) list.splice(at, 1);
    else {
      list.push(n);
      list.sort((a, b) => a - b);
    }
    return { ok: true, r, c, n, on: at < 0 };
  }

  function hint() {
    if (solved) return { ok: false, error: '本题已完成' };
    if (hintsLeft <= 0) return { ok: false, error: '提示次数已用完' };

    let target = -1;
    // 先纠正填错的空格，再填仍然空着的格；都按行优先，保证同种子可复现
    for (let i = 0; i < CELLS; i++) {
      const r = (i / SIZE) | 0;
      const c = i % SIZE;
      if (puzzle[r][c] !== 0) continue;
      if (values[r][c] !== 0 && values[r][c] !== solution[r][c]) {
        target = i;
        break;
      }
    }
    if (target < 0) {
      for (let i = 0; i < CELLS; i++) {
        const r = (i / SIZE) | 0;
        const c = i % SIZE;
        if (puzzle[r][c] === 0 && values[r][c] === 0) {
          target = i;
          break;
        }
      }
    }
    if (target < 0) return { ok: false, error: '没有需要揭示的格子' };

    const r = (target / SIZE) | 0;
    const c = target % SIZE;
    history.push({
      values: cloneGrid(values),
      notes: cloneNotes(notes),
      mistakes,
      hintsLeft,
      solved,
    });
    values[r][c] = solution[r][c];
    notes[r][c] = [];
    hintsLeft--;
    solved = checkSolved();
    return { ok: true, r, c, n: values[r][c] };
  }

  function undo() {
    if (!history.length) return { ok: false, error: '没有可撤销的步骤' };
    const snap = history.pop();
    values = snap.values;
    notes = snap.notes;
    mistakes = snap.mistakes;
    hintsLeft = snap.hintsLeft;
    solved = snap.solved;
    return { ok: true };
  }

  function setLevel(n) {
    if (!LEVELS[n]) return { ok: false, error: '难度只能是 1/2/3' };
    if (n === lv) return { ok: true, changed: false };
    lv = n;
    deal();
    return { ok: true, changed: true, level: lv };
  }

  function submit(playerId, action) {
    const who = playerId === 'p1' || playerId === 0 || playerId === '0' ? 'p1' : null;
    if (!who) return { ok: false, error: '无效玩家' };

    if (action === 'undo') return undo();
    if (action === 'hint') return hint();

    if (typeof action === 'string' && action.startsWith('level:')) {
      const n = Number(action.slice(6));
      return setLevel(n);
    }

    let parsed = parseCellAction(action, 'set');
    if (parsed) {
      if (parsed.n === null) return { ok: false, error: 'set 缺少数字' };
      return setCell(parsed.r, parsed.c, parsed.n);
    }

    parsed = parseCellAction(action, 'erase');
    if (parsed) return setCell(parsed.r, parsed.c, 0);

    parsed = parseCellAction(action, 'note');
    if (parsed) {
      if (parsed.n === null) return { ok: false, error: 'note 缺少候选数' };
      return noteCell(parsed.r, parsed.c, parsed.n);
    }

    return { ok: false, error: '无法识别的操作' };
  }

  function step() {
    /* 回合制，无需按帧推进 */
  }

  function state() {
    return {
      turn,
      puzzle: cloneGrid(puzzle),
      solution: cloneGrid(solution),
      values: cloneGrid(values),
      notes: cloneNotes(notes),
      level: lv,
      levelName: LEVELS[lv].name,
      mistakes,
      hintsLeft,
      solved,
      mode,
      players: activePlayers.slice(),
      seed,
      canUndo: history.length > 0,
      size: SIZE,
    };
  }

  function result() {
    if (!solved) return null;
    const score = Math.max(100, 1000 - mistakes * 20 - (LEVELS[lv].hints - hintsLeft) * 60);
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `数独完成！失误 ${mistakes} 次，剩余提示 ${hintsLeft}`,
    };
  }

  function reset() {
    deal();
  }

  deal();

  return { submit, step, state, result, reset };
}
