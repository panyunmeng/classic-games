import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGame,
  normalizeSeat,
  COLS,
  ROWS,
  CELL,
  OFF_X,
  OFF_Y,
  INTERVAL,
  TIME_TOTAL,
  FOOD_MAX,
  FOOD_TARGET,
  FOOD_SCORE,
  START_LENGTH,
  W,
  H,
} from '../logic.mjs';
import { chooseMove } from '../ai.mjs';

const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** 剥掉注释，只留代码，用于纯逻辑门禁自检（与 scripts/build.mjs 同规则） */
function codeOnly(url) {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function seatOf(g, id) {
  return g.state().snakes.find((s) => s.id === id);
}

test('01 开局：单机你 + 3 条 AI、双人 2 条、联机按座位去重', () => {
  const solo = createGame({ seed: 1, mode: 'solo' });
  const s = solo.state();
  assert.equal(s.turn, null, '实时制 turn 为 null，但字段必须在');
  assert.ok('turn' in s);
  assert.equal(s.mode, 'solo');
  assert.equal(s.snakes.length, 4);
  assert.equal(s.snakes[0].id, 'p1');
  assert.equal(s.snakes[0].ai, false);
  assert.ok(s.snakes.slice(1).every((x) => x.ai), '其余三条是 AI');
  assert.deepEqual(s.seats, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(s.aliveCount, 4);
  assert.equal(s.timeLeft, TIME_TOTAL);
  assert.equal(s.tick, 0);
  assert.equal(s.over, false);
  assert.equal(s.winner, null);
  assert.ok(s.snakes.every((x) => x.alive && x.segments.length === START_LENGTH));
  assert.ok(s.foods.length >= FOOD_TARGET, '开局有散落食物');
  assert.equal(s.cols, COLS);
  assert.equal(s.rows, ROWS);
  assert.equal(s.cell, CELL);
  assert.equal(s.w, W);
  assert.equal(s.h, H);
  assert.equal(s.offX, OFF_X);
  assert.equal(s.offY, OFF_Y);
  assert.equal(typeof s.score, 'number', '单机/同屏给主分数供 shell 顶栏显示');
  assert.equal(typeof s.hud, 'string');
  assert.ok(s.interval >= 0.09);

  const duo = createGame({ seed: 2, mode: 'local2p' });
  assert.equal(duo.state().snakes.length, 2);
  assert.ok(duo.state().snakes.every((x) => x.ai === false));

  const net = createGame({ seed: 3, mode: 'online', players: ['p1', 'p2'] });
  assert.equal(net.state().snakes.length, 2);

  const net2 = createGame({ seed: 4, mode: 'online', players: ['p2', 'p2'] });
  assert.deepEqual(net2.state().seats, ['p1', 'p2'], '座位去重且至少 2 条');

  // 座位归一化：shell.submit 的 0/1 索引与 'p1' 字符串都认
  assert.equal(normalizeSeat(0), 'p1');
  assert.equal(normalizeSeat(1), 'p2');
  assert.equal(normalizeSeat('p3'), 'p3');
  assert.equal(normalizeSeat('P4'), 'p4');
  assert.equal(normalizeSeat('p9'), null);
});

test('02 转向：非反向接受、反向拒绝，下一步才生效', () => {
  const g = createGame({ seed: 7, mode: 'local2p' });
  assert.equal(seatOf(g, 'p1').dir, 'right');
  assert.equal(g.submit('p1', 'left').ok, false, '不能直接反向');
  assert.equal(seatOf(g, 'p1').dir, 'right');

  assert.equal(g.submit('p1', 'up').ok, true);
  assert.equal(g.submit('p1', 'down').ok, false, '排队中的 up 也不能被反向');
  g.step(INTERVAL);
  assert.equal(seatOf(g, 'p1').dir, 'up');

  // 数字座位（shell.submit(playerId=0/1) 的约定）
  assert.equal(g.submit(1, 'left').ok, true);
  g.step(INTERVAL);
  assert.equal(seatOf(g, 'p2').dir, 'left');

  // 白名单外动作一律拒绝
  for (const bad of ['action', 'place:3,4', 'pointer:10', 'none', '', 'UP']) {
    assert.equal(g.submit('p1', bad).ok, false, `动作 ${bad} 应被拒绝`);
  }
});

test('03 吃食物：长一节、加 10 分、食物消失并按目标数补位', () => {
  const g = createGame({ seed: 11, mode: 'local2p' });
  const s0 = g.state();
  const head = s0.snakes[0].segments[0];
  const len0 = s0.snakes[0].segments.length;
  const food = { x: head.x + 1, y: head.y, id: 9001 };
  g.debugSet({ foods: [food], interval: INTERVAL });
  g.step(INTERVAL);
  const s1 = g.state();
  const p1 = s1.snakes[0];
  assert.equal(p1.segments.length, len0 + 1, '吃到食物变长一节');
  assert.equal(p1.eaten, 1);
  assert.equal(p1.score, FOOD_SCORE + 1, '食物 10 分 + 存活 1 分');
  assert.equal(s1.foods.some((f) => f.x === food.x && f.y === food.y), false, '食物已被吃掉');
  assert.ok(s1.foods.length >= FOOD_TARGET, '散落食物补足');
  assert.ok(s1.interval < INTERVAL, '进食后全场节奏加快');
  assert.ok(s1.interval >= 0.09);
});

test('04 撞墙即死：出界那一步出局，最后存活者获胜', () => {
  const g = createGame({ seed: 5, mode: 'local2p' });
  g.debugSet({
    snakes: { p1: { dir: 'left', segments: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }] } },
  });
  g.step(INTERVAL);
  const s = g.state();
  const p1 = s.snakes[0];
  assert.equal(p1.alive, false);
  assert.equal(p1.cause, 'wall');
  assert.equal(p1.segments.length, 0, '身体已变食物');
  assert.equal(s.aliveCount, 1);
  assert.equal(s.over, true);
  assert.equal(s.winner, 'p2');
  assert.equal(g.result().winner, 'p2');
  // 撞墙的坐标上没有食物（越界格不存在），身体格 (0,1)(1,1)(2,1) 有
  const cells = s.foods.map((f) => `${f.x},${f.y}`);
  for (const c of ['0,1', '1,1', '2,1']) assert.ok(cells.includes(c), `身体格 ${c} 应变成食物`);
});

test('05 撞他蛇身体即死：被撞的那条不掉血照样活', () => {
  const g = createGame({ seed: 6, mode: 'local2p' });
  g.debugSet({
    snakes: {
      p1: { dir: 'right', segments: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }] },
      p2: { dir: 'down', segments: [{ x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }] },
    },
  });
  g.step(INTERVAL);
  const s = g.state();
  const p1 = s.snakes[0];
  const p2 = s.snakes[1];
  assert.equal(p1.alive, false);
  assert.equal(p1.cause, 'body');
  assert.equal(p2.alive, true);
  assert.deepEqual(p2.segments[0], { x: 6, y: 6 });
  assert.equal(s.winner, 'p2');
});

test('06 出局后身体全部变食物，且不落在活蛇身上', () => {
  const g = createGame({ seed: 8, mode: 'local2p' });
  g.debugSet({
    snakes: {
      p1: { dir: 'right', segments: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }] },
      p2: { dir: 'down', segments: [{ x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }] },
    },
  });
  g.step(INTERVAL);
  const s = g.state();
  const cells = new Set(s.foods.map((f) => `${f.x},${f.y}`));
  for (const c of ['5,5', '4,5', '3,5']) assert.ok(cells.has(c), `出局身体格 ${c} 变食物`);
  const live = new Set();
  for (const sn of s.snakes) {
    if (!sn.alive) continue;
    for (const c of sn.segments) live.add(`${c.x},${c.y}`);
  }
  for (const f of s.foods) assert.equal(live.has(`${f.x},${f.y}`), false, '食物不落在活蛇身上');
  assert.equal(s.snakes[0].segments.length, 0);
});

test('07 计分：每存活一步 +1，吃食物再 +10', () => {
  const g = createGame({ seed: 12, mode: 'local2p' });
  g.debugSet({ foods: [] });
  for (let i = 0; i < 4; i++) g.step(INTERVAL);
  const s = g.state();
  assert.equal(s.tick, 4);
  for (const sn of s.snakes) {
    if (!sn.alive) continue;
    assert.equal(sn.score, s.tick + sn.eaten * FOOD_SCORE, `${sn.id} 分数 = 存活步数 + 吃食`);
    assert.ok(sn.score > 0);
  }
  assert.ok(s.foods.length >= FOOD_TARGET, '食物被补足');
});

test('08 时间到按体长判胜（并列再比分数）', () => {
  const g = createGame({ seed: 13, mode: 'local2p' });
  g.debugSet({
    snakes: {
      p1: { dir: 'right', segments: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }] },
      p2: { dir: 'down', segments: [{ x: 20, y: 20 }, { x: 20, y: 19 }] },
    },
    foods: [{ x: 10, y: 30, id: 1 }],
    timeLeft: INTERVAL,
  });
  g.step(INTERVAL);
  const s = g.state();
  assert.equal(s.timeLeft, 0);
  assert.equal(s.over, true);
  assert.equal(s.winner, 'p1', '体长 5 比 2 长');
  assert.equal(s.aliveCount, 2);
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.winner, 'p1');
  assert.match(r.text, /P1 5 节/);
  // 结束后再 step 不再改状态
  const frozen = JSON.stringify(g.state());
  g.step(INTERVAL, [{ seat: 'p1', action: 'up' }]);
  assert.equal(JSON.stringify(g.state()), frozen);
  assert.equal(g.submit('p1', 'up').ok, false);
});

test('09 两头同格：双方出局、身体各变食物、平局', () => {
  const g = createGame({ seed: 14, mode: 'local2p' });
  g.debugSet({
    snakes: {
      p1: { dir: 'right', segments: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }] },
      p2: { dir: 'left', segments: [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }] },
    },
  });
  g.step(INTERVAL);
  const s = g.state();
  assert.equal(s.aliveCount, 0);
  assert.equal(s.over, true);
  assert.equal(s.winner, 'draw');
  assert.equal(s.snakes[0].cause, 'head');
  assert.equal(s.snakes[1].cause, 'head');
  const cells = new Set(s.foods.map((f) => `${f.x},${f.y}`));
  for (const c of ['5,5', '4,5', '3,5', '7,5', '8,5', '9,5']) assert.ok(cells.has(c));
  assert.equal(g.result().title, '同归于尽');
});

test('10 AI：只出合法转向、朝最近食物走、同局面可复现', () => {
  const st = {
    cols: COLS,
    rows: ROWS,
    snakes: [{ id: 'p2', dir: 'up', alive: true, segments: [{ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 12 }] }],
    foods: [{ x: 14, y: 10 }],
  };
  const mv = chooseMove(st, 'p2', 1);
  assert.equal(mv, 'right', '食物在右侧 → 向右追');
  assert.equal(chooseMove(st, 'p2', 1), mv, '纯函数：同局面同结果');
  assert.equal(chooseMove(st, 'p2', 1, null), mv);

  // 任何朝向下都不出反向、不越界、不出白名单
  for (const dir of ['up', 'down', 'left', 'right']) {
    const s2 = { ...st, snakes: [{ ...st.snakes[0], dir }] };
    const m2 = chooseMove(s2, 'p2', 2);
    assert.ok(m2 === null || ['left', 'right', 'up', 'down'].includes(m2));
    assert.notEqual(m2, OPP[dir]);
  }

  // 整局跑 AI：方向始终合法且从不反向
  const g = createGame({ seed: 21, mode: 'solo' });
  const prev = {};
  for (let i = 0; i < 60; i++) {
    g.step(INTERVAL);
    const s = g.state();
    for (const sn of s.snakes) {
      if (!sn.ai) continue;
      assert.ok(['left', 'right', 'up', 'down'].includes(sn.dir));
      if (prev[sn.id]) assert.notEqual(sn.dir, OPP[prev[sn.id]], `${sn.id} 不得反向`);
      prev[sn.id] = sn.dir;
      for (const c of sn.segments) {
        assert.ok(c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS);
      }
    }
    if (s.over) break;
  }
  assert.ok(g.state().tick >= 20, 'AI 至少跑了 20 步');
});

test('11 状态序列化：每次新对象、JSON 往返一致、外部改不动内部', () => {
  const g = createGame({ seed: 3, mode: 'solo' });
  const a = g.state();
  const b = g.state();
  assert.notEqual(a, b);
  assert.notEqual(a.snakes, b.snakes);
  assert.notEqual(a.snakes[0], b.snakes[0]);
  assert.notEqual(a.snakes[0].segments, b.snakes[0].segments);
  assert.notEqual(a.foods, b.foods);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, '可 JSON 往返');
  assert.doesNotThrow(() => JSON.stringify(a));

  a.snakes[0].segments[0].x = -999;
  a.snakes[0].score = 12345;
  a.foods.length = 0;
  a.turn = 'p2';
  const c = g.state();
  assert.ok(c.snakes[0].segments[0].x >= 0);
  assert.notEqual(c.snakes[0].score, 12345);
  assert.ok(c.foods.length > 0);
  assert.equal(c.turn, null);
});

test('12 连走 3000 步不崩：数值有限、食物有界、身体不出界', () => {
  const g = createGame({ seed: 9, mode: 'solo' });
  for (let i = 0; i < 3000; i++) {
    g.step(INTERVAL);
    const s = g.state();
    assert.ok(Number.isFinite(s.timeLeft) && s.timeLeft >= 0);
    assert.ok(Number.isFinite(s.tick) && s.tick >= 0);
    assert.ok(s.foods.length <= FOOD_MAX, `食物数 ${s.foods.length} 超上限`);
    assert.ok(s.snakes.length === 4);
    for (const sn of s.snakes) {
      for (const c of sn.segments) {
        assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y));
        assert.ok(c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS);
      }
      assert.ok(Number.isFinite(sn.score) && sn.score >= 0);
    }
    if (s.over) {
      assert.ok(['p1', 'p2', 'p3', 'p4', 'draw'].includes(s.winner));
    }
  }
  const done = g.state();
  assert.equal(done.over, true, '90 s 内必然结束');
  assert.ok(g.result());
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(done)));
});

test('13 单机：玩家出局立刻结算；玩家最后存活则获胜', () => {
  // 玩家撞墙出局 → 立刻结算，标题不是“胜利”
  const g = createGame({ seed: 15, mode: 'solo' });
  g.debugSet({
    snakes: { p1: { dir: 'left', segments: [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }] } },
  });
  g.step(INTERVAL);
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.snakes[0].alive, false);
  assert.match(g.result().title, /惜败/);
  assert.ok(s.snakes.filter((x) => x.alive).length >= 2, 'AI 仍有存活');

  // 只剩玩家 → 玩家胜
  const g2 = createGame({ seed: 16, mode: 'solo' });
  g2.debugSet({
    snakes: {
      p2: { alive: false },
      p3: { alive: false },
      p4: { alive: false },
    },
  });
  g2.step(INTERVAL);
  const s2 = g2.state();
  assert.equal(s2.over, true);
  assert.equal(s2.winner, 'p1');
  assert.match(g2.result().title, /存活到最后/);
  assert.ok(g2.result().score > 0, '结算分数是玩家自己的分');
});

test('14 联机：step 接受 [{seat,action}]，白名单外动作不改方向', () => {
  const g = createGame({ seed: 30, mode: 'online', players: ['p1', 'p2'] });
  assert.equal(g.submit('p1', 'up').ok, true);
  g.step(INTERVAL);
  assert.equal(seatOf(g, 'p1').dir, 'up');

  // 服务端把输入攒成 [{seat,action}] 再调 step
  g.step(INTERVAL, [{ seat: 'p2', action: 'down' }]);
  assert.equal(seatOf(g, 'p2').dir, 'down');

  // 非法座位 / 非法词 / 反向都不生效
  g.step(INTERVAL, [
    { seat: 'p9', action: 'left' },
    { seat: 'p2', action: 'jump' },
    { seat: 'p2', action: 'up' },
    { seat: 'p1', action: 'place:3,4' },
  ]);
  assert.equal(seatOf(g, 'p1').dir, 'up');
  assert.equal(seatOf(g, 'p2').dir, 'down');
  assert.equal(g.submit('p9', 'left').ok, false);
  // 联机快照是公共的：不给“我的分”，用 hud 兜底（客户端按 seat 取分）
  const on = g.state();
  assert.equal('score' in on, false);
  assert.match(on.hud, /存活/);
  // 裸字符串动作归本机 p1
  g.step(INTERVAL, ['left']);
  assert.equal(seatOf(g, 'p1').dir, 'left');
});

test('15 纯逻辑门禁：logic/ai 无 DOM、无 Math.random、无时钟', () => {
  for (const rel of ['../logic.mjs', '../ai.mjs']) {
    const src = codeOnly(new URL(rel, import.meta.url));
    for (const [re, label] of [
      [/\bdocument\./, 'document'],
      [/\bwindow\./, 'window'],
      [/\bcanvas\./, 'canvas'],
      [/\bMath\.random\s*\(/, 'Math.random'],
      [/\bDate\.now\s*\(/, 'Date.now'],
      [/\bnew\s+Date\s*\(/, 'new Date'],
      [/\bperformance\.now\s*\(/, 'performance.now'],
    ]) {
      assert.ok(!re.test(src), `${rel} 不得出现 ${label}`);
    }
  }
});

test('19 完整一局：脚本玩家绕圈，AI 对抗到结束也不崩', () => {
  const g = createGame({ seed: 77, mode: 'solo' });
  let turns = 0;
  for (let i = 0; i < 900; i++) {
    const s = g.state();
    const me = s.snakes.find((x) => x.id === 'p1');
    if (me.alive) {
      const head = me.segments[0];
      let want = null;
      if (me.dir === 'right' && head.x >= COLS - 5) want = 'down';
      else if (me.dir === 'down' && head.y >= ROWS - 5) want = 'left';
      else if (me.dir === 'left' && head.x <= 4) want = 'up';
      else if (me.dir === 'up' && head.y <= 4) want = 'right';
      if (want && g.submit('p1', want).ok) turns += 1;
    }
    g.step(INTERVAL);
    if (g.state().over) break;
  }
  const s = g.state();
  assert.equal(s.over, true, '900 次 step（135 s）内必须结束');
  assert.ok(s.tick > 20, `不应开局即死（实际 ${s.tick} 步）`);
  assert.ok(turns > 0, '脚本玩家至少转过一次向');
  assert.equal(Number.isFinite(s.timeLeft), true);
  const r = g.result();
  assert.ok(r && ['p1', 'p2', 'p3', 'p4', 'draw'].includes(r.winner));
  assert.ok(Number.isFinite(r.score));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});
