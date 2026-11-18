import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, HOLES, DURATION } from '../logic.mjs';

function fresh(seed = 42) {
  return createGame({ seed });
}

/** 推进到有地鼠冒出，返回其格位 */
function spawnOne(g) {
  for (let i = 0; i < 300; i++) {
    const idx = g.state().holes.findIndex((h) => h.active);
    if (idx >= 0) return idx;
    g.step(0.05);
  }
  return -1;
}

test('初始状态：9 洞全空、分数为 0、30 秒、未结束、turn=p1', () => {
  const s = fresh().state();
  assert.equal(s.holes.length, HOLES);
  assert.ok(s.holes.every((h) => h.active === false && h.type === null && h.timer === 0));
  assert.equal(s.score, 0);
  assert.equal(s.combo, 0);
  assert.equal(s.maxCombo, 0);
  assert.equal(s.timeLeft, DURATION);
  assert.equal(s.over, false);
  assert.equal(s.turn, 'p1');
});

test('地鼠按时出现：推进约 1.2s 后某洞 active 且 type=mole', () => {
  const g = fresh();
  let idx = -1;
  for (let i = 0; i < 40 && idx < 0; i++) {
    g.step(0.05);
    idx = g.state().holes.findIndex((h) => h.active);
  }
  assert.ok(idx >= 0, '应有地鼠冒出');
  const h = g.state().holes[idx];
  assert.equal(h.type, 'mole');
  assert.ok(h.timer > 0);
});

test('敲中加 10 分、combo 变 1、洞立即收回', () => {
  const g = fresh();
  const idx = spawnOne(g);
  assert.ok(idx >= 0);
  const r = g.submit('p1', `hit:${idx}`);
  assert.equal(r.ok, true);
  assert.equal(r.gain, 10);
  const s = g.state();
  assert.equal(s.score, 10);
  assert.equal(s.combo, 1);
  assert.equal(s.hits, 1);
  assert.equal(s.holes[idx].active, false);
});

test('连击加成：第二次命中 +12，分数 22，最高连击 2', () => {
  const g = fresh();
  const i1 = spawnOne(g);
  g.submit('p1', `hit:${i1}`);
  const i2 = spawnOne(g);
  const r = g.submit('p1', `hit:${i2}`);
  assert.equal(r.gain, 12);
  const s = g.state();
  assert.equal(s.score, 22);
  assert.equal(s.combo, 2);
  assert.equal(s.maxCombo, 2);
});

test('敲空断连但不扣分', () => {
  const g = fresh();
  const i1 = spawnOne(g);
  g.submit('p1', `hit:${i1}`);
  const empty = g.state().holes.findIndex((h) => !h.active);
  assert.ok(empty >= 0);
  const r = g.submit('p1', `hit:${empty}`);
  assert.equal(r.ok, true);
  assert.equal(r.miss, true);
  const s = g.state();
  assert.equal(s.combo, 0);
  assert.equal(s.score, 10);
  assert.equal(s.misses, 1);
});

test('漏鼠断连：地鼠 timer 到 0 自动缩回并断连', () => {
  const g = fresh();
  const i1 = spawnOne(g);
  g.submit('p1', `hit:${i1}`);
  for (let i = 0; i < 60 && g.state().misses === 0; i++) g.step(0.05);
  const s = g.state();
  assert.ok(s.misses >= 1);
  assert.equal(s.combo, 0);
});

test('计时结束：累计 30 秒后 over=true、timeLeft=0、结果带分数与最高连击', () => {
  const g = fresh();
  g.step(DURATION + 1);
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.timeLeft, 0);
  const r = g.result();
  assert.ok(r);
  assert.equal(r.over, true);
  assert.equal(r.winner, 'p1');
  assert.equal(r.score, s.score);
  assert.match(r.text, /最高连击/);
});

test("结束后拒绝敲击，'start' 幂等且非法动作被拒", () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'start').ok, true);
  assert.equal(g.submit('p1', 'hit:9').ok, false);
  assert.equal(g.submit('p1', 'hit:-1').ok, false);
  assert.equal(g.submit('p1', 'nonsense').ok, false);
  g.step(DURATION + 1);
  assert.equal(g.submit('p1', 'hit:0').ok, false);
});

test('状态序列化：JSON 往返后逐字段相等', () => {
  const g = fresh(7);
  const idx = spawnOne(g);
  g.submit('p1', `hit:${idx}`);
  const s = g.state();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('连走 2000 步并按命中随机敲打不崩', () => {
  const g = fresh(123);
  for (let i = 0; i < 2000; i++) {
    g.step(1 / 60);
    const s = g.state();
    const active = s.holes.findIndex((h) => h.active);
    if (active >= 0 && i % 3 === 0) g.submit('p1', `hit:${active}`);
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.ok(s.hits > 0);
  assert.ok(s.score > 0);
  assert.equal(g.result().score, s.score);
});

test('reset 回到开局状态', () => {
  const g = fresh();
  g.step(5);
  const idx = spawnOne(g);
  if (idx >= 0) g.submit('p1', `hit:${idx}`);
  g.reset();
  const s = g.state();
  assert.equal(s.score, 0);
  assert.equal(s.combo, 0);
  assert.equal(s.timeLeft, DURATION);
  assert.equal(s.over, false);
  assert.ok(s.holes.every((h) => !h.active));
});
