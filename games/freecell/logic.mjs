/**
 * 空当接龙（FreeCell 玩法）· 纯逻辑。
 *
 * 关键事实与推导：
 * - 牌：一副 52 张（4 花色 × A..K），**全部翻开、没有牌堆/废牌堆**。信息全公开是本玩法
 *   与接龙（klondike）最本质的差别，难点只在"每次允许整体搬几张"的约束上，因此不需要
 *   draw/recycle 这类动作，也不存在暗牌翻面加分。
 * - 初始 8 列：前 4 列各 7 张、后 4 列各 6 张（28 + 24 = 52），按列顺序发完。
 * - 4 个自由格：每格 1 张，可暂存、可回列；4 个基础堆：A→K 同花色递增，空堆只收 A。
 * - 列内可整体搬运的条件：从起点到列末"红黑交替且点数逐张减 1"。
 * - 可搬张数上限（完整版）：(空自由格数 + 1) × 2^(可用空列数)。
 *   "可用空列"取移动前的空列数；目标本身就是空列时不计它——它要用来放这组牌，
 *   不能当周转位。单张的下限天然是 1，所以不需要特判。
 * - 空列可放任意牌或任意合法序列（不像 klondike 空列只收 K）。
 * - 全部 52 张进基础堆即胜。
 * - 计分：进基础堆 +10/张，从基础堆取回 -15/张；步数单独计。
 * - 撤销：每个成功动作前压一份完整快照；自动收牌整段算一步、只压一份快照。
 * - 随机只用注入的 createRng(seed)，同种子必得同一副牌；不碰 Math.random / Date.now。
 *
 * 动作（submit 第二参数，字符串）：
 *   'move:src,dst'
 *     src: 't0'..'t7'（从该列"最长合法序列"的起点开始整组搬）
 *          't0:k'（从该列第 k 张起，便于点在牌列中间）
 *          'f0'..'f3'（自由格）| 'd0'..'d3'（基础堆，取顶张）
 *     dst: 't0'..'t7' | 'f0'..'f3' | 'd0'..'d3'
 *   'auto'  把列顶与自由格上能进基础堆的牌一次收完（整段一步）
 *   'undo'  撤销上一步
 *
 * 说明：
 * - 单人模式 shell 传 playerId=0，这里不校验 playerId，turn 固定 'p1'。
 * - 可选 setup 参数只给单测/回放用，可直接摆出任意合法局面（仍必须 52 张唯一完整）。
 */
import { createRng } from '../../shared/rng.js';

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RED_SUITS = ['H', 'D'];
export const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
export const COLUMNS = 8;
export const FREE_CELL_COUNT = 4;
export const FOUNDATION_COUNT = 4;
export const DEAL_COUNTS = [7, 7, 7, 7, 6, 6, 6, 6];
export const TOTAL_CARDS = 52;
export const CARD_SCORE = 10;
export const FOUNDATION_TAKEBACK = 15;

const RANK_FROM_LABEL = { A: 1, J: 11, Q: 12, K: 13, T: 10 };

export function isRed(card) {
  return RED_SUITS.includes(card.suit);
}

export function rankText(rank) {
  return RANK_LABEL[rank] || String(rank);
}

/** 牌的短标识，如 "A♠"、"10♥"，仅供展示/调试 */
export function cardText(card) {
  return `${rankText(card.rank)}${SUIT_SYMBOL[card.suit]}`;
}

/** 解析 "S10" / "HA" / "D5" 形式的牌面 token；非法返回 null */
export function parseCardToken(tok) {
  if (typeof tok !== 'string') return null;
  const m = /^([SHCD])(10|[2-9]|1[0-3]|[1-9]|A|J|Q|K)$/i.exec(tok.replace(/\s+/g, ''));
  if (!m) return null;
  const suit = m[1].toUpperCase();
  const label = m[2].toUpperCase();
  const rank = RANK_FROM_LABEL[label] || Number(label);
  if (!Number.isInteger(rank) || rank < 1 || rank > 13) return null;
  return { suit, rank, up: true };
}

/** 全牌场：52 张，顺序固定（花色 S/H/D/C × A..K） */
export function fullDeckTokens() {
  const out = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) out.push(suit + rankText(rank));
  }
  return out;
}

/** col[start..] 是否红黑交替、点数逐张减 1 的合法序列 */
export function isValidRun(col, start) {
  if (!Array.isArray(col) || start < 0 || start >= col.length) return false;
  for (let i = start + 1; i < col.length; i++) {
    const prev = col[i - 1];
    const cur = col[i];
    if (cur.rank !== prev.rank - 1 || isRed(cur) === isRed(prev)) return false;
  }
  return true;
}

/** 一列里"能整体搬走的最长合法序列"的起点（列空返回 -1） */
export function runStart(col) {
  if (!col.length) return -1;
  let start = col.length - 1;
  // isValidRun(col, start - 1) 覆盖 (start-1) 与 start..end 的全部相邻关系，合法就向前扩一格
  while (start > 0 && isValidRun(col, start - 1)) start -= 1;
  return start;
}

function normalizeCardObject(card) {
  if (!card || typeof card !== 'object') return null;
  if (!SUITS.includes(card.suit)) return null;
  if (!Number.isInteger(card.rank) || card.rank < 1 || card.rank > 13) return null;
  return { suit: card.suit, rank: card.rank, up: true };
}

function coerceCard(tok, where) {
  const card = typeof tok === 'string' ? parseCardToken(tok) : normalizeCardObject(tok);
  if (!card) throw new Error(`${where} 出现非法牌：${JSON.stringify(tok)}`);
  return card;
}

/**
 * 用 setup 摆局（测试/回放用）。
 * setup = { tableau?: card[][], freeCells?: (card|null)[], foundations?: card[][] }
 * 牌可用 "S10" 这类 token；必须恰好 52 张且唯一；基础堆必须是 A 起的同花色递增前缀。
 */
function buildFromSetup(setup) {
  if (!setup || typeof setup !== 'object') throw new Error('setup 必须是对象');
  const rawTableau = setup.tableau || [];
  const rawFree = setup.freeCells || [];
  const rawFound = setup.foundations || [];
  if (rawTableau.length > COLUMNS) throw new Error(`setup.tableau 最多 ${COLUMNS} 列`);
  if (rawFree.length > FREE_CELL_COUNT) throw new Error(`setup.freeCells 最多 ${FREE_CELL_COUNT} 格`);
  if (rawFound.length > FOUNDATION_COUNT) throw new Error(`setup.foundations 最多 ${FOUNDATION_COUNT} 堆`);

  const tableau = Array.from({ length: COLUMNS }, () => []);
  const freeCells = Array.from({ length: FREE_CELL_COUNT }, () => null);
  const foundations = Array.from({ length: FOUNDATION_COUNT }, () => []);
  const seen = new Set();

  function mark(card, where) {
    const key = `${card.suit}-${card.rank}`;
    if (seen.has(key)) throw new Error(`${where} 重复出现同一张牌 ${cardText(card)}`);
    seen.add(key);
  }

  rawTableau.forEach((col, i) => {
    if (!Array.isArray(col)) throw new Error(`setup.tableau[${i}] 必须是数组`);
    for (const tok of col) {
      const card = coerceCard(tok, `setup.tableau[${i}]`);
      mark(card, `setup.tableau[${i}]`);
      tableau[i].push(card);
    }
  });
  rawFree.forEach((tok, i) => {
    if (tok == null) return;
    const card = coerceCard(tok, `setup.freeCells[${i}]`);
    mark(card, `setup.freeCells[${i}]`);
    freeCells[i] = card;
  });
  rawFound.forEach((stack, i) => {
    if (!Array.isArray(stack)) throw new Error(`setup.foundations[${i}] 必须是数组`);
    for (const tok of stack) {
      const card = coerceCard(tok, `setup.foundations[${i}]`);
      mark(card, `setup.foundations[${i}]`);
      foundations[i].push(card);
    }
    for (let k = 0; k < foundations[i].length; k++) {
      const c = foundations[i][k];
      if (c.rank !== k + 1) throw new Error(`setup.foundations[${i}] 必须是 A 起连续递增`);
      if (k > 0 && c.suit !== foundations[i][0].suit) {
        throw new Error(`setup.foundations[${i}] 必须是同一花色`);
      }
    }
  });

  if (seen.size !== TOTAL_CARDS) {
    throw new Error(`setup 必须恰好 ${TOTAL_CARDS} 张牌，当前 ${seen.size} 张`);
  }
  return { tableau, freeCells, foundations };
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], setup = null } = {}) {
  const initialSeed = seed >>> 0;
  let rng;
  let tableau;
  let freeCells;
  let foundations;
  let score;
  let moves;
  let won;
  let undoStack;

  function build() {
    rng = createRng(initialSeed);
    if (setup) {
      const s = buildFromSetup(setup);
      tableau = s.tableau;
      freeCells = s.freeCells;
      foundations = s.foundations;
    } else {
      const deck = [];
      for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank, up: true });
      }
      const shuffled = rng.shuffle(deck);
      tableau = Array.from({ length: COLUMNS }, () => []);
      freeCells = Array.from({ length: FREE_CELL_COUNT }, () => null);
      foundations = Array.from({ length: FOUNDATION_COUNT }, () => []);
      let k = 0;
      for (let i = 0; i < COLUMNS; i++) {
        for (let j = 0; j < DEAL_COUNTS[i]; j++) {
          tableau[i].push({ ...shuffled[k++], up: true });
        }
      }
    }
    score = 0;
    moves = 0;
    won = false;
    undoStack = [];
    checkWin(); // setup 可能直接给出已收完的局面
  }

  function cloneCards(arr) {
    return arr.map((c) => ({ ...c }));
  }

  function snapshot() {
    return {
      tableau: tableau.map(cloneCards),
      freeCells: freeCells.map((c) => (c ? { ...c } : null)),
      foundations: foundations.map(cloneCards),
      score,
      moves,
      won,
    };
  }

  function restore(s) {
    tableau = s.tableau.map(cloneCards);
    freeCells = s.freeCells.map((c) => (c ? { ...c } : null));
    foundations = s.foundations.map(cloneCards);
    score = s.score;
    moves = s.moves;
    won = s.won;
  }

  /* ── 规则判定 ─────────────────────────────────────────── */

  /** 目标列顶牌能否接住某张牌（空列接一切；否则红黑交替且点数大 1） */
  function canPlaceOnColumn(card, col) {
    if (!col.length) return true;
    const top = col[col.length - 1];
    return card.rank === top.rank - 1 && isRed(card) !== isRed(top);
  }

  function canCollect(card, foundation) {
    if (!foundation.length) return card.rank === 1;
    const top = foundation[foundation.length - 1];
    return card.suit === top.suit && card.rank === top.rank + 1;
  }

  /** 当前局面允许整体搬运的张数上限；目标本身是空列时要扣掉它（不能当周转位） */
  function movableInfo(dstIsEmptyColumn = false) {
    const emptyFree = freeCells.filter((c) => !c).length;
    let emptyCols = tableau.filter((col) => col.length === 0).length;
    if (dstIsEmptyColumn) emptyCols -= 1;
    if (emptyCols < 0) emptyCols = 0;
    return { emptyFree, emptyCols, limit: (emptyFree + 1) * Math.pow(2, emptyCols) };
  }

  function parseSource(tok) {
    if (typeof tok !== 'string') return null;
    let m = /^t([0-7])(?::(\d+))?$/.exec(tok);
    if (m) return { type: 't', i: Number(m[1]), idx: m[2] == null ? null : Number(m[2]) };
    m = /^f([0-3])$/.exec(tok);
    if (m) return { type: 'f', i: Number(m[1]) };
    m = /^d([0-3])$/.exec(tok);
    if (m) return { type: 'd', i: Number(m[1]) };
    return null;
  }

  function parseDest(tok) {
    if (typeof tok !== 'string') return null;
    let m = /^t([0-7])$/.exec(tok);
    if (m) return { type: 't', i: Number(m[1]) };
    m = /^f([0-3])$/.exec(tok);
    if (m) return { type: 'f', i: Number(m[1]) };
    m = /^d([0-3])$/.exec(tok);
    if (m) return { type: 'd', i: Number(m[1]) };
    return null;
  }

  function takeFrom(src) {
    if (src.type === 't') {
      const col = tableau[src.i];
      if (!col.length) return { error: '该列没有牌' };
      const start = src.idx == null ? runStart(col) : src.idx;
      if (start < 0 || start >= col.length) return { error: '起点超出该列范围' };
      if (!isValidRun(col, start)) return { error: '这组牌不是红黑交替递减序列，不能整体搬走' };
      return { cards: col.slice(start), from: 't', ti: src.i, start };
    }
    if (src.type === 'f') {
      const card = freeCells[src.i];
      if (!card) return { error: '这个自由格是空的' };
      return { cards: [card], from: 'f', fi: src.i };
    }
    const stack = foundations[src.i];
    if (!stack.length) return { error: '这个基础堆是空的' };
    return { cards: [stack[stack.length - 1]], from: 'd', di: src.i };
  }

  function removeFrom(taken) {
    if (taken.from === 't') tableau[taken.ti].length = taken.start;
    else if (taken.from === 'f') freeCells[taken.fi] = null;
    else foundations[taken.di].pop();
  }

  function checkWin() {
    if (foundations.every((f) => f.length === 13)) won = true;
  }

  /** 真正执行一次移动；record=false 时不留撤销快照（自动收牌内部用） */
  function applyMove(src, dst, record = true) {
    if (!src || !dst) return { ok: false, error: '无效的移动指令' };
    if (src.type === 't' && dst.type === 't' && src.i === dst.i) {
      return { ok: false, error: '不能移动到原列' };
    }
    if (src.type === 'f' && dst.type === 'f') return { ok: false, error: '自由格之间不能互移' };
    if (src.type === 'd' && dst.type === 'd') return { ok: false, error: '基础堆之间不能互移' };

    const taken = takeFrom(src);
    if (taken.error) return { ok: false, error: taken.error };
    const cards = taken.cards;

    if (dst.type === 't') {
      const col = tableau[dst.i];
      if (!canPlaceOnColumn(cards[0], col)) {
        return { ok: false, error: '只能压在红黑交替、点数大 1 的牌上' };
      }
      if (cards.length > 1) {
        const info = movableInfo(col.length === 0);
        if (cards.length > info.limit) {
          return {
            ok: false,
            error: `最多只能整体搬 ${info.limit} 张（空自由格 ${info.emptyFree}、可用空列 ${info.emptyCols}）`,
          };
        }
      }
    } else if (dst.type === 'f') {
      if (freeCells[dst.i]) return { ok: false, error: '这个自由格已经占用' };
      if (cards.length !== 1) return { ok: false, error: '自由格一次只能放 1 张' };
    } else {
      if (cards.length !== 1) return { ok: false, error: '基础堆一次只能收 1 张' };
      const stack = foundations[dst.i];
      if (!canCollect(cards[0], stack)) {
        return { ok: false, error: '基础堆只能同花色 A→K 递增（空堆收 A）' };
      }
    }

    if (record) undoStack.push(snapshot());
    removeFrom(taken);
    let gained = 0;
    if (dst.type === 't') {
      for (const c of cards) tableau[dst.i].push({ ...c, up: true });
    } else if (dst.type === 'f') {
      freeCells[dst.i] = { ...cards[0], up: true };
    } else {
      foundations[dst.i].push({ ...cards[0], up: true });
      gained += CARD_SCORE;
    }
    if (src.type === 'd') gained -= FOUNDATION_TAKEBACK;
    score += gained;
    moves += 1;
    checkWin();
    return { ok: true, moved: cards.length, gained, score };
  }

  function doMove(srcStr, dstStr) {
    const src = parseSource(srcStr);
    const dst = parseDest(dstStr);
    if (!src || !dst) return { ok: false, error: '无效的移动指令' };
    return applyMove(src, dst, true);
  }

  /* ── 动作 ─────────────────────────────────────────────── */

  /** 自动收牌：反复把自由格与列顶能进基础堆的牌收进去，整段算一步 */
  function autoCollect() {
    if (won) return { ok: false, error: '本局已通关' };
    const before = undoStack.length;
    undoStack.push(snapshot());
    let collected = 0;
    let gained = 0;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const sources = [];
      for (let i = 0; i < FREE_CELL_COUNT; i++) {
        if (freeCells[i]) sources.push({ type: 'f', i });
      }
      for (let i = 0; i < COLUMNS; i++) {
        if (tableau[i].length) sources.push({ type: 't', i });
      }
      for (const src of sources) {
        const card = src.type === 'f' ? freeCells[src.i] : tableau[src.i][tableau[src.i].length - 1];
        if (!card) continue;
        let target = -1;
        for (let d = 0; d < FOUNDATION_COUNT; d++) {
          if (canCollect(card, foundations[d])) { target = d; break; }
        }
        if (target < 0) continue;
        const r = applyMove(src, { type: 'd', i: target }, false);
        if (r.ok) {
          collected += 1;
          gained += r.gained;
          progressed = true;
          break;
        }
      }
    }
    if (collected === 0) {
      undoStack.length = before; // 没有可收的牌，不留下空快照
      return { ok: false, error: '当前没有可自动收进基础堆的牌' };
    }
    return { ok: true, collected, gained };
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的步' };
    restore(undoStack.pop());
    return { ok: true };
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (action === 'undo') return undo();
    if (action === 'auto') return autoCollect();
    if (action.startsWith('move:')) {
      const rest = action.slice(5);
      const comma = rest.indexOf(',');
      if (comma < 0) return { ok: false, error: '无效的移动指令' };
      return doMove(rest.slice(0, comma), rest.slice(comma + 1));
    }
    return { ok: false, error: '未知动作' };
  }

  function step() {
    /* 回合制，无需按帧推进 */
  }

  function state() {
    const foundationCount = foundations.reduce((a, f) => a + f.length, 0);
    const emptyFree = freeCells.filter((c) => !c).length;
    const emptyCols = tableau.filter((col) => col.length === 0).length;
    return {
      turn: 'p1',
      tableau: tableau.map(cloneCards),
      freeCells: freeCells.map((c) => (c ? { ...c } : null)),
      foundations: foundations.map(cloneCards),
      score,
      moves,
      won,
      over: won,
      canUndo: undoStack.length > 0,
      undoDepth: undoStack.length,
      foundationCount,
      freeCellEmpty: emptyFree,
      emptyColumnCount: emptyCols,
      // 当前可整搬上限（不含目标是否为空列的修正，实际目标为空列时再降一档）
      maxMovable: (emptyFree + 1) * Math.pow(2, emptyCols),
    };
  }

  function result() {
    if (!won) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `52 张全部收进基础堆，得分 ${score}`,
    };
  }

  function reset() {
    build();
  }

  build();

  return { submit, step, state, result, reset };
}
