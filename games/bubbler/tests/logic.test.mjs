import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  COLS,
  D,
  R,
  ROW_STEP,
  FIELD_TOP,
  INIT_ROWS,
  MAX_ROWS,
  FIELD_L,
  FIELD_R,
  DANGER_ROW,
  MAX_ANGLE,
  SHOOTER_X,
  cellX,
  cellY,
  neighbors,
} from '../logic.mjs';

/** 空盘：rows 行、每行 COLS 格全空，方便按坐标点放泡泡 */
function blank(rows) {
  return Array.from({ length: rows }, () => new Array(COLS).fill(null));
}

/** 在 rows 上放一个颜色，返回同一数组（链式摆盘） */
function put(rows, r, c, color) {
  rows[r][c] = color;
  return rows;
}

function countBubbles(state) {
  let n = 0;
  for (const row of state.grid) for (const cell of row) if (cell) n += 1;
  return n;
}

/** 推进到条件满足（最多 max 帧），返回用掉的帧数，超时返回 -1 */
function runUntil(g, pred, max = 400) {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    g.step(1 / 60);
  }
  return pred() ? max : -1;
}

/** 从栅格快照里按 id 找泡泡 */
function findById(state, id) {
  for (const row of state.grid) {
    for (const cell of row) if (cell && cell.id === id) return cell;
  }
  return null;
}

test('01 初始状态：turn / 蜂窝网格 / 发射口 / 计分 / 可序列化', () => {
  const g = createGame({ seed: 3 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.cols, COLS);
  assert.equal(s.rows, INIT_ROWS);
  assert.equal(s.grid.length, INIT_ROWS);
  assert.equal(countBubbles(s), INIT_ROWS * COLS);
  for (const row of s.grid) {
    assert.equal(row.length, COLS);
    for (const cell of row) {
      assert.ok(cell, '初始盘面每格都有泡泡');
      assert.equal(cell.color >= 0 && cell.color < 3, true, '起步 3 色');
      assert.ok(Number.isInteger(cell.r) && Number.isInteger(cell.c));
    }
  }
  assert.equal(s.score, 0);
  assert.equal(s.combo, 0);
  assert.equal(s.dropRows, 0);
  assert.equal(s.over, false);
  assert.equal(s.solved, false);
  assert.equal(s.phase, 0, '初始相位 0');
  assert.equal(s.shooter.angle, 0);
  assert.ok(s.shooter.color >= 0 && s.shooter.color < 3);
  assert.ok(s.shooter.nextColor >= 0 && s.shooter.nextColor < 3);
  assert.equal(s.flying.active, false);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test('02 发射：submit shoot 产生飞行泡泡，撞顶棚后吸附落格并补充发射色', () => {
  const g = createGame({ seed: 5 });
  g.debugSet({ grid: [[0]], autoDrop: false, shooter: { angle: 0, color: 2, nextColor: 1 } });

  assert.equal(g.submit('p1', 'shoot').ok, true);
  const air = g.state();
  assert.equal(air.flying.active, true);
  assert.equal(air.flying.color, 2);
  assert.ok(air.flying.vy < 0, '泡泡向上飞');
  assert.equal(g.submit('p1', 'shoot').ok, false, '飞行中不能连发');

  const frames = runUntil(g, () => !g.state().flying.active);
  assert.ok(frames > 0, '泡泡最终停下');

  const s = g.state();
  assert.equal(s.flying.active, false);
  assert.equal(countBubbles(s), 2, '吸附后盘面多一个泡泡');
  assert.equal(s.shots, 1);
  assert.equal(s.shooter.color, 1, '下一发颜色顶到当前位');
  assert.ok(Number.isInteger(s.shooter.nextColor));
});

test('03 碰撞吸附：撞到已有泡泡时贴到它的相邻空格（六边形邻接）', () => {
  const g = createGame({ seed: 5 });
  // 顶行 c6 有一个泡泡，正上方打上去应从下方贴住它
  const rows = blank(1);
  put(rows, 0, 6, 0);
  g.debugSet({ grid: rows, autoDrop: false, shooter: { angle: 0, color: 3, nextColor: 0 } });

  g.submit('p1', 'shoot');
  assert.ok(runUntil(g, () => !g.state().flying.active) > 0);

  const s = g.state();
  assert.equal(countBubbles(s), 2);
  const placed = [];
  for (const row of s.grid) for (const cell of row) if (cell && cell.color === 3) placed.push(cell);
  assert.equal(placed.length, 1);
  const p = placed[0];
  assert.equal(p.r, 1, '挂在被撞泡泡的下一行');
  const keys = neighbors(0, 6).map(([r, c]) => `${r},${c}`);
  assert.ok(keys.includes(`${p.r},${p.c}`), '新泡泡必须与被撞泡泡六边形相邻');
});

test('04 同色 ≥3 连通消除：4 连消除并计分', () => {
  const g = createGame({ seed: 7 });
  const rows = blank(5);
  for (let c = 0; c < COLS; c++) put(rows, 0, c, 0); // 顶行挂满颜色 0
  put(rows, 1, 2, 1);
  put(rows, 1, 3, 1);
  put(rows, 1, 4, 1); // 颜色 1 的三连
  g.debugSet({ grid: rows, autoDrop: false, shooter: { angle: 0, color: 1, nextColor: 1 } });

  // 从 c3 正下方打上去，会吸附成第 4 个同色
  g.debugSet({ flying: { x: cellX(1, 3), y: 300, vx: 0, vy: -620, color: 1 } });
  assert.ok(runUntil(g, () => !g.state().flying.active) > 0);

  const s = g.state();
  assert.equal(countBubbles(s), COLS, '只剩顶行 12 个颜色 0');
  for (const row of s.grid) for (const cell of row) if (cell) assert.equal(cell.color, 0);
  assert.equal(s.pops, 4);
  assert.equal(s.score, 4 * 10, '4 连 × 10 分 × 连消 1');
  assert.equal(s.combo, 1);
});

test('05 连消加分：连续两发都消除，第二发倍率更高', () => {
  const g = createGame({ seed: 7 });

  function setup() {
    const rows = blank(5);
    for (let c = 0; c < COLS; c++) put(rows, 0, c, 0);
    put(rows, 1, 2, 1);
    put(rows, 1, 3, 1);
    put(rows, 1, 4, 1);
    g.debugSet({ grid: rows, autoDrop: false, shooter: { angle: 0, color: 1, nextColor: 1 } });
    g.debugSet({ flying: { x: cellX(1, 3), y: 300, vx: 0, vy: -620, color: 1 } });
    runUntil(g, () => !g.state().flying.active);
  }

  setup();
  const first = g.state();
  assert.equal(first.score, 40);
  assert.equal(first.combo, 1);

  setup();
  const second = g.state();
  assert.equal(second.combo, 2, '连消计数累加');
  assert.equal(second.maxCombo, 2);
  assert.equal(second.score, 40 + 4 * 10 * 2, '第二发按 ×2 计分');
  assert.ok(second.score - first.score > first.score, '连消确实加得更多');
});

test('06 悬空坠落：消掉支撑后，与顶行失联的泡泡整片坠落并加分', () => {
  const g = createGame({ seed: 9 });
  const rows = blank(6);
  for (let c = 0; c < COLS; c++) put(rows, 0, c, 0); // 顶行锚点
  put(rows, 2, 5, 1);
  put(rows, 2, 6, 1);
  put(rows, 3, 5, 1); // 颜色 1 三连
  put(rows, 4, 5, 2); // 只靠 (3,5) 吊着，消完应坠落
  g.debugSet({ grid: rows, autoDrop: false, shooter: { angle: 0, color: 1, nextColor: 1 } });

  g.debugSet({ flying: { x: 267, y: 300, vx: 0, vy: -620, color: 1 } });
  assert.ok(runUntil(g, () => !g.state().flying.active) > 0);

  const s = g.state();
  assert.equal(s.pops, 4, '新泡泡补成 4 连');
  assert.equal(s.dropped, 1, '1 个泡泡失去支撑');
  assert.equal(s.score, (4 * 10 + 1 * 20) * 1);
  assert.equal(countBubbles(s), COLS, '只剩顶行锚点');
  assert.equal(s.grid[4][5], null, '坠落位置已清空');
});

test('07 顶部落行：每发之后插入一行，旧泡泡整体下移并错位半格', () => {
  const g = createGame({ seed: 11 });
  const rows = blank(1);
  put(rows, 0, 0, 0);
  g.debugSet({ grid: rows, shooter: { angle: 0, color: 1, nextColor: 2 } });

  const before = g.state();
  const oldId = before.grid[0][0].id;
  assert.equal(before.dropRows, 0);

  g.submit('p1', 'shoot');
  assert.ok(runUntil(g, () => !g.state().flying.active) > 0);

  const s = g.state();
  assert.equal(s.dropRows, 1, '一发落一行');
  assert.equal(s.grid.length, 2, '盘面多一行');
  const moved = findById(s, oldId);
  assert.ok(moved, '旧泡泡仍在场上');
  assert.equal(moved.r, 1, '下移一行');
  assert.equal(moved.c, 0);
  assert.equal(s.phase, 1, '落行翻转相位');
  // 关键不变式：落行只是整体下移，泡泡的绝对 x 不变（相位补偿了行奇偶翻转）
  assert.equal(cellX(moved.r, moved.c, s.phase), cellX(0, 0, before.phase), '落行不改变绝对横坐标');
  assert.equal(Math.abs(cellX(1, 0, s.phase) - cellX(0, 0, s.phase)), D / 2, '相邻行仍错位半格');
  assert.ok(countBubbles(s) >= 2);
});

test('08 触底失败：落行把底行压到危险行即结束', () => {
  const g = createGame({ seed: 13 });
  const rows = blank(DANGER_ROW);
  for (let r = 0; r < DANGER_ROW; r++) put(rows, r, 0, 0); // 一直堆到危险行上方
  g.debugSet({ grid: rows, shooter: { angle: 0, color: 1, nextColor: 1 } });
  assert.equal(g.state().over, false, '初始还没触底');

  g.submit('p1', 'shoot');
  assert.ok(runUntil(g, () => !g.state().flying.active) > 0);

  const s = g.state();
  assert.equal(s.over, true, '落行后底行越线');
  assert.equal(s.dropRows, 1);
  const info = g.result();
  assert.ok(info && info.over);
  assert.equal(info.winner, 'p1');
  assert.equal(info.score, s.score);
  assert.ok(typeof info.text === 'string' && info.text.length > 0);
  assert.equal(g.submit('p1', 'shoot').ok, false, '结束后不能再发射');
});

test('09 颜色递增：3 色起步，随分数涨到 6 色封顶', () => {
  const g = createGame({ seed: 2 });
  assert.equal(g.state().colors, 3);
  g.debugSet({ score: 299 });
  assert.equal(g.state().colors, 3);
  g.debugSet({ score: 300 });
  assert.equal(g.state().colors, 4);
  g.debugSet({ score: 600 });
  assert.equal(g.state().colors, 5);
  g.debugSet({ score: 900 });
  assert.equal(g.state().colors, 6);
  g.debugSet({ score: 999999 });
  assert.equal(g.state().colors, 6, '封顶 6 色');
});

test('10 状态序列化 / 快照隔离 / 重置', () => {
  const g = createGame({ seed: 4 });
  const a = g.state();
  const b = g.state();
  assert.notEqual(a, b, 'state() 每次返回新对象');
  assert.notEqual(a.grid, b.grid);
  assert.notEqual(a.grid[0][0], b.grid[0][0], '网格单元也是新对象');

  a.grid[0][0].color = 99;
  a.score = 12345;
  a.shooter.angle = 77;
  const c = g.state();
  assert.notEqual(c.score, 12345);
  assert.notEqual(c.grid[0][0].color, 99);
  assert.notEqual(c.shooter.angle, 77);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(g.state())));

  g.submit('p1', 'shoot');
  g.step(1 / 60);
  g.reset();
  const r = g.state();
  assert.equal(r.score, 0);
  assert.equal(r.combo, 0);
  assert.equal(r.dropRows, 0);
  assert.equal(r.over, false);
  assert.equal(r.solved, false);
  assert.equal(r.flying.active, false);
  assert.equal(r.shooter.angle, 0);
  assert.equal(r.grid.length, INIT_ROWS);
});

test('11 连走 2000 步不崩：状态始终有限、网格不越界、结束时安全', () => {
  const g = createGame({ seed: 9 });
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    const acts = [i % 120 < 60 ? 'left' : 'right'];
    g.step(1 / 60, acts);
    if (i % 37 === 5) g.submit('p1', 'shoot');
    const s = g.state();
    assert.ok(Number.isFinite(s.score) && Number.isFinite(s.combo));
    assert.ok(s.grid.length >= 1 && s.grid.length <= MAX_ROWS, '网格行数受限');
    assert.ok(s.shooter.angle >= -MAX_ANGLE && s.shooter.angle <= MAX_ANGLE);
    if (s.over) {
      rounds += 1;
      g.reset(); // 立刻重开，让 2000 步真的跑满多局而不是空转
    }
    if (i % 100 === 0) {
      for (const row of s.grid) {
        assert.equal(row.length, COLS);
        for (const cell of row) {
          if (!cell) continue;
          assert.ok(cell.color >= 0 && cell.color < 6);
          assert.ok(cell.r >= 0 && cell.r < MAX_ROWS);
          assert.ok(cell.c >= 0 && cell.c < COLS);
        }
      }
    }
  }
  assert.ok(rounds >= 1, '2000 步内至少打完一局（说明确实在推进）');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(g.state())));
  g.step(1 / 60);
  assert.ok(Number.isFinite(g.state().score));
});

test('12 瞄准：aim:deg 夹紧、持续动作微调、start 回正', () => {
  const g = createGame({ seed: 6 });
  assert.equal(g.submit('p1', 'aim:999').ok, true);
  assert.equal(g.state().shooter.angle, MAX_ANGLE);
  g.submit('p1', 'aim:-999');
  assert.equal(g.state().shooter.angle, -MAX_ANGLE);

  g.submit('p1', 'aim:30');
  assert.ok(Math.abs(g.state().shooter.angle - 30) < 1e-9);

  for (let i = 0; i < 30; i++) g.step(1 / 60, ['left']);
  assert.ok(g.state().shooter.angle < 30, '← 持续动作把角度往左推');

  const before = g.state().shooter.angle;
  for (let i = 0; i < 30; i++) g.step(1 / 60, ['right']);
  assert.ok(g.state().shooter.angle > before, '→ 持续动作把角度往右推');

  assert.equal(g.submit('p1', 'start').ok, true);
  assert.equal(g.state().shooter.angle, 0);
});

test('13 非法动作：未知指令 / 非字符串 / 空角度一律拒绝且不改变局面', () => {
  const g = createGame({ seed: 8 });
  const before = g.state();
  assert.equal(g.submit('p1', 'nope').ok, false);
  assert.equal(g.submit('p1', '').ok, false);
  assert.equal(g.submit('p1', 42).ok, false);
  assert.equal(g.submit('p1', 'aim:').ok, false);
  assert.equal(g.submit('p1', 'aim:abc').ok, false);
  const after = g.state();
  assert.equal(after.score, before.score);
  assert.equal(after.shooter.angle, before.shooter.angle);
  assert.equal(after.shots, before.shots);
});

test('14 六边形邻接（含相位）：邻居数 / 对称性 / 落行不剪切 / 不越界', () => {
  const even = neighbors(4, 5).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(new Set(even), new Set(['4,4', '4,6', '3,4', '3,5', '5,4', '5,5']));

  const odd = neighbors(5, 5).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(new Set(odd), new Set(['5,4', '5,6', '4,5', '4,6', '6,5', '6,6']));

  const top = neighbors(0, 5).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(new Set(top), new Set(['0,4', '0,6', '1,4', '1,5']), '顶行没有上方邻居');

  const corner = neighbors(0, 0).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(new Set(corner), new Set(['0,1', '1,0']), '左上角只贴两个邻居');

  // 相位 1：行奇偶整体翻转，同一条 c 的邻居方向随之镜像
  const evenP1 = neighbors(4, 5, 1).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(new Set(evenP1), new Set(['4,4', '4,6', '3,5', '3,6', '5,5', '5,6']));
  const oddP1 = neighbors(5, 5, 1).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(new Set(oddP1), new Set(['5,4', '5,6', '4,4', '4,5', '6,4', '6,5']));

  // 对称性：b 是 a 的邻居 ⇔ a 是 b 的邻居（两个相位都要成立）
  for (const ph of [0, 1]) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < COLS; c++) {
        for (const [nr, nc] of neighbors(r, c, ph)) {
          const back = neighbors(nr, nc, ph).map(([x, y]) => `${x},${y}`);
          assert.ok(back.includes(`${r},${c}`), `邻接必须对称(phase=${ph})：(${r},${c}) ↔ (${nr},${nc})`);
        }
      }
    }
  }

  // 落行不剪切：x(r+1, c, 1-phase) 必须等于 x(r, c, phase)，即落行只下移不横移
  for (const ph of [0, 1]) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < COLS; c++) {
        assert.ok(Math.abs(cellX(r + 1, c, 1 - ph) - cellX(r, c, ph)) < 1e-9, `相位补偿失效 r=${r} c=${c}`);
      }
    }
  }

  // 所有相位下的格子都必须落在场地内（贴墙但不越界）
  for (const ph of [0, 1]) {
    for (let r = 0; r < 2; r++) {
      assert.ok(cellX(r, 0, ph) - R >= FIELD_L - 1e-9, '左边界越界');
      assert.ok(cellX(r, COLS - 1, ph) + R <= FIELD_R + 1e-9, '右边界越界');
    }
  }

  // 几何自检：行距 √3/2·D，相邻行错位半格
  assert.ok(Math.abs(cellY(1) - cellY(0) - ROW_STEP) < 1e-9);
  assert.ok(Math.abs(ROW_STEP - (D * Math.sqrt(3)) / 2) < 1e-9);
  assert.ok(Math.abs(cellX(1, 0) - cellX(0, 0) - D / 2) < 1e-9);
  assert.ok(Math.abs(cellY(1) - FIELD_TOP - R - ROW_STEP) < 1e-9);
});

test('15 清台：泡泡全消后 solved 置位、加分并重发新盘', () => {
  const g = createGame({ seed: 12 });
  const rows = blank(3);
  put(rows, 0, 5, 0);
  put(rows, 0, 6, 0);
  put(rows, 1, 6, 0); // 三连，最后被打光
  g.debugSet({ grid: rows, shooter: { angle: 0, color: 0, nextColor: 0 } });

  g.debugSet({ flying: { x: cellX(0, 5), y: 300, vx: 0, vy: -620, color: 0 } });
  assert.ok(runUntil(g, () => !g.state().flying.active) > 0);

  const s = g.state();
  assert.equal(s.solved, true, '清台标记');
  assert.equal(s.clears, 1);
  assert.equal(s.over, false, '清台不是失败');
  assert.equal(s.score, 4 * 10 + 500, '消除分 + 清台奖励');
  assert.equal(s.grid.length, INIT_ROWS, '重发新盘且这一发不落行');
  assert.equal(countBubbles(s), INIT_ROWS * COLS);
});
