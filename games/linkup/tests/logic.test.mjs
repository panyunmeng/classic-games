import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, findPath, isConnectable } from '../logic.mjs';

function fresh(opts = {}) {
  return createGame({ seed: 42, ...opts });
}

test('T1 初始状态：8x6 网格、24 对、每种图案成对、turn=p1、有解', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.cols, 8);
  assert.equal(s.rows, 6);
  assert.equal(s.board.length, 48);
  assert.equal(s.remain, 48);
  assert.equal(s.turn, 'p1');
  assert.equal(s.over, false);
  assert.equal(s.won, false);
  const counts = new Map();
  for (const v of s.board) counts.set(v, (counts.get(v) || 0) + 1);
  for (const [v, n] of counts) assert.equal(n % 2, 0, `图案 ${v} 应成对出现`);
  const h = g.submit('p1', 'hint');
  assert.equal(h.ok, true, '开局应至少有一对可连（有解）');
});

test('T2 直线连通（0 折，同一行相邻）', () => {
  const b = [1, 1, 2, 3]; // 2x2
  const path = findPath(b, 2, 2, 0, 1);
  assert.ok(path, '相邻同类应直线可连');
  assert.equal(isConnectable(b, 2, 2, 0, 1), true);
  // 直线仅两个端点 + 可能的中间格，拐弯数为 0（路径点共线）
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y);
  }
});

test('T3 一折连通（拐一次）', () => {
  // 3x3，两同类在对角，拐一次（经右下角空格）
  const b = [1, 0, 0, 0, 0, 0, 0, 0, 1];
  const path = findPath(b, 3, 3, 0, 8);
  assert.ok(path, '对角两端应能一折连通');
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const d1x = path[i - 1].x - path[i - 2].x;
    const d1y = path[i - 1].y - path[i - 2].y;
    const d2x = path[i].x - path[i - 1].x;
    const d2y = path[i].y - path[i - 1].y;
    if (d1x !== d2x || d1y !== d2y) turns++;
  }
  assert.equal(turns, 1, `拐弯数=${turns} 应为 1`);
});

test('T4 两折连通（绕行中间障碍）', () => {
  // 3x3，两端同行、中间被挡，需绕两折
  const b = [1, 9, 1, 9, 9, 9, 0, 0, 0];
  const path = findPath(b, 3, 3, 0, 2);
  assert.ok(path, '应能绕下两折连通');
  // 数一数方向改变次数 ≤ 2
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const d1x = path[i - 1].x - path[i - 2].x;
    const d1y = path[i - 1].y - path[i - 2].y;
    const d2x = path[i].x - path[i - 1].x;
    const d2y = path[i].y - path[i - 1].y;
    if (d1x !== d2x || d1y !== d2y) turns++;
  }
  assert.ok(turns <= 2, `拐弯数=${turns} 应 ≤ 2`);
});

test('T5 超两折（三折）不可连通', () => {
  // 构造一个必须 3 折的情况：两端在内部，四周被同一种障碍团团围住无法 2 折到达
  const b = [
    0, 0, 0, 0, 0,
    0, 9, 9, 9, 0,
    0, 9, 1, 9, 0,
    0, 9, 9, 9, 0,
    0, 0, 0, 1, 0,
  ];
  // a=12 被 9 包围（仅上方通路，但上方也是 9），实际它的可走方向全堵：
  // 上下左右是 9,9,9,9，连外圈都出不去 → 不可连
  assert.equal(isConnectable(b, 5, 5, 12, 24), false);
});

test('T6 消除：连通的两格被清空、加分、步数增加、计时重置', () => {
  const g = fresh();
  const s0 = g.state();
  const h = g.submit('p1', 'hint');
  assert.equal(h.ok, true);
  const [a, b] = h.pair;
  const r = g.submit('p1', `select:${a}`);
  assert.equal(r.ok, true);
  const r2 = g.submit('p1', `select:${b}`);
  assert.equal(r2.ok, true);
  const s = g.state();
  assert.equal(s.board[a], null);
  assert.equal(s.board[b], null);
  assert.equal(s.remain, 46);
  assert.equal(s.score, 100);
  assert.equal(s.turns, 1);
  assert.equal(s.timeLeft, s.stepTime);
});

test('T7 洗牌后仍有解，且图案多重集与占用格集合不变', () => {
  const g = fresh();
  const before = g.state().board;
  const occupied = before.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  const countBefore = new Map();
  for (const v of before) if (v != null) countBefore.set(v, (countBefore.get(v) || 0) + 1);
  const r = g.submit('p1', 'shuffle');
  assert.equal(r.ok, true);
  const after = g.state().board;
  const countAfter = new Map();
  for (const v of after) if (v != null) countAfter.set(v, (countAfter.get(v) || 0) + 1);
  assert.deepEqual([...countAfter].sort(), [...countBefore].sort());
  for (const i of occupied) assert.notEqual(after[i], null, '占用格集合应不变');
  const h = g.submit('p1', 'hint');
  assert.equal(h.ok, true, '洗牌后应仍有可连对');
});

test('T8 胜利：清空所有对后 over=true、won=true、result 胜', () => {
  const g = fresh();
  let guard = 0;
  while (!g.state().over && guard++ < 200) {
    const b = g.state().board;
    let pair = null;
    outer: for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        if (b[i] != null && b[i] === b[j] && findPath(b, 8, 6, i, j)) {
          pair = [i, j];
          break outer;
        }
      }
    }
    if (!pair) {
      // 偶尔需要用洗牌解开死局（提示不应被无限消耗）
      assert.equal(g.submit('p1', 'shuffle').ok, true);
      continue;
    }
    g.submit('p1', `select:${pair[0]}`);
    g.submit('p1', `select:${pair[1]}`);
  }
  const s = g.state();
  assert.equal(s.remain, 0);
  assert.equal(s.won, true);
  assert.equal(s.over, true);
  const r = g.result();
  assert.ok(r && r.winner === 'p1');
});

test('T9 非法选择：越界、非整数、空格式均被拒绝，不改状态', () => {
  const g = fresh();
  const before = g.state();
  assert.equal(g.submit('p1', 'select:-1').ok, false);
  assert.equal(g.submit('p1', 'select:999').ok, false);
  assert.equal(g.submit('p1', 'select:abc').ok, false);
  assert.equal(g.submit('p1', 'bogus').ok, false);
  const after = g.state();
  assert.deepEqual(after.board, before.board);
  assert.equal(after.selected, before.selected);
});

test('T10 状态序列化：JSON 往返后结构一致，state 返回新对象', () => {
  const g = fresh();
  const s = g.state();
  const copy = JSON.parse(JSON.stringify(s));
  assert.deepEqual(copy, s);
  const s2 = g.state();
  assert.notEqual(s, s2);
  s2.board[0] = -999;
  assert.notEqual(g.state().board[0], -999, '外部改 state 不应影响内部');
});

test('T11 计时超时判负，result 为负；step 不推进已结束局', () => {
  const g = fresh({ stepTime: 0.5 });
  g.step(0.3);
  assert.equal(g.state().over, false);
  g.step(0.3);
  assert.equal(g.state().over, true);
  assert.equal(g.state().won, false);
  const r = g.result();
  assert.ok(r && r.winner === 'p2');
  const t = g.state().timeLeft;
  g.step(10);
  assert.equal(g.state().timeLeft, t);
});

test('T12 提示消耗次数，用完后拒绝；不同图案改选不消除', () => {
  const g = fresh({ hints: 2 });
  const h1 = g.submit('p1', 'hint');
  assert.equal(h1.ok, true);
  assert.equal(g.state().hintLeft, 1);
  assert.ok(g.state().hintPair);
  assert.equal(g.submit('p1', 'hint').ok, true);
  assert.equal(g.state().hintLeft, 0);
  assert.equal(g.submit('p1', 'hint').ok, false);
  // 不同图案：找一对不同值的格
  const b = g.state().board;
  let x = -1;
  let y = -1;
  for (let i = 0; i < b.length && x < 0; i++) {
    for (let j = i + 1; j < b.length; j++) {
      if (b[i] != null && b[j] != null && b[i] !== b[j]) {
        x = i;
        y = j;
        break;
      }
    }
  }
  g.submit('p1', `select:${x}`);
  const r = g.submit('p1', `select:${y}`);
  assert.equal(r.ok, false);
  assert.equal(g.state().remain, 48, '不同图案不应消除');
  assert.equal(g.state().selected, y, '应改选到新格');
});
