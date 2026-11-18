import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  H,
  PW,
  FLAP_VY,
  GRAVITY,
  BASE_SPEED,
  SPEED_STEP,
  MAX_SPEED,
  GAP,
  R,
} from '../logic.mjs';

const PLAYER_X = 130;
const STEP = 1 / 120;

function fresh(seed = 42) {
  return createGame({ seed });
}

/** 简单自动驾驶：把飞行器维持在最近管道缺口中心附近 */
function autopilot(g, maxFrames = 4000) {
  let flaps = 0;
  g.submit('p1', 'flap'); // 单键起飞：不先 flap 则 ready 阶段物理冻结
  flaps++;
  for (let i = 0; i < maxFrames; i++) {
    const s = g.state();
    if (s.over) break;
    const p = s.pipes.find((q) => q.x + PW > PLAYER_X);
    const target = p ? p.gapY : H / 2;
    if (s.player.y > target + 8) {
      g.submit('p1', 'flap');
      flaps++;
    }
    g.step(STEP);
  }
  return flaps;
}

test('01 初始状态：ready、未结束、分数 0、turn=p1', () => {
  const s = fresh().state();
  assert.equal(s.ready, true);
  assert.equal(s.over, false);
  assert.equal(s.score, 0);
  assert.equal(s.turn, 'p1');
  assert.equal(s.player.x, PLAYER_X);
  assert.equal(s.player.vy, 0);
  assert.ok(s.pipes.length > 0, '开局即预生成管道');
});

test('02 flap 给固定向上冲量，并结束 ready', () => {
  const g = fresh();
  const r = g.submit('p1', 'flap');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.ready, false);
  assert.equal(s.player.vy, FLAP_VY);
  // 再 flap 一次仍是同一个固定冲量，不累加
  g.submit('p1', 'flap');
  assert.equal(g.state().player.vy, FLAP_VY);
});

test('03 重力持续下拉：vy 递增，翻过上升段后 y 下落', () => {
  const g = fresh();
  g.submit('p1', 'flap');
  const vy0 = g.state().player.vy;
  const y0 = g.state().player.y;
  for (let i = 0; i < 12; i++) g.step(STEP);
  const s = g.state();
  assert.ok(s.player.vy > vy0, 'vy 单调向正向增加');
  assert.ok(Math.abs(s.player.vy - (FLAP_VY + GRAVITY * 12 * STEP)) < 1e-6);
  assert.ok(s.player.y < y0, '0.1 s 内冲量仍占优，先上升');
  // 继续飞行直到 vy 转正并越过顶点，确认重力最终使其下落
  for (let i = 0; i < 80; i++) g.step(STEP);
  const s2 = g.state();
  assert.ok(s2.player.vy > 0, '重力使 vy 转正');
  assert.ok(s2.player.y > s.player.y, '越顶后 y 下落');
});

test('04 起飞前物理冻结（ready 阶段不掉落）', () => {
  const g = fresh();
  const y0 = g.state().player.y;
  for (let i = 0; i < 200; i++) g.step(STEP);
  const s = g.state();
  assert.equal(s.ready, true);
  assert.equal(s.player.y, y0);
  assert.equal(s.over, false);
});

test('05 穿过管道得 1 分（自动驾驶至少过一根）', () => {
  const g = fresh();
  autopilot(g);
  const s = g.state();
  assert.ok(s.score >= 1, `期望穿管得分，实际 score=${s.score}`);
});

test('06 撞管道结束（且非地面/天花板）', () => {
  const g = fresh();
  const gapY = g.state().pipes[0].gapY;
  // 选一个落在缺口之外的目标高度
  const target = gapY > H / 2 ? gapY - (GAP / 2 + R + 20) : gapY + (GAP / 2 + R + 20);
  g.submit('p1', 'start');
  for (let i = 0; i < 4000; i++) {
    const s = g.state();
    if (s.over) break;
    if (s.player.y > target + 8) g.submit('p1', 'flap');
    g.step(STEP);
  }
  const s = g.state();
  assert.equal(s.over, true, '应撞上管道');
  assert.ok(s.player.y > R && s.player.y < H - R, '并非撞地面/天花板');
});

test('07 撞地面结束', () => {
  const g = fresh();
  g.submit('p1', 'start');
  for (let i = 0; i < 400; i++) {
    if (g.state().over) break;
    g.step(STEP);
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.ok(s.player.y + R >= H - 1e-6, '触地');
});

test('08 管道生成可复现：同种子同缺口序列，不同种子有差异', () => {
  const a = fresh(2024);
  const b = fresh(2024);
  for (let i = 0; i < 300; i++) {
    a.step(STEP);
    b.step(STEP);
  }
  assert.deepEqual(
    a.state().pipes.map((p) => p.gapY),
    b.state().pipes.map((p) => p.gapY),
  );
  const c = fresh(999);
  for (let i = 0; i < 300; i++) c.step(STEP);
  assert.notDeepEqual(
    a.state().pipes.map((p) => p.gapY),
    c.state().pipes.map((p) => p.gapY),
  );
});

test('09 固定步长可复现：step(0.1) 与 6×step(1/60) 得分与管道一致', () => {
  const a = fresh();
  const b = fresh();
  a.step(0.1);
  for (let i = 0; i < 6; i++) b.step(1 / 60);
  const sa = a.state();
  const sb = b.state();
  assert.equal(sa.score, sb.score);
  assert.equal(sa.over, sb.over);
  assert.deepEqual(
    sa.pipes.map((p) => p.gapY),
    sb.pipes.map((p) => p.gapY),
  );
  for (let i = 0; i < sa.pipes.length; i++) {
    assert.ok(Math.abs(sa.pipes[i].x - sb.pipes[i].x) < 1e-6, 'x 由滚动距离推出，与切分无关');
  }
});

test('10 速度随分数略增且 capped', () => {
  const g = fresh();
  assert.equal(g.state().speed, BASE_SPEED);
  g.submit('p1', 'start');
  autopilot(g, 12000);
  const s = g.state();
  if (s.score > 0) {
    assert.ok(s.speed >= BASE_SPEED && s.speed <= MAX_SPEED);
    assert.equal(s.speed, Math.min(MAX_SPEED, BASE_SPEED + s.score * SPEED_STEP));
  }
});

test('11 状态可 JSON 序列化，且 state() 返回新对象', () => {
  const g = fresh();
  g.submit('p1', 'flap');
  for (let i = 0; i < 30; i++) g.step(STEP);
  const s = g.state();
  const json = JSON.stringify(s);
  assert.ok(json.length > 0);
  const back = JSON.parse(json);
  assert.equal(back.turn, 'p1');
  assert.equal(back.score, s.score);
  assert.deepEqual(back.player, s.player);
  // 改动返回值不影响内部
  s.player.y = -999;
  s.pipes.length = 0;
  assert.notEqual(g.state().player.y, -999);
  assert.ok(g.state().pipes.length > 0);
});

test('12 reset 重开，连走 3000 步不崩且无 NaN', () => {
  const g = fresh();
  autopilot(g, 1000);
  g.reset();
  const s0 = g.state();
  assert.equal(s0.score, 0);
  assert.equal(s0.ready, true);
  assert.equal(s0.over, false);
  for (let i = 0; i < 3000; i++) {
    if (i % 17 === 0) g.submit('p1', 'flap');
    g.step(STEP);
    const s = g.state();
    assert.ok(Number.isFinite(s.player.y) && Number.isFinite(s.player.vy));
    if (s.over) break;
  }
  assert.ok(g.state().steps > 0);
});

test('13 非法动作与结束后动作被拒绝', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'nonsense').ok, false);
  g.submit('p1', 'start');
  for (let i = 0; i < 500; i++) g.step(STEP);
  assert.equal(g.state().over, true);
  assert.equal(g.submit('p1', 'flap').ok, false);
});
