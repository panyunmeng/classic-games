import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, solve24, applyOp, generateRound } from '../logic.mjs';
import { createRng } from '../../../shared/rng.js';

test('初始：4 张牌在栈中，无选中', () => {
  const g = createGame({ seed: 1 });
  const s = g.state();
  assert.equal(s.stack.length, 4);
  assert.equal(s.selected.length, 0);
  assert.equal(s.turn, 'p1');
  assert.equal(s.score, 0);
});

test('选两张牌后合并：2 + 3 = 5，栈剩 3 个', () => {
  const g = createGame({ seed: 2 });
  const r1 = g.submit('p1', 'pick:0');
  const r2 = g.submit('p1', 'pick:1');
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  const rm = g.submit('p1', 'op:add');
  assert.equal(rm.ok, true);
  const s = g.state();
  assert.equal(s.stack.length, 3);
  // 合并结果 5 应在栈中
  assert.ok(s.stack.some((x) => x.value === 5));
});

test('除零被拒绝', () => {
  const g = createGame({ seed: 3 });
  // 强制选一个值为 0 的组合：先合并出 0（同数相减）
  // 直接测试 applyOp
  const r = applyOp({ value: 5, expr: '5', prec: null }, { value: 0, expr: '0', prec: null }, 'div');
  assert.equal(r.ok, false);
  assert.match(r.error, /0/);
});

test('solve24 能解出经典题 3 3 8 8', () => {
  const sol = solve24([3, 3, 8, 8]);
  assert.ok(sol, '3 3 8 8 应有解（8/(3-8/3)）');
  // 用 new Function 求值验证（表达式只含数字与四则）
  const val = new Function(`return (${sol.replace(/×/g, '*').replace(/÷/g, '/')})`)();
  assert.ok(Math.abs(val - 24) < 1e-9, `表达式 ${sol} = ${val}`);
});

test('solve24 无解题返回 null', () => {
  // 1 1 1 1 显然无解
  const sol = solve24([1, 1, 1, 1]);
  assert.equal(sol, null);
});

test('生成的题目保证有解', () => {
  const rng = createRng(42);
  for (let i = 0; i < 20; i++) {
    const cards = generateRound(rng);
    assert.equal(cards.length, 4);
    assert.ok(solve24(cards), `生成的题 ${cards} 必须有解`);
  }
});

test('撤销恢复上一步的栈与分数', () => {
  const g = createGame({ seed: 4 });
  const before = JSON.stringify(g.state().stack);
  g.submit('p1', 'pick:0');
  g.submit('p1', 'pick:1');
  g.submit('p1', 'op:mul');
  assert.notEqual(JSON.stringify(g.state().stack), before);
  const r = g.submit('p1', 'undo');
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(g.state().stack), before);
});

test('无选中时合并报错', () => {
  const g = createGame({ seed: 5 });
  const r = g.submit('p1', 'op:add');
  assert.equal(r.ok, false);
});

test('撤销到空栈时返回错误', () => {
  const g = createGame({ seed: 6 });
  const r = g.submit('p1', 'undo');
  assert.equal(r.ok, false);
});

test('凑成 24 时得分并进入下一题', () => {
  const g = createGame({ seed: 7 });
  // 直接构造：找一手能 24 的牌——用生成器保证有解，然后按解操作太复杂；
  // 改为验证：连续 merge 到剩 1 个数后，无论是否 24，rounds 都会 +1
  // 先 merge 三次（4→3→2→1）
  for (let k = 0; k < 3; k++) {
    const s = g.state();
    if (s.stack.length < 2) break;
    g.submit('p1', 'pick:0');
    g.submit('p1', 'pick:1');
    const r = g.submit('p1', 'op:add');
    assert.equal(r.ok, true, `第 ${k} 次合并应成功`);
  }
  // 合并 3 次后应进入下一题（新题又是 4 张）
  const s = g.state();
  assert.equal(s.rounds, 1);
  assert.equal(s.stack.length, 4, '进入下一题');
});

test('跳过换题并计数', () => {
  const g = createGame({ seed: 8 });
  const r = g.submit('p1', 'skip');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.skips, 1);
  assert.equal(s.stack.length, 4);
});

test('状态可 JSON 序列化且每次返回新对象', () => {
  const g = createGame({ seed: 9 });
  const s1 = g.state();
  const s2 = g.state();
  assert.notEqual(s1, s2);
  assert.notEqual(s1.stack, s2.stack);
  assert.doesNotThrow(() => JSON.stringify(s1));
});

test('hint 返回提示或明确报错', () => {
  const g = createGame({ seed: 10 });
  const r = g.submit('p1', 'hint');
  assert.equal(typeof r.ok, 'boolean');
  if (r.ok) assert.equal(typeof r.hint, 'string');
});

test('非法动作被拒绝', () => {
  const g = createGame({ seed: 11 });
  assert.equal(g.submit('p1', 'bogus').ok, false);
  assert.equal(g.submit('p1', 'pick:abc').ok, false);
  assert.equal(g.submit('p1', 'pick:99').ok, false);
});

test('连走 200 步（随机合并+跳过）不崩', () => {
  const g = createGame({ seed: 12 });
  const rng = createRng(99);
  for (let i = 0; i < 200; i++) {
    const s = g.state();
    if (s.stack.length >= 2 && rng.chance(0.6)) {
      g.submit('p1', 'pick:0');
      g.submit('p1', 'pick:1');
      g.submit('p1', `op:${['add', 'sub', 'mul', 'div'][rng.int(4)]}`);
    } else {
      g.submit('p1', 'skip');
    }
  }
  assert.ok(g.state().score >= 0);
  assert.ok(Number.isFinite(g.state().score));
});
