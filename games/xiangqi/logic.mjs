/**
 * 中国象棋 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 坐标与表示（唯一事实来源）：
 * - 9 列（col 0～8）× 10 行（row 0～9），索引 i = row*9+col（0～89）；
 * - row 0 在顶部 = 黑方底线，row 9 在底部 = 红方底线；col 0 在左；
 * - 棋子编码 v = kind | (黑方 ? 8 : 0)，kind ∈ 1～7 依次为 将/士/象/马/车/炮/兵；
 *   故 0 = 空，1～7 = 红子，9～15 = 黑子。用位运算取兵种，避免两套表。
 * - p1 = 红方（帅/仕/相/傌/俥/炮/兵），红先；p2 = 黑方（将/士/象/马/车/炮/兵）。
 *
 * 规则推导（都落在这一个模块，AI/渲染/输入不得再写一份）：
 * - 帅/将：九宫（黑 row 0～2 / 红 row 7～9，col 3～5）内一步正交；
 * - 仕/士：九宫内一步斜；
 * - 相/象：田字（两格斜），象眼（中点）不可被占，且不得过河；
 * - 傌/马：日字，马腿（沿两格方向的第一格）被占则该向不可走；
 * - 俥/车：直线任意格，遇子即止，可吃第一个敌子；
 * - 炮：不吃子时同车；吃子必须恰好隔一个「炮架」，落点必须是敌子；
 * - 兵/卒：向前一步；过河后可横走一步；任何时候不能后退；
 * - 将帅照面：双方将帅同列且中间无子 —— 该局面非法，
 *   实现上把「敌将」视作沿列的第一个子即攻击己帅，于是任何造成照面的着法都会被合法性过滤掉；
 * - 将军 = 行棋方帅/将被攻击；应将强制 = 走完后自己的帅/将不得被攻击；
 * - 绝杀 = 行棋方被将军且无合法着法（判负）；困毙 = 未被将军但无合法着法（象棋同样判负）；
 * - 和棋：连续 60 回合（120 手）无吃子，或同一局面（含行棋方）第三次出现。
 *   注：亚洲规则的「长将判负」未实现，重复局面一律判和，见交付说明。
 *
 * 联机兼容：服务端直接 import 本模块跑权威逻辑；submit 的 playerId 兼容
 * 'p1'/'p2' 与数字 0/1（shell 传数字），state() 始终带 turn，且每次返回新对象。
 */

export const COLS = 9;
export const ROWS = 10;
export const CELLS = 90;

export const RED = 'p1';
export const BLACK = 'p2';

/** 兵种编号（低 3 位） */
export const KIND = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 };

const K = KIND.K;
const A = KIND.A;
const B = KIND.B;
const N = KIND.N;
const R = KIND.R;
const C = KIND.C;
const P = KIND.P;

/** 棋子汉字：红方 帅仕相傌俥炮兵 / 黑方 将士象马车炮兵（兵种对照见任务口径） */
export const PIECE_CHARS = {
  p1: { 1: '帅', 2: '仕', 3: '相', 4: '傌', 5: '俥', 6: '炮', 7: '兵' },
  p2: { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '兵' },
};

export const sq = (row, col) => row * COLS + col;
export const rowOf = (i) => (i / COLS) | 0;
export const colOf = (i) => i % COLS;

/** 组成棋子编码：红子 = kind，黑子 = kind + 8 */
export function pieceOf(side, kind) {
  return kind | (side === BLACK ? 8 : 0);
}

export function sideOf(v) {
  if (!v) return null;
  return v >= 8 ? BLACK : RED;
}

export function kindOf(v) {
  return v & 7;
}

export function otherSide(p) {
  return p === RED ? BLACK : RED;
}

/** shell 传数字 0/1，联机传 'p1'/'p2'，统一成 side */
export function normalizePlayer(pid) {
  if (pid === RED || pid === 0 || pid === '0') return RED;
  if (pid === BLACK || pid === 1 || pid === '1') return BLACK;
  return null;
}

/** 是否在九宫内 */
export function inPalace(side, row, col) {
  if (col < 3 || col > 5) return false;
  return side === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

/** 是否已过河（红方到 row ≤ 4，黑方到 row ≥ 5） */
export function crossedRiver(side, row) {
  return side === RED ? row <= 4 : row >= 5;
}

/** 初始局面：双方底线车马象士将士象马车、炮在 row 2/7、兵在 row 3/6 */
export function initialBoard() {
  const b = new Array(CELLS).fill(0);
  const back = [R, N, B, A, K, A, B, N, R];
  for (let c = 0; c < COLS; c++) {
    b[sq(0, c)] = pieceOf(BLACK, back[c]);
    b[sq(9, c)] = pieceOf(RED, back[c]);
  }
  b[sq(2, 1)] = pieceOf(BLACK, C);
  b[sq(2, 7)] = pieceOf(BLACK, C);
  b[sq(7, 1)] = pieceOf(RED, C);
  b[sq(7, 7)] = pieceOf(RED, C);
  for (let c = 0; c < COLS; c += 2) {
    b[sq(3, c)] = pieceOf(BLACK, P);
    b[sq(6, c)] = pieceOf(RED, P);
  }
  return b;
}

/* ── 走子生成 ───────────────────────────────────────────── */

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** 马：[dr, dc, 马腿 dr, 马腿 dc]，马腿 = 沿两格方向的第一格 */
const KNIGHT_STEPS = [
  [-2, -1, -1, 0], [-2, 1, -1, 0],
  [-1, -2, 0, -1], [-1, 2, 0, 1],
  [1, -2, 0, -1], [1, 2, 0, 1],
  [2, -1, 1, 0], [2, 1, 1, 0],
];

/** 田字（相/象）：[dr, dc] 为落点偏移，象眼为 (dr/2, dc/2) */
const BISHOP_STEPS = [[-2, -2], [-2, 2], [2, -2], [2, 2]];

function canLand(board, side, to) {
  const v = board[to];
  return v === 0 || sideOf(v) !== side;
}

function pushIfCanLand(out, board, side, from, to) {
  if (canLand(board, side, to)) out.push({ from, to });
}

/** 直线滑行（车）：空格可走，遇第一个子：敌子可吃、己子止步 */
function slideRook(board, side, from, out) {
  const r0 = rowOf(from);
  const c0 = colOf(from);
  for (const [dr, dc] of ORTHO) {
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const to = sq(r, c);
      const v = board[to];
      if (v === 0) out.push({ from, to });
      else {
        if (sideOf(v) !== side) out.push({ from, to });
        break;
      }
      r += dr;
      c += dc;
    }
  }
}

/** 炮：不吃子时同车；吃子必须恰好跃过一个炮架，落点是敌子 */
function slideCannon(board, side, from, out) {
  const r0 = rowOf(from);
  const c0 = colOf(from);
  for (const [dr, dc] of ORTHO) {
    let r = r0 + dr;
    let c = c0 + dc;
    let screen = false;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const to = sq(r, c);
      const v = board[to];
      if (!screen) {
        if (v === 0) out.push({ from, to });
        else screen = true;
      } else if (v !== 0) {
        if (sideOf(v) !== side) out.push({ from, to });
        break;
      }
      r += dr;
      c += dc;
    }
  }
}

/**
 * 伪合法着法（未过滤「走后被将军 / 将帅照面」）。
 * 导出供 AI 与测试复用，保证规则只有一份实现。
 */
export function genPseudoMoves(board, side) {
  const out = [];
  for (let from = 0; from < CELLS; from++) {
    const v = board[from];
    if (!v || sideOf(v) !== side) continue;
    const k = kindOf(v);
    const r0 = rowOf(from);
    const c0 = colOf(from);

    if (k === K) {
      for (const [dr, dc] of ORTHO) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (!inPalace(side, r, c)) continue;
        pushIfCanLand(out, board, side, from, sq(r, c));
      }
      continue;
    }

    if (k === A) {
      for (const [dr, dc] of DIAG) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (!inPalace(side, r, c)) continue;
        pushIfCanLand(out, board, side, from, sq(r, c));
      }
      continue;
    }

    if (k === B) {
      for (const [dr, dc] of BISHOP_STEPS) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        if (crossedRiver(side, r)) continue; // 象不过河
        if (board[sq(r0 + dr / 2, c0 + dc / 2)] !== 0) continue; // 塞象眼
        pushIfCanLand(out, board, side, from, sq(r, c));
      }
      continue;
    }

    if (k === N) {
      for (const [dr, dc, lr, lc] of KNIGHT_STEPS) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        if (board[sq(r0 + lr, c0 + lc)] !== 0) continue; // 蹩马腿
        pushIfCanLand(out, board, side, from, sq(r, c));
      }
      continue;
    }

    if (k === R) {
      slideRook(board, side, from, out);
      continue;
    }

    if (k === C) {
      slideCannon(board, side, from, out);
      continue;
    }

    if (k === P) {
      const fwd = side === RED ? -1 : 1;
      const r = r0 + fwd;
      if (r >= 0 && r < ROWS) pushIfCanLand(out, board, side, from, sq(r, c0));
      if (crossedRiver(side, r0)) {
        for (const dc of [-1, 1]) {
          const c = c0 + dc;
          if (c < 0 || c >= COLS) continue;
          pushIfCanLand(out, board, side, from, sq(r0, c));
        }
      }
    }
  }
  return out;
}

/** 找到某方帅/将的索引，找不到返回 -1（残局构造里可能出现） */
export function findKing(board, side) {
  const target = pieceOf(side, K);
  for (let i = 0; i < CELLS; i++) if (board[i] === target) return i;
  return -1;
}

/**
 * 某个格子是否被 bySide 攻击。
 * 只用于判帅/将安全，所以士/象的远程攻击不参与（它们永远到不了对方九宫）：
 * 士不离九宫、象不过河，二者都不可能攻击到敌方的帅/将。
 */
export function isAttacked(board, target, bySide) {
  const r0 = rowOf(target);
  const c0 = colOf(target);

  // 兵/卒：前进方向的一格 + 过河后的左右一格（反向看：谁能攻击到 target）
  if (bySide === RED) {
    if (r0 + 1 < ROWS) {
      const v = board[sq(r0 + 1, c0)];
      if (v && sideOf(v) === RED && kindOf(v) === P) return true;
    }
    if (r0 <= 4) {
      for (const dc of [-1, 1]) {
        const c = c0 + dc;
        if (c < 0 || c >= COLS) continue;
        const v = board[sq(r0, c)];
        if (v && sideOf(v) === RED && kindOf(v) === P) return true;
      }
    }
  } else {
    if (r0 - 1 >= 0) {
      const v = board[sq(r0 - 1, c0)];
      if (v && sideOf(v) === BLACK && kindOf(v) === P) return true;
    }
    if (r0 >= 5) {
      for (const dc of [-1, 1]) {
        const c = c0 + dc;
        if (c < 0 || c >= COLS) continue;
        const v = board[sq(r0, c)];
        if (v && sideOf(v) === BLACK && kindOf(v) === P) return true;
      }
    }
  }

  // 马：反向枚举 8 个马位，再按「从马到 target」的方向判马腿
  for (const [dr, dc] of KNIGHT_STEPS) {
    const kr = r0 + dr;
    const kc = c0 + dc;
    if (kr < 0 || kr >= ROWS || kc < 0 || kc >= COLS) continue;
    const v = board[sq(kr, kc)];
    if (!v || sideOf(v) !== bySide || kindOf(v) !== N) continue;
    const backDr = -dr;
    const backDc = -dc;
    let lr;
    let lc;
    if (Math.abs(backDr) === 2) {
      lr = kr + backDr / 2;
      lc = kc;
    } else {
      lr = kr;
      lc = kc + backDc / 2;
    }
    if (board[sq(lr, lc)] === 0) return true; // 马腿空 → 可攻击
  }

  // 车 / 炮 / 将（将帅照面与贴身）
  for (const [dr, dc] of ORTHO) {
    let r = r0 + dr;
    let c = c0 + dc;
    let screened = false;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const v = board[sq(r, c)];
      if (v !== 0) {
        if (!screened) {
          if (sideOf(v) === bySide) {
            const k = kindOf(v);
            if (k === R) return true;
            // 同列且中间无子：将帅照面
            if (k === K && dc === 0) return true;
            // 贴身的将/帅（正常局面不会出现，自定义残局兜底）
            if (k === K && Math.abs(r - r0) + Math.abs(c - c0) === 1) return true;
          }
          screened = true;
        } else {
          if (sideOf(v) === bySide && kindOf(v) === C) return true;
          break;
        }
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

/** 某方是否被将军（含将帅照面） */
export function inCheck(board, side) {
  const k = findKing(board, side);
  if (k < 0) return false;
  return isAttacked(board, k, otherSide(side));
}

/** 双方将帅是否照面（同列且中间无子） */
export function kingsFacing(board) {
  const rk = findKing(board, RED);
  const bk = findKing(board, BLACK);
  if (rk < 0 || bk < 0) return false;
  if (colOf(rk) !== colOf(bk)) return false;
  const c = colOf(rk);
  const lo = Math.min(rowOf(rk), rowOf(bk));
  const hi = Math.max(rowOf(rk), rowOf(bk));
  for (let r = lo + 1; r < hi; r++) if (board[sq(r, c)] !== 0) return false;
  return true;
}

/**
 * 生成某方全部合法着法（已过滤送将 / 将帅照面）。
 * 返回 [{ from, to, capture, captured }]，captured 为被吃子的编码（0 表示空点）。
 * 纯函数：内部在副本上试走，不改入参棋盘。
 */
export function genLegalMoves(board, side) {
  const b = Array.from(board);
  const k0 = findKing(b, side);
  const opp = otherSide(side);
  const out = [];
  for (const m of genPseudoMoves(b, side)) {
    const moving = b[m.from];
    const captured = b[m.to];
    b[m.to] = moving;
    b[m.from] = 0;
    const king = k0 === m.from ? m.to : k0;
    const safe = king < 0 ? true : !isAttacked(b, king, opp);
    b[m.from] = moving;
    b[m.to] = captured;
    if (safe) out.push({ from: m.from, to: m.to, capture: captured !== 0, captured });
  }
  return out;
}

/** 解析 'move:from,to'（from/to 为 0～89 索引），失败返回 null */
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

/**
 * @param {{seed?:number, mode?:string, players?:string[], level?:number,
 *          board?:number[], turn?:string}} opts
 */
export function createGame({ seed = 1, mode = 'solo', players, level = 1, board: initBoard, turn: initTurn } = {}) {
  const activePlayers = players && players.length
    ? players.slice()
    : (mode === 'ai' || mode === 'local2p' || mode === 'online' ? [RED, BLACK] : [RED]);

  let board;
  let turn;
  let winner;
  let reason;
  let moveCount;
  let halfmove;
  let lastMove;
  let moveList;
  let undoStack;
  let positionKeys;

  function positionKey() {
    return `${turn}|${board.join(',')}`;
  }

  function snapshot() {
    return {
      board: board.slice(),
      turn,
      winner,
      reason,
      moveCount,
      halfmove,
      lastMove: lastMove ? { ...lastMove } : null,
      movesLen: moveList.length,
      keysLen: positionKeys.length,
    };
  }

  function restore(s) {
    board = s.board.slice();
    turn = s.turn;
    winner = s.winner;
    reason = s.reason;
    moveCount = s.moveCount;
    halfmove = s.halfmove;
    lastMove = s.lastMove ? { ...s.lastMove } : null;
    moveList.length = s.movesLen;
    positionKeys.length = s.keysLen;
  }

  /** 终局判定：无着法（绝杀/困毙）→ 和棋规则 */
  function evaluateEnd() {
    if (winner) return true;
    const legal = genLegalMoves(board, turn);
    if (legal.length === 0) {
      const check = inCheck(board, turn);
      winner = otherSide(turn);
      reason = check ? 'checkmate' : 'stalemate';
      return true;
    }
    if (halfmove >= 120) {
      winner = 'draw';
      reason = 'noCapture';
      return true;
    }
    const key = positionKey();
    let seen = 0;
    for (let i = 0; i < positionKeys.length; i++) if (positionKeys[i] === key) seen++;
    if (seen >= 3) {
      winner = 'draw';
      reason = 'repetition';
      return true;
    }
    return false;
  }

  function reset() {
    if (initBoard) {
      if (initBoard.length !== CELLS) throw new Error('board 长度必须为 90');
      board = Array.from(initBoard);
    } else {
      board = initialBoard();
    }
    turn = (initTurn && normalizePlayer(initTurn)) || RED;
    winner = null;
    reason = null;
    moveCount = 0;
    halfmove = 0;
    lastMove = null;
    moveList = [];
    undoStack = [];
    positionKeys = [positionKey()];
    evaluateEnd(); // 摆残局可能一开局就是绝杀/困毙
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可悔的棋' };
    let s = undoStack.pop();
    // 人机模式：撤到 AI 回合时再撤一步，回到玩家回合
    if (mode === 'ai' && s.turn === BLACK && undoStack.length) s = undoStack.pop();
    restore(s);
    return { ok: true };
  }

  function submit(playerId, action) {
    if (action === 'undo') return undo();

    const who = normalizePlayer(playerId);
    if (!who) return { ok: false, error: '无效玩家' };
    if (winner) return { ok: false, error: '本局已结束' };
    if (who !== turn) return { ok: false, error: '还没轮到你走棋' };

    const pos = parseAction(action);
    if (!pos) return { ok: false, error: '着法格式错误，应为 move:from,to' };

    const moving = board[pos.from];
    if (!moving) return { ok: false, error: '起点没有棋子' };
    if (sideOf(moving) !== who) return { ok: false, error: '不能走对方的棋子' };
    if (pos.from === pos.to) return { ok: false, error: '起点与落点相同' };

    const legal = genLegalMoves(board, who);
    const chosen = legal.find((m) => m.from === pos.from && m.to === pos.to);
    if (!chosen) {
      // 区分「不会走」与「会走但送将/照面」，给玩家可读的提示
      const pseudo = genPseudoMoves(board, who).some((m) => m.from === pos.from && m.to === pos.to);
      return {
        ok: false,
        error: pseudo ? '该着法会让自己的帅/将被将军（或将帅照面）' : '该棋子不能这样走',
      };
    }

    const captured = chosen.captured;
    undoStack.push(snapshot());
    board[pos.to] = moving;
    board[pos.from] = 0;
    moveCount += 1;
    halfmove = captured ? 0 : halfmove + 1;
    lastMove = {
      from: pos.from,
      to: pos.to,
      piece: moving,
      kind: kindOf(moving),
      player: who,
      captured,
      index: moveCount,
    };
    moveList.push({ ...lastMove });
    turn = otherSide(who);
    positionKeys.push(positionKey());
    evaluateEnd();

    return {
      ok: true,
      from: pos.from,
      to: pos.to,
      capture: captured !== 0,
      captured,
      turn,
      inCheck: inCheck(board, turn),
    };
  }

  function state() {
    const legal = genLegalMoves(board, turn);
    const check = inCheck(board, turn);
    const noMoves = legal.length === 0;
    let red = 0;
    let black = 0;
    for (let i = 0; i < CELLS; i++) {
      const v = board[i];
      if (!v) continue;
      if (sideOf(v) === RED) red++;
      else black++;
    }
    return {
      board: board.slice(),
      turn,
      winner,
      over: Boolean(winner),
      reason: winner ? reason : null,
      inCheck: check,
      checkmate: noMoves && check,
      stalemate: noMoves && !check,
      lastMove: lastMove ? { ...lastMove } : null,
      moveHistory: moveList.map((m) => ({ ...m })),
      legalMoves: legal.map((m) => ({ from: m.from, to: m.to, capture: m.capture })),
      moveCount,
      halfmove,
      pieceCount: { p1: red, p2: black },
      canUndo: undoStack.length > 0,
      cols: COLS,
      rows: ROWS,
      cells: CELLS,
      mode,
      players: activePlayers.slice(),
      seed,
      level,
    };
  }

  function step() {
    /* 回合制：由 submit 直接驱动，无需按帧推进 */
  }

  function resultText() {
    if (winner === 'draw') {
      if (reason === 'repetition') return '同一局面三次出现，判和';
      if (reason === 'noCapture') return '连续 60 回合无吃子，判和';
      return '和棋';
    }
    const w = winner === RED ? '红方' : '黑方';
    const l = winner === RED ? '黑方' : '红方';
    if (reason === 'checkmate') return `${w}绝杀，${l}无子可应`;
    if (reason === 'stalemate') return `困毙：${l}无子可走，${w}胜`;
    return `${w}获胜`;
  }

  function result() {
    if (!winner) return null;
    return {
      over: true,
      winner,
      reason,
      // 结算面板标题（shell 的 showOver 优先用 info.title）
      title: winner === 'draw' ? '和棋' : winner === RED ? '红方胜' : '黑方胜',
      scores: {
        p1: winner === RED ? 1 : 0,
        p2: winner === BLACK ? 1 : 0,
      },
      text: resultText(),
    };
  }

  reset();

  return { submit, step, state, result, reset, undo };
}
