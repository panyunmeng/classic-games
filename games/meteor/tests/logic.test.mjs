import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, W, H, wrapDistance } from '../logic.mjs';

/** 固定在左下角的"看门石"：防止清空判定触发下一波，且不在飞船/子弹弹道上 */
function keepRock() {
  return { x: 40, y: 600, size: 1, vx: 0, vy: 0 };
}

function speedOf(vx, vy) {
  return Math.hypot(vx, vy);
}

test('01 初始状态：turn/ship/陨石/分数/命/波次/冷却/可序列化', () => {
  const g = createGame({ seed: 1 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.over, false);
  assert.equal(s.score, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.wave, 1);
  assert.equal(s.fireCooldown, 0);
  assert.equal(s.maxBullets, 4);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.rocks.length, 4, '首波 4 块大石');
  assert.ok(s.rocks.every((r) => r.size === 3 && r.r > 0));
  assert.ok(s.rocks.every((r) => Math.abs(speedOf(r.vx, r.vy) - 24) < 1e-9), '首波基准速度 24 px/s');
  assert.equal(s.ship.x, W / 2);
  assert.equal(s.ship.y, H / 2);
  assert.ok(s.ship.invuln > 0, '开局有短暂保护');
  assert.equal(s.w, W);
  assert.equal(s.h, H);
  assert.ok(wrapDistance(0, 0, W - 1, H - 1) < 2, '环形距离跨接缝');
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('02 旋转与推进惯性：转向只改朝向、推进给加速度、松手无阻力漂移', () => {
  const g = createGame({ seed: 3 });
  g.debugSet({ rocks: [keepRock()], invuln: 2 });

  const a0 = g.state().ship.angle;
  for (let i = 0; i < 30; i++) g.step(1 / 60, ['right']);
  const turned = g.state().ship;
  assert.ok(turned.angle > a0, '右转角度增大');
  assert.equal(speedOf(turned.vx, turned.vy), 0, '只旋转不给速度');

  for (let i = 0; i < 30; i++) g.step(1 / 60, ['up']);
  const s1 = g.state();
  const sp1 = speedOf(s1.ship.vx, s1.ship.vy);
  assert.ok(sp1 > 100, `推进 0.5 s 后应获得速度，实际 ${sp1.toFixed(1)}`);
  const x0 = s1.ship.x;
  const y0 = s1.ship.y;

  for (let i = 0; i < 60; i++) g.step(1 / 60, []);
  const s2 = g.state();
  assert.ok(Math.abs(speedOf(s2.ship.vx, s2.ship.vy) - sp1) < 1e-9, '无阻力：速度大小不变');
  assert.ok(Math.abs(s2.ship.vx - s1.ship.vx) < 1e-9 && Math.abs(s2.ship.vy - s1.ship.vy) < 1e-9);
  const dx = s2.ship.x - x0;
  const dy = s2.ship.y - y0;
  const shiftedX = dx - W * Math.round(dx / W);
  const shiftedY = dy - H * Math.round(dy / H);
  assert.ok(Math.abs(shiftedX - s2.ship.vx) < 1e-6, '1 s 位移 = 速度 × 1 s');
  assert.ok(Math.abs(shiftedY - s2.ship.vy) < 1e-6);
});

test('03 子弹发射与 250 ms 冷却、同时最多 4 发、寿命到期消失', () => {
  const g = createGame({ seed: 5 });
  g.debugSet({ rocks: [keepRock()], bullets: [], fireCooldown: 0 });
  g.step(1 / 60, ['shoot']);
  let s = g.state();
  assert.equal(s.bullets.length, 1);
  assert.ok(s.fireCooldown > 0.2, '开火后进入冷却');
  assert.ok(s.bullets[0].vy < -400, '朝飞船朝向（开局向上）出膛');

  for (let i = 0; i < 5; i++) g.step(1 / 60, ['shoot']);
  assert.equal(g.state().bullets.length, 1, '冷却未结束不追加');

  for (let i = 0; i < 12; i++) g.step(1 / 60, ['shoot']);
  assert.ok(g.state().bullets.length >= 2, '冷却结束后继续出膛');

  let maxSeen = 0;
  for (let i = 0; i < 90; i++) {
    g.step(1 / 60, ['shoot']);
    maxSeen = Math.max(maxSeen, g.state().bullets.length);
  }
  assert.equal(maxSeen, 4, '同屏最多 4 发');

  for (let i = 0; i < 60; i++) g.step(1 / 60, []);
  assert.equal(g.state().bullets.length, 0, '子弹寿命到期后消失');
});

test('04 子弹命中陨石：大石被击碎成 2 块中石并计 20 分', () => {
  const g = createGame({ seed: 7 });
  g.debugSet({ rocks: [{ x: 240, y: 200, size: 3, vx: 0, vy: 0 }], bullets: [], fireCooldown: 0 });
  g.step(1 / 60, ['shoot']);
  for (let i = 0; i < 24; i++) g.step(1 / 60, []);
  const s = g.state();
  assert.equal(s.rocks.length, 2);
  assert.ok(s.rocks.every((r) => r.size === 2), '变成两块中石');
  assert.equal(s.score, 20);
  assert.equal(s.bullets.length, 0, '命中后子弹消失');
});

test('05 陨石分裂链：大→中×2→小×4→消失，分值 20/40/80', () => {
  const g = createGame({ seed: 11 });

  // 大石 → 2 中石
  g.debugSet({ rocks: [keepRock(), { x: 240, y: 200, size: 3, vx: 0, vy: 0 }], bullets: [], fireCooldown: 0 });
  g.step(1 / 60, ['shoot']);
  for (let i = 0; i < 20; i++) g.step(1 / 60, []);
  let s = g.state();
  assert.equal(s.rocks.length, 3, '看门石 + 2 中石');
  assert.equal(s.rocks.filter((r) => r.size === 2).length, 2);
  assert.equal(s.score, 20);

  // 中石 → 2 小石
  g.debugSet({ rocks: [keepRock(), { x: 240, y: 200, size: 2, vx: 0, vy: 0 }], bullets: [], fireCooldown: 0 });
  g.step(1 / 60, ['shoot']);
  for (let i = 0; i < 20; i++) g.step(1 / 60, []);
  s = g.state();
  assert.equal(s.rocks.filter((r) => r.size === 1).length, 3, '看门石 + 2 小石');
  assert.equal(s.score, 60, '20 + 40');

  // 小石 → 消失（只剩看门石，波次不变）
  g.debugSet({ rocks: [keepRock(), { x: 240, y: 200, size: 1, vx: 0, vy: 0 }], bullets: [], fireCooldown: 0 });
  g.step(1 / 60, ['shoot']);
  for (let i = 0; i < 20; i++) g.step(1 / 60, []);
  s = g.state();
  assert.equal(s.rocks.length, 1, '小石炸完不裂');
  assert.equal(s.wave, 1, '有看门石，不触发下一波');
  assert.equal(s.score, 140, '20 + 40 + 80');
});

test('06 清空一波进入下一波：更多、更大、更快', () => {
  const g = createGame({ seed: 2 });
  const first = g.state();
  const count1 = first.rocks.length;
  const r1 = Math.max(...first.rocks.map((r) => r.r));

  // 唯一一块小石，击碎即清屏
  g.debugSet({
    rocks: [{ x: 240, y: 200, size: 1, vx: 0, vy: 0 }],
    bullets: [],
    fireCooldown: 0,
    invuln: 2,
  });
  g.step(1 / 60, ['shoot']);
  for (let i = 0; i < 20; i++) g.step(1 / 60, []);
  const s = g.state();

  assert.equal(s.wave, 2, '进入第 2 波');
  assert.equal(s.rocks.length, count1 + 1, '陨石更多');
  assert.ok(s.rocks.every((r) => r.size === 3), '新一波重新从大石开始');
  assert.ok(s.rocks.every((r) => Math.abs(speedOf(r.vx, r.vy) - 32) < 1e-9), '基准速度 24 → 32');
  assert.ok(Math.max(...s.rocks.map((r) => r.r)) > r1, '半径随波次变大');
  assert.ok(s.waveTimer < 0.6, '波次计时重置');
  assert.equal(s.score, 80);
});

test('07 撞船减命：减 1 命、2 s 无敌、回到中心、被撞陨石碎裂', () => {
  const g = createGame({ seed: 4 });
  g.debugSet({
    invuln: 0,
    rocks: [{ x: 240, y: 320, size: 2, vx: 0, vy: 0 }],
    bullets: [],
  });
  g.step(1 / 60, []);
  let s = g.state();
  assert.equal(s.lives, 2, '撞石减一命');
  assert.equal(s.over, false);
  assert.ok(s.ship.invuln > 1.9, '获得 2 s 无敌');
  assert.equal(s.ship.x, 240);
  assert.equal(s.ship.y, 320);
  assert.equal(shipSpeed(s), 0, '重生后速度归零');
  assert.ok(
    s.rocks.every((r) => r.size === 1),
    '被撞的中石碎成小石，不会留在重生点'
  );

  // 无敌期内同一位置再摆一块石头，不再扣命
  g.debugSet({ rocks: [{ x: 240, y: 320, size: 2, vx: 0, vy: 0 }] });
  g.step(1 / 60, []);
  assert.equal(g.state().lives, 2, '无敌期免疫');
  assert.equal(g.state().over, false);
});

function shipSpeed(s) {
  return Math.hypot(s.ship.vx, s.ship.vy);
}

test('08 三命耗尽：over 置位，result 给出结算，之后 step 不再推进', () => {
  const g = createGame({ seed: 8 });
  for (let k = 0; k < 3; k++) {
    g.debugSet({ invuln: 0, bullets: [], rocks: [{ x: 240, y: 320, size: 3, vx: 0, vy: 0 }] });
    g.step(1 / 60, []);
  }
  const s = g.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);

  const r = g.result();
  assert.ok(r && r.over === true);
  assert.equal(r.winner, 'p1');
  assert.equal(r.score, 0);
  assert.equal(r.scores.p1, 0);

  const frozen = JSON.stringify(g.state());
  g.step(1, ['up', 'shoot']);
  assert.equal(JSON.stringify(g.state()), frozen, '结束后逻辑冻结');
});

test('09 边界环绕：飞船穿边、子弹跨接缝命中断言', () => {
  const g = createGame({ seed: 6 });
  g.debugSet({
    rocks: [keepRock()],
    bullets: [],
    invuln: 2,
    ship: { x: W - 4, y: 100, vx: 120, vy: 0, angle: 0 },
  });
  for (let i = 0; i < 10; i++) g.step(1 / 60, []);
  let s = g.state();
  assert.ok(s.ship.x < 40, `右边界应折回左侧，实际 x=${s.ship.x.toFixed(1)}`);

  // 子弹从 x≈88 向左飞，命中接缝另一侧 x=W-4 的小石
  g.debugSet({
    ship: { x: 100, y: 300, vx: 0, vy: 0, angle: Math.PI },
    invuln: 0,
    bullets: [],
    fireCooldown: 0,
    rocks: [{ x: W - 4, y: 300, size: 1, vx: 0, vy: 0 }],
  });
  g.step(1 / 60, ['shoot']);
  for (let i = 0; i < 20; i++) g.step(1 / 60, []);
  s = g.state();
  assert.equal(s.score, 80, '跨接缝命中计分');
  assert.equal(s.wave, 2, '打光后进入下一波');
  assert.equal(s.rocks.length, 5);
});

test('10 状态序列化 / 返回新对象 / reset 回到开局', () => {
  const g = createGame({ seed: 9 });
  const s = g.state();
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));

  s.score = 999;
  s.ship.x = -1;
  s.rocks.length = 0;
  assert.notEqual(g.state().score, 999);
  assert.notEqual(g.state().ship.x, -1);
  assert.ok(g.state().rocks.length > 0, '改返回值不影响内部状态');

  g.debugSet({ score: 500, lives: 1, wave: 3 });
  g.reset();
  const r = g.state();
  assert.equal(r.score, 0);
  assert.equal(r.lives, 3);
  assert.equal(r.wave, 1);
  assert.equal(r.over, false);
  assert.equal(r.bullets.length, 0);
  assert.equal(r.fireCooldown, 0);
  assert.equal(r.rocks.length, 4);
});

test('11 连走 3000 步不崩（含死亡后 start 重开）', () => {
  const g = createGame({ seed: 12345 });
  const seq = [['left'], ['up'], ['right'], ['up'], ['shoot'], [], ['shoot']];
  let restarts = 0;
  for (let i = 0; i < 3000; i++) {
    g.step(1 / 60, seq[i % seq.length]);
    if (i % 250 === 0) {
      const s = g.state();
      assert.ok(Number.isFinite(s.ship.x) && Number.isFinite(s.ship.y));
      assert.ok(Number.isFinite(s.ship.vx) && Number.isFinite(s.ship.vy));
      assert.ok(Number.isFinite(s.ship.angle));
      assert.ok(Number.isFinite(s.score));
      assert.ok(s.lives >= 0 && s.lives <= 3);
      assert.ok(s.bullets.length <= 4);
      assert.ok(s.rocks.length <= 40);
      assert.ok(s.wave >= 1);
      assert.equal(s.turn, 'p1');
    }
    if (g.state().over) {
      restarts += 1;
      assert.equal(g.submit('p1', 'start').ok, true);
    }
  }
  const end = g.state();
  assert.equal(end.over, false);
  assert.ok(Number.isFinite(speedOf(end.ship.vx, end.ship.vy)));
  assert.ok(restarts >= 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(end)));
});

test('12 start 动作：局中幂等、结束后重开；shoot 合法、未知动作被拒', () => {
  const g = createGame({ seed: 21 });
  assert.equal(g.submit('p1', 'start').ok, true, '局中 start 幂等');
  assert.equal(g.state().over, false);
  assert.equal(g.state().lives, 3);

  for (let k = 0; k < 3; k++) {
    g.debugSet({ invuln: 0, bullets: [], rocks: [{ x: 240, y: 320, size: 3, vx: 0, vy: 0 }] });
    g.step(1 / 60, []);
  }
  assert.equal(g.state().over, true);
  assert.equal(g.submit('p1', 'shoot').ok, false, '结束后不能再开火');
  assert.equal(g.submit('p1', 'start').ok, true);
  const s = g.state();
  assert.equal(s.over, false);
  assert.equal(s.lives, 3);
  assert.equal(s.wave, 1);
  assert.equal(s.score, 0);
  assert.equal(s.rocks.length, 4);

  assert.equal(g.submit('p1', 'shoot').ok, true);
  assert.equal(g.submit('p1', 'nope').ok, false);
  assert.equal(g.submit('p1', 42).ok, false);
});
