/**
 * 黑白棋 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 规则事实与推导：
 * - 8×8，p1=黑=1，p2=白=2；开局中心四子：(3,3)白 (3,4)黑 (4,3)黑 (4,4)白，
 *   由此黑恰有 4 个合法点 (2,3)(3,2)(4,5)(5,4)。
 * - 合法着法的唯一判据：沿八方向之一，紧邻的连续对方棋子被己方棋子封住；
 *   同一落子可同时翻转多条射线上的棋子。
 * - 无合法着法必须跳过；若双方都无着法则终局。为了让 shell / 人类 / AI 都不会卡死，
 *   跳过在 submit 内自动完成（turn 永远指向有合法着法的一方，或为 null 表示终局），
 *   同时仍接受显式 'pass' 动作以兼容契约与 AI 返回值。
 * - passCount 统计全局累计跳过次数；落子不清零。
 *
 * 联机兼容：服务端 import 本模块跑权威逻辑，submit 的 playerId 可为 'p1'|'p2'|0|1；
 * state() 含 turn / board / validMoves / scores / passCount，均可 JSON 序列化。
 */

export const SIZE = 8;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

/** 八方向（含四个斜向） */
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

/** 把 shell 的数字下标或联机字符串统一成 'p1' | 'p2' */
export function normalizePlayer(pid) {
  if (pid === 'p1' || pid === 0 || pid === '0') return 'p1';
  if (pid === 'p2' || pid === 1 || pid === '1') return 'p2';
  return null;
}

export function playerColor(pid) {
  return pid === 'p2' ? WHITE : BLACK;
}

export function otherPlayer(pid) {
  return pid === 'p1' ? 'p2' : 'p1';
}

export function otherColor(c) {
  return c === BLACK ? WHITE : BLACK;
}

export function initialBoard() {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  b[3][3] = WHITE;
  b[3][4] = BLACK;
  b[4][3] = BLACK;
  b[4][4] = WHITE;
  return b;
}

/**
 * 只读：返回在 (x,y) 落 color 会被翻转的所有坐标；非法落子返回空数组。
 * 这是全模块唯一的合法性判据，state / submit / AI 共用，避免规则分叉。
 */
export function flipsFor(board, x, y, color) {
  if (!inBounds(x, y) || board[y][x] !== EMPTY) return [];
  const opp = otherColor(color);
  const flips = [];
  for (const [dx, dy] of DIRS) {
    const run = [];
    let nx = x + dx;
    let ny = y + dy;
    while (inBounds(nx, ny) && board[ny][nx] === opp) {
      run.push({ x: nx, y: ny });
      nx += dx;
      ny += dy;
    }
    if (run.length && inBounds(nx, ny) && board[ny][nx] === color) {
      for (const p of run) flips.push(p);
    }
  }
  return flips;
}

/** 只读：某方全部合法着法（含翻转明细，供 AI 复用） */
export function legalMoves(board, color) {
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] !== EMPTY) continue;
      const flips = flipsFor(board, x, y, color);
      if (flips.length) out.push({ x, y, flips });
    }
  }
  return out;
}

/** 只读：返回落子后的新棋盘，不改入参；非法返回 null */
export function applyMove(board, x, y, color) {
  const flips = flipsFor(board, x, y, color);
  if (!flips.length) return null;
  const nb = board.map((row) => row.slice());
  nb[y][x] = color;
  for (const f of flips) nb[f.y][f.x] = color;
  return { board: nb, flipped: flips.length };
}

function scoresOf(board) {
  let p1 = 0;
  let p2 = 0;
  for (const row of board) {
    for (const v of row) {
      if (v === BLACK) p1++;
      else if (v === WHITE) p2++;
    }
  }
  return { p1, p2 };
}

function decideWinner(board) {
  const { p1, p2 } = scoresOf(board);
  if (p1 > p2) return 'p1';
  if (p2 > p1) return 'p2';
  return 'draw';
}

function parsePlace(action) {
  if (typeof action !== 'string') return null;
  const m = /^place:(-?\d+),(-?\d+)$/.exec(action);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y)) return null;
  return { x, y };
}

/**
 * @param {{seed?:number, mode?:string, players?:string[], level?:number}} opts
 */
export function createGame({ seed = 1, mode = 'solo', players, level = 1 } = {}) {
  const activePlayers = players && players.length
    ? players.slice()
    : (mode === 'ai' ? ['p1', 'p2'] : ['p1']);

  let board;
  let turn;
  let winner;
  let passCount;
  let lastMove;

  /**
   * 当前 turn 方若无合法着法则跳过；若对方也无着法则终局。
   * 每次跳过 passCount +1；turn 最终要么是能落子的一方，要么是 null（终局）。
   */
  function resolveTurn() {
    if (winner) return;
    if (legalMoves(board, playerColor(turn)).length > 0) return;

    passCount += 1; // 当前方跳过
    const opp = otherPlayer(turn);
    if (legalMoves(board, playerColor(opp)).length > 0) {
      turn = opp;
      return;
    }
    passCount += 1; // 对方也跳过 → 双方连续无着法 → 终局
    winner = decideWinner(board);
    turn = null;
  }

  function reset() {
    board = initialBoard();
    turn = 'p1';
    winner = null;
    passCount = 0;
    lastMove = null;
    resolveTurn(); // 标准开局黑有 4 着，此处不产生跳过；保留以覆盖未来变体开局
  }

  function place(who, action) {
    if (winner) return { ok: false, error: '本局已结束' };
    if (who !== turn) return { ok: false, error: '还没轮到你落子' };

    const pos = parsePlace(action);
    if (!pos) return { ok: false, error: '动作格式或坐标错误（应为 place:x,y）' };

    const color = playerColor(who);
    const flips = flipsFor(board, pos.x, pos.y, color);
    if (!flips.length) return { ok: false, error: '该位置无法夹住对方棋子' };

    board[pos.y][pos.x] = color;
    for (const f of flips) board[f.y][f.x] = color;
    lastMove = { x: pos.x, y: pos.y, player: who, color, flipped: flips.length };

    turn = otherPlayer(who);
    resolveTurn();
    return { ok: true, x: pos.x, y: pos.y, player: who, flipped: flips.length };
  }

  function pass(who) {
    if (winner) return { ok: false, error: '本局已结束' };
    if (who !== turn) return { ok: false, error: '还没轮到你行动' };
    if (legalMoves(board, playerColor(who)).length > 0) {
      return { ok: false, error: '还有合法着法，不能跳过' };
    }
    passCount += 1;
    turn = otherPlayer(who);
    resolveTurn();
    return { ok: true, passed: who };
  }

  function submit(playerId, action) {
    const who = normalizePlayer(playerId);
    if (!who) return { ok: false, error: '无效玩家' };
    if (action === 'pass') return pass(who);
    return place(who, action);
  }

  function step() {
    /* 回合制：由 submit 驱动，无需按帧推进 */
  }

  function state() {
    const mover = turn || 'p1';
    const moves = winner ? [] : legalMoves(board, playerColor(mover));
    return {
      board: board.map((row) => row.slice()),
      turn,
      validMoves: moves.map(({ x, y }) => ({ x, y })),
      scores: scoresOf(board),
      passCount,
      winner,
      over: Boolean(winner),
      lastMove: lastMove ? { ...lastMove } : null,
      size: SIZE,
      mode,
      players: activePlayers.slice(),
      seed,
      level,
    };
  }

  function result() {
    if (!winner) return null;
    const scores = scoresOf(board);
    return {
      over: true,
      winner,
      scores,
      text: winner === 'draw'
        ? `双方均无合法着法 · ${scores.p1}:${scores.p2} 和棋`
        : `${winner === 'p1' ? '黑棋' : '白棋'}获胜 · ${scores.p1}:${scores.p2}`,
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
