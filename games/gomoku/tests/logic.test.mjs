import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, SIZE } from '../logic.mjs';
import { chooseMove } from '../ai.mjs';

function fresh(opts = {}) {
  return createGame({ seed: 42, ...opts });
}

/** 依次落子，自动交替 p1/p2 */
function play(g, seq) {
  for (const [x, y] of seq) {
    const who = g.state().turn;
    const r = g.submit(who, `place:${x},${y}`);
    assert.equal(r.ok, true, `落子 ${x},${y} 应成功`);
  }
}

/** 无五连的满盘填充：((x + 2y) % 4 < 2) ? 黑 : 白；黑 113 白 112 */
function fillColor(x, y) {
  return (((x + 2 * y) % 4) + 4) % 4 < 2 ? 1 : 2;
}

test('1. 初始状态：空棋盘、黑先、p1 回合', () => {
  const s = fresh().state();
  assert.equal(s.board.length, SIZE);
  assert.equal(s.board[0].length, SIZE);
  assert.ok(s.board.every((row) => row.every((v) => v === 0)));
  assert.equal(s.turn, 'p1');
  assert.equal(s.moveCount, 0);
  assert.equal(s.winner, null);
  assert.equal(s.lastMove, null);
});

test('2. 黑先落子后 turn 变为 p2，棋盘记录黑子 1', () => {
  const g = fresh();
  const r = g.submit('p1', 'place:7,7');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.turn, 'p2');
  assert.equal(s.board[7][7], 1);
  assert.equal(s.moveCount, 1);
  assert.deepEqual(s.lastMove, { x: 7, y: 7, player: 'p1', color: 1 });
});

test('3. 非法 playerId 被拒绝', () => {
  const g = fresh();
  assert.equal(g.submit('p3', 'place:7,7').ok, false);
  assert.equal(g.submit('p2', 'place:7,7').ok, false); // 非当前回合方
  assert.equal(g.state().moveCount, 0);
});

test('4. 越界坐标被拒绝，边界 14,14 合法', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'place:-1,0').ok, false);
  assert.equal(g.submit('p1', 'place:15,0').ok, false);
  assert.equal(g.submit('p1', 'place:0,15').ok, false);
  assert.equal(g.submit('p1', 'place:14,14').ok, true);
  assert.equal(g.state().moveCount, 1);
});

test('5. 已占坐标被拒绝且回合不变', () => {
  const g = fresh();
  g.submit('p1', 'place:7,7');
  const r = g.submit('p2', 'place:7,7');
  assert.equal(r.ok, false);
  assert.equal(g.state().turn, 'p2');
  assert.equal(g.state().moveCount, 1);
});

test('6. 五连胜判定（横向，含 winner/scores/text）', () => {
  const g = fresh();
  play(g, [[3, 7], [3, 8], [4, 7], [4, 8], [5, 7], [5, 8], [6, 7], [6, 8], [7, 7]]);
  const s = g.state();
  assert.equal(s.winner, 'p1');
  assert.equal(s.over, true);
  assert.ok(s.winningLine && s.winningLine.length === 5);
  const res = g.result();
  assert.ok(res);
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.equal(res.scores.p1, 1);
  assert.equal(res.scores.p2, 0);
  assert.match(res.text, /黑棋/);
  assert.equal(g.submit('p2', 'place:0,0').ok, false); // 胜局后不能落子
});

test('7. 斜向五连同样判胜', () => {
  const g = fresh();
  play(g, [[3, 3], [0, 10], [4, 4], [1, 10], [5, 5], [2, 10], [6, 6], [0, 11], [7, 7]]);
  assert.equal(g.state().winner, 'p1');
  assert.equal(g.result().winner, 'p1');
});

test('8. 平局判定：225 手落满且无五连', () => {
  const g = fresh();
  const blacks = [];
  const whites = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      (fillColor(x, y) === 1 ? blacks : whites).push({ x, y });
    }
  }
  assert.equal(blacks.length, 113);
  assert.equal(whites.length, 112);

  let bi = 0;
  let wi = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const who = i % 2 === 0 ? 'p1' : 'p2';
    const cell = who === 'p1' ? blacks[bi++] : whites[wi++];
    const r = g.submit(who, `place:${cell.x},${cell.y}`);
    assert.equal(r.ok, true, `第 ${i} 手落 ${cell.x},${cell.y} 应成功`);
    if (i < SIZE * SIZE - 1) {
      assert.equal(g.state().winner, null, `第 ${i} 手不应提前判胜`);
    }
  }
  const s = g.state();
  assert.equal(s.moveCount, 225);
  assert.equal(s.winner, 'draw');
  const res = g.result();
  assert.equal(res.winner, 'draw');
  assert.match(res.text, /和棋/);
});

test('9. AI 在空盘与各 level 都返回合法着法（且纯函数不改 state）', () => {
  const g = fresh({ mode: 'ai' });
  const before = JSON.stringify(g.state());
  for (const level of [1, 2, 3]) {
    const s = g.state();
    const mv = chooseMove(s, s.turn, level);
    assert.match(mv, /^place:(\d+),(\d+)$/);
    const [, x, y] = mv.match(/^place:(\d+),(\d+)$/).map(Number);
    assert.ok(x >= 0 && x < SIZE && y >= 0 && y < SIZE);
    assert.equal(g.submit(s.turn, mv).ok, true);
    g.undo(); // 撤回，保持空盘给下一 level
  }
  assert.equal(JSON.stringify(g.state()), before, 'chooseMove 不得改动传入 state');
});

test('10. AI 会挡住对手的活四（必胜/必防点）', () => {
  const g = fresh({ mode: 'ai' });
  // 白(p2)先手造成黑(p1)三连：p1 落 (3,7)(4,7)(5,7)，白随意
  play(g, [[3, 7], [0, 0], [4, 7], [0, 1], [5, 7]]);
  const s = g.state(); // 轮到 p2
  assert.equal(s.turn, 'p2');
  const mv = chooseMove(s, 'p2', 2);
  // 必须落在 (2,7) 或 (6,7) 封堵，否则黑下一手成五
  assert.ok(mv === 'place:2,7' || mv === 'place:6,7', `AI 应封堵，实际 ${mv}`);
});

test('11. 状态可 JSON 序列化且每次返回新对象', () => {
  const g = fresh();
  g.submit('p1', 'place:7,7');
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.ok(json.includes('"turn"'));
  assert.deepEqual(JSON.parse(json), s1);
  s1.board[7][7] = 9; // 改外部快照
  assert.equal(g.state().board[7][7], 1, '内部状态不应被外部改动');
});

test('12. 重置回到开局；悔棋可撤回落子', () => {
  const g = fresh();
  g.submit('p1', 'place:7,7');
  assert.equal(g.state().moveCount, 1);
  assert.equal(g.undo().ok, true);
  assert.equal(g.state().moveCount, 0);
  assert.equal(g.state().turn, 'p1');
  g.submit('p1', 'place:7,7');
  g.submit('p2', 'place:8,8');
  g.reset();
  const s = g.state();
  assert.equal(s.moveCount, 0);
  assert.equal(s.turn, 'p1');
  assert.equal(s.winner, null);
  assert.ok(s.board.every((row) => row.every((v) => v === 0)));
});

test('13. AI 连续对弈 60 手不崩且始终合法（深度 1 快速回归）', () => {
  const g = fresh({ mode: 'ai' });
  for (let i = 0; i < 60; i++) {
    const s = g.state();
    if (s.winner) break;
    const mv = chooseMove(s, s.turn, 1);
    assert.match(mv, /^place:\d+,\d+$/);
    assert.equal(g.submit(s.turn, mv).ok, true);
  }
  assert.ok(g.state().moveCount <= 225);
});
