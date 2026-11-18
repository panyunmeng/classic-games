/**
 * 蜘蛛纸牌（Spider 玩法，双花色）· 纯逻辑。
 *
 * 关键事实与推导：
 * - 牌数：104 张 = 2 花色（♠/♥）× 4 份 × A..K。双花色变体里每份花色都完整出现 4 次，
 *   因此整副牌恰好能排出 8 组同花色 K→A，收集满 8 组即胜。
 * - 发牌：10 列 tableau。首轮发 54 张（前 4 列各 6 张、后 6 列各 5 张，每列只有最上面一张翻开），
 *   余 50 张做发牌堆，正好 5 轮、每轮给每列各 1 张；发牌堆空即不可再发。
 * - 移动：一次只能搬「同花色且点数从上到下逐级减 1」的连续牌组（♠K♠Q♠J 可整体搬）；
 *   落点只要求目标顶牌点数比所搬牌组最上面那张大 1，花色不限（红黑交替不强制）；
 *   目标为空列时任意牌组或单牌都能放。
 * - 列顶翻暗牌：任何一次搬走牌组后，若源列新顶是暗牌就翻开。
 * - 收组：某列末尾 13 张恰好是同花色 K→A（递减到 A）时自动移除，+100 分；
 *   移动或发牌都可能凑成，移除后新顶暗牌同样翻开；可连续收（同一次动作里循环检查）。
 * - 计分：只有收组得分（每组 +100），步数单算。
 * - 随机：只用注入的 createRng(seed) 洗整副牌，不碰全局随机源与墙钟，
 *   同种子必得同一副牌（联机/回放/测试可复现）。
 *
 * 动作（submit 第二参数，字符串）：
 *   'stock'              发一轮（10 张，每列一张，全部翻开）
 *   'move:src,dst[,n]'   src/dst 形如 't0'..'t9'；n 省略时搬该列顶部最长的合法同花色序列
 *   'undo'               撤销上一步
 *
 * 说明：shell 在本地模式给 playerId 传 0，单人玩法不校验 playerId，turn 固定 'p1'。
 */
import { createRng } from '../../shared/rng.js';

export const SUITS = ['S', 'H'];
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
export const COLUMNS = 10;
export const COPIES = 4; // 每种花色 4 份
export const SET_SIZE = 13;
export const SETS_TO_WIN = 8;
export const CARD_SCORE = 100;
export const TOTAL_CARDS = SUITS.length * COPIES * SET_SIZE; // 104
export const STOCK_ROUND = COLUMNS; // 每轮给每列各 1 张

export function rankText(rank) {
  return RANK_LABEL[rank] || String(rank);
}

/** 牌的短标识，如 "A♠"、"10♥"，仅供展示/调试 */
export function cardText(card) {
  return `${rankText(card.rank)}${SUIT_SYMBOL[card.suit]}`;
}

/**
 * 从 col[start] 到列末是否构成可整体搬运的牌组：
 * 全部翻开、同花色、点数逐张减 1。
 */
export function isMovableRun(col, start) {
  if (!Array.isArray(col) || start < 0 || start >= col.length) return false;
  for (let i = start; i < col.length; i++) {
    if (!col[i].faceUp) return false;
    if (i > start) {
      const prev = col[i - 1];
      if (col[i].suit !== prev.suit || col[i].rank !== prev.rank - 1) return false;
    }
  }
  return true;
}

/** 列末最长可搬牌组的张数（0 表示顶部不是可搬的翻开牌组） */
export function movableRunLength(col) {
  const n = col.length;
  if (!n || !col[n - 1].faceUp) return 0;
  let start = n - 1;
  while (start > 0) {
    const up = col[start - 1];
    const low = col[start];
    if (!up.faceUp || up.suit !== low.suit || up.rank !== low.rank + 1) break;
    start--;
  }
  return n - start;
}

/** 列末 13 张若是同花色 K→A 完整序列，返回其起始下标；否则 -1 */
export function findCompleteSet(col) {
  const n = col.length;
  if (n < SET_SIZE) return -1;
  const start = n - SET_SIZE;
  const suit = col[start].suit;
  for (let i = 0; i < SET_SIZE; i++) {
    const c = col[start + i];
    if (!c.faceUp || c.suit !== suit || c.rank !== SET_SIZE - i) return -1;
  }
  return start;
}

function parseColumn(text) {
  const m = /^t([0-9])$/.exec(text);
  if (!m) return -1;
  const i = Number(m[1]);
  return i < COLUMNS ? i : -1;
}

export function createGame({
  seed = 1,
  mode = 'solo',
  players = ['p1'],
  level = 1,
  // 测试/回放用固定牌序（104 张，按发牌顺序排列）；正式对局不传。
  deck = null,
  // 测试/回放用固定桌面；正式对局不传。
  tableau: fixedTableau = null,
  stock: fixedStock = null,
} = {}) {
  const initialSeed = seed >>> 0;

  let tableau;
  let stockCards;
  let score;
  let completedSets;
  let moves;
  let won;
  let undoStack;

  function standardDeck() {
    const out = [];
    for (const suit of SUITS) {
      for (let copy = 0; copy < COPIES; copy++) {
        for (let rank = 1; rank <= SET_SIZE; rank++) out.push({ suit, rank, faceUp: false });
      }
    }
    return out;
  }

  function cloneCards(cards) {
    return cards.map((c) => ({ ...c }));
  }

  function snapshot() {
    return {
      tableau: tableau.map(cloneCards),
      stock: cloneCards(stockCards),
      score,
      completedSets,
      moves,
      won,
    };
  }

  function restore(s) {
    tableau = s.tableau.map(cloneCards);
    stockCards = cloneCards(s.stock);
    score = s.score;
    completedSets = s.completedSets;
    moves = s.moves;
    won = s.won;
  }

  function flipTop(col) {
    if (col.length && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true;
  }

  /** 收组：循环到没有完整序列为止；返回本次收掉的组数 */
  function collectSets() {
    let removed = 0;
    let again = true;
    while (again) {
      again = false;
      for (let i = 0; i < COLUMNS; i++) {
        const start = findCompleteSet(tableau[i]);
        if (start < 0) continue;
        tableau[i].splice(start, SET_SIZE);
        completedSets += 1;
        score += CARD_SCORE;
        removed += 1;
        flipTop(tableau[i]);
        again = true;
      }
    }
    if (completedSets >= SETS_TO_WIN) won = true;
    return removed;
  }

  function build() {
    score = 0;
    completedSets = 0;
    moves = 0;
    won = false;
    undoStack = [];
    tableau = Array.from({ length: COLUMNS }, () => []);
    stockCards = [];

    // 测试/回放：直接给定桌面与发牌堆（不洗牌），先结算桌上已存在的完整序列。
    if (Array.isArray(fixedTableau)) {
      for (let i = 0; i < COLUMNS; i++) {
        const col = Array.isArray(fixedTableau[i]) ? fixedTableau[i] : [];
        tableau[i] = col.map((c) => ({ suit: c.suit, rank: c.rank, faceUp: !!c.faceUp }));
      }
      if (Array.isArray(fixedStock)) {
        stockCards = fixedStock.map((c) => ({ suit: c.suit, rank: c.rank, faceUp: false }));
      }
      collectSets();
      return;
    }

    const rng = createRng(initialSeed);
    let cards;
    if (Array.isArray(deck) && deck.length === TOTAL_CARDS) {
      // 固定牌序：按发牌顺序给出，第一张先发到第 0 列。
      cards = deck.map((c) => ({ suit: c.suit, rank: c.rank, faceUp: false }));
    } else {
      cards = rng.shuffle(standardDeck()).map((c) => ({ ...c, faceUp: false }));
    }

    let k = 0;
    for (let i = 0; i < COLUMNS; i++) {
      const count = i < 4 ? 6 : 5; // 首轮 54 张：4×6 + 6×5
      const col = [];
      for (let j = 0; j < count; j++) col.push({ ...cards[k++], faceUp: false });
      col[col.length - 1].faceUp = true;
      tableau[i] = col;
    }
    stockCards = cards.slice(k).map((c) => ({ ...c, faceUp: false })); // 余 50 张 = 5 轮
    collectSets();
  }

  function deal() {
    if (won) return { ok: false, error: '本局已通关' };
    if (stockCards.length < STOCK_ROUND) return { ok: false, error: '发牌堆已空' };
    undoStack.push(snapshot());
    const round = stockCards.splice(0, STOCK_ROUND);
    for (let i = 0; i < COLUMNS; i++) tableau[i].push({ ...round[i], faceUp: true });
    moves += 1;
    const sets = collectSets();
    return { ok: true, dealt: STOCK_ROUND, sets };
  }

  function move(srcText, dstText, countText) {
    if (won) return { ok: false, error: '本局已通关' };
    const src = parseColumn(srcText);
    const dst = parseColumn(dstText);
    if (src < 0 || dst < 0) return { ok: false, error: '无效的列' };
    if (src === dst) return { ok: false, error: '不能移动到原列' };

    const col = tableau[src];
    if (!col.length) return { ok: false, error: '源列没有牌' };

    let n;
    if (countText == null) {
      n = movableRunLength(col);
      if (n === 0) return { ok: false, error: '该列顶部没有可移动的同花色序列' };
    } else {
      n = Number(countText);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: '移动张数无效' };
    }
    const start = col.length - n;
    if (start < 0) return { ok: false, error: '移动张数超过该列牌数' };
    if (!isMovableRun(col, start)) return { ok: false, error: '只能整体移动同花色连续递减序列' };

    const moving = col.slice(start);
    const target = tableau[dst];
    if (target.length) {
      const top = target[target.length - 1];
      if (!top.faceUp) return { ok: false, error: '目标列顶牌未翻开' };
      if (moving[0].rank !== top.rank - 1) return { ok: false, error: '只能放在点数大 1 的牌上' };
    }

    undoStack.push(snapshot());
    col.length = start;
    for (const c of moving) target.push({ ...c, faceUp: true });
    flipTop(col);
    moves += 1;
    const sets = collectSets();
    return { ok: true, moved: moving.length, sets };
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的步' };
    restore(undoStack.pop());
    return { ok: true };
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    const text = action.trim();
    if (text === 'stock') return deal();
    if (text === 'undo') return undo();
    if (text.startsWith('move:')) {
      const parts = text.slice(5).split(',');
      if (parts.length < 2 || parts.length > 3) return { ok: false, error: '无效的移动指令' };
      return move(parts[0], parts[1], parts[2]);
    }
    return { ok: false, error: '未知动作' };
  }

  function step() {
    /* 回合驱动，无需按帧推进 */
  }

  function state() {
    return {
      turn: 'p1',
      tableau: tableau.map((col) =>
        col.map((c) => ({ suit: c.suit, rank: c.rank, faceUp: c.faceUp })),
      ),
      stock: Math.floor(stockCards.length / STOCK_ROUND), // 剩余可发轮数
      stockCards: stockCards.length,
      score,
      completedSets,
      won,
      moves,
      over: won,
      canUndo: undoStack.length > 0,
      undoDepth: undoStack.length,
      setsToWin: SETS_TO_WIN,
    };
  }

  function result() {
    if (!won) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `8 组全部收齐，得分 ${score}`,
    };
  }

  function reset() {
    build();
  }

  build();

  return { submit, step, state, result, reset };
}
