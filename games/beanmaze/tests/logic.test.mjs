import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, COLS, ROWS, MAZE, MOVE_INTERVAL, POWER_TIME } from '../logic.mjs';

function fresh(seed = 42) {
  return createGame({ seed });
}

/** 推进 n 个固定逻辑步（每步恰一格） */
function ticks(g, n) {
  for (let i = 0; i < n; i++) g.step(MOVE_INTERVAL, []);
}

test('1. 初始迷宫：19×21、222 豆（含 4 能量豆）、3 命、turn=p1', () => {
  const s = fresh().state();
  assert.equal(s.cols, COLS);
  assert.equal(s.rows, ROWS);
  assert.equal(MAZE.length, ROWS);
  assert.ok(MAZE.every((r) => r.length === COLS));
  assert.equal(s.beansLeft, 222);
  assert.equal(s.lives, 3);
  assert.equal(s.score, 0);
  assert.equal(s.turn, 'p1');
  assert.equal(s.over, false);
  assert.equal(s.ghosts.length, 4);
  assert.deepEqual(
    s.ghosts.map((g) => g.strategy),
    ['direct', 'predict', 'flank', 'random']
  );
});

test('2. 玩家移动与墙阻挡：向左吃豆，撞墙后停在原地', () => {
  const g = fresh();
  g.submit('p1', 'start');
  const p0 = g.state().player;
  assert.equal(p0.x, 9);
  assert.equal(p0.y, 15);
  // 连续向左推进，直到撞墙（第 1 列墙）
  ticks(g, 3);
  const p1 = g.state().player;
  assert.equal(p1.x, 6);
  assert.equal(p1.y, 15);
  ticks(g, 20);
  const p2 = g.state().player;
  assert.equal(p2.y, 15, '仍在原地这一行');
  assert.ok(p2.x >= 1, '不越出左墙');
});

test('3. 吃豆加分：普通豆 +10，能量豆 +50 且开启能量状态', () => {
  const g = fresh();
  // 起点 (9,15) 是空格；向左第 8 列与第 7 列都是豆
  g.submit('p1', 'dir:left');
  ticks(g, 1); // 走到 (8,15) 豆
  assert.equal(g.state().score, 10);
  ticks(g, 1); // 走到 (7,15) 豆
  assert.equal(g.state().score, 20);
  assert.equal(g.state().beansLeft, 220);

  // 摆一颗能量豆在正下方通道格 (7,16)
  g.debugSetCell(7, 16, 'o');
  g.debugSetActors({ x: 7, y: 15, dir: { x: 0, y: 1 }, nextDir: { x: 0, y: 1 } });
  g.submit('p1', 'dir:down');
  ticks(g, 1);
  const s = g.state();
  assert.equal(s.score, 70);
  assert.equal(s.powerTimer, POWER_TIME);
  assert.ok(s.ghosts.every((g) => g.mode === 'frightened' || g.mode === 'returning'), '鬼受惊');
});

test('4. 能量豆状态：倒计时结束恢复普通模式', () => {
  const g = fresh();
  g.debugSetCell(7, 15, 'o');
  g.debugSetActors({ x: 8, y: 15, dir: { x: -1, y: 0 }, nextDir: { x: -1, y: 0 } });
  g.submit('p1', 'dir:left');
  ticks(g, 1);
  assert.ok(g.state().powerTimer > 0);
  assert.ok(g.state().ghosts.every((g) => g.mode === 'frightened' || g.mode === 'returning'));
  ticks(g, Math.ceil(POWER_TIME / MOVE_INTERVAL) + 2);
  const s = g.state();
  assert.equal(s.powerTimer, 0);
  assert.ok(s.ghosts.every((g) => g.mode === 'chase' || g.mode === 'scatter' || g.mode === 'returning'), '恢复巡游');
});

test('5. 反吃鬼连击加分：200/400/800/1600，鬼变回巢态', () => {
  const g = fresh();
  g.debugSetCell(7, 15, 'o');
  g.debugSetActors(
    { x: 8, y: 15, dir: { x: -1, y: 0 }, nextDir: { x: -1, y: 0 } },
    [
      { x: 7, y: 15, mode: 'frightened' },
      { x: 7, y: 15, mode: 'frightened' },
      { x: 7, y: 15, mode: 'frightened' },
      { x: 7, y: 15, mode: 'frightened' },
    ]
  );
  g.submit('p1', 'dir:left');
  ticks(g, 1); // 吃能量豆，随后反吃 4 只鬼
  const s = g.state();
  assert.equal(s.chain, 4);
  // 50（豆）+ 200+400+800+1600 = 3050
  assert.equal(s.score, 3050);
  assert.ok(s.ghosts.every((g) => g.mode === 'returning'), '四鬼均变眼睛回巢');
  assert.equal(s.lives, 3);
});

test('6. 鬼碰玩家减命并复活：3 命逐级减少', () => {
  const g = fresh();
  // 无敌时间清零；把鬼直接放在玩家格上，避开能量状态
  g.debugSetActors({ x: 8, y: 15, invuln: 0 }, [{ x: 8, y: 15, mode: 'chase' }]);
  ticks(g, 1);
  assert.equal(g.state().lives, 2);
  assert.equal(g.state().player.x, 9, '复活回出生点');
  assert.equal(g.state().player.y, 15);
  assert.ok(g.state().player.invuln > 0, '复活短暂无敌');

  // 清掉无敌后再碰
  g.debugSetActors({ x: 8, y: 15, invuln: 0 }, [{ x: 8, y: 15, mode: 'chase' }]);
  ticks(g, 1);
  assert.equal(g.state().lives, 1);
});

test('7. 3 命结束：over=true、result 判负', () => {
  const g = fresh();
  g.debugSetActors({ x: 8, y: 15, invuln: 0 }, [{ x: 8, y: 15, mode: 'chase' }]);
  ticks(g, 1); // 2 命
  g.debugSetActors({ x: 8, y: 15, invuln: 0 }, [{ x: 8, y: 15, mode: 'chase' }]);
  ticks(g, 1); // 1 命
  g.debugSetActors({ x: 8, y: 15, invuln: 0 }, [{ x: 8, y: 15, mode: 'chase' }]);
  ticks(g, 1); // 0 命
  const s = g.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);
  const r = g.result();
  assert.ok(r && r.over === true);
  assert.equal(r.winner, null);
  assert.equal(r.score, s.score);
});

test('8. 豆吃光过关：over=true、win=true、result 判胜', () => {
  const g = fresh();
  g.debugSetBeansLeft(1);
  g.debugSetCell(8, 15, '.');
  g.debugSetActors({ x: 9, y: 15, dir: { x: -1, y: 0 }, nextDir: { x: -1, y: 0 } });
  g.submit('p1', 'dir:left');
  ticks(g, 1);
  const s = g.state();
  assert.equal(s.beansLeft, 0);
  assert.equal(s.over, true);
  assert.equal(s.win, true);
  const r = g.result();
  assert.equal(r.winner, 'p1');
  assert.match(r.title, /过关/);
});

test('9. 状态序列化：state() 每次新对象、JSON 往返一致', () => {
  const g = fresh();
  g.submit('p1', 'dir:up');
  ticks(g, 2);
  const s1 = g.state();
  const s2 = g.state();
  assert.notStrictEqual(s1, s2);
  assert.notStrictEqual(s1.player, s2.player);
  assert.notStrictEqual(s1.ghosts, s2.ghosts);
  const round = JSON.parse(JSON.stringify(s1));
  assert.deepEqual(round, s1);
});

test('10. 隧道环绕：第 10 行左右边界穿越不卡死', () => {
  const g = fresh();
  // 放在隧道行 (1,10) 朝左
  g.debugSetActors({ x: 1, y: 10, dir: { x: -1, y: 0 }, nextDir: { x: -1, y: 0 } });
  g.submit('p1', 'dir:left');
  ticks(g, 2);
  const s = g.state();
  assert.equal(s.player.y, 10);
  assert.ok(s.player.x === COLS - 1 || s.player.x === COLS - 2, '从左边界环绕到右侧');
});

test('11. 无效动作与结束后动作被拒：submit 返回 ok=false', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'dir:nowhere').ok, false);
  assert.equal(g.submit('p1', 'nonsense').ok, false);
  assert.equal(g.submit('p1', 'start').ok, true);
  g.debugSetBeansLeft(0);
  g.debugSetActors({ x: 9, y: 15 });
  g.submit('p1', 'dir:left');
  ticks(g, 1);
  assert.equal(g.state().over, true);
  assert.equal(g.submit('p1', 'dir:up').ok, false);
});

test('12. 连走 500 步不崩：状态始终合法', () => {
  const g = fresh(7);
  const dirs = ['up', 'left', 'down', 'right'];
  g.submit('p1', 'start');
  for (let i = 0; i < 500; i++) {
    if (i % 7 === 0) g.submit('p1', `dir:${dirs[i % 4]}`);
    g.step(MOVE_INTERVAL, []);
    const s = g.state();
    assert.ok(s.player.x >= 0 && s.player.x < COLS);
    assert.ok(s.player.y >= 0 && s.player.y < ROWS);
    assert.ok(s.lives >= 0 && s.lives <= 3);
    assert.ok(s.beansLeft >= 0);
    assert.ok(s.powerTimer >= 0);
    for (const gh of s.ghosts) {
      assert.ok(gh.x >= 0 && gh.x < COLS && gh.y >= 0 && gh.y < ROWS);
    }
    if (s.over) break;
  }
});

test('13. 重置可复现：同种子 reset 后状态一致', () => {
  const g = fresh(123);
  const s0 = g.state();
  g.submit('p1', 'dir:up');
  ticks(g, 30);
  g.reset();
  assert.deepEqual(g.state(), s0);
});

test('14. 确定性：同种子同输入得到相同轨迹', () => {
  const run = () => {
    const g = fresh(2024);
    const dirs = ['up', 'right', 'down', 'left'];
    g.submit('p1', 'start');
    for (let i = 0; i < 120; i++) {
      if (i % 5 === 0) g.submit('p1', `dir:${dirs[Math.floor(i / 5) % 4]}`);
      g.step(MOVE_INTERVAL, []);
      if (g.state().over) break;
    }
    return JSON.stringify(g.state());
  };
  assert.equal(run(), run());
});
