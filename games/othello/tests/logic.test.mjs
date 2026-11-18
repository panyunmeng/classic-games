import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, SIZE, initialBoard, flipsFor, legalMoves, applyMove,
} from '../logic.mjs';
import { chooseMove } from '../ai.mjs';

function fresh(opts = {}) {
  return createGame({ seed: 42, ...opts });
}

/** 依次按给定着法落子，自动用当前 turn 提交 */
function play(g, seq) {
  for (const [x, y] of seq) {
    const who = g.state().turn;
    const r = g.submit(who, `place:${x},${y}`);
    assert.equal(r.ok, true, `落子 ${x},${y} 应成功（第 ${JSON.stringify(r)}）`);
  }
}

const seq = (s) => s.split(' ').map((p) => p.split(',').map(Number));

// 走到第 16 手时 p1 无合法着法被自动跳过（passCount 从 0→1）。
const FORCE_PASS = seq('4,5 5,5 6,5 6,6 6,7 7,7 5,4 5,7 5,6 4,6 4,7 3,7 7,6 7,5 2,3 7,4');

test('1. 初始布局：中心四子、黑先、4 个合法点、比分 2:2', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.board.length, SIZE);
  assert.equal(s.board[0].length, SIZE);
  assert.equal(s.board[3][3], 2); // 白
  assert.equal(s.board[3][4], 1); // 黑
  assert.equal(s.board[4][3], 1); // 黑
  assert.equal(s.board[4][4], 2); // 白
  assert.equal(s.turn, 'p1');
  assert.deepEqual(s.scores, { p1: 2, p2: 2 });
  assert.deepEqual(
    s.validMoves.map((m) => `${m.x},${m.y}`).sort(),
    ['2,3', '3,2', '4,5', '5,4'],
  );
  assert.equal(s.passCount, 0);
  assert.equal(s.winner, null);
  assert.equal(s.over, false);
});

test('2. 合法着法与翻转：(3,2) 落黑翻转 (3,3)，八方向统一判据', () => {
  const b = initialBoard();
  assert.deepEqual(flipsFor(b, 3, 2, 1), [{ x: 3, y: 3 }]); // 横向夹住
  assert.deepEqual(flipsFor(b, 2, 3, 1), [{ x: 3, y: 3 }]); // 纵向夹住
  assert.deepEqual(flipsFor(b, 2, 2, 1), []);               // 未夹住：非法
  assert.deepEqual(flipsFor(b, 3, 4, 1), []);               // 已占格：非法
  const r = applyMove(b, 3, 2, 1); // x=3, y=2
  assert.ok(r);
  assert.equal(r.board[2][3], 1); // 落子点 (x=3,y=2)
  assert.equal(r.board[3][3], 1); // 被翻转的 (3,3)
  assert.equal(b[3][3], 2, 'applyMove 不得改原棋盘');
  // 八方向之一：多方向同时翻转由 flipsFor 统一处理，此处确认 DIRS 含斜向
  const diag = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  // 在 (0,0) 落白（color=2），夹住 (1,1) 黑（1），以 (2,2) 白（2）封口
  diag[1][1] = 1;
  diag[2][2] = 2;
  assert.deepEqual(flipsFor(diag, 0, 0, 2), [{ x: 1, y: 1 }]);
  // 多方向同时翻转：(0,0) 落白同时夹住主对角 (1,1) 与横向 (0,1)
  diag[0][1] = 1;
  diag[0][2] = 2;
  assert.deepEqual(flipsFor(diag, 0, 0, 2), [{ x: 1, y: 0 }, { x: 1, y: 1 }]);
});

test('3. 落子后比分变化与回合交替', () => {
  const g = fresh();
  const r = g.submit('p1', 'place:3,2');
  assert.equal(r.ok, true);
  assert.equal(r.flipped, 1);
  const s = g.state();
  assert.equal(s.scores.p1, 4); // 原 2 + 落子 1 + 翻转 1
  assert.equal(s.scores.p2, 1);
  assert.equal(s.turn, 'p2');
  assert.deepEqual(s.lastMove, { x: 3, y: 2, player: 'p1', color: 1, flipped: 1 });
});

test('4. 非法落子被拒：非法玩家、非当前回合、越界、已占、未夹住', () => {
  const g = fresh();
  assert.equal(g.submit('p3', 'place:3,2').ok, false);
  assert.equal(g.submit('p2', 'place:3,2').ok, false); // 非当前回合
  assert.equal(g.submit('p1', 'place:-1,0').ok, false);
  assert.equal(g.submit('p1', 'place:8,0').ok, false);
  assert.equal(g.submit('p1', 'place:abc').ok, false);
  assert.equal(g.submit('p1', 'place:3,3').ok, false); // 已占
  assert.equal(g.submit('p1', 'place:0,0').ok, false); // 空但未夹住
  assert.equal(g.state().turn, 'p1');
  assert.deepEqual(g.state().scores, { p1: 2, p2: 2 });
});

test('5. playerId 兼容：数字 0/1 与 p1/p2 等价', () => {
  const g = fresh();
  assert.equal(g.submit(0, 'place:3,2').ok, true); // 数字 0 = p1
  assert.equal(g.state().turn, 'p2');
  assert.equal(g.submit(1, 'place:0,0').ok, false); // 数字 1 = p2，但 (0,0) 未夹住
  assert.equal(g.submit('p2', 'place:0,0').ok, false);
  const mv = g.state().validMoves[0];
  assert.equal(g.submit(1, `place:${mv.x},${mv.y}`).ok, true); // 数字 1 = p2 可正常落子
});

test('6. 无合法着法自动跳过：passCount 增加、回合保留给能落子方', () => {
  const g = fresh();
  play(g, FORCE_PASS);
  const s = g.state();
  assert.equal(s.passCount, 1, 'p1 应被跳过一次');
  assert.equal(s.turn, 'p2', '跳过后轮到仍能落子的 p2');
  assert.equal(s.over, false);
  assert.ok(s.validMoves.length > 0, '当前方必须有合法着法');
  assert.ok(s.scores.p1 > 0 && s.scores.p2 > 0);
});

test('7. 终局判胜：双方连续无着法，子多者胜（64 手满盘）', () => {
  const g = fresh();
  for (let i = 0; i < 70 && !g.state().over; i++) {
    const s = g.state();
    const m = s.validMoves[0];
    assert.ok(m, '未终局时必须有合法着法');
    assert.equal(g.submit(s.turn, `place:${m.x},${m.y}`).ok, true);
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.ok(s.winner === 'p1' || s.winner === 'p2' || s.winner === 'draw');
  assert.equal(s.scores.p1 + s.scores.p2, 64, '终局应填满棋盘');
  assert.equal(s.validMoves.length, 0);
  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, s.winner);
  if (s.winner !== 'draw') {
    const expect = s.scores.p1 > s.scores.p2 ? 'p1' : 'p2';
    assert.equal(res.winner, expect, '子多者胜');
  }
  assert.match(res.text, /获胜|和棋/);
  assert.equal(g.submit('p1', 'place:0,0').ok, false, '终局后不能再落子');
});

test('8. 显式 pass 动作：仅在无合法着法时接受', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'pass').ok, false, '有合法着法时不能 pass');
  play(g, FORCE_PASS); // 此刻 p1 已被跳过，轮到 p2，p2 有合法着法
  assert.equal(g.state().turn, 'p2');
  assert.equal(g.submit('p2', 'pass').ok, false);
  // 走到终局后 pass 也被拒绝
  for (let i = 0; i < 70 && !g.state().over; i++) {
    const s = g.state();
    const m = s.validMoves[0];
    g.submit(s.turn, `place:${m.x},${m.y}`);
  }
  assert.equal(g.submit(g.state().turn || 'p1', 'pass').ok, false);
});

test('9. AI 着法合法且为纯函数：各 level 不改 state，落子成功', () => {
  const g = fresh({ mode: 'ai' });
  const before = JSON.stringify(g.state());
  for (const level of [1, 2, 3]) {
    const s = g.state();
    if (s.over) break;
    const mv = chooseMove(s, s.turn, level);
    assert.match(mv, /^place:(\d+),(\d+)$/, `level ${level} 应返回落子动作`);
    const [, x, y] = mv.match(/^place:(\d+),(\d+)$/).map(Number);
    const legal = s.validMoves.some((m) => m.x === x && m.y === y);
    assert.ok(legal, `AI 着法 ${mv} 必须是合法着法`);
    assert.equal(g.submit(s.turn, mv).ok, true);
    g.reset();
  }
  assert.equal(JSON.stringify(g.state()), before, 'chooseMove 不得改动传入 state');
});

test('10. AI 抢占角：在可选时优先落在角上（永久据点）', () => {
  const g = fresh({ mode: 'ai' });
  // 构造角可落的局面：用合法序列走到角 (0,0) 可落黑
  // 直接以初始盘起手，AI 应避开角旁的负分位；这里验证 AI 在角可落时选角。
  // 手工构造棋盘（通过重放已知开局使 (0,0) 成为合法点较繁琐），
  // 改用直接检查：AI 在第 1 手不会选择角旁 (2,2)/(1,1) 之类非法点，只落在 4 个合法点。
  const s = g.state();
  const mv = chooseMove(s, 'p1', 3);
  assert.match(mv, /^place:(2,3|3,2|4,5|5,4)$/);
  // 用一个角可落的自制 state 验证角偏好
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  // 让 (0,0) 落白可夹住 (1,0) 黑、(2,0) 白 → 角合法；(3,3) 另一个合法点分低
  board[1][0] = 1;
  board[2][0] = 2;
  board[3][3] = 1;
  board[3][4] = 2;
  const cornerState = { board, turn: 'p2', validMoves: [{ x: 0, y: 0 }, { x: 4, y: 3 }] };
  const cornerMv = chooseMove(cornerState, 'p2', 3);
  assert.equal(cornerMv, 'place:0,0', 'AI 应优先占角');
});

test('11. 状态序列化与隔离：每次 state() 返回新对象，外部改动不影响内部', () => {
  const g = fresh();
  g.submit('p1', 'place:3,2');
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.ok(json.includes('"turn"'));
  assert.ok(json.includes('"validMoves"'));
  assert.ok(json.includes('"scores"'));
  assert.ok(json.includes('"passCount"'));
  assert.deepEqual(JSON.parse(json), s1);
  s1.board[3][3] = 9;
  s1.scores.p1 = 999;
  s1.validMoves.length = 0;
  const s2 = g.state();
  assert.equal(s2.board[3][3], 1, '内部棋盘不应被外部快照改动'); // (3,3) 落黑后被翻为黑
  assert.notEqual(s2.scores.p1, 999);
  assert.ok(s2.validMoves.length > 0);
  assert.notStrictEqual(s1, s2, 'state() 应返回新对象');
});

test('12. 重置回到开局；AI 自对弈全程不崩且始终合法', () => {
  const g = fresh({ mode: 'ai' });
  // 先走若干手
  for (let i = 0; i < 6 && !g.state().over; i++) {
    const s = g.state();
    g.submit(s.turn, `place:${s.validMoves[0].x},${s.validMoves[0].y}`);
  }
  g.reset();
  let s = g.state();
  assert.equal(s.turn, 'p1');
  assert.deepEqual(s.scores, { p1: 2, p2: 2 });
  assert.equal(s.passCount, 0);
  assert.equal(s.winner, null);

  // AI 自对弈到终局（level 1，快速）
  for (let i = 0; i < 70 && !s.over; i++) {
    const mv = chooseMove(s, s.turn, 1);
    assert.match(mv, /^place:(\d+),(\d+)$/);
    const [, x, y] = mv.match(/^place:(\d+),(\d+)$/).map(Number);
    assert.ok(s.validMoves.some((m) => m.x === x && m.y === y), 'AI 着法必须合法');
    assert.equal(g.submit(s.turn, mv).ok, true);
    s = g.state();
  }
  assert.equal(s.over, true);
  assert.ok(g.result());
});
