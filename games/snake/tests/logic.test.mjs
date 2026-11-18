import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, COLS, ROWS } from '../logic.mjs';

function fresh() {
  return createGame({ seed: 42 });
}

test('初始状态：长度 3、分数 0、未结束', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.snake.length, 3);
  assert.equal(s.score, 0);
  assert.equal(s.over, false);
  assert.deepEqual(s.dir, { x: 1, y: 0 });
});

test('反向输入被拒绝，方向不变', () => {
  const g = fresh();
  const r = g.submit('p1', 'left');
  assert.equal(r.ok, false);
  g.step(0.2);
  assert.deepEqual(g.state().dir, { x: 1, y: 0 });
});

test('吃到食物加分并变长', () => {
  const g = fresh();
  const s0 = g.state();
  assert.ok(s0.food);
  // 把蛇头一步步走到食物位置
  const path = [];
  let head = s0.snake[0];
  let dir = { x: 1, y: 0 };
  while (head.x !== s0.food.x || head.y !== s0.food.y) {
    if (head.x < s0.food.x) {
      if (dir.x !== 1) g.submit('p1', 'right');
    } else if (head.x > s0.food.x) {
      if (dir.x !== -1) g.submit('p1', 'left');
    } else if (head.y < s0.food.y) {
      if (dir.y !== 1) g.submit('p1', 'down');
    } else if (head.y > s0.food.y) {
      if (dir.y !== -1) g.submit('p1', 'up');
    }
    g.step(0.2);
    head = g.state().snake[0];
    path.push(head);
    if (path.length > 400) break;
    if (g.state().over) break;
  }
  const s = g.state();
  assert.equal(s.over, false, '沿食物路径不应死亡');
  assert.ok(s.score >= 10, '至少吃到一次');
});

test('撞墙结束（穿墙关闭）', () => {
  const g = fresh();
  for (let i = 0; i < COLS + 5; i++) g.step(0.2);
  assert.equal(g.state().over, true);
});

test('开启穿墙后不会撞墙结束', () => {
  const g = fresh();
  g.setWrap(true);
  for (let i = 0; i < COLS + 5; i++) g.step(0.2);
  assert.equal(g.state().over, false);
});

test('结果对象包含分数与分数排行', () => {
  const g = fresh();
  for (let i = 0; i < COLS + 5; i++) g.step(0.2);
  const r = g.result();
  assert.ok(r);
  assert.equal(r.winner, 'p1');
  assert.equal(typeof r.score, 'number');
});

test('穿墙开关的读写一致', () => {
  const g = fresh();
  assert.equal(g.isWrap(), false);
  assert.equal(g.setWrap(true), true);
  assert.equal(g.isWrap(), true);
  assert.equal(g.state().wrap, true);
});

test('食物不会生成在蛇身上', () => {
  const g = fresh();
  const s = g.state();
  const occupied = new Set(s.snake.map((c) => `${c.x},${c.y}`));
  assert.equal(occupied.has(`${s.food.x},${s.food.y}`), false);
});

test('网格尺寸与逻辑常量一致', () => {
  const s = fresh().state();
  assert.equal(s.cols, COLS);
  assert.equal(s.rows, ROWS);
});
