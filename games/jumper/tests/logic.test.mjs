import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  MAX_VX,
  PERFECT_R,
  SCORE_STEP,
  PERFECT_BONUS,
  CHARGE_RATE,
  GAP_MAX,
  MIN_W,
  GRAVITY,
  JUMP_VY,
} from '../logic.mjs';

/* ── 工具：按目标力度蓄力 / 起跳并结算到落地 ─────────────── */

function chargeTo(g, target, dt = 1 / 240) {
  let guard = 0;
  while (!g.state().over && guard < 6000) {
    const s = g.state();
    if (s.player.power >= target - 0.05) break;
    if (s.chargeDir === -1 && s.player.power < target) break; // 已过峰值，别再等
    g.step(dt, ['charge']);
    guard += 1;
  }
  return g.state();
}

function settle(g, dt = 1 / 240, maxSteps = 2000) {
  let guard = 0;
  while (!g.state().over && !g.state().player.onGround && guard < maxSteps) {
    g.step(dt, []);
    guard += 1;
  }
  return g.state();
}

/** 新开一局，蓄力到 target，松开，结算落地；返回该局与落地后的 state */
function jumpOnce(seed, target) {
  const g = createGame({ seed });
  g.submit('p1', 'start');
  chargeTo(g, target);
  if (g.state().over) return { g, s: g.state() };
  g.submit('p1', 'release');
  return { g, s: settle(g) };
}

/** 连续两跳：新开一局，按 t1/t2 蓄力起跳落地 */
function jumpTwice(seed, t1, t2) {
  const g = createGame({ seed });
  g.submit('p1', 'start');
  chargeTo(g, t1);
  if (g.state().over) return g.state();
  g.submit('p1', 'release');
  let s = settle(g);
  if (s.over || !s.player.onGround) return s;
  chargeTo(g, t2);
  if (g.state().over) return g.state();
  g.submit('p1', 'release');
  return settle(g);
}

/** 扫描力度找一次「落到下一个平台」的起跳 */
function scanLanding(seed, pick) {
  const hits = [];
  for (let t = 5; t <= 100; t += 1) {
    const { s } = jumpOnce(seed, t);
    if (s.lastLand && s.lastLand.scored) hits.push({ t, s });
  }
  if (!pick) return hits;
  return pick(hits);
}

/* ── 1. 初始状态 ─────────────────────────────────────────── */

test('初始状态：ready、p1 回合、站在起始平台、平台链已生成', () => {
  const s = createGame({ seed: 42 }).state();
  assert.equal(s.ready, true);
  assert.equal(s.turn, 'p1');
  assert.equal(s.score, 0);
  assert.equal(s.combo, 0);
  assert.equal(s.over, false);
  assert.equal(s.player.onGround, true);
  assert.equal(s.player.charging, false);
  assert.equal(s.player.power, 0);
  assert.ok(s.platforms.length >= 4, '至少起始平台 + 3 个待跳平台');
  assert.equal(s.platforms[0].id, 0);
  assert.equal(s.platforms[0].next, false);
  assert.equal(s.platforms[1].next, true);
  // 角色站在起始平台顶面
  assert.ok(Math.abs(s.player.y + s.r - s.platforms[0].y) < 1e-6);
  assert.ok(Math.abs(s.player.x - (s.platforms[0].x + s.platforms[0].w / 2)) < 1e-6);
});

/* ── 2. 蓄力累积与封顶 ───────────────────────────────────── */

test('蓄力累积：按 1.2 s 到满且永不超过 100', () => {
  const g = createGame({ seed: 7 });
  g.submit('p1', 'start');
  let maxPower = 0;
  let prev = 0;
  for (let i = 0; i < 300; i++) {
    g.step(1 / 240, ['charge']);
    const p = g.state().player.power;
    assert.ok(p >= 0 && p <= 100, `power 必须落在 [0,100]，实测 ${p}`);
    if (i < 288) assert.ok(p >= prev, '未满时力度单调上升');
    maxPower = Math.max(maxPower, p);
    prev = p;
  }
  assert.ok(maxPower >= 99.9, `1.2 s 应到满，实测峰值 ${maxPower}`);
  assert.ok(maxPower <= 100);
  // 蓄满用时与常量一致（容差一个步长）
  const g2 = createGame({ seed: 7 });
  g2.submit('p1', 'start');
  let n = 0;
  let peak = 0;
  let peakAt = 0;
  while (n < 400) {
    g2.step(1 / 240, ['charge']);
    n += 1;
    const p = g2.state().player.power;
    if (p > peak) {
      peak = p;
      peakAt = n;
    }
  }
  assert.ok(peak >= 99.9, `峰值 ${peak}`);
  const seconds = peakAt / 240;
  assert.ok(Math.abs(seconds - 100 / CHARGE_RATE) <= 1 / 240 + 1e-9, `蓄满用时 ${seconds}s`);
});

/* ── 3. 蓄满后回弹 ───────────────────────────────────────── */

test('蓄满后回弹：继续按住力度下降并反向', () => {
  const g = createGame({ seed: 7 });
  g.submit('p1', 'start');
  for (let i = 0; i < 292; i++) g.step(1 / 240, ['charge']); // 1.2167 s，刚过蓄满
  const full = g.state();
  assert.ok(full.player.power > 98, `到顶附近，实测 ${full.player.power}`);
  assert.equal(full.chargeDir, -1, '到顶后方向翻转为回落');

  for (let i = 0; i < 144; i++) g.step(1 / 240, ['charge']); // 0.6 s
  const half = g.state();
  assert.ok(half.player.power > 42 && half.player.power < 60, `回落到约 50，实测 ${half.player.power}`);

  for (let i = 0; i < 144; i++) g.step(1 / 240, ['charge']); // 再 0.6 s
  const low = g.state();
  assert.ok(low.player.power < 10, `回到近 0，实测 ${low.player.power}`);
  assert.equal(low.chargeDir, 1, '落底后再次反向');
});

/* ── 4. 起跳速度与蓄力成正比 ─────────────────────────────── */

test('松开起跳：水平速度 = 力度 × 方向，且与蓄力成正比', () => {
  function vxAt(target) {
    const g = createGame({ seed: 11 });
    g.submit('p1', 'start');
    chargeTo(g, target);
    const before = g.state().player.power;
    const res = g.submit('p1', 'release');
    assert.equal(res.ok, true);
    const s = g.state();
    assert.equal(s.player.onGround, false);
    assert.ok(s.player.vy < 0, '起跳后竖直速度向上');
    assert.ok(Math.abs(s.player.vx - (before / 100) * MAX_VX) < 1e-6, 'vx 由力度线性决定');
    return s.player.vx;
  }
  const v25 = vxAt(25);
  const v50 = vxAt(50);
  const v80 = vxAt(80);
  assert.ok(Math.abs(v25 - 0.25 * MAX_VX) < 5);
  assert.ok(Math.abs(v50 - 0.5 * MAX_VX) < 5);
  assert.ok(Math.abs(v80 - 0.8 * MAX_VX) < 5);
  assert.ok(Math.abs(v50 / v25 - 2) < 0.06, `50/25 力度速度比 ${v50 / v25}`);
  assert.ok(Math.abs(v80 / v25 - 3.2) < 0.1, `80/25 力度速度比 ${v80 / v25}`);
});

test('方向决定水平速度的符号', () => {
  const g = createGame({ seed: 11 });
  g.submit('p1', 'start');
  g.submit('p1', 'direction:left');
  chargeTo(g, 50);
  g.submit('p1', 'release');
  assert.ok(g.state().player.vx < 0);

  const g2 = createGame({ seed: 11 });
  g2.submit('p1', 'start');
  g2.submit('p1', 'direction:right');
  chargeTo(g2, 50);
  g2.submit('p1', 'release');
  assert.ok(g2.state().player.vx > 0);
});

/* ── 5. 抛物线飞出去并落到下一个平台得分 ─────────────────── */

test('抛物线落到下一个平台：+10 分且目标平台前移', () => {
  const hits = scanLanding(42);
  assert.ok(hits.length > 0, '力度扫描中应存在能落到下一平台的解');
  const { s } = hits[0];
  assert.equal(s.over, false);
  assert.equal(s.player.onGround, true);
  assert.equal(s.lastLand.scored, true);
  assert.equal(s.lastLand.id, 1, '第一次起跳应落到 id=1 的平台');
  assert.ok(s.score === SCORE_STEP || s.score === SCORE_STEP + PERFECT_BONUS, `得分 ${s.score}`);
  assert.equal(s.nextId, 2);
  assert.equal(s.player.power, 0, '落地后力度清零');
  // 飞行过程中确实是抛物线：先升后降
  const g = createGame({ seed: 42 });
  g.submit('p1', 'start');
  chargeTo(g, 45);
  g.submit('p1', 'release');
  let sawRise = false;
  let sawFall = false;
  for (let i = 0; i < 400 && !g.state().over && !g.state().player.onGround; i++) {
    g.step(1 / 120, []);
    const p = g.state().player;
    if (p.vy < 0) sawRise = true;
    if (sawRise && p.vy > 0) sawFall = true;
  }
  assert.ok(sawRise && sawFall, '应有上升段与下降段');
});

/* ── 6. 完美落点加成 ─────────────────────────────────────── */

test('完美落点（平台中心）：额外 +5 并累加 combo', () => {
  const hits = scanLanding(42);
  assert.ok(hits.length > 0);
  const best = hits.reduce((a, b) =>
    Math.abs(a.s.lastLand.dx) <= Math.abs(b.s.lastLand.dx) ? a : b,
  );
  assert.ok(Math.abs(best.s.lastLand.dx) <= PERFECT_R, `最近的落点应落在完美区，dx=${best.s.lastLand.dx}`);
  assert.equal(best.s.lastLand.perfect, true);
  assert.equal(best.s.score, SCORE_STEP + PERFECT_BONUS);
  assert.equal(best.s.combo, 1);
  assert.equal(best.s.perfects, 1);
});

test('连续两次完美落点：combo 累加、分数继续叠加', () => {
  // 第一跳找完美解
  const first = scanLanding(42);
  const best1 = first.reduce((a, b) =>
    Math.abs(a.s.lastLand.dx) <= Math.abs(b.s.lastLand.dx) ? a : b,
  );
  assert.equal(best1.s.lastLand.perfect, true);

  let best2 = null;
  for (let t = 5; t <= 100; t += 1) {
    const s = jumpTwice(42, best1.t, t);
    // 必须真的完成第二跳并落在下一个平台（id 2）上，否则 lastLand 还是第一跳的
    if (s.landings !== 2 || !s.lastLand) continue;
    if (s.lastLand.id !== 2 || !s.lastLand.scored || !s.lastLand.perfect) continue;
    if (!best2 || Math.abs(s.lastLand.dx) < Math.abs(best2.s.lastLand.dx)) best2 = { t, s };
  }
  assert.ok(best2, '第二跳应存在落在下一平台的完美解');
  assert.equal(best2.s.score, (SCORE_STEP + PERFECT_BONUS) * 2);
  assert.equal(best2.s.combo, 2);
  assert.equal(best2.s.perfects, 2);
  assert.equal(best2.s.nextId, 3);
});

test('非完美落点把 combo 归零', () => {
  const hits = scanLanding(42);
  const bad = hits.find((h) => !h.s.lastLand.perfect);
  assert.ok(bad, '应存在非完美的落地点');
  assert.equal(bad.s.combo, 0);
  assert.equal(bad.s.score, SCORE_STEP);
});

/* ── 7. 掉下屏幕结束 ─────────────────────────────────────── */

test('反向起飞落空：掉出屏幕后结束并给出结算', () => {
  const g = createGame({ seed: 3 });
  g.submit('p1', 'start');
  chargeTo(g, 60);
  g.submit('p1', 'direction:left');
  g.submit('p1', 'release');
  let guard = 0;
  while (!g.state().over && guard < 1200) {
    g.step(1 / 120, []);
    guard += 1;
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.ok(s.player.y > s.h, '角色已落到画面下方');
  const r = g.result();
  assert.ok(r && r.over);
  assert.equal(r.winner, 'p1');
  assert.equal(r.score, s.score);
  assert.equal(g.submit('p1', 'release').ok, false, '结束后拒绝起跳');
  assert.equal(g.submit('p1', 'nope').ok, false, '结束后也拒绝非法操作');
});

test('小幅原地跳不会掉下去，也不加分', () => {
  const g = createGame({ seed: 5 });
  g.submit('p1', 'start');
  chargeTo(g, 2); // 力度极小 → 几乎垂直起落
  g.submit('p1', 'release');
  const s = settle(g);
  assert.equal(s.over, false);
  assert.equal(s.player.onGround, true);
  assert.equal(s.score, 0);
  assert.equal(s.lastLand.scored, false);
});

/* ── 8. 平台生成递减 ─────────────────────────────────────── */

test('平台随进度收窄、间距在生成范围内', () => {
  const g = createGame({ seed: 2024 });
  const ps = g.state().platforms;
  assert.ok(ps.length >= 4);
  for (let i = 1; i < ps.length; i++) {
    assert.ok(ps[i].w <= ps[i - 1].w + 1e-9, `宽度应单调不增：${ps[i - 1].w} → ${ps[i].w}`);
    assert.ok(ps[i].w >= MIN_W - 1e-9, '宽度不低于下限');
    assert.ok(ps[i].x > ps[i - 1].x + ps[i - 1].w, '平台不重叠且向右排布');
    const gap = ps[i].x - (ps[i - 1].x + ps[i - 1].w);
    assert.ok(gap > 40 && gap <= GAP_MAX + 1e-9, `间距 ${gap} 应合理`);
  }
  // 同种子可复现
  const again = createGame({ seed: 2024 }).state().platforms;
  assert.deepEqual(again, ps);
  // 不同种子生成不同的布局
  const other = createGame({ seed: 9 }).state().platforms;
  assert.notDeepEqual(other, ps);
});

/* ── 9. 方向自动 / 手动 ──────────────────────────────────── */

test('落地后方向自动朝向下一平台，←→ 可改', () => {
  const hits = scanLanding(42);
  const { s } = hits[0];
  const expect = s.nextX >= s.player.x ? 1 : -1;
  assert.equal(s.dir, expect, '自动朝向下一平台');

  const { g } = jumpOnce(42, hits[0].t);
  assert.deepEqual(g.submit('p1', 'direction:left'), { ok: true });
  assert.equal(g.state().dir, -1);
  g.submit('p1', 'direction:right');
  assert.equal(g.state().dir, 1);
  assert.deepEqual(g.submit('p1', 'left'), { ok: true }, '兼容裸 left/right 写法');
  assert.equal(g.state().dir, -1);
  // step 的持续动作也能改向
  g.step(1 / 120, ['charge', 'right']);
  assert.equal(g.state().dir, 1);
});

/* ── 10. 状态序列化 ─────────────────────────────────────── */

test('state() 可 JSON 往返、每次都是新对象', () => {
  const g = createGame({ seed: 8 });
  g.submit('p1', 'start');
  chargeTo(g, 40);
  const s = g.state();
  const copy = JSON.parse(JSON.stringify(s));
  assert.deepEqual(copy, s);
  assert.equal(typeof s.turn, 'string');
  assert.equal(typeof s.score, 'number');
  assert.ok(Array.isArray(s.platforms));
  assert.ok(Array.isArray(s.platforms) && s.platforms.length > 0);
  assert.equal(typeof s.player.charging, 'boolean');
  // 外部改快照不影响内部状态
  s.player.power = 999;
  s.platforms[0].w = -1;
  s.score = 12345;
  const again = g.state();
  assert.notEqual(again.player.power, 999);
  assert.equal(again.platforms[0].w > 0, true);
  assert.equal(again.score, 0);
  assert.notEqual(g.state(), s);
});

/* ── 11. 非法动作 ───────────────────────────────────────── */

test('非法动作返回 ok:false 且不改变状态', () => {
  const g = createGame({ seed: 2 });
  const before = g.state();
  const r = g.submit('p1', 'jump');
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.deepEqual(g.state(), before);
  assert.equal(g.submit('p1', 'release').ok, true, '地面松开是合法动作');
  assert.equal(g.submit('p1', 'release').ok, false, '空中不能再次起跳');
});

/* ── 12. 复位 ───────────────────────────────────────────── */

test('reset 恢复到开局：分数清零、平台链重建、ready 复位', () => {
  const g = createGame({ seed: 42 });
  const initial = g.state();
  g.submit('p1', 'start');
  chargeTo(g, 60);
  g.submit('p1', 'release');
  settle(g);
  g.reset();
  const s = g.state();
  assert.equal(s.score, 0);
  assert.equal(s.combo, 0);
  assert.equal(s.ready, true);
  assert.equal(s.over, false);
  assert.equal(s.player.onGround, true);
  assert.equal(s.player.power, 0);
  assert.deepEqual(s.platforms, initial.platforms, '同一种子重建出同一平台链');
});

/* ── 13. 长时间运行 ─────────────────────────────────────── */

test('连走 3000 步不崩、数值有限、平台列表有界', () => {
  const g = createGame({ seed: 123456 });
  g.submit('p1', 'start');
  let restarts = 0;
  for (let i = 0; i < 3000; i++) {
    const s = g.state();
    if (s.over) {
      g.reset();
      g.submit('p1', 'start');
      restarts += 1;
      continue;
    }
    if (s.player.onGround) {
      if (s.player.power < 62) g.step(1 / 60, ['charge']);
      else g.submit('p1', 'release');
    } else {
      const acts = [];
      if (i % 11 === 0) acts.push('left');
      else if (i % 17 === 0) acts.push('right');
      g.step(1 / 60, acts);
    }
    const n = g.state();
    for (const k of ['x', 'y', 'vx', 'vy']) {
      assert.ok(Number.isFinite(n.player[k]), `player.${k} 必须是有限数`);
    }
    assert.ok(n.player.power >= 0 && n.player.power <= 100);
    assert.ok(n.platforms.length < 40, `平台列表应有界，实测 ${n.platforms.length}`);
    assert.ok(n.score >= 0);
  }
  const s = g.state();
  assert.ok(restarts >= 0);
  assert.ok(Number.isFinite(s.camX));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

/* ── 14. 落地即停：台面上不再受重力 ─────────────────────── */

test('站在平台上时 step 不会让角色下坠', () => {
  const g = createGame({ seed: 6 });
  g.submit('p1', 'start');
  const y0 = g.state().player.y;
  for (let i = 0; i < 120; i++) g.step(1 / 60, []);
  const s = g.state();
  assert.equal(s.player.onGround, true);
  assert.equal(s.player.y, y0);
  assert.equal(s.player.vy, 0);
});

/* ── 15. 可达性：按解析解起跳能连续跨过 10 个平台 ───────── */

test('平台间距始终可达：解析解起跳连过 10 个平台', () => {
  // 用同一套物理常量反解所需力度：解竖直方程得飞行时间 t，再令 d = vx·t。
  // 这不是作弊，而是验证「生成的间距 / 高差」永远落在玩家能达到的力度范围内。
  function powerToReach(s, next) {
    const feet = s.player.y + s.r;
    const dy = feet - next.y; // >0 表示目标更高，飞行时间更短
    const disc = JUMP_VY * JUMP_VY - 2 * GRAVITY * dy;
    if (disc <= 0) return null;
    const t = (-JUMP_VY + Math.sqrt(disc)) / GRAVITY;
    const d = next.x + next.w / 2 - s.player.x;
    return { t, d, need: (Math.abs(d) / t / MAX_VX) * 100 };
  }

  const g = createGame({ seed: 2024 });
  g.submit('p1', 'start');
  let guard = 0;
  while (!g.state().over && g.state().nextId < 10 && guard < 200000) {
    guard += 1;
    const s = g.state();
    if (!s.player.onGround) {
      g.step(1 / 120, []);
      continue;
    }
    const next = s.platforms.find((p) => p.next);
    assert.ok(next, '地面上应存在「下一个平台」');
    const plan = powerToReach(s, next);
    assert.ok(plan && plan.need <= 100, `所需力度必须可达，实测 ${plan && plan.need}`);

    let cg = 0;
    while (g.state().player.power + 0.4 < plan.need && cg < 2000) {
      g.step(1 / 240, ['charge']);
      if (g.state().chargeDir < 0) break; // 越过峰值就不再等
      cg += 1;
    }
    if (plan.d < 0) g.submit('p1', 'direction:left');
    assert.equal(g.submit('p1', 'release').ok, true);
    let fg = 0;
    while (!g.state().over && !g.state().player.onGround && fg < 2000) {
      g.step(1 / 240, []);
      fg += 1;
    }
  }
  const s = g.state();
  assert.equal(s.over, false, '按可达力度起跳不应掉下去');
  assert.ok(s.nextId >= 10, `应连续跨过 10 个平台，实际 nextId=${s.nextId}`);
  assert.equal(s.score, (SCORE_STEP + PERFECT_BONUS) * 9, '每次都落在中心附近，9 跳全完美');
  assert.equal(s.combo, 9);
});
