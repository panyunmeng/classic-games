/**
 * 坦克战场 · 纯逻辑单测（node --test）。
 *
 * 覆盖：初始地图/状态、格子移动与撞墙拒绝、水挡车、旋转、开火冷却、子弹飞行、
 * 钢墙挡弹、砖墙炸毁、子弹掠水、敌我子弹互消、击毁敌车得分、被击减命、
 * 出生无敌、3 命结束、过关、非法动作、状态不可变/可序列化、连走 2000 步、
 * 同种子确定性、本地双人与联机座位归属。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  MAZE,
  COLS,
  ROWS,
  CELL,
  BULLET_COOLDOWN,
  INVULN_TIME,
  MAX_LIVES,
} from '../logic.mjs';

const DIRS = ['up', 'right', 'down', 'left'];

/** 固定种子，保证胜负/弹道可复现 */
function fresh(opts = {}) {
  return createGame({ seed: 7, ...opts });
}

/** 清空敌军并冻结补位：让测试只观察玩家自己的行为，又不会误触发「过关」 */
function quiet(g) {
  g.debugSetEnemies([], 9);
  g.debugPauseSpawn(true);
  return g;
}

/** 按 1/60 精确推进 N 秒（step 单次最多补 0.25 s，长过程拆成子步） */
function run(g, seconds, actions = []) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) g.step(1 / 60, actions);
}

test('初始地图是 13×13，字符只用 # % ~ 空格，出生点是空格', () => {
  assert.equal(MAZE.length, ROWS);
  assert.equal(ROWS, 13);
  assert.equal(COLS, 13);
  for (const row of MAZE) {
    assert.equal(row.length, COLS);
    assert.match(row, /^[#%~ ]+$/);
  }
  assert.equal(MAZE[0], '#############');
  assert.equal(MAZE[12], '#############');
  // 玩家出生点 (6,11) 与三个敌军出生点必须是可通行空格
  assert.equal(MAZE[11][6], ' ');
  for (const [x, y] of [[1, 1], [6, 1], [11, 1]]) {
    assert.equal(MAZE[y][x], ' ');
  }
  // 三种地形都在
  const all = MAZE.join('');
  assert.ok(all.includes('#'));
  assert.ok(all.includes('%'));
  assert.ok(all.includes('~'));
});

test('初始状态字段齐全，turn 恒为 p1，状态可 JSON 序列化', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.score, 0);
  assert.equal(s.lives, MAX_LIVES);
  assert.equal(s.level, 1);
  assert.equal(s.over, false);
  assert.equal(s.solved, false);
  assert.deepEqual(Object.keys(s.player).sort(), ['cooldown', 'dir', 'invuln', 'x', 'y']);
  assert.equal(s.player.x, 6);
  assert.equal(s.player.y, 11);
  assert.equal(s.player.dir, 'up');
  assert.equal(s.enemies.length, 3);
  assert.ok(s.bullets.every((b) => ['x', 'y', 'vx', 'vy', 'owner'].every((k) => k in b)));
  const round = JSON.parse(JSON.stringify(s));
  assert.equal(round.turn, 'p1');
  assert.equal(round.maze.length, ROWS);
  assert.equal(g.result(), null);
});

test('敌军总数 3～6 辆：第 1 关 3 辆、第 4 关 6 辆，同屏最多 3 辆', () => {
  const g1 = fresh();
  assert.equal(g1.state().total, 3);
  assert.equal(g1.state().remaining, 3);
  assert.equal(g1.state().enemies.length, 3);

  const g4 = fresh({ level: 4 });
  assert.equal(g4.state().total, 6);
  assert.equal(g4.state().remaining, 6);
  assert.equal(g4.state().enemies.length, 3); // 其余排队补位

  const g9 = fresh({ level: 9 });
  assert.equal(g9.state().total, 6); // 封顶 6
});

test('按住方向可整格推进：0.2 s 走一格', () => {
  const g = quiet(fresh());
  g.step(0.2, ['up']);
  assert.equal(g.state().player.x, 6);
  assert.equal(g.state().player.y, 10);
  assert.equal(g.state().player.dir, 'up');
});

test('撞钢墙 / 砖墙：坦克不移动，墙不变', () => {
  const steel = quiet(fresh());
  steel.debugSetPlayer('p1', { x: 1, y: 11 });
  steel.debugSetCell(1, 10, '#');
  run(steel, 0.3, ['up']);
  assert.equal(steel.state().player.y, 11);
  assert.equal(steel.state().maze[10][1], '#');

  const brick = quiet(fresh());
  brick.debugSetPlayer('p1', { x: 1, y: 11 });
  brick.debugSetCell(1, 10, '%');
  run(brick, 0.3, ['up']);
  assert.equal(brick.state().player.y, 11);
  assert.equal(brick.state().maze[10][1], '%');
});

test('水阻挡坦克：不能开进水面', () => {
  const g = quiet(fresh());
  g.debugSetPlayer('p1', { x: 1, y: 11 });
  g.debugSetCell(1, 10, '~');
  run(g, 0.3, ['up']);
  assert.equal(g.state().player.y, 11);
  assert.equal(g.state().maze[10][1], '~');
});

test('旋转只换车头不位移，随后按新方向前进一格', () => {
  const g = quiet(fresh());
  const res = g.submit(0, 'right');
  assert.equal(res.ok, true);
  const s = g.state();
  assert.equal(s.player.dir, 'right');
  assert.equal(s.player.x, 6);
  assert.equal(s.player.y, 11);

  g.step(0.05, []);
  assert.equal(g.state().player.x, 6, '不足一格时间不位移');

  g.step(0.15, []);
  assert.equal(g.state().player.x, 7);
  assert.equal(g.state().player.y, 11);
});

test('开火：子弹沿车头飞出，冷却 0.4 s 内不能连射', () => {
  const g = quiet(fresh());
  assert.equal(g.submit(0, 'shoot').ok, true);
  g.step(1 / 60, []);
  let s = g.state();
  assert.equal(s.bullets.length, 1);
  assert.equal(s.bullets[0].owner, 'p1');
  assert.equal(s.bullets[0].side, 'player');
  assert.ok(s.bullets[0].vy < 0, '朝上开火 vy 应为负');
  assert.ok(s.player.cooldown > BULLET_COOLDOWN - 0.05);

  // 冷却期内再按开火：不产生第二颗子弹
  assert.equal(g.submit(0, 'shoot').ok, true);
  g.step(1 / 60, []);
  assert.equal(g.state().bullets.length, 1);
  assert.ok(g.state().player.cooldown > 0);

  // 冷却结束后可再次开火
  run(g, 0.5);
  assert.equal(g.state().player.cooldown, 0);
  assert.equal(g.submit(0, 'shoot').ok, true);
  g.step(1 / 60, []);
  assert.equal(g.state().bullets.length, 1);
  assert.ok(g.state().player.cooldown > 0.3);
});

test('子弹飞行并在钢墙前消失，钢墙不被破坏', () => {
  const g = quiet(fresh());
  g.debugSetCell(6, 9, '#');
  g.submit(0, 'shoot');
  g.step(1 / 60, []);
  const y0 = g.state().bullets[0]?.y;
  assert.ok(Number.isFinite(y0));

  run(g, 0.5);
  const s = g.state();
  assert.equal(s.bullets.length, 0);
  assert.equal(s.maze[9][6], '#');
});

test('子弹可以飞过水面', () => {
  const g = quiet(fresh());
  g.debugSetCell(6, 9, '~');
  g.submit(0, 'shoot');
  g.step(0.2, []);
  const s = g.state();
  assert.equal(s.bullets.length, 1, '水不挡子弹');
  const b = s.bullets[0];
  assert.ok(b.y >= 9 * CELL && b.y <= 10 * CELL, '子弹应已进入水格');
  assert.equal(s.maze[9][6], '~');
});

test('砖墙被子弹逐格炸毁：一弹一格', () => {
  const g = quiet(fresh());
  // 初始地图 (6,7) 是砖墙
  assert.equal(g.state().maze[7][6], '%');
  g.submit(0, 'shoot');
  run(g, 0.5);
  const s = g.state();
  assert.equal(s.maze[7][6], ' ');
  assert.equal(s.bullets.length, 0);

  // 同一列里更远处的砖墙 (6,4) 不受这一发影响
  assert.equal(s.maze[4][6], '%');
});

test('敌我子弹相撞互相抵消', () => {
  const g = quiet(fresh());
  g.debugSetPlayer('p1', { x: 0, y: 0 }); // 挪开，避免干扰
  g.debugAddBullet({ x: 234, y: 300, vx: 0, vy: 300, owner: 'p1' });
  g.debugAddBullet({ x: 234, y: 340, vx: 0, vy: -300, owner: 'e1' });
  g.step(0.1, []);
  const s = g.state();
  assert.equal(s.bullets.length, 0);
  assert.ok(s.effects.some((e) => e.kind === 'spark'));
});

test('击毁敌车 +100 分，车体消失但砖墙保留', () => {
  const g = fresh();
  g.debugSetEnemies([{ x: 6, y: 8, dir: 'down' }], 2);
  g.submit(0, 'shoot');
  run(g, 0.5);
  const s = g.state();
  assert.equal(s.enemies.length, 0);
  assert.equal(s.score, 100);
  assert.equal(s.maze[7][6], '%', '子弹先命中敌车，不应打到后面的砖墙');
  // 还有 2 辆排队，未过关
  assert.equal(s.solved, false);
  assert.equal(s.over, false);
});

test('被击中减一条命并回出生点重生，重生带 2 s 无敌', () => {
  const g = quiet(fresh());
  g.debugSetPlayer('p1', { invuln: 0 });
  g.debugAddBullet({ x: 234, y: 380, vx: 0, vy: 300, owner: 'e1' });
  run(g, 0.2);
  const s = g.state();
  assert.equal(s.lives, 2);
  assert.equal(s.over, false);
  assert.equal(s.player.x, 6);
  assert.equal(s.player.y, 11);
  assert.ok(s.player.invuln > INVULN_TIME - 0.3, '重生应带接近 2 s 的无敌');
});

test('出生无敌期间子弹打不掉命', () => {
  const g = quiet(fresh());
  g.debugSetPlayer('p1', { invuln: 2 });
  g.debugAddBullet({ x: 234, y: 380, vx: 0, vy: 300, owner: 'e1' });
  run(g, 0.2);
  const s = g.state();
  assert.equal(s.lives, 3);
  assert.equal(s.bullets.length, 0, '无敌时子弹被护盾吞掉');
  assert.ok(s.effects.some((e) => e.kind === 'spark'));
});

test('3 条命耗尽：over=true、solved=false、result 判负', () => {
  const g = quiet(fresh());
  g.debugSetLives(1);
  g.debugSetPlayer('p1', { invuln: 0 });
  g.debugAddBullet({ x: 234, y: 380, vx: 0, vy: 300, owner: 'e1' });
  run(g, 0.2);
  const s = g.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);
  assert.equal(s.solved, false);
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.winner, null);
  assert.match(r.title, /游戏结束/);
});

test('击毁全部敌车：solved=true、over=true、result 判胜', () => {
  const g = fresh();
  g.debugClearEnemies();
  g.step(1 / 60, []);
  const s = g.state();
  assert.equal(s.remaining, 0);
  assert.equal(s.solved, true);
  assert.equal(s.over, true);
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.winner, 'p1');
  assert.match(r.title, /过关/);
});

test('非法动作被拒绝，不改变状态', () => {
  const g = quiet(fresh());
  assert.equal(g.submit(0, 'fly').ok, false);
  assert.equal(g.submit(0, null).ok, false);
  assert.equal(g.submit('p2', 'left').ok, false, '单人局没有 p2 坦克');
  assert.equal(g.submit(0, 'start').ok, true);
  assert.equal(g.state().player.dir, 'up');
});

test('state() 每次返回新对象，外部改快照不影响内部状态', () => {
  const g = quiet(fresh());
  const s1 = g.state();
  s1.player.x = 0;
  s1.maze[11] = 'XXXXXXXXXXXXX';
  s1.enemies.push({ x: 0, y: 0 });
  const s2 = g.state();
  assert.notEqual(s1, s2);
  assert.equal(s2.player.x, 6);
  assert.match(s2.maze[11], /^#/);
  assert.equal(s2.enemies.length, 0);
});

test('连走 2000 步不崩，状态始终可序列化', () => {
  const g = fresh({ seed: 42 });
  g.debugSetLives(99);
  for (let i = 0; i < 2000; i++) {
    if (i % 10 === 0) g.submit(0, 'shoot');
    g.step(1 / 60, [DIRS[i % 4]]);
  }
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.ok(Number.isFinite(s.score));
  assert.ok(s.lives >= 0);
  assert.ok(Array.isArray(s.maze) && s.maze.length === ROWS);
  const round = JSON.parse(JSON.stringify(s));
  assert.equal(round.turn, 'p1');
});

test('同种子 + 同输入 = 同结果（确定性 rng）', () => {
  const a = fresh({ seed: 99 });
  const b = fresh({ seed: 99 });
  for (let i = 0; i < 400; i++) {
    const actions = [DIRS[i % 4]];
    if (i % 7 === 0) {
      a.submit(0, 'shoot');
      b.submit(0, 'shoot');
    }
    a.step(1 / 60, actions);
    b.step(1 / 60, actions);
  }
  assert.equal(JSON.stringify(a.state()), JSON.stringify(b.state()));
});

test('本地双人：p2 坦克存在，p2 前缀动作只动 p2', () => {
  const g = quiet(createGame({ seed: 7, mode: 'local2p' }));
  const s = g.state();
  assert.ok(s.player2);
  assert.equal(s.player2.x, 4);
  g.step(0.2, ['p2up']);
  assert.equal(g.state().player.y, 11, 'p1 不应被 p2 的动作带动');
  assert.equal(g.state().player2.y, 10);

  g.submit(0, 'p2shoot');
  g.step(1 / 60, []);
  assert.ok(g.state().bullets.some((b) => b.owner === 'p2'));
});

test('联机：{seat, action} 的动作归属服务端认定的座位', () => {
  const g = quiet(createGame({ seed: 7, mode: 'online' }));
  assert.ok(g.state().player2);
  // 带 seat 的裸方向只作用于该座位
  g.step(0.2, [{ seat: 'p2', action: 'left' }]);
  assert.equal(g.state().player.y, 11);
  assert.equal(g.state().player2.x, 3);

  assert.equal(g.submit('p2', 'right').ok, true);
  assert.equal(g.state().player2.dir, 'right');
  assert.equal(g.state().player.dir, 'up');
});
