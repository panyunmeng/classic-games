import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, bounceVelocity, W, H } from '../logic.mjs';

function fresh(seed = 7) {
  return createGame({ seed });
}

/** 造一块位于球正下方近处的砖，球向上运动即命中 */
function brickAt(x, y, extra = {}) {
  return {
    id: 'tb',
    x,
    y,
    w: 40,
    h: 20,
    color: '#fff',
    hp: 1,
    armor: 1,
    score: 10,
    ...extra,
  };
}

/** 场外保留砖，避免唯一砖被击碎后触发清关重置，干扰单场景断言 */
function keepBrick() {
  return { id: 'keep', x: -100, y: -100, w: 1, h: 1, color: '#fff', hp: 1, armor: 1, score: 0 };
}

test('01 初始状态：turn/命/分数/球粘板/砖块非空/可序列化', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.lives, 3);
  assert.equal(s.score, 0);
  assert.equal(s.over, false);
  assert.equal(s.stuck, true);
  assert.equal(s.level, 1);
  assert.ok(s.bricks.length > 0);
  assert.ok(s.ball);
  assert.equal(s.w, W);
  assert.equal(s.h, H);
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('02 球发射：submit launch 后球获得向上速度', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'launch').ok, true);
  const s = g.state();
  assert.equal(s.stuck, false);
  assert.ok(s.ball.vy < 0, '球应向上飞');
  assert.ok(Math.abs(s.ball.vx) > 0, '球带初始水平分量');
  assert.equal(g.submit('p1', 'launch').ok, false, '重复发射被拒绝');
});

test('03 挡板反弹角随落点变化（非镜像）', () => {
  const left = bounceVelocity(-1, 250);
  const mid = bounceVelocity(0, 250);
  const right = bounceVelocity(1, 250);
  assert.ok(left.vx < 0 && right.vx > 0, '左右落点产生相反横向速度');
  assert.ok(Math.abs(mid.vx) < 1e-9, '正中落点几乎垂直向上');
  assert.ok(Math.abs(left.vx) > Math.abs(bounceVelocity(-0.5, 250).vx), '越靠边角度越大');
  assert.ok(left.vy < 0 && mid.vy < 0 && right.vy < 0, '出射恒向上');
  // 与"入射角镜像"区分：同一反弹速度、不同落点 → 出射不同
  assert.notEqual(left.vx, right.vx);
});

test('04 击中砖块：击碎、加分、连击，砖块从状态移除', () => {
  const g = fresh();
  g.debugSet({
    bricks: [keepBrick(), brickAt(200, 300)],
    ball: { x: 220, y: 324, vx: 0, vy: -250 },
    stuck: false,
  });
  g.step(1 / 60);
  const s = g.state();
  assert.equal(s.bricks.length, 1, '目标砖被击碎，保留砖仍在');
  assert.equal(s.bricks[0].id, 'keep');
  assert.ok(s.score >= 10, '获得分数');
  assert.ok(s.combo >= 2, '连击累加');
});

test('05 装甲砖需两次击中才碎', () => {
  const g = fresh();
  g.debugSet({
    bricks: [keepBrick(), brickAt(200, 300, { hp: 2, armor: 2 })],
    ball: { x: 220, y: 324, vx: 0, vy: -250 },
    stuck: false,
  });
  g.step(1 / 60);
  let s = g.state();
  assert.equal(s.bricks.length, 2, '保留砖 + 装甲砖');
  assert.equal(s.bricks.find((b) => b.id === 'tb').hp, 1, '第一次只掉一层');
  assert.equal(s.score, 0, '未碎不得分');
  // 把球拉回砖下方再次向上命中
  g.debugSet({ ball: { x: 220, y: 324, vx: 0, vy: -250 } });
  g.step(1 / 60);
  s = g.state();
  assert.equal(s.bricks.length, 1, '装甲砖第二次击碎，只剩保留砖');
  assert.ok(s.score > 0);
});

test('06 道具生效：加宽挡板（widen）', () => {
  const g = fresh();
  const before = g.state().paddle.w;
  g.debugSet({
    bricks: [keepBrick()],
    powerups: [{ id: 'pw', kind: 'widen', x: 220, y: 580, w: 18, h: 18 }],
    stuck: false,
    ball: { x: 220, y: 400, vx: 0, vy: -250 },
  });
  // 道具落到挡板位置被接住
  for (let i = 0; i < 20; i++) g.step(1 / 60);
  const s = g.state();
  assert.ok(s.paddle.w > before, '挡板被加宽');
  assert.equal(s.powerups.length, 0, '道具被消耗');
});

test('07 道具生效：多球（multiball）与慢球（slow）', () => {
  const g = fresh();
  g.debugSet({
    bricks: [keepBrick()],
    powerups: [{ id: 'pm', kind: 'multiball', x: 220, y: 580, w: 18, h: 18 }],
    stuck: false,
    ball: { x: 220, y: 400, vx: 0, vy: -250 },
  });
  for (let i = 0; i < 20; i++) g.step(1 / 60);
  assert.ok(g.state().balls.length > 1, '多球生效');

  const g2 = fresh();
  g2.debugSet({
    bricks: [keepBrick()],
    stuck: false,
    ball: { x: 220, y: 300, vx: 100, vy: -200 },
  });
  const speedBefore = Math.hypot(g2.state().ball.vx, g2.state().ball.vy);
  g2.debugSet({ powerups: [{ id: 'ps', kind: 'slow', x: 220, y: 580, w: 18, h: 18 }] });
  for (let i = 0; i < 20; i++) g2.step(1 / 60);
  const s2 = g2.state();
  const speedAfter = Math.hypot(s2.ball.vx, s2.ball.vy);
  assert.ok(speedAfter < speedBefore, '慢球降低速度');
});

test('08 球落底减命，三命耗尽结束', () => {
  const g = fresh();
  g.debugSet({
    bricks: [keepBrick()],
    stuck: false,
    ball: { x: 40, y: H - 2, vx: 0, vy: 250 }, // 挡板左外侧、贴近底线，一步即越过
  });
  g.step(1 / 60);
  assert.equal(g.state().lives, 2, '落底减一命');
  assert.equal(g.state().over, false);

  // 再丢两次
  for (let k = 0; k < 2; k++) {
    g.debugSet({ stuck: false, ball: { x: 40, y: H - 2, vx: 0, vy: 250 } });
    g.step(1 / 60);
  }
  const s = g.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true, '三命耗尽结束');
  assert.ok(g.result() && g.result().over);
});

test('09 关卡清空进入下一关（砖块重新生成、球重新粘板）', () => {
  const g = fresh();
  g.debugSet({
    bricks: [brickAt(200, 300)], // 唯一砖：击碎后应触发清关
    ball: { x: 220, y: 324, vx: 0, vy: -250 },
    stuck: false,
  });
  g.step(1 / 60);
  const s = g.state();
  assert.equal(s.level, 2, '进入下一关');
  assert.ok(s.bricks.length > 0, '新关卡有砖块');
  assert.equal(s.stuck, true, '新关卡球粘板');
});

test('10 状态序列化 / 重置 / 连走 600 步不崩', () => {
  const g = fresh();
  const s = g.state();
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
  // state 是新对象：改返回值不影响内部
  s.score = 999;
  assert.notEqual(g.state().score, 999);

  for (let i = 0; i < 600; i++) g.step(1 / 60, i % 120 < 60 ? ['left'] : ['right']);
  assert.ok(Number.isFinite(g.state().score));
  assert.ok(g.state().lives >= 0);

  g.reset();
  const r = g.state();
  assert.equal(r.score, 0);
  assert.equal(r.lives, 3);
  assert.equal(r.over, false);
});

test('11 持续动作移动挡板，pointer 拖拽设置挡板中心', () => {
  const g = fresh();
  const x0 = g.state().paddle.x;
  for (let i = 0; i < 30; i++) g.step(1 / 60, ['right']);
  assert.ok(g.state().paddle.x > x0, '右键移动挡板');

  g.submit('p1', 'pointer:120');
  g.step(1 / 60);
  const s = g.state();
  assert.ok(Math.abs(s.paddle.x + s.paddle.w / 2 - 120) < 2, '挡板中心跟随 pointer');
});
