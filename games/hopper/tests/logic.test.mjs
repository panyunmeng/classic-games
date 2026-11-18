import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  COLS,
  CELL,
  TRACK,
  TIME_LIMIT,
  START_LIVES,
  START_COL,
  LANE_H,
  LANE_TOP,
  PLAYER_SIZE,
  VEHICLE_H,
  HOLE_ROW,
  rowToY,
  colToPx,
} from '../logic.mjs';

/* ── 测试工具：只用公开的 state()/submit()/step() 驱动，不碰内部状态 ── */

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function obstacleBoxes(o) {
  return [o.x, o.x - TRACK];
}

/** 该列在 1..8 行是否都能安全通过（公路无车、河道有原木）——用来找一条「绿色通道」 */
function colCorridorFree(state, col) {
  const px = colToPx(col);
  const half = PLAYER_SIZE / 2;
  for (const lane of state.lanes) {
    if (lane.kind === 'road') {
      const cy = LANE_TOP + (lane.row - 1) * LANE_H + (LANE_H - VEHICLE_H) / 2;
      const py = rowToY(lane.row) - half;
      for (const o of lane.obstacles) {
        for (const ox of obstacleBoxes(o)) {
          if (overlap(px - half, py, PLAYER_SIZE, PLAYER_SIZE, ox, cy, o.w, VEHICLE_H)) {
            return false;
          }
        }
      }
    } else {
      let onLog = false;
      for (const o of lane.obstacles) {
        for (const ox of obstacleBoxes(o)) {
          if (px >= ox && px <= ox + o.w) onLog = true;
        }
      }
      if (!onLog) return false;
    }
  }
  return true;
}

function rowFreeOfCars(state, row, col) {
  const lane = state.lanes[row - 1];
  const px = colToPx(col);
  const half = PLAYER_SIZE / 2;
  const cy = LANE_TOP + (row - 1) * LANE_H + (LANE_H - VEHICLE_H) / 2;
  const py = rowToY(row) - half;
  for (const o of lane.obstacles) {
    for (const ox of obstacleBoxes(o)) {
      if (overlap(px - half, py, PLAYER_SIZE, PLAYER_SIZE, ox, cy, o.w, VEHICLE_H)) return false;
    }
  }
  return true;
}

function moveTo(g, col) {
  for (let guard = 0; guard < 40; guard++) {
    const x = g.state().player.x;
    if (Math.abs(x - col) < 1e-9) return;
    const r = g.submit('p1', x < col ? 'move:right' : 'move:left');
    assert.equal(r.ok, true, `行走到第 ${col} 列失败：${r.error}`);
  }
  assert.fail(`无法行走到第 ${col} 列`);
}

/** 找一条当前可直达洞位的整列通道（可限定只走空槽） */
function findCorridorCol(state, { freeSlot = true } = {}) {
  for (let col = 0; col < COLS; col++) {
    if (freeSlot && state.holes[Math.floor(col / 2)].occupied) continue;
    if (colCorridorFree(state, col)) return col;
  }
  return -1;
}

/** 等车流/原木对齐，然后从起点一路跳到洞位填一个洞。返回填洞后的 state。 */
function crossToHole(g, maxFrames = 900) {
  for (let i = 0; i < maxFrames; i++) {
    const s = g.state();
    const col = findCorridorCol(s);
    if (col >= 0) {
      moveTo(g, col);
      const before = g.state();
      for (let k = 0; k < 9; k++) {
        const r = g.submit('p1', 'move:up');
        assert.equal(r.ok, true, `第 ${k + 1} 次上跳失败：${r.error}`);
      }
      const after = g.state();
      assert.equal(after.filled, before.filled + 1, '上跳到洞位应填满一个洞');
      return after;
    }
    g.step(1 / 30);
  }
  assert.fail('等待通道超时');
}

test('01 初始状态：起点、3 命、1 关、30 秒、5 个空洞、8 条车道', () => {
  const g = createGame({ seed: 42 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.deepEqual(s.player, { x: START_COL, y: 0 });
  assert.equal(s.score, 0);
  assert.equal(s.lives, START_LIVES);
  assert.equal(s.level, 1);
  assert.equal(s.timeLeft, TIME_LIMIT);
  assert.equal(s.over, false);
  assert.equal(s.solved, false);
  assert.equal(s.filled, 0);
  assert.equal(s.holes.length, 5);
  assert.ok(s.holes.every((h) => h.occupied === false));
  assert.equal(s.lanes.length, 8);
  assert.equal(s.lanes.filter((l) => l.kind === 'road').length, 4);
  assert.equal(s.lanes.filter((l) => l.kind === 'river').length, 4);
  // 方向逐道交替、速度两两不同
  for (let i = 1; i < s.lanes.length; i++) {
    assert.equal(s.lanes[i].dir, -s.lanes[i - 1].dir, `第 ${i + 1} 道方向应交替`);
  }
  assert.equal(new Set(s.lanes.map((l) => l.speed)).size, 8);
  assert.equal(g.result(), null);
});

test('02 四向移动与边界：左右一格、下边界拒绝、上跳一格', () => {
  const g = createGame({ seed: 42 });
  for (let i = 0; i < 5; i++) assert.equal(g.submit('p1', 'move:left').ok, true);
  assert.equal(g.state().player.x, 0);
  const left = g.submit('p1', 'move:left');
  assert.equal(left.ok, false);
  assert.equal(left.error, '已到边界');

  for (let i = 0; i < 9; i++) assert.equal(g.submit('p1', 'move:right').ok, true);
  assert.equal(g.state().player.x, 9);
  assert.equal(g.submit('p1', 'move:right').ok, false);

  const down = g.submit('p1', 'move:down');
  assert.equal(down.ok, false);
  assert.equal(down.error, '已在起点');

  // 找第 1 道当前无车的一列再上跳，验证「每步一格」
  const s0 = g.state();
  let safe = -1;
  for (let c = 0; c < COLS; c++) if (rowFreeOfCars(s0, 1, c)) safe = c;
  assert.ok(safe >= 0, '第 1 道应有空位');
  moveTo(g, safe);
  const up = g.submit('p1', 'move:up');
  assert.equal(up.ok, true);
  assert.equal(g.state().player.y, 1);
  assert.equal(g.state().lives, START_LIVES);
});

test('03 车辆/原木按固定步长推进：位置 = (x0 + dir·speed·dt) mod TRACK', () => {
  const g = createGame({ seed: 7 });
  const before = g.state();
  g.step(0.5);
  const after = g.state();
  for (let i = 0; i < before.lanes.length; i++) {
    const lane0 = before.lanes[i];
    const lane1 = after.lanes[i];
    const delta = lane0.dir * lane0.speed * 0.5;
    for (let k = 0; k < lane0.obstacles.length; k++) {
      const expect = ((lane0.obstacles[k].x + delta) % TRACK + TRACK) % TRACK;
      const actual = lane1.obstacles[k].x;
      const diff = Math.abs(((actual - expect + TRACK * 1.5) % TRACK) - TRACK * 0.5);
      assert.ok(diff < 1e-6, `第 ${i + 1} 道第 ${k + 1} 个障碍位移不符合公式`);
    }
  }
  assert.ok(after.timeLeft < before.timeLeft, '倒计时应同步推进');
});

test('04 撞车减命：开进有车的格子 → 命 −1 并回到起点', () => {
  const g = createGame({ seed: 3 });
  const s0 = g.state();
  let col = -1;
  for (let c = 0; c < COLS && col < 0; c++) if (!rowFreeOfCars(s0, 1, c)) col = c;
  assert.ok(col >= 0, '第 1 道当前应有车');
  moveTo(g, col);
  const r = g.submit('p1', 'move:up');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(s.lastCause, '撞车');
  assert.deepEqual(s.player, { x: START_COL, y: 0 });
  assert.equal(s.score, 0);
  assert.equal(s.over, false);
});

test('05 踩空溺水：跳到没有原木的河面 → 命 −1', () => {
  const g = createGame({ seed: 5 });
  let col = -1;
  const waterCol = () => {
    const s0 = g.state();
    for (let c = 0; c < COLS; c++) {
      let roadClear = true;
      for (let row = 1; row <= 4; row++) if (!rowFreeOfCars(s0, row, c)) roadClear = false;
      if (!roadClear) continue;
      const px = colToPx(c);
      const river = s0.lanes[4]; // 第 5 道是第一条河道
      const onLog = river.obstacles.some((o) =>
        obstacleBoxes(o).some((ox) => px >= ox && px <= ox + o.w)
      );
      if (!onLog) return c;
    }
    return -1;
  };
  for (let i = 0; i < 600 && col < 0; i++) {
    col = waterCol();
    if (col < 0) g.step(1 / 30);
  }
  assert.ok(col >= 0, '应在有限时间内等到「公路畅通 + 河面空水」的列');
  moveTo(g, col);
  for (let k = 0; k < 4; k++) assert.equal(g.submit('p1', 'move:up').ok, true);
  assert.equal(g.state().player.y, 4);
  assert.equal(g.submit('p1', 'move:up').ok, true);
  const s = g.state();
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(s.lastCause, '溺水');
  assert.deepEqual(s.player, { x: START_COL, y: 0 });
});

test('06 到达洞位 +10 分：洞位占满、回到起点、计时不清零', () => {
  const g = createGame({ seed: 11 });
  const before = g.state();
  const s = crossToHole(g);
  assert.equal(s.score, 10);
  assert.equal(s.filled, 1);
  assert.equal(s.holes.filter((h) => h.occupied).length, 1);
  assert.equal(s.solved, false);
  assert.equal(s.level, 1);
  assert.deepEqual(s.player, { x: START_COL, y: 0 }, '非最后一洞应回到起点');
  assert.ok(s.timeLeft > 0 && s.timeLeft <= before.timeLeft);
});

test('07 洞位关闭：已占用的洞槽再次进入被拒绝，青蛙留在第 8 行', () => {
  const g = createGame({ seed: 11 });
  const afterFill = crossToHole(g);
  const slot = afterFill.holes.findIndex((h) => h.occupied);
  assert.ok(slot >= 0);
  // 在已占槽的两列里找一条能通到第 8 行的通道
  let col = -1;
  for (let i = 0; i < 900 && col < 0; i++) {
    const s = g.state();
    for (const c of [slot * 2, slot * 2 + 1]) {
      if (c < COLS && colCorridorFree(s, c)) {
        col = c;
        break;
      }
    }
    if (col < 0) g.step(1 / 30);
  }
  assert.ok(col >= 0, '应能等到通往已占洞槽的通道');
  moveTo(g, col);
  for (let k = 0; k < 8; k++) assert.equal(g.submit('p1', 'move:up').ok, true);
  assert.equal(g.state().player.y, 8);
  const r = g.submit('p1', 'move:up');
  assert.equal(r.ok, false);
  assert.equal(r.error, '洞位已关闭');
  assert.equal(g.state().player.y, 8);
  assert.equal(g.state().filled, 1);
});

test('08 5 洞填满过关：solved 后进入第 2 关，洞位清空、车辆加速', () => {
  const g = createGame({ seed: 13 });
  const level1Speed = g.state().lanes[0].speed;
  const level1RiverSpeed = g.state().lanes[4].speed;
  let last = null;
  for (let i = 0; i < 5; i++) last = crossToHole(g);
  assert.equal(last.filled, 5);
  assert.equal(last.score, 50);
  assert.equal(last.solved, true);
  assert.equal(last.level, 1);

  for (let i = 0; i < 90; i++) g.step(1 / 60); // 1.5 s：过场动画结束并进入下一关
  const s = g.state();
  assert.equal(s.solved, false);
  assert.equal(s.level, 2);
  assert.equal(s.score, 50);
  assert.equal(s.filled, 0);
  assert.ok(s.holes.every((h) => h.occupied === false));
  assert.ok(s.timeLeft > 28, `进入新关应重置倒计时，实际 ${s.timeLeft}`);
  assert.ok(s.lanes[0].speed > level1Speed, '第 2 关车辆应更快');
  assert.equal(s.lanes[0].speed, level1Speed * 1.18);
  assert.equal(s.lanes[4].speed, level1RiverSpeed, '原木不随关卡加速');
});

test('09 倒计时超时：30 秒减 1 命并重置倒计时', () => {
  const g = createGame({ seed: 9 });
  for (let i = 0; i < 1801; i++) g.step(1 / 60);
  const s = g.state();
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(s.lastCause, '时间到');
  assert.equal(s.over, false);
  assert.ok(s.timeLeft > 29.8 && s.timeLeft <= TIME_LIMIT, `倒计时应重置，实际 ${s.timeLeft}`);
  assert.deepEqual(s.player, { x: START_COL, y: 0 });
});

test('10 3 命结束：连续三次撞车 → over=true，后续操作被拒绝', () => {
  const g = createGame({ seed: 3 });
  const col = (() => {
    const s = g.state();
    for (let c = 0; c < COLS; c++) if (!rowFreeOfCars(s, 1, c)) return c;
    return -1;
  })();
  assert.ok(col >= 0);
  for (let round = 0; round < 3; round++) {
    moveTo(g, col);
    assert.equal(g.submit('p1', 'move:up').ok, true);
    const s = g.state();
    if (round < 2) {
      assert.equal(s.lives, START_LIVES - 1 - round);
      assert.equal(s.over, false);
      assert.equal(s.player.y, 0);
    } else {
      assert.equal(s.lives, 0);
      assert.equal(s.over, true);
    }
  }
  assert.equal(g.submit('p1', 'move:up').ok, false);
  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.equal(res.score, 0);
  assert.match(res.text, /第 1 关/);
});

test('11 持续按住方向键：边沿立即跳一格，之后每 0.12 s 连跳一格', () => {
  const g = createGame({ seed: 42 });
  const x0 = g.state().player.x;
  g.step(1 / 60, ['left']);
  assert.equal(g.state().player.x, x0 - 1, 'actions 里的新方向应立即跳一格');
  for (let i = 0; i < 20; i++) g.step(1 / 60, ['left']); // 再 0.33 s
  const x1 = g.state().player.x;
  assert.ok(x1 < x0 - 1, '按住应产生连发移动');
  for (let i = 0; i < 120; i++) g.step(1 / 60, ['left']); // 再 2 s
  assert.equal(g.state().player.x, 0, '连发应一路到左边界');
  assert.equal(g.state().lives, START_LIVES, '起点行没有危险');
});

test('11b 边沿去重：submit 后同一帧的 step(actions) 不会重复跳同一格', () => {
  const g = createGame({ seed: 42 });
  const x0 = g.state().player.x;
  assert.equal(g.submit('p1', 'move:right').ok, true);
  g.step(1 / 60, ['right']);
  assert.equal(g.state().player.x, x0 + 1, '一次按键只应跳一格');
  g.step(1 / 60, ['right']);
  assert.equal(g.state().player.x, x0 + 1, '连发延迟未到，不应再动');
  for (let i = 0; i < 20; i++) g.step(1 / 60, ['right']);
  assert.ok(g.state().player.x > x0 + 1, '延迟过后应继续连发');
});

test('12 状态可 JSON 序列化；state() 每次返回新对象，外部改动不影响内部', () => {
  const g = createGame({ seed: 21 });
  g.submit('p1', 'move:up');
  g.step(0.2);
  const s = g.state();
  const json = JSON.stringify(s);
  assert.ok(json.length > 0);
  const back = JSON.parse(json);
  assert.equal(back.turn, 'p1');
  assert.equal(back.score, s.score);
  assert.deepEqual(back.player, s.player);
  assert.deepEqual(back.holes, s.holes);

  s.player.x = -999;
  s.holes[0].occupied = true;
  s.lanes[0].obstacles.length = 0;
  const s2 = g.state();
  assert.notEqual(s2.player.x, -999);
  assert.equal(s2.holes[0].occupied, false);
  assert.ok(s2.lanes[0].obstacles.length > 0);
});

test('13 reset 回到开局；连走 2000 步不崩、无 NaN', () => {
  const g = createGame({ seed: 31 });
  crossToHole(g);
  assert.equal(g.state().filled, 1);
  g.reset();
  const s0 = g.state();
  assert.equal(s0.score, 0);
  assert.equal(s0.lives, START_LIVES);
  assert.equal(s0.level, 1);
  assert.equal(s0.filled, 0);
  assert.equal(s0.timeLeft, TIME_LIMIT);
  assert.deepEqual(s0.player, { x: START_COL, y: 0 });

  const dirs = ['up', 'left', 'right', 'down'];
  for (let i = 0; i < 2000; i++) {
    if (i % 23 === 0) g.submit('p1', `move:${dirs[(i / 23) % 4]}`);
    g.step(1 / 60, i % 3 === 0 ? ['up'] : []);
    const s = g.state();
    assert.ok(Number.isFinite(s.player.x) && Number.isFinite(s.player.y), `第 ${i} 步位置 NaN`);
    assert.ok(Number.isFinite(s.timeLeft), `第 ${i} 步倒计时 NaN`);
    assert.ok(Number.isFinite(s.score), `第 ${i} 步分数 NaN`);
    assert.ok(s.lives >= 0 && s.lives <= START_LIVES);
    if (s.over) break;
  }
  const s = g.state();
  assert.ok(JSON.stringify(s).length > 0);
  if (s.over) {
    const res = g.result();
    assert.equal(res.over, true);
    assert.equal(res.winner, 'p1');
  }
});
