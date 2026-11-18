/**
 * 推箱子 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实（不可再分）：
 * - 关卡是等宽字符串数组：#墙 / 空格地 / .目标 / $箱 / @玩家 / *箱在目标 / +人在目标；
 * - 玩家只能把相邻箱子推向其前方空格；箱子不能拉、不能穿墙、不能叠箱；
 * - 只有「全部箱子都站在目标上」才算过关；
 * - 一次成功移动（含推箱）记一步，推箱另记一次推动；撞墙/推不动不计步也不入撤销栈；
 * - undo/redo 用完整快照栈，保证回到任意历史局面时步数/推动数一致。
 */

/** 固定关卡数组（8 关，每关为字符串数组）。导出供测试与求解器使用。 */
export const LEVELS = [
  // 1 · 单箱直推：站在箱子下方，上推一步到位
  [
    '########',
    '#      #',
    '#  .   #',
    '#  $   #',
    '#  @   #',
    '#      #',
    '########',
  ],
  // 2 · 单箱转向：先下推两格，再绕到左侧右推入位
  [
    '########',
    '#      #',
    '#  $   #',
    '#   #  #',
    '#   .  #',
    '#  @   #',
    '########',
  ],
  // 3 · 双箱直上：两个箱子各向上推一格
  [
    '########',
    '#      #',
    '# .  . #',
    '# $  $ #',
    '#  @   #',
    '#      #',
    '########',
  ],
  // 4 · 双箱推下：需绕到箱子上方，把它们向下推入目标
  [
    '########',
    '#      #',
    '#  $$  #',
    '#  ..  #',
    '#  @   #',
    '#      #',
    '########',
  ],
  // 5 · 三箱分推：两个向上、一个先下后左
  [
    '########',
    '#      #',
    '# .  . #',
    '# $  $ #',
    '#  @$  #',
    '#  .   #',
    '########',
  ],
  // 6 · 双箱绕行：先右推再上推，另一箱下推后左推
  [
    '########',
    '#   #  #',
    '# $ .  #',
    '#  $   #',
    '# . @  #',
    '#      #',
    '########',
  ],
  // 7 · 双箱隔墙：两箱各自在目标正上方，绕行到上方下推
  [
    '########',
    '#  #   #',
    '#  $ $ #',
    '#  . . #',
    '#  @   #',
    '#      #',
    '########',
  ],
  // 8 · 双箱归角：先横推再纵推，把两箱分别送入上排目标
  [
    '########',
    '# .  . #',
    '#  $$  #',
    '#      #',
    '#  @   #',
    '#      #',
    '########',
  ],
];

const DIRS = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

const isWall = (c) => c === undefined || c === '#';
const isBox = (c) => c === '$' || c === '*';
const isGoal = (c) => c === '.' || c === '*' || c === '+';

function setAt(row, x, c) {
  return row.slice(0, x) + c + row.slice(x + 1);
}

function findPlayer(grid) {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const c = grid[y][x];
      if (c === '@' || c === '+') return { x, y };
    }
  }
  return { x: -1, y: -1 };
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  // seed/mode/players 在本作中不影响规则，保留签名以符合平台契约。
  void seed;
  void mode;
  void players;

  let levelIndex = 0;
  let grid = [];
  let player = { x: -1, y: -1 };
  let steps = 0;
  let pushes = 0;
  let solved = false;
  let undoStack = [];
  let redoStack = [];
  let goalsTotal = 0;
  let boxesTotal = 0;

  function cell(x, y) {
    if (y < 0 || y >= grid.length) return '#';
    const row = grid[y];
    if (x < 0 || x >= row.length) return '#';
    return row[x];
  }

  function computeSolved() {
    let looseBox = false;
    let emptyGoal = false;
    for (const row of grid) {
      for (const c of row) {
        if (c === '$') looseBox = true;
        if (c === '.') emptyGoal = true;
      }
    }
    return goalsTotal > 0 && !looseBox && !emptyGoal;
  }

  function snapshot() {
    return {
      grid: grid.slice(),
      player: { ...player },
      steps,
      pushes,
      solved,
    };
  }

  function restore(s) {
    grid = s.grid.slice();
    player = { ...s.player };
    steps = s.steps;
    pushes = s.pushes;
    solved = s.solved;
  }

  function loadLevel(n) {
    levelIndex = n - 1;
    const raw = LEVELS[levelIndex];
    grid = raw.slice();
    player = findPlayer(grid);
    goalsTotal = 0;
    boxesTotal = 0;
    for (const row of grid) {
      for (const c of row) {
        if (isGoal(c)) goalsTotal += 1;
        if (isBox(c)) boxesTotal += 1;
      }
    }
    steps = 0;
    pushes = 0;
    undoStack = [];
    redoStack = [];
    solved = computeSolved();
  }

  function move(action) {
    const d = DIRS[action];
    if (!d) return { ok: false, error: '无效动作' };
    if (solved) return { ok: false, error: '本关已完成' };

    const [dx, dy] = d;
    const nx = player.x + dx;
    const ny = player.y + dy;
    const target = cell(nx, ny);
    if (isWall(target)) return { ok: false, error: '前方是墙' };

    let pushing = false;
    let bx = -1;
    let by = -1;
    let boxCell = ' ';
    if (isBox(target)) {
      bx = nx + dx;
      by = ny + dy;
      boxCell = cell(bx, by);
      if (isWall(boxCell) || isBox(boxCell)) return { ok: false, error: '箱子推不动' };
      pushing = true;
    }

    undoStack.push(snapshot());
    redoStack = [];

    if (pushing) {
      // 箱子离开原格：原格是目标(*)则还原为 '.'，否则还原为空格
      grid[ny] = setAt(grid[ny], nx, isGoal(target) ? '.' : ' ');
      // 箱子进入新格：新格是目标('.')则变为 '*'，否则变为 '$'
      grid[by] = setAt(grid[by], bx, isGoal(boxCell) ? '*' : '$');
    }

    // 玩家离开原格
    const fromCell = cell(player.x, player.y);
    grid[player.y] = setAt(grid[player.y], player.x, isGoal(fromCell) ? '.' : ' ');
    // 玩家进入新格（推箱时新格即箱子原格）
    grid[ny] = setAt(grid[ny], nx, isGoal(target) ? '+' : '@');
    player = { x: nx, y: ny };

    steps += 1;
    if (pushing) pushes += 1;
    solved = computeSolved();
    return { ok: true };
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的步骤' };
    redoStack.push(snapshot());
    restore(undoStack.pop());
    return { ok: true };
  }

  function redo() {
    if (!redoStack.length) return { ok: false, error: '没有可重做的步骤' };
    undoStack.push(snapshot());
    restore(redoStack.pop());
    return { ok: true };
  }

  function submit(playerId, action) {
    void playerId;
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (action === 'undo') return undo();
    if (action === 'redo') return redo();
    if (action.startsWith('level:')) {
      const n = Number(action.slice(6));
      if (!Number.isInteger(n) || n < 1 || n > LEVELS.length) {
        return { ok: false, error: '关卡不存在' };
      }
      loadLevel(n);
      return { ok: true };
    }
    return move(action);
  }

  function step() {
    // 回合制：由 submit 直接驱动，固定步长此处无需推进。
  }

  function state() {
    let boxesOnGoal = 0;
    for (const row of grid) {
      for (const c of row) if (c === '*') boxesOnGoal += 1;
    }
    return {
      turn: 'p1',
      level: levelIndex + 1,
      levelCount: LEVELS.length,
      grid: grid.slice(),
      player: { ...player },
      steps,
      pushes,
      solved,
      cols: grid[0].length,
      rows: grid.length,
      boxesTotal,
      goalsTotal,
      boxesOnGoal,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      hud: `第${levelIndex + 1}关 · 步 ${steps} · 推 ${pushes}`,
    };
  }

  function result() {
    // 过关只体现在 state().solved：若返回结算对象，shell 会弹出遮罩挡住「下一关」按钮。
    return null;
  }

  function reset() {
    loadLevel(1);
  }

  loadLevel(Math.min(Math.max(1, Number(level) || 1), LEVELS.length));

  return { submit, step, state, result, reset };
}
