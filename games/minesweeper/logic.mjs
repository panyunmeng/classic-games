/**
 * 扫雷 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 雷区在「首次翻开」时才生成：候选格排除首击格及其八邻域，故首击必安全，
 *   且首击周围八格在候选够用时也为零（经典首击安全）。
 * - 翻开零格用迭代洪泛展开连通非雷格，避免递归爆栈（高级 16×30=480 格）。
 * - 和弦展开只在「数字格已翻开 && 邻旗数 == 数字」时生效，且只翻未插旗的邻格；
 *   若旗插错，会翻到雷并判负，这是标准扫雷规则。
 * - 胜利条件：所有非雷格都被翻开（不要求旗数正确）。踩雷立即判负并揭示全雷。
 * - 撤销快照覆盖可逆字段与 RNG 状态（rng.seed() 即当前 mulberry32 内部态），
 *   因此撤销回首击前再点同一格，会得到同一张雷图；reset() 也用初始 seed 重建 RNG。
 * - 所有随机来自注入的 createRng(seed)，联机两端同种子同结果；state() 每次返回新对象，
 *   隐藏字段用 null 占位而非 undefined，保证 JSON 往返后结构不变。
 */
import { createRng } from '../../shared/rng.js';

export const LEVELS = {
  beginner: { cols: 9, rows: 9, mines: 10, label: '初级' },
  intermediate: { cols: 16, rows: 16, mines: 40, label: '中级' },
  expert: { cols: 30, rows: 16, mines: 99, label: '高级' },
};

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** 把难度标识 / 自定义尺寸归一成合法配置 */
function resolveLevel(level) {
  if (typeof level === 'string' && LEVELS[level]) return { ...LEVELS[level] };
  if (typeof level === 'number' && level >= 1 && level <= 3) {
    return { ...LEVELS[['beginner', 'intermediate', 'expert'][level - 1]] };
  }
  if (level && typeof level === 'object') {
    const cols = Math.floor(Number(level.cols));
    const rows = Math.floor(Number(level.rows));
    const mines = Math.floor(Number(level.mines));
    if (cols >= 2 && rows >= 2 && mines >= 1 && mines < cols * rows - 8) {
      return { cols, rows, mines, label: level.label || '自定义' };
    }
  }
  return { ...LEVELS.intermediate };
}

export function createGame({ seed = 1, mode = 'solo', level = 'intermediate' } = {}) {
  let rng = createRng(seed);
  const cfg = resolveLevel(level);
  const { cols, rows, mines } = cfg;
  const total = cols * rows;

  let cells;        // [{ mine, adjacent, revealed, flagged }]
  let placed;       // 是否已布雷
  let over;         // 本局是否结束（胜或负）
  let won;          // 是否胜利
  let opened;       // 已翻开格数
  let flags;        // 当前旗数
  let firstAt;      // 首击坐标 {x,y}
  let cursor;       // 键盘光标坐标 {x,y}，属于视图状态但放这里便于渲染与输入共享
  let undoStack;    // 操作快照栈

  function makeCell() {
    return { mine: false, adjacent: 0, revealed: false, flagged: false };
  }

  function idx(x, y) {
    return y * cols + x;
  }

  function at(x, y) {
    return cells[idx(x, y)];
  }

  function inBounds(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cols && y < rows;
  }

  function neighbors(x, y) {
    const out = [];
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny)) out.push([nx, ny]);
    }
    return out;
  }

  function snapshot() {
    return {
      revealed: cells.map((c) => c.revealed),
      flagged: cells.map((c) => c.flagged),
      mine: cells.map((c) => c.mine),
      adjacent: cells.map((c) => c.adjacent),
      rngState: rng.seed(),
      placed,
      over,
      won,
      opened,
      flags,
      firstAt: firstAt ? { ...firstAt } : null,
    };
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 64) undoStack.shift();
  }

  /** 首击布雷：候选池排除首击格及其八邻域；候选不足时退化为仅排除首击格。 */
  function placeMines(x, y) {
    const safe = new Set(neighbors(x, y).map(([nx, ny]) => idx(nx, ny)));
    safe.add(idx(x, y));
    let pool = [];
    for (let i = 0; i < total; i++) if (!safe.has(i)) pool.push(i);
    if (pool.length < mines) {
      pool = [];
      for (let i = 0; i < total; i++) if (i !== idx(x, y)) pool.push(i);
    }
    const chosen = rng.shuffle(pool).slice(0, mines);
    for (const i of chosen) cells[i].mine = true;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (cells[idx(cx, cy)].mine) continue;
        let n = 0;
        for (const [nx, ny] of neighbors(cx, cy)) if (cells[idx(nx, ny)].mine) n++;
        cells[idx(cx, cy)].adjacent = n;
      }
    }
    placed = true;
    firstAt = { x, y };
  }

  /** 翻开单格；返回是否踩雷。 */
  function revealOne(x, y) {
    const c = at(x, y);
    if (c.revealed || c.flagged || c.mine) return c.mine;
    c.revealed = true;
    opened++;
    return false;
  }

  /** 零格迭代洪泛：翻开后若 adjacent===0，把未翻开的非雷邻格加入队列。 */
  function flood(x, y) {
    const queue = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      if (at(cx, cy).adjacent !== 0) continue;
      for (const [nx, ny] of neighbors(cx, cy)) {
        const n = at(nx, ny);
        if (n.revealed || n.flagged || n.mine) continue;
        n.revealed = true;
        opened++;
        if (n.adjacent === 0) queue.push([nx, ny]);
      }
    }
  }

  function reveal(x, y) {
    const c = at(x, y);
    if (over || c.revealed || c.flagged) return { ok: false, error: '该格不能翻开' };

    pushUndo();
    if (!placed) placeMines(x, y);

    if (c.mine) {
      c.revealed = true;
      opened++;
      over = true;
      won = false;
      return { ok: true, boom: true };
    }

    revealOne(x, y);
    flood(x, y);
    checkWin();
    return { ok: true, boom: false };
  }

  function toggleFlag(x, y) {
    const c = at(x, y);
    if (over || c.revealed) return { ok: false, error: '该格不能插旗' };
    pushUndo();
    c.flagged = !c.flagged;
    flags += c.flagged ? 1 : -1;
    return { ok: true, flagged: c.flagged };
  }

  /** 和弦：双击/双数字数字格，邻旗数达到数字时展开其余未旗邻格。 */
  function chord(x, y) {
    const c = at(x, y);
    if (over || !c.revealed || c.adjacent === 0) return { ok: false, error: '这里不能和弦展开' };
    const ns = neighbors(x, y);
    const flaggedCount = ns.filter(([nx, ny]) => at(nx, ny).flagged).length;
    if (flaggedCount !== c.adjacent) return { ok: false, error: '旗数未达到数字' };

    const targets = ns.filter(([nx, ny]) => {
      const n = at(nx, ny);
      return !n.revealed && !n.flagged;
    });
    if (!targets.length) return { ok: true, opened: 0 };

    pushUndo();
    if (!placed) placeMines(x, y); // 防御：和弦不可能先于翻开，理论上不会走到
    let boom = false;
    for (const [nx, ny] of targets) {
      if (revealOne(nx, ny)) {
        boom = true;
        over = true;
        won = false;
        break;
      }
      flood(nx, ny);
    }
    if (!boom) checkWin();
    return { ok: true, boom, opened: targets.length };
  }

  function checkWin() {
    if (opened === total - mines) {
      over = true;
      won = true;
      // 自动把剩余雷插旗，旗数直观显示（不改变胜负判定）
      for (const c of cells) if (c.mine && !c.flagged) { c.flagged = true; flags++; }
    }
  }

  /** 撤销：出栈恢复快照；已败/已胜也可撤销回上一步。 */
  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的操作' };
    const s = undoStack.pop();
    cells.forEach((c, i) => {
      c.revealed = s.revealed[i];
      c.flagged = s.flagged[i];
      c.mine = s.mine[i];
      c.adjacent = s.adjacent[i];
    });
    rng = createRng(s.rngState);
    placed = s.placed;
    over = s.over;
    won = s.won;
    opened = s.opened;
    flags = s.flags;
    firstAt = s.firstAt ? { ...s.firstAt } : null;
    return { ok: true };
  }

  function parseAction(action) {
    if (typeof action !== 'string') return null;
    if (action === 'undo') return { kind: 'undo' };
    // 键盘光标移动：cursor:dx,dy（相对位移），超界由 clamp 处理
    const cm = /^cursor:(-?\d+),(-?\d+)$/.exec(action);
    if (cm) return { kind: 'cursor', dx: Number(cm[1]), dy: Number(cm[2]) };
    // 动作格式：'<kind>:x,y'，kind ∈ reveal | flag | chord | open | tap
    const m = /^(reveal|flag|chord|open|tap):(\d+),(\d+)$/.exec(action);
    if (!m) return null;
    return { kind: m[1] === 'flag' ? 'flag' : m[1] === 'chord' ? 'chord' : 'reveal', x: Number(m[2]), y: Number(m[3]) };
  }

  function submit(playerId, action) {
    if (playerId && playerId !== 'p1') return { ok: false, error: '不是你的回合' };
    const a = parseAction(action);
    if (!a) return { ok: false, error: '无效操作' };
    if (a.kind === 'cursor') {
      cursor = {
        x: Math.max(0, Math.min(cols - 1, cursor.x + a.dx)),
        y: Math.max(0, Math.min(rows - 1, cursor.y + a.dy)),
      };
      return { ok: true };
    }
    if (a.kind === 'undo') return undo();
    if (!inBounds(a.x, a.y)) return { ok: false, error: '坐标越界' };
    if (a.kind === 'flag') return toggleFlag(a.x, a.y);
    if (a.kind === 'chord') return chord(a.x, a.y);
    return reveal(a.x, a.y);
  }

  function step() {
    /* 回合制：由 submit 直接驱动，无按帧推进 */
  }

  function state() {
    return {
      cols,
      rows,
      mines,
      level: cfg.label,
      cells: cells.map((c) => ({
        // 雷位置只在结局后公开；隐藏字段用 null 占位，保证 JSON 可往返
        mine: over ? c.mine : null,
        adjacent: c.revealed || over ? c.adjacent : null,
        revealed: c.revealed,
        flagged: c.flagged,
      })),
      placed,
      over,
      won,
      opened,
      flags,
      firstAt: firstAt ? { ...firstAt } : null,
      cursor: { ...cursor },
      canUndo: undoStack.length > 0,
      undoDepth: undoStack.length,
      turn: 'p1',
      mode,
      seed,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: won ? 'p1' : 'p2',
      score: won ? 1 : 0,
      scores: { p1: won ? 1 : 0 },
      text: won ? `排雷成功 · ${mines} 颗雷全部标出` : '踩到地雷 · 本局结束',
    };
  }

  function reset() {
    rng = createRng(seed);
    cells = Array.from({ length: total }, makeCell);
    placed = false;
    over = false;
    won = false;
    opened = 0;
    flags = 0;
    firstAt = null;
    cursor = { x: 0, y: 0 };
    undoStack = [];
  }

  reset();

  return { submit, step, state, result, reset, reveal, toggleFlag, chord, undo };
}
