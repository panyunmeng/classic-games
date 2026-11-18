/**
 * 记忆翻牌 · 纯逻辑。
 *
 * 规则事实与推导：
 * - 难度 4×3(6 对) / 4×4(8 对) / 6×4(12 对)，牌堆 = 每符号 2 张，用 createRng(seed) 洗牌；
 * - 每次翻一张；翻到第二张构成一次"尝试"（steps+1）：
 *   · 相同 → 两张进入 matched（消除），score += 100；
 *   · 不同 → 保留 flipped=[i,j] 作为"待翻回"，由渲染层用 view.time 显示 0.75s 后翻回；
 *     逻辑层在**下一次 flip 到来时**先清掉这个待翻回状态（回合制没有 tick，不能靠定时器）。
 * - 全部配对完成 over=true；计时属于墙钟，逻辑层禁用 Date.now，故由 render 用 view.time 呈现；
 * - 撤销保存每次成功翻牌前的快照（含 matched/flipped/score/steps）。
 *
 * 注意 shell.submit 对本地模式传的 playerId 是数字 0，故这里不校验 playerId，只固定 turn='p1'。
 */
import { createRng } from '../../shared/rng.js';
import { levelConfig, boardLayout } from './layout.mjs';

export { LEVELS, boardLayout } from './layout.mjs';

const SYMBOLS = ['✦', '◆', '●', '▲', '■', '★', '♥', '✿', '⬟', '◇', '◈', '☾'];
const PAIR_SCORE = 100;

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const initialSeed = seed >>> 0;
  let rng;
  let cfg;
  let layout;
  let deck;
  let matched;
  let flipped;
  let score;
  let steps;
  let matchedPairs;
  let totalPairs;
  let over;
  let undoStack;

  function build() {
    cfg = levelConfig(level);
    layout = boardLayout(level, 480, 640);
    totalPairs = cfg.cols * cfg.rows / 2;
    rng = createRng(initialSeed);
    deck = [];
    for (let i = 0; i < totalPairs; i++) {
      deck.push(i % SYMBOLS.length, i % SYMBOLS.length);
    }
    deck = rng.shuffle(deck);
    matched = Array(layout.count).fill(false);
    flipped = [];
    score = 0;
    steps = 0;
    matchedPairs = 0;
    over = false;
    undoStack = [];
  }

  function snapshot() {
    return {
      matched: matched.slice(),
      flipped: flipped.slice(),
      score,
      steps,
      matchedPairs,
      over,
    };
  }

  function restore(s) {
    matched = s.matched.slice();
    flipped = s.flipped.slice();
    score = s.score;
    steps = s.steps;
    matchedPairs = s.matchedPairs;
    over = s.over;
  }

  function isMatch(a, b) {
    return deck[a] === deck[b];
  }

  function flip(index) {
    if (over) return { ok: false, error: '本局已完成' };
    if (!Number.isInteger(index) || index < 0 || index >= layout.count) {
      return { ok: false, error: '无效格子' };
    }
    if (matched[index]) return { ok: false, error: '这张牌已消除' };

    // 上一轮未匹配的两张在这里正式翻回（回合制没有 tick）
    if (flipped.length === 2) flipped = [];
    if (flipped.includes(index)) return { ok: false, error: '这张牌已经翻开' };

    undoStack.push(snapshot());
    flipped.push(index);

    if (flipped.length === 2) {
      steps += 1;
      const [a, b] = flipped;
      if (isMatch(a, b)) {
        matched[a] = true;
        matched[b] = true;
        matchedPairs += 1;
        score += PAIR_SCORE;
        flipped = [];
        if (matchedPairs === totalPairs) over = true;
        return { ok: true, kind: 'match', indices: [a, b], gained: PAIR_SCORE };
      }
      return { ok: true, kind: 'mismatch', indices: [a, b] };
    }
    return { ok: true, kind: 'flip', index };
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的步' };
    restore(undoStack.pop());
    return { ok: true };
  }

  function submit(playerId, action) {
    if (action === 'undo') return undo();
    if (typeof action === 'string' && action.startsWith('flip:')) {
      const raw = action.slice(5);
      if (!/^\d+$/.test(raw)) return { ok: false, error: '无效动作' };
      return flip(Number(raw));
    }
    if (typeof action === 'string' && action.startsWith('level:')) {
      const n = Number(action.slice(6));
      if (![1, 2, 3].includes(n)) return { ok: false, error: '无效难度' };
      if (n === level) return { ok: true };
      level = n;
      build();
      return { ok: true, level };
    }
    return { ok: false, error: '无效动作' };
  }

  function step() {
    /* 回合驱动，无需按帧推进 */
  }

  function state() {
    return {
      turn: 'p1',
      level,
      cols: cfg.cols,
      rows: cfg.rows,
      deck: deck.slice(),
      matched: matched.slice(),
      flipped: flipped.slice(),
      score,
      steps,
      matchedPairs,
      totalPairs,
      over,
      canUndo: undoStack.length > 0,
      undoDepth: undoStack.length,
      symbols: SYMBOLS.slice(),
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `全部 ${totalPairs} 对配对完成，用了 ${steps} 步`,
    };
  }

  function reset() {
    build();
  }

  build();

  return { submit, step, state, result, reset };
}
