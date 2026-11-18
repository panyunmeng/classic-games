/**
 * 数织（Nonogram / Picross）· 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 图案只有一个事实来源：solution（0/1 扁平数组，行优先，下标 i = r*size + c）。
 *   行/列线索不是状态，而是 solution 的确定性投影：lineClues() 只按「连续填充段」
 *   切分，空行/空列返回 [0]（规则书里 0 表示该线无填充）。
 * - 玩家盘面 cells 是三态：0 未定 / 1 填充 / 2 标 X（排除）。点按只改 1↔0，
 *   标记只改 2↔0；三态互不重叠，因此「填充模式与原图一致」＝ 对每个 i 都有
 *   (solution[i] === 1) === (cells[i] === 1)，X 只是演算草稿，不参与判定。
 * - 错误不惩罚：不判负、不扣步数，只把「当前与解矛盾的格子」暴露出来给渲染层做
 *   高亮。mistakes 就是这些格子的个数（派生量，不是历史累计），所以撤销/提示会
 *   自动把数字改回去，不需要额外的错误账本。
 * - 提示揭示一格：优先补一个「解里是该填、玩家还没填」的格；若解的格都填完了
 *   却还有错填，则改为清掉第一个错填格。提示吃库存（hintsLeft），可撤销。
 * - 撤销快照同时存 cells 与 hintsLeft，因此撤销提示会连库存一起回退；快照不存
 *   solution（图案在一局内不变）与焦点。
 * - 随机全部来自 createRng(seed)：同种子同尺寸必然得到同一图案，联机/回放可复现。
 * - 图案生成用拒绝采样排除退化行/列（整行全空或全满），否则该行线索退化为 0 或 n，
 *   等于白送答案；总量再限制在 25%～75%，避免近乎空白或近乎全满的图。
 *   已知限制：不做唯一解校验（随机图案可能需猜），这是本作与「逻辑推演关卡」的差别，
 *   通过提示与矛盾高亮来兜住。
 */
import { createRng } from '../../shared/rng.js';

export const DEFAULT_SIZE = 10;
export const HINTS_DEFAULT = 3;
export const SIZE_MIN = 5;
export const SIZE_MAX = 12;

/** 每行填充分布概率：0.48 接近一半，线索段数适中，肉眼更像图 */
const FILL_P = 0.48;
/** 拒绝采样上限：单次命中概率约 25%（5×5）～90%（10×10），200 次足够 */
const MAX_ATTEMPTS = 200;
/** 撤销栈上限，防止长时间对局无限吃内存 */
const UNDO_LIMIT = 200;

const SIZE_BY_LEVEL = { 1: 5, 2: 10, 3: 12 };

/** 尺寸归一：整数并夹到 [SIZE_MIN, SIZE_MAX] */
export function clampSize(size) {
  const n = Math.floor(Number(size));
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, n));
}

/**
 * 一条线的线索：连续 1 的段长序列；全空返回 [0]，全满返回 [n]。
 * @param {number[]} line 0/1 数组
 * @returns {number[]}
 */
export function lineClues(line) {
  const out = [];
  let run = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i]) {
      run++;
    } else if (run > 0) {
      out.push(run);
      run = 0;
    }
  }
  if (run > 0) out.push(run);
  return out.length ? out : [0];
}

/** 退化图案判定：任一行/列全空或全满、总量过少/过多都拒绝 */
function isWellFormed(grid, n) {
  let filled = 0;
  for (let i = 0; i < grid.length; i++) filled += grid[i];
  if (filled < Math.ceil(n * n * 0.25) || filled > Math.floor(n * n * 0.75)) return false;
  for (let r = 0; r < n; r++) {
    let c = 0;
    for (let x = 0; x < n; x++) c += grid[r * n + x];
    if (c === 0 || c === n) return false;
  }
  for (let c = 0; c < n; c++) {
    let r = 0;
    for (let y = 0; y < n; y++) r += grid[y * n + c];
    if (r === 0 || r === n) return false;
  }
  return true;
}

/** 兜底图案：棋盘格。对 n ≥ 2 每条线都交替，必然非退化。 */
function fallbackPattern(n) {
  const grid = new Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) grid[r * n + c] = (r + c) % 2 === 0 ? 1 : 0;
  }
  return grid;
}

/**
 * 生成一局谜题：随机图案 → 行/列线索。
 * @param {number} seed 种子（同种子同尺寸 → 同图案）
 * @param {number} size 边长，默认 10，夹到 5～12
 * @returns {{size:number, seed:number, solution:number[], rowClues:number[][], colClues:number[][]}}
 */
export function generatePuzzle(seed = 1, size = DEFAULT_SIZE) {
  const n = clampSize(size);
  const rng = createRng(seed);
  let solution = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && !solution; attempt++) {
    const grid = new Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next() < FILL_P ? 1 : 0;
    if (isWellFormed(grid, n)) solution = grid;
  }
  if (!solution) solution = fallbackPattern(n);

  const rowClues = new Array(n);
  for (let r = 0; r < n; r++) rowClues[r] = lineClues(solution.slice(r * n, r * n + n));

  const colClues = new Array(n);
  for (let c = 0; c < n; c++) {
    const line = new Array(n);
    for (let r = 0; r < n; r++) line[r] = solution[r * n + c];
    colClues[c] = lineClues(line);
  }

  return { size: n, seed, solution, rowClues, colClues };
}

export function createGame({ seed = 1, mode = 'solo', level = 2, size } = {}) {
  const n = size != null ? clampSize(size) : clampSize(SIZE_BY_LEVEL[level] ?? DEFAULT_SIZE);
  const puzzle = generatePuzzle(seed, n);
  const solution = puzzle.solution.slice();
  const rowClues = puzzle.rowClues.map((a) => a.slice());
  const colClues = puzzle.colClues.map((a) => a.slice());
  const total = solution.reduce((a, v) => a + v, 0);

  let cells;
  let hintsLeft;
  let undoStack;
  let focus; // 最近一次操作的格 {r,c}，渲染层拿它画选中环
  let solved;

  function inBounds(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < n && c >= 0 && c < n;
  }

  function conflictIndices(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (solution[i] === 1 ? list[i] === 2 : list[i] === 1) out.push(i);
    }
    return out;
  }

  function computeSolved() {
    for (let i = 0; i < cells.length; i++) {
      if ((solution[i] === 1) !== (cells[i] === 1)) return false;
    }
    return true;
  }

  function refresh() {
    solved = computeSolved();
  }

  function pushUndo() {
    undoStack.push({ cells: cells.slice(), hintsLeft, focus: focus ? { ...focus } : null });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function parseAction(action) {
    if (typeof action !== 'string') return null;
    if (action === 'hint') return { kind: 'hint' };
    if (action === 'undo') return { kind: 'undo' };
    if (action === 'reset') return { kind: 'reset' };
    const m = /^(toggle|mark|fill|flag):(\d+),(\d+)$/.exec(action);
    if (!m) return null;
    const kind = m[1] === 'mark' || m[1] === 'flag' ? 'mark' : 'toggle';
    return { kind, r: Number(m[2]), c: Number(m[3]) };
  }

  /** 点按：空→填、填→空；X 被点按视为「改主意填上」→ 填 */
  function doToggle(r, c) {
    const i = r * n + c;
    pushUndo();
    cells[i] = cells[i] === 1 ? 0 : 1;
    focus = { r, c };
    refresh();
    return { ok: true, cell: cells[i] };
  }

  /** 标记：X→空、其它→X；填错的格可直接改成 X，撤销可回去 */
  function doMark(r, c) {
    const i = r * n + c;
    pushUndo();
    cells[i] = cells[i] === 2 ? 0 : 2;
    focus = { r, c };
    refresh();
    return { ok: true, cell: cells[i] };
  }

  /** 提示目标：先补解里该填未填的格，全填完则清第一个错填格 */
  function findHintTarget() {
    for (let i = 0; i < cells.length; i++) {
      if (solution[i] === 1 && cells[i] !== 1) return { i, value: 1 };
    }
    for (let i = 0; i < cells.length; i++) {
      if (solution[i] === 0 && cells[i] === 1) return { i, value: 0 };
    }
    return null;
  }

  function doHint() {
    if (hintsLeft <= 0) return { ok: false, error: '提示已用完' };
    const target = findHintTarget();
    if (!target) return { ok: false, error: '没有可提示的格子' };
    pushUndo();
    cells[target.i] = target.value;
    hintsLeft--;
    focus = { r: Math.floor(target.i / n), c: target.i % n };
    refresh();
    return {
      ok: true,
      hint: { r: focus.r, c: focus.c, value: target.value },
      hintsLeft,
    };
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的操作' };
    const s = undoStack.pop();
    cells = s.cells.slice();
    hintsLeft = s.hintsLeft;
    focus = s.focus ? { ...s.focus } : null;
    refresh();
    return { ok: true };
  }

  function doReset() {
    cells = new Array(n * n).fill(0);
    hintsLeft = HINTS_DEFAULT;
    undoStack = [];
    focus = null;
    refresh();
    return { ok: true };
  }

  function submit(playerId, action) {
    // shell 传的是玩家序号 0（falsy），联机鉴权才传 'p1'/'p2'；两种都要放行 p1
    if (playerId && playerId !== 'p1') return { ok: false, error: '不是你的回合' };
    const a = parseAction(action);
    if (!a) return { ok: false, error: '无效操作' };

    if (a.kind === 'reset') return doReset();
    if (a.kind === 'undo') return undo();
    if (solved) return { ok: false, error: '本局已完成' };
    if (a.kind === 'hint') return doHint();
    if (!inBounds(a.r, a.c)) return { ok: false, error: '坐标越界' };
    return a.kind === 'mark' ? doMark(a.r, a.c) : doToggle(a.r, a.c);
  }

  function step() {
    /* 回合制：由 submit 直接驱动，无按帧推进 */
  }

  function state() {
    const conflicts = conflictIndices(cells);
    let filled = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] === 1) filled++;
    return {
      size: n,
      seed,
      mode,
      turn: 'p1',
      solution: solution.slice(),
      cells: cells.slice(),
      rowClues: rowClues.map((a) => a.slice()),
      colClues: colClues.map((a) => a.slice()),
      mistakes: conflicts.length,
      conflicts,
      solved,
      hintsLeft,
      hintsTotal: HINTS_DEFAULT,
      focus: focus ? { ...focus } : null,
      progress: { filled, total },
      canUndo: undoStack.length > 0,
      undoDepth: undoStack.length,
      hud: `已填 ${filled}/${total}`,
      level: n <= 5 ? '初级' : n <= 10 ? '中级' : '高级',
    };
  }

  function result() {
    if (!solved) return null;
    const hintsUsed = HINTS_DEFAULT - hintsLeft;
    const mistakes = conflictIndices(cells).length;
    const score = Math.max(0, n * n * 10 - mistakes * 15 - hintsUsed * 40);
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `图案还原 · ${n}×${n} · 矛盾 ${mistakes} · 提示 ${hintsUsed}`,
    };
  }

  function reset() {
    doReset();
  }

  doReset();

  return { submit, step, state, result, reset, undo, hints: doHint };
}
