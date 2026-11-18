/**
 * 五子棋 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 15×15 棋盘，黑先白后，黑=1 白=2，p1 执黑 p2 执白；
 * - 落子必须落在 0～14 的整数格且为空，且提交者必须是当前回合方；
 * - 胜负只需检查“最后落子点”穿过横、竖、两条斜线的连续同色长度 >= 5；
 * - 棋盘落满（moveCount === 225）且无五连 => 平局；
 * - 人机模式 undo 连撤两步回到玩家回合，否则玩家永远轮不到。
 *
 * 联机兼容：服务端 import 本模块跑权威逻辑，submit 的 playerId 必须是 'p1'|'p2'，
 * state() 含 turn 字段；同时兼容 shell 传来的数字 0/1。
 */

export const SIZE = 15;
export const WIN_LEN = 5;

/** 把 shell 的数字下标或联机的字符串 id 统一成 'p1' | 'p2' */
function normalizePlayer(pid) {
  if (pid === 'p1' || pid === 0 || pid === '0') return 'p1';
  if (pid === 'p2' || pid === 1 || pid === '1') return 'p2';
  return null;
}

function other(p) {
  return p === 'p1' ? 'p2' : 'p1';
}

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function cloneBoard(b) {
  return b.map((row) => row.slice());
}

const DIRS = [
  [1, 0],  // 横
  [0, 1],  // 竖
  [1, 1],  // 主对角
  [1, -1], // 副对角
];

/** 统计某点沿某方向连续同色棋子数（不含自身以外的空格） */
function countDir(board, x, y, dx, dy, color) {
  let n = 1;
  for (let s = 1; s < SIZE; s++) {
    const nx = x + dx * s;
    const ny = y + dy * s;
    if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || board[ny][nx] !== color) break;
    n++;
  }
  return n;
}

/**
 * 检查最后落子是否形成五连。
 * 返回连线的格子数组（>=5 个），否则返回 null。
 */
function findWinLine(board, x, y, color) {
  for (const [dx, dy] of DIRS) {
    const line = [{ x, y }];
    for (let s = 1; s < SIZE; s++) {
      const nx = x + dx * s;
      const ny = y + dy * s;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || board[ny][nx] !== color) break;
      line.push({ x: nx, y: ny });
    }
    for (let s = 1; s < SIZE; s++) {
      const nx = x - dx * s;
      const ny = y - dy * s;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || board[ny][nx] !== color) break;
      line.unshift({ x: nx, y: ny });
    }
    if (line.length >= WIN_LEN) return line;
  }
  return null;
}

/**
 * @param {{seed?:number, mode?:string, players?:string[], level?:number}} opts
 */
export function createGame({ seed = 1, mode = 'solo', players, level = 1 } = {}) {
  // mode='ai' 时双方都是可提交者（黑由人、白由 AI），players 对外暴露
  const activePlayers = players && players.length ? players.slice() : (mode === 'ai' ? ['p1', 'p2'] : ['p1']);

  let board;
  let turn;
  let winner;
  let moveCount;
  let lastMove;
  let winningLine;
  let history;

  function snapshot() {
    return {
      board: cloneBoard(board),
      turn,
      winner,
      moveCount,
      lastMove: lastMove ? { ...lastMove } : null,
      winningLine: winningLine ? winningLine.map((p) => ({ ...p })) : null,
    };
  }

  function restore(s) {
    board = cloneBoard(s.board);
    turn = s.turn;
    winner = s.winner;
    moveCount = s.moveCount;
    lastMove = s.lastMove ? { ...s.lastMove } : null;
    winningLine = s.winningLine ? s.winningLine.map((p) => ({ ...p })) : null;
  }

  function reset() {
    board = emptyBoard();
    turn = 'p1';
    winner = null;
    moveCount = 0;
    lastMove = null;
    winningLine = null;
    history = [];
  }

  /** 解析 'place:x,y'，返回 {x,y} 或 null */
  function parseAction(action) {
    if (typeof action !== 'string') return null;
    const m = /^place:(-?\d+),(-?\d+)$/.exec(action);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return { x, y };
  }

  function place(playerId, action) {
    const who = normalizePlayer(playerId);
    if (!who) return { ok: false, error: '无效玩家' };
    if (winner) return { ok: false, error: '本局已结束' };
    if (who !== turn) return { ok: false, error: '还没轮到你落子' };

    const pos = parseAction(action);
    if (!pos) return { ok: false, error: '坐标越界或格式错误' };
    if (board[pos.y][pos.x] !== 0) return { ok: false, error: '该位置已有棋子' };

    const color = who === 'p1' ? 1 : 2;
    history.push(snapshot());
    board[pos.y][pos.x] = color;
    moveCount += 1;
    lastMove = { x: pos.x, y: pos.y, player: who, color };

    const line = findWinLine(board, pos.x, pos.y, color);
    if (line) {
      winner = who;
      winningLine = line;
    } else if (moveCount >= SIZE * SIZE) {
      winner = 'draw';
      winningLine = null;
    } else {
      turn = other(who);
    }

    return { ok: true, x: pos.x, y: pos.y, player: who };
  }

  function undo() {
    if (!history.length) return { ok: false, error: '没有可悔的棋' };
    let s = history.pop();
    // 人机模式：若撤到的是 p2（AI）回合，再撤一步回到玩家 p1 回合
    if (mode === 'ai' && (s.turn === 'p2' || s.turn === 1 || s.turn === '1') && history.length) {
      s = history.pop();
    }
    restore(s);
    return { ok: true };
  }

  function submit(playerId, action) {
    if (action === 'undo') return undo();
    return place(playerId, action);
  }

  function step() {
    /* 回合制，无需按帧推进 */
  }

  function state() {
    return {
      board: cloneBoard(board),
      turn,
      winner,
      over: Boolean(winner),
      moveCount,
      lastMove: lastMove ? { ...lastMove } : null,
      winningLine: winningLine ? winningLine.map((p) => ({ ...p })) : null,
      size: SIZE,
      mode,
      players: activePlayers.slice(),
      canUndo: history.length > 0,
      seed,
      level,
    };
  }

  function result() {
    if (!winner) return null;
    return {
      over: true,
      winner,
      scores: {
        p1: winner === 'p1' ? 1 : 0,
        p2: winner === 'p2' ? 1 : 0,
      },
      text: winner === 'draw' ? '棋盘已满，和棋' : (winner === 'p1' ? '黑棋五连获胜' : '白棋五连获胜'),
    };
  }

  reset();

  return { submit, step, state, result, reset, undo };
}
