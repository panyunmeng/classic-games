/**
 * 国际跳棋 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导（English draughts / checkers，8×8，每方 12 子）：
 * - 棋盘扁平数组长 64，索引 i = row*8+col，row0 在顶部、col0 在左侧；
 *   深色格为 (row+col)%2===1（右下角 row7,col7 为深格，符合标准摆放）。
 * - p1=黑(1/王3) 开局占 row0~2 的深格，向 row 增大方向前进，抵 row7 升王；
 *   p2=白(2/王4) 占 row5~7 的深格，向 row 减小方向前进，抵 row0 升王。
 * - 兵走子：仅斜向前一格到空格；兵吃子：斜前或斜后越过相邻敌子落到其后空格；
 *   王走子/吃子：四个斜向均可，一次走一格；英式规则王吃子也只跳一格（非国际跳棋的远距离飞王）。
 * - 强制吃子：任一方存在合法吃子时，该方所有非吃子着法均非法（生成时统一过滤）。
 * - 连吃：吃子后若同一子仍有吃子机会，回合不交换，continueFrom 锁定该子继续吃；
 *   升王当步立即结束回合（英式规则：兵到底线升王后本回合终止，不再继续跳）。
 * - 胜负：对手棋子数为 0 或对手无任何合法着法则本方获胜。
 *
 * 联机兼容：服务端 import 本模块跑权威逻辑；submit 的 playerId 兼容 'p1'/'p2' 与数字 0/1；
 * state() 含 turn 字段，且每次返回新对象（新数组/新对象），外部改动无法污染内部。
 */

export const SIZE = 8;
export const CELLS = 64;

// 棋子编码
export const EMPTY = 0;
export const BLACK = 1;   // 黑兵 (p1)
export const WHITE = 2;   // 白兵 (p2)
export const BLACK_KING = 3;
export const WHITE_KING = 4;

const DIRS = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];

/** 把 shell 的数字下标或联机字符串 id 统一成 'p1' | 'p2' */
export function normalizePlayer(pid) {
  if (pid === 'p1' || pid === 0 || pid === '0') return 'p1';
  if (pid === 'p2' || pid === 1 || pid === '1') return 'p2';
  return null;
}

function other(p) {
  return p === 'p1' ? 'p2' : 'p1';
}

function rowOf(i) { return Math.floor(i / SIZE); }
function colOf(i) { return i % SIZE; }
function isDark(i) { return (rowOf(i) + colOf(i)) % 2 === 1; }
function inBoard(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

/** 初始布局：黑占前 3 行深格，白占后 3 行深格 */
export function initialBoard() {
  const b = new Array(CELLS).fill(EMPTY);
  for (let i = 0; i < CELLS; i++) {
    if (!isDark(i)) continue;
    const r = rowOf(i);
    if (r < 3) b[i] = BLACK;
    else if (r > 4) b[i] = WHITE;
  }
  return b;
}

/** 棋子所属方：1/3 → p1 (黑)，2/4 → p2 (白) */
export function pieceOwner(v) {
  if (v === BLACK || v === BLACK_KING) return 'p1';
  if (v === WHITE || v === WHITE_KING) return 'p2';
  return null;
}

export function isKing(v) {
  return v === BLACK_KING || v === WHITE_KING;
}

function promote(who, v) {
  if (who === 'p1' && v === BLACK) return BLACK_KING;
  if (who === 'p2' && v === WHITE) return WHITE_KING;
  return v;
}

/** 该方兵的前进方向（row 增减）；王两个方向都可 */
function forward(who) {
  return who === 'p1' ? 1 : -1;
}

/**
 * 单个着法：{ from, to, captured, capture, promote }
 * - captured: 被吃子的格索引或 -1；capture 为是否吃子；promote 为是否升王。
 */
function movesForPiece(board, from, who) {
  const v = board[from];
  const out = [];
  const king = isKing(v);
  const r = rowOf(from);
  const c = colOf(from);
  // 兵的可走方向：仅前进(负/正由 who 决定)；吃子及王：四方向
  const stepDirs = king ? DIRS : DIRS.filter(([dr]) => dr === forward(who));
  const jumpDirs = king ? DIRS : DIRS;

  for (const [dr, dc] of stepDirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBoard(nr, nc)) continue;
    const to = nr * SIZE + nc;
    if (board[to] !== EMPTY) continue;
    out.push({ from, to, captured: -1, capture: false, promote: false });
  }

  for (const [dr, dc] of jumpDirs) {
    const mr = r + dr;
    const mc = c + dc;
    const lr = r + 2 * dr;
    const lc = c + 2 * dc;
    if (!inBoard(lr, lc)) continue;
    const mid = mr * SIZE + mc;
    const to = lr * SIZE + lc;
    const midV = board[mid];
    if (midV === EMPTY || pieceOwner(midV) === who) continue;
    if (board[to] !== EMPTY) continue;
    out.push({ from, to, captured: mid, capture: true, promote: false });
  }
  return out;
}

/** 在 board 副本上执行一步，返回新 board（不改原 board） */
function applyMove(board, m, who) {
  const b = board.slice();
  const v = b[m.from];
  b[m.from] = EMPTY;
  // 只有真正抵达底线（m.promote）才升王，否则保持原兵种
  b[m.to] = m.promote ? promote(who, v) : v;
  if (m.captured >= 0) b[m.captured] = EMPTY;
  return b;
}

/**
 * 生成当前方所有合法着法（已应用强制吃子过滤、连吃锁定）。
 * 导出供 AI 与测试复用，保证"同一套规则"只有一个事实来源。
 */
export function genTurnMoves(board, who, continueFrom = -1) {
  const locked = continueFrom >= 0;
  const sources = locked
    ? [continueFrom]
    : [];
  if (!locked) {
    for (let i = 0; i < CELLS; i++) {
      if (pieceOwner(board[i]) === who) sources.push(i);
    }
  }

  const jumpMoves = [];
  const stepMoves = [];
  for (const from of sources) {
    if (pieceOwner(board[from]) !== who) continue;
    const all = movesForPiece(board, from, who);
    for (const m of all) {
      // 标注升王（兵抵达对方底线）
      const targetRow = rowOf(m.to);
      m.promote = !isKing(board[from]) && targetRow === (who === 'p1' ? SIZE - 1 : 0);
      // 升王当步终止回合：升王后的跳视为非法（连带下的后续吃子也不再允许）
      if (m.promote && m.capture) {
        // 吃子到升王仍合法，但不再产生连吃（由 apply 后 continueFrom=-1 保证）
      }
      (m.capture ? jumpMoves : stepMoves).push(m);
    }
  }

  if (jumpMoves.length) return jumpMoves; // 强制吃子：有吃子只能吃
  if (locked) return [];                   // 连吃中该子已无吃子 → 回合结束（由 submit 处理）
  return stepMoves;
}

/** 某一方是否还有任何合法着法 */
function hasAnyMove(board, who) {
  return genTurnMoves(board, who, -1).length > 0;
}

function countPieces(board) {
  let black = 0;
  let white = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = board[i];
    if (v === BLACK || v === BLACK_KING) black++;
    else if (v === WHITE || v === WHITE_KING) white++;
  }
  return { black, white, p1: black, p2: white };
}

/**
 * 解析 action：'move:from,to'，from/to 为 0～63 整数（深格）。
 * 兼容带空格的形式 'move: 17, 14'。
 */
export function parseAction(action) {
  if (typeof action !== 'string') return null;
  const m = /^move:\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(action);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || from >= CELLS || to < 0 || to >= CELLS) return null;
  return { from, to };
}

/** 把 from/to 应用到 board，自动判断升王与连吃；返回新局面对象 */
export function applyAction(board, who, action, continueFrom = -1) {
  const pos = parseAction(action);
  if (!pos) return null;
  const legal = genTurnMoves(board, who, continueFrom);
  const chosen = legal.find((m) => m.from === pos.from && m.to === pos.to);
  if (!chosen) return null;

  const v = board[chosen.from];
  const kingBefore = isKing(v);
  const b = applyMove(board, chosen, who);

  // 升王或吃过的值班员不再连吃；否则检查同子是否仍可吃
  let nextContinue = -1;
  if (chosen.capture && !chosen.promote) {
    const more = genTurnMoves(b, who, chosen.to);
    if (more.length && more[0].capture) nextContinue = chosen.to;
  }
  return {
    board: b,
    move: chosen,
    promote: chosen.promote,
    wasKing: kingBefore,
    continueFrom: nextContinue,
  };
}

/**
 * @param {{seed?:number, mode?:string, players?:string[], level?:number,
 *          board?:number[], turn?:string}} opts
 */
export function createGame({ seed = 1, mode = 'solo', players, level = 1, board: initBoard, turn: initTurn } = {}) {
  const activePlayers = players && players.length ? players.slice() : (mode === 'ai' ? ['p1', 'p2'] : ['p1']);

  let board;
  let turn;
  let winner;
  let winReason;
  let moveCount;
  let lastMove;
  let continueFrom;
  let history;

  function snapshot() {
    return {
      board: board.slice(), turn, winner, winReason, moveCount,
      lastMove: lastMove ? { ...lastMove } : null, continueFrom,
    };
  }

  function restore(s) {
    board = s.board.slice();
    turn = s.turn;
    winner = s.winner;
    winReason = s.winReason;
    moveCount = s.moveCount;
    lastMove = s.lastMove ? { ...s.lastMove } : null;
    continueFrom = s.continueFrom;
  }

  function reset() {
    board = initBoard ? initBoard.slice() : initialBoard();
    if (board.length !== CELLS) throw new Error('board 长度必须为 64');
    turn = initTurn ? normalizePlayer(initTurn) || 'p1' : 'p1';
    winner = null;
    winReason = null;
    moveCount = 0;
    lastMove = null;
    continueFrom = -1;
    history = [];
    // 摆局时若当前方无子，直接判负（便于终局测试）
    settleIfOver();
  }

  /** 判胜：对手无子或无合法着法则当前方胜；当前方无着法则对手胜 */
  function settleIfOver() {
    const counts = countPieces(board);
    if (counts.black === 0) { winner = 'p2'; winReason = 'noPieces'; return true; }
    if (counts.white === 0) { winner = 'p1'; winReason = 'noPieces'; return true; }
    const meMoves = genTurnMoves(board, turn, continueFrom);
    if (meMoves.length === 0) {
      if (continueFrom >= 0) {
        // 连吃结束：换手后重新判
        turn = other(turn);
        continueFrom = -1;
        const oppMoves = genTurnMoves(board, turn, -1);
        if (oppMoves.length === 0) { winner = turn === 'p1' ? 'p2' : 'p1'; winReason = 'noMoves'; return true; }
      } else {
        winner = other(turn);
        winReason = 'noMoves';
        return true;
      }
    }
    return false;
  }

  function state() {
    const counts = countPieces(board);
    return {
      board: board.slice(),
      turn,
      winner,
      over: Boolean(winner),
      winReason: winner ? winReason : null,
      moveCount,
      lastMove: lastMove ? { ...lastMove } : null,
      mustJump: genTurnMoves(board, turn, continueFrom).some((m) => m.capture),
      continueFrom,
      pieceCount: counts,
      size: SIZE,
      cells: CELLS,
      mode,
      players: activePlayers.slice(),
      seed,
      level,
    };
  }

  function undo() {
    if (!history.length) return { ok: false, error: '没有可悔的棋' };
    let s = history.pop();
    // 人机模式：若撤到的是 AI 回合，再撤一步回到玩家回合
    if (mode === 'ai' && s.turn === 'p2' && history.length) s = history.pop();
    restore(s);
    return { ok: true };
  }

  function submit(playerId, action) {
    if (action === 'undo') return undo();
    const who = normalizePlayer(playerId);
    if (!who) return { ok: false, error: '无效玩家' };
    if (winner) return { ok: false, error: '本局已结束' };
    if (who !== turn) return { ok: false, error: '还没轮到你走棋' };

    const applied = applyAction(board, who, action, continueFrom);
    if (!applied) return { ok: false, error: '非法着法（格式/目标/强制吃子不符）' };

    history.push(snapshot());
    board = applied.board;
    moveCount += 1;
    lastMove = {
      from: applied.move.from,
      to: applied.move.to,
      captured: applied.move.captured,
      capture: applied.move.capture,
      promote: applied.promote,
      player: who,
    };

    if (applied.continueFrom >= 0) {
      // 连吃：保持玩家与回合，只锁定该子
      continueFrom = applied.continueFrom;
    } else {
      // 普通一步或连吃结束：换手并清锁定
      turn = other(who);
      continueFrom = -1;
    }

    settleIfOver();
    return {
      ok: true,
      from: applied.move.from,
      to: applied.move.to,
      capture: applied.move.capture,
      promote: applied.promote,
      continueFrom,
      turn,
    };
  }

  function step() {
    /* 回合制，无需按帧推进 */
  }

  function result() {
    if (!winner) return null;
    return {
      over: true,
      winner,
      reason: winReason,
      scores: {
        p1: winner === 'p1' ? 1 : 0,
        p2: winner === 'p2' ? 1 : 0,
      },
      text: winner === 'p1' ? '黑棋获胜' : '白棋获胜',
    };
  }

  reset();

  return { submit, step, state, result, reset, undo };
}
