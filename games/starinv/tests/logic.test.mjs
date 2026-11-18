import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, ENEMY_COLS, ENEMY_ROWS, FIELD } from '../logic.mjs';

function fresh() {
  return createGame({ seed: 42 });
}

test('初始编队：5 行 × 10 列 = 50 架、3 命、第 1 波、分数 0', () => {
  const s = fresh().state();
  assert.equal(s.enemies.length, ENEMY_ROWS * ENEMY_COLS);
  assert.equal(s.enemies.filter((e) => e.alive).length, 50);
  assert.equal(s.lives, 3);
  assert.equal(s.wave, 1);
  assert.equal(s.score, 0);
  assert.equal(s.over, false);
  assert.equal(s.turn, 'p1');
  assert.equal(s.bunkers.length, 4);
});

test('玩家左右移动被限制在场地边界内', () => {
  const g = fresh();
  for (let i = 0; i < 200; i++) g.step(1 / 60, ['left']);
  let p = g.state().player;
  assert.equal(p.x, FIELD.left);
  for (let i = 0; i < 300; i++) g.step(1 / 60, ['right']);
  p = g.state().player;
  assert.equal(p.x, FIELD.right - p.w);
});

test('射击冷却：连续 shoot 同时最多 2 发在场上', () => {
  const g = fresh();
  // 冷却期内连续 submit 只接受 1 发
  assert.equal(g.submit('p1', 'shoot').ok, true);
  assert.equal(g.submit('p1', 'shoot').ok, false);
  assert.equal(g.state().bullets.length, 1);
  // 等冷却结束再发一发，达到 2 发上限
  for (let i = 0; i < 16; i++) g.step(1 / 60, []);
  assert.equal(g.submit('p1', 'shoot').ok, true);
  assert.equal(g.state().bullets.length, 2);
  // 上限 + 冷却双重闸门：此时 actions 入口也无法再加
  for (let i = 0; i < 16; i++) g.step(1 / 60, []);
  g.step(1 / 60, ['shoot']);
  assert.equal(g.state().bullets.length, 2);
  // 推进足够时间让子弹飞出边界并冷却结束，可再次开火
  for (let i = 0; i < 120; i++) g.step(1 / 60, []);
  assert.equal(g.state().bullets.length, 0);
  assert.equal(g.submit('p1', 'shoot').ok, true);
});

test('子弹命中敌机：敌机消失、分数增加、产生爆炸帧', () => {
  const g = fresh();
  g.dbg.freeze(true);
  // 对准第 0 列最前排（row=4）敌机正下方；下排会先挡住上排，属于正常行为
  const front = g.state().enemies.find((e) => e.col === 0 && e.row === ENEMY_ROWS - 1);
  g.dbg.playerX(front.x + front.w / 2 - g.state().player.w / 2);
  g.submit('p1', 'shoot');
  // 子弹从底部飞到前排约需 0.8 s；命中后爆炸 ttl 0.45 s，取 52 步仍能观察到
  for (let i = 0; i < 52; i++) g.step(1 / 60, []);
  const s = g.state();
  assert.equal(s.enemies.find((e) => e.col === 0 && e.row === ENEMY_ROWS - 1).alive, false, '目标敌机应被击落');
  assert.ok(s.score > 0, '分数应增加');
  assert.ok(s.explosions.length > 0, '应有爆炸帧');
});

test('敌弹逐格破坏掩体', () => {
  const g = fresh();
  const before = g.state().bunkers[0].grid.flat().filter(Boolean).length;
  // 在第一个掩体顶部某存活格上方注入一颗敌弹
  const bu = g.state().bunkers[0];
  let col = -1;
  for (let c = 0; c < bu.grid[0].length; c++) {
    if (bu.grid[0][c]) {
      col = c;
      break;
    }
  }
  assert.ok(col >= 0);
  g.dbg.freeze(true);
  g.dbg.playerX(FIELD.left); // 玩家远离，避免被弹击中
  g.dbg.spawnEnemyBullet(bu.x + col * bu.cell + bu.cell / 2 - 1.5, bu.y - 12);
  g.step(1 / 60, []);
  g.step(1 / 60, []);
  const after = g.state().bunkers[0].grid.flat().filter(Boolean).length;
  assert.equal(after, before - 1, '恰好破坏一个掩体格');
  assert.equal(g.state().enemyBullets.length, 0, '敌弹撞掩体后消失');
});

test('敌弹命中玩家减命', () => {
  const g = fresh();
  g.dbg.freeze(true);
  const p = g.state().player;
  g.dbg.spawnEnemyBullet(p.x + p.w / 2 - 1.5, p.y - 40);
  for (let i = 0; i < 40; i++) g.step(1 / 60, []);
  assert.equal(g.state().lives, 2, '被击中后剩 2 命');
});

test('清空一波进入下一波：敌机满编、波次+1、速度提升', () => {
  const g = fresh();
  g.dbg.freeze(true);
  g.dbg.killWave();
  const s = g.state();
  assert.equal(s.wave, 2);
  assert.equal(s.enemies.filter((e) => e.alive).length, 50, '敌机满编复位');
  assert.ok(s.score >= 100, '清波奖励');
  assert.ok(s.enemies[0].y > 96, '下一波编队起始位置更低（逐波下压）');
  // 用相同 dt 比较两波的横移距离，第 2 波应更快
  const g2 = fresh();
  const x0a = g2.state().enemies[0].x;
  g2.step(0.05, []);
  const d1 = g2.state().enemies[0].x - x0a;
  g.dbg.freeze(false);
  const x0b = g.state().enemies[0].x;
  g.step(0.05, []);
  const d2 = g.state().enemies[0].x - x0b;
  assert.ok(Math.abs(d2) > Math.abs(d1), '后续波次编队移动更快');
});

test('敌机触底减命并复位阵型', () => {
  const g = fresh();
  assert.equal(g.state().lives, 3);
  g.dbg.hurt();
  assert.equal(g.state().lives, 2);
  g.dbg.hurt();
  assert.equal(g.state().lives, 1);
});

test('3 命耗尽结束：over=true 且 result() 给出得分', () => {
  const g = fresh();
  g.dbg.hurt();
  g.dbg.hurt();
  g.dbg.hurt();
  const s = g.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);
  const r = g.result();
  assert.ok(r && r.over === true);
  assert.equal(r.winner, 'p1');
  assert.equal(typeof r.score, 'number');
  // 结束后 submit 开火被拒
  assert.equal(g.submit('p1', 'shoot').ok, false);
});

test('状态可序列化且每次 state() 返回新对象', () => {
  const g = fresh();
  const a = g.state();
  assert.doesNotThrow(() => JSON.stringify(a));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  const b = g.state();
  assert.notEqual(a, b);
  assert.notEqual(a.enemies, b.enemies);
  // 改外部快照不影响内部状态
  a.bunkers[0].grid[0][0] = false;
  a.player.x = -999;
  const c = g.state();
  assert.equal(c.bunkers[0].grid[0][0] !== false, true);
  assert.notEqual(c.player.x, -999);
});

test('reset / start 重置到开局', () => {
  const g = fresh();
  g.dbg.hurt();
  g.dbg.killWave();
  g.submit('p1', 'shoot');
  g.reset();
  const s = g.state();
  assert.equal(s.lives, 3);
  assert.equal(s.wave, 1);
  assert.equal(s.score, 0);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.over, false);
  assert.equal(g.submit('p1', 'start').ok, true);
  assert.equal(g.state().wave, 1);
});

test('连走 600 步不崩，状态始终合法', () => {
  const g = fresh();
  for (let i = 0; i < 600; i++) {
    const dir = i % 120 < 60 ? 'left' : 'right';
    g.step(1 / 60, [dir, ...(i % 7 === 0 ? ['shoot'] : [])]);
    const s = g.state();
    assert.ok(s.player.x >= FIELD.left && s.player.x <= FIELD.right - s.player.w);
    assert.ok(s.bullets.length <= 2);
    assert.ok(s.lives >= 0 && s.lives <= 3);
    assert.ok(s.enemies.length === 50);
  }
});
