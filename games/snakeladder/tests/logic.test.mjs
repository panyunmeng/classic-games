import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  resolveMove,
  cellOf,
  numberOf,
  SNAKES,
  LADDERS,
  SIZE,
  LAST,
  PLAYER_IDS,
} from '../logic.mjs';
import { chooseMove } from '../ai.mjs';

/** 固定骰子序列的开局：测试不依赖 rng 具体序列，规则分支才可精确断言 */
function fresh(opts = {}) {
  return createGame({ seed: 42, ...opts });
}

const sixes = (n) => Array(n).fill(6);

/** 用当前回合方掷骰，返回 submit 结果 */
function roll(g) {
  const who = g.state().turn;
  return g.submit(who, 'roll');
}

test('1. 初始状态：100 格蛇形盘、固定蛇梯表、p1 先手、全部在起点', () => {
  const s = fresh({ mode: 'local2p' }).state();
  assert.equal(s.size, SIZE);
  assert.equal(s.last, LAST);
  assert.equal(s.players.length, 2);
  assert.deepEqual(s.players.map((p) => p.id), ['p1', 'p2']);
  assert.equal(s.players[0].pos, 0);
  assert.equal(s.players[1].pos, 0);
  assert.equal(s.players[0].rollCount, 0);
  assert.equal(s.turn, 'p1');
  assert.equal(s.dice, null);
  assert.equal(s.winner, null);
  assert.equal(s.over, false);
  assert.equal(s.moveCount, 0);
  assert.deepEqual(s.moves, []);
  assert.equal(s.lastMove, null);
  // 蛇与梯以 {头:尾} / {底:顶} 的纯数据形式暴露
  assert.deepEqual(s.snakes, { ...SNAKES });
  assert.deepEqual(s.ladders, { ...LADDERS });
});

test('2. 编号 1～100 走蛇形：1 左下、10 右下、11 在其正上方、100 左上', () => {
  assert.deepEqual(cellOf(1), { col: 0, row: 0 });
  assert.deepEqual(cellOf(10), { col: 9, row: 0 });
  assert.deepEqual(cellOf(11), { col: 9, row: 1 });
  assert.deepEqual(cellOf(20), { col: 0, row: 1 });
  assert.deepEqual(cellOf(21), { col: 0, row: 2 });
  assert.deepEqual(cellOf(100), { col: 0, row: 9 });
  assert.equal(cellOf(0), null);
  assert.equal(cellOf(101), null);
  // 逆运算对所有格子都成立
  for (let n = 1; n <= LAST; n++) {
    const { col, row } = cellOf(n);
    assert.equal(numberOf(col, row), n, `第 ${n} 格往返失败`);
    assert.ok(col >= 0 && col < SIZE && row >= 0 && row < SIZE);
  }
});

test('3. 蛇梯表不变量：端点合法、四组端点两两不重合、跳转终点不再触发', () => {
  const heads = Object.keys(SNAKES).map(Number);
  const tails = Object.values(SNAKES);
  const bases = Object.keys(LADDERS).map(Number);
  const tops = Object.values(LADDERS);
  const all = [...heads, ...tails, ...bases, ...tops];

  assert.equal(heads.length, 5);
  assert.equal(bases.length, 5);
  assert.equal(new Set(all).size, all.length, '蛇/梯端点不得互相重合');
  for (const n of all) assert.ok(n >= 2 && n <= 99, `端点 ${n} 越界`);
  for (const [h, t] of Object.entries(SNAKES)) assert.ok(Number(h) > t, '蛇头必须高于蛇尾');
  for (const [b, t] of Object.entries(LADDERS)) assert.ok(Number(b) < t, '梯底必须低于梯顶');
  // 「只触发一次」的结构性保证：跳转终点本身不是任何蛇头/梯底
  for (const target of [...tails, ...tops]) {
    assert.equal(SNAKES[target], undefined);
    assert.equal(LADDERS[target], undefined);
  }
});

test('4. 骰点恒为 1～6 的整数，且同种子必得同一串点数（可复现）', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const g = createGame({ seed, players: ['p1'] });
    assert.equal(g.state().dice, null, '未掷骰前 dice 必须是 null');
    assert.equal(g.submit('p1', 'roll').ok, true);
    const d = g.state().dice;
    assert.ok(Number.isInteger(d) && d >= 1 && d <= 6, `骰点 ${d} 非法`);
    seen.add(d);
  }
  assert.equal(seen.size, 6, '200 个种子应覆盖 1～6');

  const a = createGame({ seed: 2024, players: ['p1'] });
  const b = createGame({ seed: 2024, players: ['p1'] });
  const seqA = [];
  const seqB = [];
  for (let i = 0; i < 20; i++) {
    a.submit('p1', 'roll');
    b.submit('p1', 'roll');
    seqA.push(a.state().dice);
    seqB.push(b.state().dice);
  }
  assert.deepEqual(seqA, seqB, '同种子必须同序列');
});

test('5. 掷骰前进对应步数，回合在 p1/p2 之间轮换', () => {
  const g = fresh({ mode: 'local2p', rolls: [5, 1] });
  assert.equal(g.submit('p1', 'roll').ok, true);
  let s = g.state();
  assert.equal(s.players[0].pos, 5);
  assert.equal(s.dice, 5);
  assert.equal(s.turn, 'p2');

  assert.equal(g.submit('p2', 'roll').ok, true);
  s = g.state();
  assert.equal(s.players[1].pos, 1);
  assert.equal(s.dice, 1);
  assert.equal(s.turn, 'p1');
  assert.equal(s.moveCount, 2);
  assert.deepEqual(s.moves.map((m) => m.action), ['roll', 'roll']);
});

test('6. 踩到蛇头：按表下降，且只结算一次（不连环）', () => {
  const g = fresh({ players: ['p1'], rolls: [5, 5, 5, 5, 5, 4, 5] });
  for (let i = 0; i < 5; i++) roll(g);
  assert.equal(g.state().players[0].pos, 25);

  const r = roll(g); // 25 + 4 = 29 → 蛇 29 → 7
  assert.equal(r.ok, true);
  assert.equal(r.event, 'snake');
  assert.equal(r.jumpFrom, 29);
  assert.equal(r.jumpTo, 7);
  const s = g.state();
  assert.equal(s.players[0].pos, 7);
  assert.equal(s.lastMove.event, 'snake');
  assert.equal(s.lastMove.to, 7, '跳转后不得再触发第二次');

  roll(g); // 7 + 5 = 12，正常前进，证明已稳定在蛇尾
  assert.equal(g.state().players[0].pos, 12);
  assert.equal(g.state().moveCount, 7);
});

test('7. 踩到梯底：按表上升', () => {
  const g = fresh({ players: ['p1'], rolls: [5, 1] });
  roll(g);
  assert.equal(g.state().players[0].pos, 5);

  const r = roll(g); // 5 + 1 = 6 → 梯 6 → 31
  assert.equal(r.event, 'ladder');
  assert.equal(r.jumpFrom, 6);
  assert.equal(r.jumpTo, 31);
  assert.equal(g.state().players[0].pos, 31);
});

test('8. 恰好停在 100 才获胜：落点 100 立刻判胜并清空 turn', () => {
  // 0 →(6) 6 梯 31 → 37 43 49 55 61 67 73 79 85 91 →(3) 94 →(6) 100
  const rolls = [...sixes(11), 3, 6];
  const g = fresh({ players: ['p1'], rolls });
  for (let i = 0; i < 13; i++) {
    const r = roll(g);
    assert.equal(r.ok, true, `第 ${i + 1} 次掷骰应合法`);
    if (i < 12) assert.equal(g.state().winner, null, `第 ${i + 1} 次不应提前判胜`);
  }
  const s = g.state();
  assert.equal(s.players[0].pos, 100);
  assert.equal(s.winner, 'p1');
  assert.equal(s.turn, null);
  assert.equal(s.over, true);
  assert.equal(s.lastMove.event, 'move');

  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.equal(res.scores.p1, 1);
  assert.match(res.text, /100/);
  assert.equal(g.submit('p1', 'roll').ok, false, '胜局后不能再掷骰');
});

test('9. 骰点越过 100：停在原位不走，也不结算蛇梯', () => {
  const g = fresh({ players: ['p1'], rolls: [...sixes(13)] });
  for (let i = 0; i < 12; i++) roll(g);
  assert.equal(g.state().players[0].pos, 97); // 91 + 6

  const r = roll(g); // 97 + 6 = 103 > 100
  assert.equal(r.ok, true);
  assert.equal(r.event, 'stuck');
  assert.equal(r.dice, 6);
  const s = g.state();
  assert.equal(s.players[0].pos, 97, '超出 100 时原地不动');
  assert.equal(s.winner, null);
  assert.equal(s.turn, 'p1'); // 单人局轮到下一个还是自己
  assert.equal(s.lastMove.event, 'stuck');
});

test('10. 非法提交被拒绝：非本回合、未知动作、无效玩家', () => {
  const g = fresh({ mode: 'local2p', rolls: [3, 3] });
  assert.equal(g.submit('p2', 'roll').ok, false); // 还没轮到 p2
  assert.equal(g.submit('p9', 'roll').ok, false);
  assert.equal(g.submit('p1', 'jump').ok, false); // 未知动作
  assert.equal(g.state().moveCount, 0);
  assert.equal(g.state().players[0].pos, 0);

  g.submit('p1', 'roll');
  assert.equal(g.state().turn, 'p2');
  assert.equal(g.submit('p1', 'roll').ok, false);
  assert.equal(g.state().moveCount, 1);
});

test('11. AI 的着法恒为 roll，且只在轮到自己时出招（纯函数）', () => {
  const g = fresh({ mode: 'ai' });
  const s0 = g.state();
  const before = JSON.stringify(s0);
  assert.equal(chooseMove(s0, 'p1'), 'roll');
  assert.equal(chooseMove(s0, 0), 'roll'); // 外壳的数字下标
  assert.equal(chooseMove(s0, 'p2'), null); // 不是 p2 的回合
  assert.equal(chooseMove(s0, 'p9'), null);
  for (const level of [1, 2, 3]) assert.equal(chooseMove(s0, 'p1', level), 'roll');

  g.submit('p1', 'roll');
  const s1 = g.state();
  assert.equal(s1.turn, 'p2');
  assert.equal(chooseMove(s1, 'p2'), 'roll');
  assert.equal(chooseMove(s1, 1), 'roll');
  assert.equal(chooseMove(s1, 'p1'), null);

  // AI 只看不改：传进去的 state 必须原封不动
  assert.equal(JSON.stringify(g.state()), JSON.stringify(s1));
  const win = fresh({ players: ['p1'], rolls: [...sixes(11), 3, 6] });
  for (let i = 0; i < 13; i++) roll(win);
  assert.equal(chooseMove(win.state(), 'p1'), null, '已结束的局不再出招');
  assert.equal(before, JSON.stringify(s0));
});

test('12. 状态可 JSON 序列化、每次返回新对象、外部改动不污染内部', () => {
  const g = fresh({ mode: 'local2p', rolls: [5, 1, 2] });
  g.submit('p1', 'roll');
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.deepEqual(JSON.parse(json), s1);
  assert.ok(json.includes('"turn"'));

  s1.players[0].pos = 77;
  s1.moves.push({ fake: true });
  s1.snakes[1] = 2;
  const s2 = g.state();
  assert.equal(s2.players[0].pos, 5, '内部位置不应被外部快照改动');
  assert.equal(s2.moves.length, 1);
  assert.equal(s2.snakes[1], undefined);

  const s3 = g.state();
  assert.notEqual(s1, s3, 'state() 每次都要给新对象');
  assert.notEqual(s1.players, s3.players);
  assert.equal(s1.turn, s3.turn);
});

test('13. reset 回到开局，且同一 seed 的骰子序列可完整重放', () => {
  const g = fresh({ mode: 'local2p', rolls: [4, 2, 6] });
  g.submit('p1', 'roll');
  g.submit('p2', 'roll');
  assert.equal(g.state().moveCount, 2);

  g.reset();
  let s = g.state();
  assert.equal(s.moveCount, 0);
  assert.equal(s.dice, null);
  assert.equal(s.turn, 'p1');
  assert.equal(s.winner, null);
  assert.deepEqual(s.players.map((p) => p.pos), [0, 0]);

  const seq = [];
  for (let i = 0; i < 3; i++) {
    s = g.state();
    g.submit(s.turn, 'roll');
    seq.push(g.state().dice);
  }
  assert.deepEqual(seq, [4, 2, 6], 'reset 后固定序列应从头发放');

  const replay = createGame({ seed: 42, mode: 'local2p', rolls: [4, 2, 6] });
  const seq2 = [];
  for (let i = 0; i < 3; i++) {
    replay.submit(replay.state().turn, 'roll');
    seq2.push(replay.state().dice);
  }
  assert.deepEqual(seq2, seq);
});

test('14. 4 人局按 p1→p2→p3→p4 轮流，位置各自独立记账', () => {
  const g = createGame({ seed: 3, mode: 'local2p', players: ['p1', 'p2', 'p3', 'p4'], rolls: [1, 2, 3, 4] });
  const s0 = g.state();
  assert.equal(s0.playerCount, 4);
  assert.deepEqual(s0.players.map((p) => p.id), PLAYER_IDS);
  assert.equal(s0.turn, 'p1');

  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push(g.state().turn);
    assert.equal(g.submit(g.state().turn, 'roll').ok, true);
  }
  assert.deepEqual(order, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(g.state().turn, 'p1');
  assert.deepEqual(g.state().players.map((p) => p.pos), [1, 2, 3, 4]);
  assert.deepEqual(g.state().players.map((p) => p.rollCount), [1, 1, 1, 1]);
});

test('15. skip：放弃本回合，位置与骰点不变，回合照常交出', () => {
  const g = fresh({ mode: 'local2p', rolls: [5, 2] });
  g.submit('p1', 'roll');
  assert.equal(g.state().players[0].pos, 5);
  assert.equal(g.state().turn, 'p2');

  const r = g.submit('p2', 'skip');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.players[1].pos, 0);
  assert.equal(s.dice, 5, 'skip 不改动上一次骰点');
  assert.equal(s.lastMove.event, 'skip');
  assert.equal(s.moveCount, 2);
});

test('16. resolveMove 是纯函数：前进 / 梯 / 蛇 / 越界 四个分支都能单测', () => {
  assert.equal(resolveMove(50, 3).pos, 53);
  assert.equal(resolveMove(50, 3).event, 'move');
  assert.equal(resolveMove(0, 6).pos, 31); // 梯 6 → 31
  assert.equal(resolveMove(0, 6).event, 'ladder');
  assert.equal(resolveMove(37, 1).pos, 59); // 梯 38 → 59
  assert.equal(resolveMove(63, 1).pos, 41); // 蛇 64 → 41
  assert.equal(resolveMove(63, 1).event, 'snake');
  assert.equal(resolveMove(91, 6).pos, 97);
  assert.equal(resolveMove(97, 6).pos, 97);
  assert.equal(resolveMove(97, 6).event, 'stuck');
  assert.equal(resolveMove(97, 6).stuck, true);
  assert.equal(resolveMove(94, 6).pos, 100);
  assert.equal(resolveMove(94, 6).win, true);

  // 自定义表：说明升降完全由参数决定，不是写死在函数里
  assert.equal(resolveMove(10, 5, {}, { 15: 40 }).pos, 40);
  assert.equal(resolveMove(10, 5, { 15: 2 }, { 15: 40 }).pos, 2, '同格既是蛇又是梯时蛇优先');
});

test('17. 用种子随机对局能自然打到终点，全程状态合法（不崩、不越界）', () => {
  const g = createGame({ seed: 7, mode: 'local2p' });
  let rolls = 0;
  while (!g.state().winner && rolls < 500) {
    const s = g.state();
    assert.ok(s.players.some((p) => p.id === s.turn), 'turn 必须指向在场玩家');
    for (const p of s.players) assert.ok(p.pos >= 0 && p.pos <= LAST, `位置 ${p.pos} 越界`);
    const r = g.submit(s.turn, 'roll');
    assert.equal(r.ok, true);
    rolls++;
  }
  const s = g.state();
  assert.ok(s.winner === 'p1' || s.winner === 'p2', `应有胜者，实际 ${s.winner}`);
  const w = s.players.find((p) => p.id === s.winner);
  assert.equal(w.pos, LAST);
  assert.ok(rolls < 500);
  assert.ok(g.result());
});
