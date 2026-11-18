import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, initialBoard, genTurnMoves, applyAction, parseAction,
  normalizePlayer, SIZE, CELLS, BLACK, WHITE, BLACK_KING, WHITE_KING,
} from '../logic.mjs';
import { chooseMove } from '../ai.mjs';

/** 从一组 [索引,棋子编码] 摆局 */
function boardOf(fills, turn = 'p1', opts = {}) {
  const arr = new Array(CELLS).fill(0);
  for (const [i, v] of fills) arr[i] = v;
  return createGame({ board: arr, turn, ...opts });
}
const fresh = (opts = {}) => createGame({ seed: 42, ...opts });

test('1. 初始布局：64 格数组，双方各 12 子，黑先，7 个前走', () => {
  const s = fresh().state();
  assert.equal(s.board.length, CELLS);
  assert.equal(s.pieceCount.p1, 12);
  assert.equal(s.pieceCount.p2, 12);
  assert.equal(s.pieceCount.black, 12);
  assert.equal(s.pieceCount.white, 12);
  assert.equal(s.turn, 'p1');
  assert.equal(s.mustJump, false);
  assert.equal(s.winner, null);
  assert.equal(genTurnMoves(s.board, 'p1').length, 7);
  assert.equal(initialBoard()[17], BLACK);
  assert.equal(initialBoard()[46], WHITE);
});

test('2. 合法斜前走：17→26，提交后棋盘更新、回合交换', () => {
  const g = fresh();
  const r = g.submit('p1', 'move:17,26');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.board[17], 0);
  assert.equal(s.board[26], BLACK);
  assert.equal(s.turn, 'p2');
  assert.equal(s.moveCount, 1);
  assert.deepEqual(s.lastMove, { from: 17, to: 26, captured: -1, capture: false, promote: false, player: 'p1' });
});

test('3. 强制吃子：有吃子时非吃子着法被拒绝', () => {
  // 黑26(r3,c2)，白35(r4,c3)，44空 → 唯一合法是 26→44 吃 35
  const g = boardOf([[26, BLACK], [35, WHITE], [56, WHITE]]);
  const s = g.state();
  const moves = genTurnMoves(s.board, 'p1');
  assert.equal(s.mustJump, true);
  assert.deepEqual(moves.map((m) => `${m.from},${m.to}`), ['26,44']);
  assert.equal(g.submit('p1', 'move:26,29').ok, false, '不可改走普通步');
  assert.equal(g.submit('p1', 'move:26,44').ok, true);
  assert.equal(g.state().pieceCount.p2, 1, '白子被吃掉一枚');
});

test('4. 连吃：同子连续吃两枚、回合不交换，吃光判胜', () => {
  // 黑18(r2,c2) 吃 27(r3,c3) 落 36(r4,c4)，再吃 45(r5,c5) 落 54(r6,c6)
  const g = boardOf([[18, BLACK], [27, WHITE], [45, WHITE], [60, WHITE]]);
  const r = g.submit('p1', 'move:18,36');
  assert.equal(r.ok, true);
  assert.equal(r.turn, 'p1', '连吃不换手');
  assert.equal(r.continueFrom, 36);
  assert.equal(g.state().mustJump, true);
  const chain = genTurnMoves(g.state().board, 'p1', g.state().continueFrom);
  assert.deepEqual(chain.map((m) => `${m.from},${m.to}`), ['36,54']);
  assert.equal(g.submit('p1', 'move:60,52').ok, false, '连吃中其他子不能动');
  const r2 = g.submit('p1', 'move:36,54');
  assert.equal(r2.ok, true);
  assert.equal(r2.turn, 'p2', '连吃结束换手');
  assert.equal(g.state().pieceCount.p2, 1);
});

test('5. 升王：兵到底线变王（3/4），且升王当步不再连吃', () => {
  const g = boardOf([[50, BLACK], [7, WHITE]]); // 黑50(r6,c2) → 57(r7,c1) 升王
  const r = g.submit('p1', 'move:50,57');
  assert.equal(r.ok, true);
  assert.equal(r.promote, true);
  assert.equal(g.state().board[57], BLACK_KING);
  assert.equal(g.state().turn, 'p2');
  // 白方同理：白13(r1,c5) → 6(r0,c6) 升王
  const g2 = boardOf([[13, WHITE], [60, BLACK]], 'p2');
  const r2 = g2.submit('p2', 'move:13,6');
  assert.equal(r2.ok, true);
  assert.equal(g2.state().board[6], WHITE_KING);
});

test('6. 吃子可后退：兵能斜后吃子（前进方向之外）', () => {
  // 黑兵前进方向 row 增大；黑44(r5,c4) 后方白35(r4,c3) → 落 26(r3,c2)
  const g = boardOf([[44, BLACK], [35, WHITE], [0, WHITE]]);
  const moves = genTurnMoves(g.state().board, 'p1');
  assert.ok(moves.some((m) => m.from === 44 && m.to === 26 && m.capture));
  const r = g.submit('p1', 'move:44,26');
  assert.equal(r.ok, true);
  assert.equal(r.capture, true);
  assert.equal(g.state().board[35], 0);
});

test('7. 王可后退走一格与后退吃子', () => {
  // 黑王36(r4,c4)：四向均可走
  const g = boardOf([[36, BLACK_KING], [63, WHITE]]);
  const moves = genTurnMoves(g.state().board, 'p1');
  const dests = moves.filter((m) => m.from === 36).map((m) => m.to);
  assert.ok(dests.includes(27) && dests.includes(29) && dests.includes(43) && dests.includes(45));
  // 黑王44 后退吃 35 落 26
  const g2 = boardOf([[44, BLACK_KING], [35, WHITE], [0, WHITE]]);
  const r = g2.submit('p1', 'move:44,26');
  assert.equal(r.ok, true);
  assert.equal(g2.state().board[26], BLACK_KING, '王吃后仍是王');
});

test('8. 终局判胜：对方无子 / 对方无法走', () => {
  const noPiece = boardOf([[26, BLACK]]);
  assert.equal(noPiece.state().winner, 'p1');
  assert.equal(noPiece.result().reason, 'noPieces');
  assert.equal(noPiece.result().scores.p1, 1);
  // 白在 7(r0,c7)，黑占 14(r1,c6) 挡住唯一前走点且吃子落点 21 被占 → 白无着
  const blocked = boardOf([[7, WHITE], [14, BLACK], [21, BLACK]], 'p2');
  assert.equal(genTurnMoves(blocked.state().board, 'p2').length, 0);
  assert.equal(blocked.state().winner, 'p1');
  assert.equal(blocked.state().winReason, 'noMoves');
  assert.equal(blocked.submit('p2', 'move:7,14').ok, false, '胜局后不接受提交');
});

test('9. AI 各 level 着法合法、纯函数不改 state、且遵守强制吃子', () => {
  const g = fresh({ mode: 'ai' });
  const before = JSON.stringify(g.state());
  for (const level of [1, 2, 3]) {
    const s = g.state();
    const mv = chooseMove(s, s.turn, level);
    assert.match(mv, /^move:\d+,\d+$/);
    assert.equal(g.submit(s.turn, mv).ok, true);
    g.undo();
  }
  assert.equal(JSON.stringify(g.state()), before, 'chooseMove 不得改传入 state');
  // 强制吃子场景：AI 必须选吃子着法
  const cap = boardOf([[26, BLACK], [35, WHITE], [56, WHITE]]);
  assert.equal(chooseMove(cap.state(), 'p1', 2), 'move:26,44');
});

test('10. 非法着法与非法玩家被拒绝、回合不变', () => {
  const g = fresh();
  assert.equal(g.submit('p3', 'move:17,24').ok, false);
  assert.equal(g.submit('p2', 'move:17,24').ok, false, '非当前方');
  assert.equal(g.submit('p1', 'place:17,24').ok, false, '格式错误');
  assert.equal(g.submit('p1', 'move:17,18').ok, false, '非斜走');
  assert.equal(g.submit('p1', 'move:-1,24').ok, false, '越界');
  assert.equal(g.submit('p1', 'move:17,24').ok, true);
  assert.equal(g.state().moveCount, 1);
});

test('11. playerId 兼容 p1/p2 与数字 0/1', () => {
  assert.equal(normalizePlayer('p1'), 'p1');
  assert.equal(normalizePlayer(0), 'p1');
  assert.equal(normalizePlayer('0'), 'p1');
  assert.equal(normalizePlayer('p2'), 'p2');
  assert.equal(normalizePlayer(1), 'p2');
  assert.equal(normalizePlayer('1'), 'p2');
  const g = fresh({ mode: 'ai' });
  assert.equal(g.submit(0, 'move:17,26').ok, true);
  assert.equal(g.submit(1, 'move:40,33').ok, true);
});

test('12. 状态可 JSON 序列化、每次新对象、外改不污染内部', () => {
  const g = fresh();
  g.submit('p1', 'move:17,24');
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.deepEqual(JSON.parse(json), s1);
  assert.ok(json.includes('"turn"') && json.includes('"mustJump"') && json.includes('"pieceCount"'));
  s1.board[24] = 99;
  s1.pieceCount.p1 = 99;
  assert.equal(g.state().board[24], BLACK);
  assert.equal(g.state().pieceCount.p1, 12);
  assert.notEqual(g.state(), g.state(), '每次返回新对象');
});

test('13. 重置与悔棋：回到开局；人机模式悔棋连撤两步', () => {
  const g = fresh({ mode: 'ai' });
  g.submit('p1', 'move:17,24');
  g.submit('p2', 'move:40,33');
  assert.equal(g.state().moveCount, 2);
  assert.equal(g.undo().ok, true);
  assert.equal(g.state().turn, 'p1');
  assert.equal(g.state().moveCount, 0);
  g.submit('p1', 'move:19,26');
  g.submit('p2', 'move:40,33');
  g.reset();
  assert.equal(g.state().moveCount, 0);
  assert.equal(g.state().pieceCount.p1, 12);
  assert.equal(g.state().winner, null);
});

test('14. applyAction/parseAction 纯函数：解析与计算不改原棋盘', () => {
  const b = initialBoard();
  const before = b.slice();
  assert.deepEqual(parseAction('move:17,24'), { from: 17, to: 24 });
  assert.ok(parseAction('move:17, 24'));
  assert.equal(parseAction('move:64,1'), null);
  assert.equal(parseAction('bad'), null);
  const r = applyAction(b, 'p1', 'move:17,24');
  assert.ok(r);
  assert.equal(r.board[17], 0);
  assert.equal(r.board[24], BLACK);
  assert.deepEqual(b, before, '原棋盘未被修改');
});

test('15. AI 与人对弈 80 手不崩、无随机且始终合法', () => {
  const g = fresh({ mode: 'ai' });
  for (let i = 0; i < 80; i++) {
    const s = g.state();
    if (s.winner) break;
    const mv = chooseMove(s, s.turn, 1);
    assert.match(mv, /^move:\d+,\d+$/);
    assert.equal(g.submit(s.turn, mv).ok, true, `第 ${i} 手 ${mv} 应合法`);
  }
  assert.ok(g.state().moveCount <= 80);
});
