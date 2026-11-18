/**
 * 纸牌接龙（Klondike 玩法）· 纯逻辑。
 *
 * 关键事实与推导：
 * - 一副标准 52 张牌（4 花色 × 13 点数），洗牌只用注入的 createRng(seed)，不依赖任何全局随机源与墙钟；
 * - 7 列 tableau：第 i 列发 i+1 张（合计 28 张），只有最上一张翻开；
 * - 4 个 foundation：A→K 同花色递增；空 foundation 只收任意 A，之后锁定该花色；
 * - stock/waste：stock 末尾为"顶张"，draw 从末尾弹出压入 waste 末尾（waste 末尾为可打得牌）；
 *   stock 空且 waste 非空时 recycle 把 waste 逆序倒回 stock，循环顺序保持一致；
 * - tableau 可叠：目标为空只收 K，否则红黑交替且点数递减 1；
 * - 计分只认三件事：翻开 tableau 暗牌 +5、收一张进 foundation +10、从 foundation 取回 -15；
 * - 全部 52 张进 foundation 即胜；每次成功动作存一份完整快照供 undo（含自动收牌，合并为一步）。
 *
 * 动作（submit 第二参数，字符串）：
 *   'draw' | 'recycle' | 'move:src,dst' | 'auto' | 'undo'
 *   src: 'w' | 'f0..f3' | 't0..t6' | 'tN:k'（从该列第 k 张起抓整段翻开序列；省略 k 则只抓顶张）
 *   dst: 't0..t6' | 'f0..f3'
 *
 * 说明：shell 在本地模式给 playerId 传 0，故这里不校验 playerId，固定 turn='p1'。
 */
import { createRng } from '../../shared/rng.js';

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RED_SUITS = ['H', 'D'];
export const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

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

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], drawCount = 1 } = {}) {
  const initialSeed = seed >>> 0;
  const drawN = drawCount === 3 ? 3 : 1;
  let rng;
  let tableau;
  let foundations;
  let stock;
  let waste;
  let score;
  let moves;
  let won;
  let undoStack;

  function build() {
    rng = createRng(initialSeed);
    const deck = [];
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank, up: false });
    }
    const shuffled = rng.shuffle(deck);
    tableau = Array.from({ length: 7 }, () => []);
    let k = 0;
    for (let col = 0; col < 7; col++) {
      for (let j = 0; j <= col; j++) {
        const card = shuffled[k++];
        card.up = j === col; // 每列最后一张翻开
        tableau[col].push(card);
      }
    }
    stock = shuffled.slice(k).map((c) => ({ ...c, up: false }));
    waste = [];
    foundations = [[], [], [], []];
    score = 0;
    moves = 0;
    won = false;
    undoStack = [];
  }

  function cloneCards(arr) {
    return arr.map((c) => ({ ...c }));
  }

  function snapshot() {
    return {
      tableau: tableau.map(cloneCards),
      foundations: foundations.map(cloneCards),
      stock: cloneCards(stock),
      waste: cloneCards(waste),
      score,
      moves,
      won,
    };
  }

  function restore(s) {
    tableau = s.tableau.map(cloneCards);
    foundations = s.foundations.map(cloneCards);
    stock = cloneCards(s.stock);
    waste = cloneCards(s.waste);
    score = s.score;
    moves = s.moves;
    won = s.won;
  }

  function canStackTableau(card, targetCol) {
    if (!targetCol.length) return card.rank === 13; // 空列只放 K
    const top = targetCol[targetCol.length - 1];
    if (!top.up) return false;
    return card.rank === top.rank - 1 && isRed(card) !== isRed(top);
  }

  function canStackFoundation(card, foundation) {
    if (!foundation.length) return card.rank === 1; // 空槽只收 A
    const top = foundation[foundation.length - 1];
    return card.suit === top.suit && card.rank === top.rank + 1;
  }

  function parseSource(src) {
    if (src === 'w') return { type: 'w' };
    let m = /^f([0-3])$/.exec(src);
    if (m) return { type: 'f', i: Number(m[1]) };
    m = /^t([0-6])(?::(\d+))?$/.exec(src);
    if (m) return { type: 't', i: Number(m[1]), idx: m[2] == null ? null : Number(m[2]) };
    return null;
  }

  function parseDest(dst) {
    let m = /^t([0-6])$/.exec(dst);
    if (m) return { type: 't', i: Number(m[1]) };
    m = /^f([0-3])$/.exec(dst);
    if (m) return { type: 'f', i: Number(m[1]) };
    return null;
  }

  /** 取出一份待移动牌堆；返回 null 表示源不合法/无可移动牌 */
  function takeFrom(src) {
    if (src.type === 'w') {
      if (!waste.length) return null;
      return { cards: [waste[waste.length - 1]], from: 'w' };
    }
    if (src.type === 'f') {
      const f = foundations[src.i];
      if (!f.length) return null;
      return { cards: [f[f.length - 1]], from: 'f', fi: src.i };
    }
    const col = tableau[src.i];
    if (!col.length) return null;
    const start = src.idx == null ? col.length - 1 : src.idx;
    if (start < 0 || start >= col.length) return null;
    const run = col.slice(start);
    for (let x = 0; x < run.length; x++) {
      if (!run[x].up) return null;
      if (x > 0 && !(run[x].rank === run[x - 1].rank - 1 && isRed(run[x]) !== isRed(run[x - 1]))) {
        return null; // 不是合法交替递减序列
      }
    }
    return { cards: run, from: 't', ti: src.i, start };
  }

  function removeFrom(taken) {
    if (taken.from === 'w') waste.pop();
    else if (taken.from === 'f') foundations[taken.fi].pop();
    else tableau[taken.ti].length = taken.start;
  }

  function checkWin() {
    if (foundations.every((f) => f.length === 13)) won = true;
  }

  function doMove(srcStr, dstStr, silent = false) {
    const src = parseSource(srcStr);
    const dst = parseDest(dstStr);
    if (!src || !dst) return { ok: false, error: '无效的移动指令' };
    if (src.type === 'f' && dst.type === 'f') return { ok: false, error: '回收区之间不能互移' };
    if (src.type === dst.type && src.i === dst.i) return { ok: false, error: '不能移动到原位置' };

    const taken = takeFrom(src);
    if (!taken) return { ok: false, error: '源位置没有可移动的牌' };
    const cards = taken.cards;

    if (dst.type === 'f') {
      if (cards.length !== 1) return { ok: false, error: '每次只能收一张进回收区' };
      if (!canStackFoundation(cards[0], foundations[dst.i])) {
        return { ok: false, error: '这张牌不能放入回收区' };
      }
    } else if (!canStackTableau(cards[0], tableau[dst.i])) {
      return { ok: false, error: '目标列不能放置这组牌' };
    }

    if (!silent) undoStack.push(snapshot());

    removeFrom(taken);
    let gained = 0;
    if (dst.type === 'f') {
      foundations[dst.i].push({ ...cards[0], up: true });
      gained += 10;
    } else {
      for (const c of cards) tableau[dst.i].push({ ...c, up: true });
    }
    if (src.type === 'f') gained -= 15; // 从回收区取回罚分

    if (src.type === 't') {
      const col = tableau[taken.ti];
      if (col.length && !col[col.length - 1].up) {
        col[col.length - 1].up = true; // 翻开新暴露的暗牌
        gained += 5;
      }
    }

    score += gained;
    moves += 1;
    checkWin();
    return { ok: true, gained, count: cards.length };
  }

  function draw() {
    if (won) return { ok: false, error: '本局已通关' };
    if (!stock.length) return { ok: false, error: '牌堆已空，请先回收废牌堆' };
    undoStack.push(snapshot());
    let n = 0;
    while (n < drawN && stock.length) {
      waste.push({ ...stock.pop(), up: true });
      n++;
    }
    moves += 1;
    return { ok: true, drawn: n };
  }

  function recycle() {
    if (!waste.length) return { ok: false, error: '废牌堆为空' };
    if (stock.length) return { ok: false, error: '牌堆还有牌，不能回收' };
    undoStack.push(snapshot());
    stock = waste.slice().reverse().map((c) => ({ ...c, up: false }));
    waste = [];
    moves += 1;
    return { ok: true, recycled: stock.length };
  }

  /** 自动收牌：反复把 waste 顶张与各列顶张能进 foundation 的牌全部收进去，算一步 */
  function autoCollect() {
    if (won) return { ok: false, error: '本局已通关' };
    undoStack.push(snapshot());
    let collected = 0;
    let gained = 0;
    let moved = true;
    while (moved) {
      moved = false;
      const sources = [];
      if (waste.length) sources.push('w');
      for (let i = 0; i < 7; i++) {
        const col = tableau[i];
        if (col.length && col[col.length - 1].up) sources.push('t' + i);
      }
      for (const src of sources) {
        const taken = takeFrom(parseSource(src));
        if (!taken || taken.cards.length !== 1) continue;
        const card = taken.cards[0];
        let fi = -1;
        for (let i = 0; i < 4; i++) {
          if (canStackFoundation(card, foundations[i])) { fi = i; break; }
        }
        if (fi < 0) continue;
        const r = doMove(src, 'f' + fi, true); // 静默：整段自动收只占一个撤销步
        if (r.ok) {
          collected++;
          gained += r.gained;
          moved = true;
          break;
        }
      }
    }
    if (collected === 0) {
      undoStack.pop(); // 没有可收的牌，撤销栈不留空快照
      return { ok: false, error: '当前没有可自动回收的牌' };
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
    if (action === 'draw') return draw();
    if (action === 'recycle') return recycle();
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
    /* 回合驱动，无需按帧推进 */
  }

  function state() {
    return {
      turn: 'p1',
      tableau: tableau.map(cloneCards),
      foundations: foundations.map(cloneCards),
      stock: cloneCards(stock),
      waste: cloneCards(waste),
      score,
      moves,
      won,
      over: won,
      canUndo: undoStack.length > 0,
      undoDepth: undoStack.length,
      drawCount: drawN,
      stockCount: stock.length,
      foundationCount: foundations.reduce((a, f) => a + f.length, 0),
      wasteTop: waste.length ? { ...waste[waste.length - 1] } : null,
    };
  }

  function result() {
    if (!won) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `全部 52 张牌已回收，得分 ${score}`,
    };
  }

  function reset() {
    build();
  }

  build();

  return { submit, step, state, result, reset };
}
