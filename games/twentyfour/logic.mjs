/**
 * 24 点 · 纯逻辑。
 *
 * 规则事实：
 * - 每局 4 张 1～13 数字牌，用 + - × ÷ 与括号凑 24，每张恰好用一次；
 * - 玩家选两张数 → 选运算符 → 合并为一个新数（表达式随之拼接），直到剩一个数；
 * - 合并规则：每次二合一，n 张牌合并 n-1 次后剩 1 个数，与 24 比较（容差 1e-9）；
 * - 除法要求除数非 0；除不尽的结果保留分数（用浮点 + 容差比较，不约分）；
 * - 生成的题目保证至少一解（生成后用求解器验证）；
 * - 跳过换下一题；撤销回退一步合并。
 *
 * 表达式：每个数带一个字符串 expr，合并时按优先级决定是否加括号：
 *   合并 a 与 b（先算谁由调用顺序决定：(a op b)），低优先级子表达式加括号。
 */
import { createRng } from '../../shared/rng.js';

const EPS = 1e-9;
const TARGET = 24;
const OPS = ['add', 'sub', 'mul', 'div'];

/** 优先级：add/sub=1，mul/div=2 */
function prec(op) {
  return op === 'mul' || op === 'div' ? 2 : 1;
}

const SYMBOL = { add: '+', sub: '-', mul: '×', div: '÷' };

/**
 * 把两个数与表达式按 op 合并。
 * @returns {{ok:boolean, value?:number, expr?:string, error?:string}}
 */
export function applyOp(a, b, op) {
  if (!OPS.includes(op)) return { ok: false, error: '未知运算符' };
  let value;
  if (op === 'add') value = a.value + b.value;
  else if (op === 'sub') value = a.value - b.value;
  else if (op === 'mul') value = a.value * b.value;
  else {
    if (Math.abs(b.value) < EPS) return { ok: false, error: '不能除以 0' };
    value = a.value / b.value;
  }
  if (!Number.isFinite(value)) return { ok: false, error: '结果无效' };

  // 括号：子表达式优先级低于当前运算符时加括号；减/除的右操作数若同优先级也加
  const p = prec(op);
  const wrap = (e, side) => {
    const ep = e.prec;
    if (ep === null) return e.expr; // 单个数字不加
    let need = ep < p;
    if (op === 'sub' && side === 'right') need = ep <= p;
    if (op === 'div' && side === 'right') need = ep <= p;
    return need ? `(${e.expr})` : e.expr;
  };
  const expr = `${wrap(a, 'left')} ${SYMBOL[op]} ${wrap(b, 'right')}`;

  return { ok: true, value, expr, prec: p };
}

/**
 * 求解器：给定 4 个数，返回一个能凑 24 的表达式（不存在返回 null）。
 * 穷举：每次取两个数合并（含交换），递归到剩一个数。
 */
export function solve24(nums) {
  const targets = [];

  function rec(values) {
    if (values.length === 1) {
      if (Math.abs(values[0].value - TARGET) < EPS) targets.push(values[0].expr);
      return;
    }
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const a = values[i];
        const b = values[j];
        const rest = values.filter((_, k) => k !== i && k !== j);
        for (const op of OPS) {
          // a op b 与 b op a 都试（减/除不交换）
          const variants = op === 'add' || op === 'mul' ? [[a, b]] : [[a, b], [b, a]];
          for (const [x, y] of variants) {
            const r = applyOp(x, y, op);
            if (!r.ok) continue;
            rec([...rest, { value: r.value, expr: r.expr, prec: r.prec }]);
            if (targets.length > 0) return; // 找到一个就够
          }
        }
      }
    }
  }

  rec(nums.map((n) => ({ value: n, expr: String(n), prec: null })));
  return targets[0] || null;
}

/** 生成一副保证有解的 4 张牌 */
export function generateRound(rng) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const cards = [];
    for (let i = 0; i < 4; i++) cards.push(1 + rng.int(13));
    if (solve24(cards)) return cards;
  }
  // 极端兜底：24 的平凡拆解（几乎不可能走到）
  return [6, 4, 2, 2];
}

export function createGame({ seed = 1 } = {}) {
  const rng = createRng(seed);
  let cards;
  let stack; // [{value, expr, prec}] 已合并的数与单牌
  let selected; // stack 中被选中的索引
  let history; // 撤销栈：每步 {stack, score, streak}
  let score;
  let streak;
  let rounds;
  let skips;
  let over;
  let solved;

  function reset() {
    cards = generateRound(rng);
    stack = cards.map((n) => ({ value: n, expr: String(n), prec: null }));
    selected = [];
    history = [];
    // score/streak/rounds 跨题保留，reset 是「重开整局」
    score = 0;
    streak = 0;
    rounds = 0;
    skips = 0;
    over = false;
    solved = false;
    newRound();
  }

  function newRound() {
    cards = generateRound(rng);
    stack = cards.map((n) => ({ value: n, expr: String(n), prec: null }));
    selected = [];
    history = [];
  }

  function pick(index) {
    if (typeof index !== 'number' || index < 0 || index >= stack.length) {
      return { ok: false, error: '无效选择' };
    }
    const at = selected.indexOf(index);
    if (at >= 0) {
      selected.splice(at, 1); // 取消选中
      return { ok: true };
    }
    selected.push(index);
    if (selected.length > 2) selected.shift(); // 最多同时选两个
    return { ok: true };
  }

  function merge(op) {
    if (selected.length !== 2) return { ok: false, error: '先选两张牌' };
    const [i, j] = selected;
    // 按选择顺序合并：先点的在左
    const order = i < j ? [i, j] : [j, i];
    // selected 数组保存了点选顺序，用它
    const [ia, ib] = selected;
    const a = stack[ia];
    const b = stack[ib];
    const r = applyOp(a, b, op);
    if (!r.ok) return { ok: false, error: r.error };

    history.push({ stack: stack.map((s) => ({ ...s })), score, streak });

    const merged = { value: r.value, expr: r.expr, prec: r.prec };
    const next = stack.filter((_, k) => k !== ia && k !== ib);
    next.push(merged);
    stack = next;
    selected = [];

    if (stack.length === 1) finishRound();
    return { ok: true };
  }

  function finishRound() {
    rounds += 1;
    if (Math.abs(stack[0].value - TARGET) < EPS) {
      solved = true;
      streak += 1;
      score += 100 + Math.min(streak - 1, 5) * 20;
      // 命中后自动进入下一题（过 800ms 由渲染层表现，逻辑直接换）
      newRound();
      return { ok: true, hit: true };
    }
    // 没凑成：连击清零，等玩家撤销或跳过
    streak = 0;
    over = false;
    return { ok: true, hit: false };
  }

  function undo() {
    if (!history.length) return { ok: false, error: '没有可撤销的步' };
    const snap = history.pop();
    stack = snap.stack;
    score = snap.score;
    streak = snap.streak;
    selected = [];
    return { ok: true };
  }

  function skip() {
    skips += 1;
    streak = 0;
    history = [];
    if (rounds >= 100) {
      over = true;
      return { ok: true };
    }
    newRound();
    return { ok: true };
  }

  function hint() {
    // 用求解器给当前 stack（可能是已合并的部分）找 24 —— 只对 4 张原始牌有意义，
    // 简化：对当前 stack 的所有数求解，返回提示表达式（不消耗）
    const nums = stack.map((s) => s.value);
    if (nums.length < 2) return { ok: false, error: '没有可提示的局面' };
    // 求解器只处理 4 个数；对已合并局面，退化为「提示下一步」：
    // 枚举当前可合并的两数与四运算符，找一个合并后仍可解的方向
    for (let i = 0; i < stack.length; i++) {
      for (let j = 0; j < stack.length; j++) {
        if (i === j) continue;
        for (const op of OPS) {
          const r = applyOp(stack[i], stack[j], op);
          if (!r.ok) continue;
          const rest = stack.filter((_, k) => k !== i && k !== j).map((s) => s.value);
          const all = [...rest, r.value];
          if (all.length === 4 && solve24(all)) {
            return { ok: true, hint: `先算 ${stack[i].expr} ${SYMBOL[op]} ${stack[j].expr}` };
          }
          if (all.length === 1 && Math.abs(all[0] - TARGET) < EPS) {
            return { ok: true, hint: `最后算 ${r.expr}` };
          }
        }
      }
    }
    return { ok: false, error: '当前局面提示不可用，试试撤销或跳过' };
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    const [head, arg] = action.split(':');
    switch (head) {
      case 'pick': {
        const idx = Number(arg);
        if (!Number.isInteger(idx)) return { ok: false, error: '无效选择' };
        return pick(idx);
      }
      case 'op':
        return merge(arg);
      case 'undo':
        return undo();
      case 'skip':
        return skip();
      case 'hint':
        return hint();
      case 'start':
        return { ok: true };
      default:
        return { ok: false, error: '未知动作' };
    }
  }

  function step() {
    /* 回合制，无需按帧推进 */
  }

  function state() {
    return {
      turn: 'p1',
      stack: stack.map((s) => ({ ...s })),
      selected: selected.slice(),
      score,
      streak,
      rounds,
      skips,
      over,
      solved,
      target: TARGET,
      historyDepth: history.length,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `完成 ${rounds} 题，得分 ${score}`,
    };
  }

  reset();

  return { submit, step, state, result, reset, skip, undo, hint };
}
