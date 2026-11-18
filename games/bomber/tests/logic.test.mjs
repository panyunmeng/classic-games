import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  COLS,
  ROWS,
  BOMB_FUSE,
  BASE_POWER,
  CLEAR_DELAY,
} from '../logic.mjs';

/** 以固定 1/60 步长推进 seconds 秒 */
function run(g, seconds, actions = []) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) g.step(1 / 60, actions);
  return g.state();
}

function brickTotal(s) {
  return s.maze.join('').split('+').length - 1;
}

/** 把一块矩形区域清成通道，便于构造无砖的爆炸场景 */
function clearRoom(g, x0, x1, y0, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) g.debugSetCell(x, y, ' ');
  }
}

/** 远离玩家的静止假敌人，避免“清空敌人即过关”干扰单项测试 */
function dummyEnemy(x = 11, y = 9) {
  return { x, y, interval: 99, timer: 99 };
}

test('初始地图：13×11、外围钢墙、出生区为空、有砖墙、初始状态正确', () => {
  const g = createGame({ seed: 42 });
  const s = g.state();

  assert.equal(COLS, 13);
  assert.equal(ROWS, 11);
  assert.equal(s.maze.length, ROWS);
  for (const row of s.maze) assert.equal(row.length, COLS);
  for (let x = 0; x < COLS; x++) {
    assert.equal(s.maze[0][x], '#');
    assert.equal(s.maze[ROWS - 1][x], '#');
  }
  for (let y = 0; y < ROWS; y++) {
    assert.equal(s.maze[y][0], '#');
    assert.equal(s.maze[y][COLS - 1], '#');
  }

  assert.ok(brickTotal(s) > 0, '初始地图应有砖墙');
  assert.equal(s.maze[1][1], ' ', '出生格必须是通道');
  assert.equal(s.turn, 'p1');
  assert.equal(s.player.cx, 1);
  assert.equal(s.player.cy, 1);
  assert.equal(s.player.power, BASE_POWER);
  assert.equal(s.player.maxBombs, 1);
  assert.equal(s.player.bombs, 0);
  assert.equal(s.player.speed, 3.2);
  assert.deepEqual(s.player.dir, { x: 0, y: 1 });
  assert.equal(s.score, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.level, 1);
  assert.equal(s.over, false);
  assert.equal(s.solved, false);
  assert.ok(s.enemies.length >= 2 && s.enemies.length <= 4);
  for (const e of s.enemies) {
    assert.ok(Number.isInteger(e.cx) && Number.isInteger(e.cy));
    assert.ok(Number.isFinite(e.timer));
    assert.ok(e.dir && Number.isFinite(e.dir.x));
  }
});

test('移动撞墙：钢墙/砖墙都走不进去，通道可连续走', () => {
  const g = createGame({ seed: 42 });

  // 出生格上方是外围钢墙
  run(g, 1.0, ['up']);
  let s = g.state();
  assert.equal(s.player.cx, 1);
  assert.equal(s.player.cy, 1);

  // 出生格右侧是通道
  run(g, 0.8, ['right']);
  s = g.state();
  assert.ok(s.player.cx >= 3, `应向右走到第 3 格之后，实际 cx=${s.player.cx}`);

  // 把右侧封成砖墙后不能再进入
  const g2 = createGame({ seed: 42 });
  g2.debugSetCell(2, 1, '+');
  run(g2, 0.6, ['right']);
  s = g2.state();
  assert.equal(s.player.cx, 1);
  assert.equal(s.player.cy, 1);
  assert.equal(s.maze[1][2], '+');
});

test('放炸弹：落在脚下、2s 引信、同格不可重复、容量上限为 1', () => {
  const g = createGame({ seed: 42 });
  const r = g.submit('p1', 'bomb');
  assert.equal(r.ok, true);

  let s = g.state();
  assert.equal(s.bombs.length, 1);
  assert.equal(s.bombs[0].x, 1);
  assert.equal(s.bombs[0].y, 1);
  assert.equal(s.bombs[0].timer, BOMB_FUSE);
  assert.equal(s.bombs[0].power, BASE_POWER);
  assert.equal(s.bombs[0].owner, 'p1');
  assert.equal(s.player.bombs, 1);

  const again = g.submit('p1', 'bomb');
  assert.equal(again.ok, false);
  assert.equal(again.error, '这里已经有炸弹');

  // 离开这一格再放：容量只有 1，仍然拒绝
  run(g, 0.4, ['right']);
  const third = g.submit('p1', 'bomb');
  assert.equal(third.ok, false);
  assert.equal(third.error, '炸弹用完了');
});

test('炸弹倒计时：1.9s 仍在，2.0s 后爆炸并产生火焰', () => {
  const g = createGame({ seed: 7 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 1, y: 1, invuln: 0 });
  clearRoom(g, 3, 9, 3, 8);
  g.debugPlaceBomb({ x: 5, y: 6, timer: BOMB_FUSE, power: 2 });

  let s = run(g, 1.9, []);
  assert.equal(s.bombs.length, 1);

  s = run(g, 0.15, []);
  assert.equal(s.bombs.length, 0);
  assert.ok(s.flames.length > 0);
});

test('十字爆炸：射程 3 格，四个方向各 3 格，共 13 格火焰', () => {
  const g = createGame({ seed: 11 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 1, y: 1 });
  // 清出以 (6,5) 为中心的十字，保证 3 格射程内没有砖
  clearRoom(g, 3, 9, 5, 5);
  clearRoom(g, 6, 6, 2, 8);
  g.debugPlaceBomb({ x: 6, y: 5, timer: BOMB_FUSE, power: 3 });

  const s = run(g, 2.1, []);
  const cells = new Set(s.flames.map((f) => `${f.x},${f.y}`));
  assert.equal(s.flames.length, 13, `火焰应为 1+4×3=13 格，实际 ${s.flames.length}`);
  assert.ok(cells.has('6,5'));
  for (const [x, y] of [
    [6, 2],
    [6, 8],
    [3, 5],
    [9, 5],
  ]) {
    assert.ok(cells.has(`${x},${y}`), `射程第 3 格 (${x},${y}) 应有火焰`);
  }
  assert.ok(!cells.has('6,1'), '第 4 格不应有火焰');
  assert.ok(!cells.has('2,5'), '第 4 格不应有火焰');
});

test('炸毁砖墙：砖被清成通道，火焰止于砖不再穿透', () => {
  const g = createGame({ seed: 13 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 1, y: 1 });
  clearRoom(g, 3, 9, 5, 5);
  clearRoom(g, 5, 5, 3, 7);
  g.debugSetCell(3, 5, '+'); // 砖墙挡在左侧射程内
  g.debugPlaceBomb({ x: 5, y: 5, timer: BOMB_FUSE, power: 3 });

  const s = run(g, 2.1, []);
  assert.equal(s.maze[5][3], ' ', '砖墙应被炸毁');
  const cells = new Set(s.flames.map((f) => `${f.x},${f.y}`));
  assert.ok(cells.has('4,5'));
  assert.ok(cells.has('3,5'), '砖墙格应有火焰');
  assert.ok(!cells.has('2,5'), '火焰不应穿过砖墙');
});

test('钢墙阻挡：钢墙方向零射程，定向射击不外溢', () => {
  const g = createGame({ seed: 17 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 9, y: 9 });
  clearRoom(g, 1, 5, 1, 1);
  // 炸弹贴着外围钢墙(上)与钢柱(下)放置
  g.debugPlaceBomb({ x: 2, y: 1, timer: BOMB_FUSE, power: 3 });

  const s = run(g, 2.1, []);
  assert.ok(s.flames.length > 0);
  assert.ok(!s.flames.some((f) => f.y === 0), '钢墙外不应有火焰');
  assert.ok(!s.flames.some((f) => f.x === 2 && f.y === 2), '钢柱不应被火穿透');
  assert.ok(s.flames.some((f) => f.x === 1 && f.y === 1));
});

test('道具拾取：射程/速度/炸弹上限提升并加分', () => {
  const g = createGame({ seed: 19 });
  g.debugSetPlayer({ x: 1, y: 1 });
  g.debugSpawnItem(1, 1, 'power');
  let s = run(g, 0.1, []);
  assert.equal(s.items.length, 0);
  assert.equal(s.player.power, BASE_POWER + 1);
  assert.equal(s.score, 20);

  g.debugSpawnItem(1, 1, 'speed');
  s = run(g, 0.1, []);
  assert.equal(s.player.speed, 3.65);
  assert.equal(s.score, 40);

  g.debugSpawnItem(1, 1, 'bomb');
  s = run(g, 0.1, []);
  assert.equal(s.player.maxBombs, 2);
  assert.equal(s.score, 60);
});

test('炸弹上限随分数提升：600 分时同时可放 2 颗', () => {
  const g = createGame({ seed: 23 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 1, y: 1, score: 600 });
  assert.equal(g.state().player.maxBombs, 2);

  assert.equal(g.submit('p1', 'bomb').ok, true);
  run(g, 0.4, ['right']);
  const second = g.submit('p1', 'bomb');
  assert.equal(second.ok, true);
  const s = g.state();
  assert.equal(s.bombs.length, 2);
  assert.equal(s.player.bombs, 2);

  run(g, 0.4, ['right']);
  const third = g.submit('p1', 'bomb');
  assert.equal(third.ok, false);
  assert.equal(third.error, '炸弹用完了');
});

test('炸死敌人得 100 分；只有敌人全灭才过关', () => {
  const g = createGame({ seed: 29 });
  g.debugSetPlayer({ x: 1, y: 1 });
  clearRoom(g, 3, 9, 3, 9);
  g.debugSetEnemies([{ x: 6, y: 5, interval: 99, timer: 99 }, dummyEnemy(11, 9)]);
  g.debugPlaceBomb({ x: 6, y: 7, timer: BOMB_FUSE, power: 3 });

  const s = run(g, 2.1, []);
  assert.equal(s.enemies.length, 1, '射程内的敌人应被炸死');
  assert.equal(s.score, 100);
  assert.equal(s.solved, false);
});

test('炸到自己减命：站立不动被自己的火焰命中，扣 1 命并回到出生点', () => {
  const g = createGame({ seed: 31 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 5, y: 5, invuln: 0 });
  g.debugPlaceBomb({ x: 5, y: 5, timer: BOMB_FUSE, power: 3, passTimer: 0 });

  const s = run(g, 2.1, []);
  assert.equal(s.lives, 2);
  assert.equal(s.over, false);
  assert.equal(s.player.cx, 1);
  assert.equal(s.player.cy, 1);
  assert.ok(s.player.invuln > 0);
});

test('3 命耗尽：连续三次被炸，游戏结束并给出 result', () => {
  const g = createGame({ seed: 37 });
  g.debugSetEnemies([dummyEnemy()]);
  g.debugSetPlayer({ x: 1, y: 1, invuln: 0 });

  for (let i = 0; i < 3; i++) {
    g.debugPlaceBomb({ x: 1, y: 1, timer: 0.05, power: 3, passTimer: 0 });
    run(g, 0.2, []);
    if (i < 2) run(g, 2.1, []); // 等无敌时间结束
  }

  const s = g.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);
  const r = g.result();
  assert.ok(r);
  assert.equal(r.over, true);
  assert.equal(r.score, s.score);
  assert.equal(typeof r.text, 'string');
});

test('过关：炸死全部敌人即 solved，短暂结算后进入下一关（砖更多、敌人更快）', () => {
  const g = createGame({ seed: 41 });
  const bricks1 = brickTotal(g.state());
  g.debugSetPlayer({ x: 1, y: 1 });
  clearRoom(g, 3, 9, 3, 9);
  g.debugSetEnemies([{ x: 6, y: 5, interval: 99, timer: 99 }]);
  g.debugPlaceBomb({ x: 6, y: 7, timer: BOMB_FUSE, power: 3 });

  let s = run(g, 2.1, []);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.solved, true);
  assert.equal(s.level, 1);
  assert.ok(s.clearTimer > 0 && s.clearTimer <= CLEAR_DELAY);
  assert.ok(s.score >= 300, '击杀 100 + 过关奖励 200');

  s = run(g, 1.3, []);
  assert.equal(s.solved, false);
  assert.equal(s.level, 2);
  assert.equal(s.enemies.length, 3, '第 2 关 3 只敌人');
  assert.ok(brickTotal(s) > bricks1, `第 2 关砖更多：${bricks1} → ${brickTotal(s)}`);
  assert.ok(s.enemies[0].interval < 0.62, '第 2 关敌人更快');
});

test('reset 与同种子重开：地图与初始状态完全一致', () => {
  const a = createGame({ seed: 61 });
  const mazeA = a.state().maze;
  a.submit('p1', 'bomb');
  run(a, 0.4, ['right']);
  a.debugHurt();
  a.reset();

  const s = a.state();
  assert.equal(s.score, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.level, 1);
  assert.equal(s.bombs.length, 0);
  assert.equal(s.over, false);
  assert.equal(s.player.cx, 1);
  assert.equal(s.player.cy, 1);
  assert.deepEqual(s.maze, mazeA);

  const b = createGame({ seed: 61 });
  assert.deepEqual(b.state().maze, mazeA, '同种子应生成同一张地图');
});

test('状态序列化：state() 每次新对象，JSON 往返一致且不被外部改动污染', () => {
  const g = createGame({ seed: 43 });
  g.submit('p1', 'bomb');
  run(g, 0.3, ['right']);

  const s = g.state();
  const roundTrip = JSON.parse(JSON.stringify(s));
  assert.deepEqual(roundTrip, s);

  for (const key of ['turn', 'maze', 'player', 'enemies', 'bombs', 'flames', 'items', 'score', 'lives', 'level', 'over', 'solved']) {
    assert.ok(key in s, `state 缺少字段 ${key}`);
  }
  for (const key of ['x', 'y', 'power', 'bombs', 'maxBombs', 'speed', 'invuln']) {
    assert.ok(key in s.player, `player 缺少字段 ${key}`);
  }
  for (const b of s.bombs) {
    for (const key of ['x', 'y', 'timer', 'power', 'owner']) assert.ok(key in b);
  }

  const s2 = g.state();
  assert.notStrictEqual(s2, s);
  s2.player.x = 999;
  s2.bombs.length = 0;
  const s3 = g.state();
  assert.notEqual(s3.player.x, 999);
  assert.equal(s3.bombs.length, s.bombs.length);
  assert.equal(s3.turn, 'p1');
});

test('放置后 0.8s 内可穿过自己的炸弹，超时后炸弹变成实体阻挡', () => {
  const g = createGame({ seed: 47 });
  g.debugSetEnemies([{ x: 11, y: 9, interval: 99, timer: 99 }]);
  g.debugSetPlayer({ x: 1, y: 1, invuln: 0 });
  // 长引信炸弹：本用例只看 0.8s 通行窗口，不触发爆炸
  assert.ok(g.debugPlaceBomb({ x: 1, y: 1, timer: 30, power: 3, passTimer: 0.8 }));
  assert.ok(g.state().bombs[0].passTimer > 0.7, '刚放置时应有约 0.8s 通行窗口');

  // 先在窗口内向右离开，再立即掉头走回炸弹格
  run(g, 0.32, ['right']);
  run(g, 0.1, ['left']);
  run(g, 0.4, []);
  let s = g.state();
  assert.equal(s.player.cx, 1, '0.8s 内应能重新进入炸弹格');
  assert.equal(s.bombs.length, 1, '炸弹仍在计时');

  // 等窗口彻底关闭，再从旁边走向炸弹格：应被挡住
  run(g, 0.5, []);
  run(g, 0.4, ['right']);
  run(g, 1.0, ['left']);
  run(g, 0.3, []);
  s = g.state();
  assert.equal(s.player.cx, 2, '超时后不应再能进入炸弹格');
  assert.equal(s.player.cy, 1);
});

test('敌人接触玩家减命：同格相遇扣 1 命并短暂无敌', () => {
  const g = createGame({ seed: 59 });
  g.debugSetPlayer({ x: 5, y: 5, invuln: 0 });
  g.debugSetEnemies([{ x: 5, y: 5, interval: 99, timer: 99 }]);

  let s = run(g, 0.05, []);
  assert.equal(s.lives, 2);
  assert.equal(s.over, false);
  assert.equal(s.player.cx, 1, '复活回应出生点');
  assert.ok(s.player.invuln > 1.5);

  // 无敌期内继续贴着也不会再扣命
  g.debugSetEnemies([{ x: 1, y: 1, interval: 99, timer: 99 }]);
  s = run(g, 0.5, []);
  assert.equal(s.lives, 2);
});

test('连走 2000 步不崩：随机方向 + 周期放弹，state 始终可序列化', () => {
  const g = createGame({ seed: 53 });
  const dirs = ['right', 'down', 'left', 'up'];
  for (let i = 0; i < 2000; i++) {
    g.step(1 / 60, [dirs[Math.floor(i / 20) % 4]]);
    if (i % 120 === 0) g.submit('p1', 'bomb');
    if (i % 100 === 0) {
      const s = g.state();
      assert.ok(Number.isFinite(s.score));
      assert.ok(s.lives >= 0 && s.lives <= 3);
      assert.ok(Number.isInteger(s.level) && s.level >= 1);
      for (const e of s.enemies) {
        assert.equal(s.maze[e.cy][e.cx], ' ', '敌人必须站在通道格');
        assert.ok(e.x >= 0 && e.x < s.cols && e.y >= 0 && e.y < s.rows);
      }
      for (const b of s.bombs) {
        assert.ok(s.maze[b.y][b.x] === ' ', '炸弹必须落在通道格');
        assert.ok(b.timer > 0);
      }
      assert.doesNotThrow(() => JSON.stringify(s));
    }
  }
  const s = g.state();
  assert.ok(s.ticks > 0);
  assert.equal(typeof s.over, 'boolean');
  assert.equal(typeof s.solved, 'boolean');
});
