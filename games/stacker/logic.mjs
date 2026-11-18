/**
 * 方块坠落 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 网格 10×20，坐标 y 向下为正；方块由 4×4（I/O）或 3×3 矩阵内的 4 格表示。
 * - 7-bag：每批 7 种方块各出一次、洗牌后逐发，保证可复现且不会长期缺某种。
 * - SRS 四态 + 踢墙：矩阵随 rot 变化，旋转失败时依次尝试表内偏移。
 * - Hold：每落定一块后才重置一次机会，同一块内重复按无效。
 * - 幽灵落点：不改活动块，仅计算硬降后的 y 供渲染。
 * - 锁定延迟：触底累计 500ms 才锁定；期间位移/旋转最多重置 15 次。
 * - 重力间隔按等级递减（下限 50ms），软降间隔固定 40ms。
 * - 计分：单/双/三/四行 = 100/300/500/800 × 等级；软降每格 +1、硬降每格 +2。
 * - 顶出失败：新块在生成位置即与已有格重叠则 game over。
 */
import { createRng } from '../../shared/rng.js';

export const COLS = 10;
export const ROWS = 20;
export const LOCK_DELAY = 0.5;
export const MAX_LOCK_RESETS = 15;
const SOFT_INTERVAL = 0.04;

// 每种方块的四个旋转态，单元格是各自矩阵内的 [x, y]（y 向下）。
const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [2, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

const TYPES = Object.keys(SHAPES);

// SRS 踢墙表：来自 Tetris Wiki 标准表，y 轴已按本实现「向下为正」取反。
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const SCORE_TABLE = [0, 100, 300, 500, 800];

function matrixSize(type) {
  return type === 'T' || type === 'S' || type === 'Z' || type === 'J' || type === 'L' ? 3 : 4;
}

function gravityInterval(level) {
  return Math.max(0.05, Math.pow(0.8, Math.max(0, level - 1)) * 0.8);
}

export function createGame({ seed = 1, mode = 'solo', level = 1 } = {}) {
  const rng = createRng(seed);
  let board;
  let bag;
  let queue;
  let active;
  let ghostY;
  let holdType;
  let holdUsed;
  let lockTimer;
  let lockResets;
  let dropAcc;
  let softAcc;
  let justLanded; // 本帧重力把块推进到底，锁定延迟从下一帧才开始计
  let score;
  let lines;
  let startLevel;
  let currentLevel;
  let lastClear;
  let pieces;
  let over;

  function refillBag() {
    bag.push(...rng.shuffle(TYPES.slice()));
  }

  function nextType() {
    if (bag.length === 0) refillBag();
    return bag.shift();
  }

  function spawnPosition(type) {
    const size = matrixSize(type);
    return { x: Math.floor((COLS - size) / 2), y: 0 };
  }

  function cellsOf(piece) {
    return SHAPES[piece.type][piece.rot].map(([cx, cy]) => ({
      x: piece.x + cx,
      y: piece.y + cy,
    }));
  }

  function valid(piece) {
    for (const c of cellsOf(piece)) {
      if (c.x < 0 || c.x >= COLS || c.y >= ROWS) return false;
      if (c.y >= 0 && board[c.y][c.x]) return false;
    }
    return true;
  }

  function updateGhost() {
    if (!active) {
      ghostY = 0;
      return;
    }
    let gy = active.y;
    while (valid({ ...active, y: gy + 1 })) gy += 1;
    ghostY = gy;
  }

  function spawn(type) {
    const pos = spawnPosition(type);
    active = { type, rot: 0, x: pos.x, y: pos.y };
    lockTimer = 0;
    lockResets = 0;
    dropAcc = 0;
    softAcc = 0;
    justLanded = false;
    updateGhost();
    if (!valid(active)) over = true;
  }

  function takeNext() {
    const type = queue.shift();
    queue.push(nextType());
    spawn(type);
  }

  function resetLock() {
    if (lockTimer > 0 && lockResets < MAX_LOCK_RESETS) {
      lockTimer = 0;
      lockResets += 1;
    }
  }

  const ACTIONS = new Set([
    'left', 'right', 'soft', 'hard', 'rotCW', 'rotCCW', 'rot180', 'hold', 'nop',
  ]);

  function normalizeAction(action) {
    switch (action) {
      case 'rotate':
      case 'rotateCW':
      case 'cw':
      case 'up':
      case 'action2':
      case 'x':
        return 'rotCW';
      case 'rotateCCW':
      case 'ccw':
      case 'z':
        return 'rotCCW';
      case 'down':
        return 'soft';
      case 'action':
      case 'space':
        return 'hard';
      default:
        return action;
    }
  }

  function lockPiece() {
    if (!active || over) return;
    for (const c of cellsOf(active)) {
      if (c.y >= 0 && c.y < ROWS && c.x >= 0 && c.x < COLS) {
        board[c.y][c.x] = active.type;
      }
    }

    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every(Boolean)) {
        board.splice(y, 1);
        board.unshift(new Array(COLS).fill(null));
        cleared += 1;
        y += 1;
      }
    }

    if (cleared > 0) {
      score += SCORE_TABLE[cleared] * currentLevel;
      lines += cleared;
      lastClear = cleared;
      currentLevel = startLevel + Math.floor(lines / 10);
    } else {
      lastClear = 0;
    }

    pieces += 1;
    holdUsed = false;
    active = null;
    takeNext();
  }

  function mutate(action) {
    if (over || !active) return false;
    let changed = false;

    switch (action) {
      case 'left': {
        const probe = { ...active, x: active.x - 1 };
        if (valid(probe)) {
          active = probe;
          changed = true;
        }
        break;
      }
      case 'right': {
        const probe = { ...active, x: active.x + 1 };
        if (valid(probe)) {
          active = probe;
          changed = true;
        }
        break;
      }
      case 'rotCW':
      case 'rotCCW':
      case 'rot180': {
        const steps = action === 'rot180' ? 2 : action === 'rotCCW' ? 3 : 1;
        const from = active.rot;
        const to = (from + steps) % 4;
        const table = active.type === 'I' ? KICKS_I : active.type === 'O' ? null : KICKS_JLSTZ;
        if (table) {
          for (const [dx, dy] of table[`${from}>${to}`] || [[0, 0]]) {
            const probe = { ...active, rot: to, x: active.x + dx, y: active.y + dy };
            if (valid(probe)) {
              active = probe;
              changed = true;
              break;
            }
          }
        } else if (valid({ ...active, rot: to })) {
          active = { ...active, rot: to };
          changed = true;
        }
        break;
      }
      case 'soft': {
        const probe = { ...active, y: active.y + 1 };
        if (valid(probe)) {
          active = probe;
          score += 1;
          changed = true;
        }
        break;
      }
      case 'hard': {
        while (valid({ ...active, y: active.y + 1 })) {
          active = { ...active, y: active.y + 1 };
          score += 2;
          changed = true;
        }
        // 即使一格都落不下（卡在顶部）也要锁定：否则该块永远悬空，游戏既不推进也不结束。
        lockPiece();
        break;
      }
      case 'hold': {
        if (holdUsed) break;
        const outgoing = active.type;
        if (holdType == null) {
          holdType = outgoing;
          takeNext();
        } else {
          const incoming = holdType;
          holdType = outgoing;
          spawn(incoming);
        }
        holdUsed = true;
        changed = true;
        break;
      }
      default:
        break;
    }

    if (changed && action !== 'hard' && action !== 'hold') {
      resetLock();
      updateGhost();
      // 玩家移动/旋转后若重新触底，给一次新的锁定延迟窗口。
      if (active && !valid({ ...active, y: active.y + 1 })) justLanded = true;
    }
    return changed;
  }

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  }

  /** 调试/单测专用：直接写棋盘单格，绕过正常玩法以构造消行场景。 */
  function debugSetCell(x, y, type) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    board[y][x] = type;
    return true;
  }

  function reset() {
    board = emptyBoard();
    bag = [];
    queue = [nextType(), nextType(), nextType()];
    active = null;
    ghostY = 0;
    holdType = null;
    holdUsed = false;
    lockTimer = 0;
    lockResets = 0;
    dropAcc = 0;
    softAcc = 0;
    justLanded = false;
    score = 0;
    lines = 0;
    startLevel = Math.max(1, Math.floor(level) || 1);
    currentLevel = startLevel;
    lastClear = 0;
    pieces = 0;
    over = false;
    takeNext();
  }

  function submit(playerId, action) {
    // shell 以数组下标 0 表示 p1；服务端/测试用字符串 p1。两者都归一。
    const who = playerId === 0 || playerId === 1 || playerId === 'p1' ? 'p1' : null;
    if (who !== 'p1') return { ok: false, error: '非本玩家回合' };
    if (over) return { ok: false, error: '本局已结束' };
    const act = normalizeAction(action);
    if (!ACTIONS.has(act)) return { ok: false, error: `无效动作：${action}` };
    if (act === 'nop') return { ok: true };
    mutate(act);
    return { ok: true };
  }

  function step(dt, actions = []) {
    if (over || !active) return;
    const delta = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    const soft = Array.isArray(actions) && actions.includes('soft');
    const gravityStep = soft ? SOFT_INTERVAL : gravityInterval(currentLevel);

    dropAcc += delta;
    let guard = 0;
    let landedThisFrame = false;

    // 重力推进走细步：每跨过一个 gravityStep 就下移一格，用 FALLING 距离判断触底。
    while (dropAcc >= gravityStep && guard < 12) {
      if (!valid({ ...active, y: active.y + 1 })) {
        dropAcc = 0; // 触底后剩余加速度作废，避免"攒着"到下次移动时突然再落
        landedThisFrame = true;
        break;
      }
      active = { ...active, y: active.y + 1 };
      if (soft) score += 1;
      dropAcc -= gravityStep;
      if (!valid({ ...active, y: active.y + 1 })) {
        landedThisFrame = true;
        break;
      }
      guard += 1;
    }

    const grounded = !valid({ ...active, y: active.y + 1 });

    if (grounded) {
      if (landedThisFrame) {
        // 本帧刚落到底：锁定延迟从下一帧开始，给玩家约 500ms 反应窗口。
        justLanded = true;
        lockTimer = 0;
      } else if (justLanded) {
        justLanded = false;
        lockTimer += delta;
      } else {
        lockTimer += delta;
      }
      if (lockTimer >= LOCK_DELAY) lockPiece();
    } else {
      lockTimer = 0;
      justLanded = false;
    }

    updateGhost();
  }

  function state() {
    return {
      board: board.map((row) => row.slice()),
      active: active ? { type: active.type, rot: active.rot, x: active.x, y: active.y } : null,
      ghostY,
      next: queue.slice(0, 3),
      hold: holdType,
      holdUsed,
      score,
      lines,
      level: currentLevel,
      lastClear,
      pieces,
      lockTimer,
      over,
      cols: COLS,
      rows: ROWS,
      turn: 'p1',
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `消行 ${lines} · 等级 ${currentLevel} · 落块 ${pieces}`,
    };
  }

  reset();

  return { submit, step, state, result, reset, debugSetCell };
}
