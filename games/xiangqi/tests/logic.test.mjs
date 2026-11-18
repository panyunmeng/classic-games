import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, initialBoard, genLegalMoves, genPseudoMoves, isAttacked, inCheck,
  kingsFacing, findKing, parseAction, normalizePlayer, pieceOf, sideOf, kindOf,
  RED, BLACK, KIND, CELLS, COLS, ROWS,
} from '../logic.mjs';
import { chooseMove } from '../ai.mjs';

const { K, A, B, N, R, C, P } = KIND;
const sq = (r, c) => r * COLS + c;

/** 摆局：默认给双方各放一个不照面的帅/将（红 (9,3)、黑 (0,4)），再覆盖 fills */
function gameOf(fills, turn = RED, opts = {}) {
  const { kings = true, ...rest } = opts;
  const b = new Array(CELLS).fill(0);
  if (kings) {
    b[sq(9, 3)] = pieceOf(RED, K);
    b[sq(0, 4)] = pieceOf(BLACK, K);
  }
  for (const [i, v] of fills) b[i] = v;
  return createGame({ board: b, turn, ...rest });
}

const destsOf = (board, side, from) => genLegalMoves(board, side)
  .filter((m) => m.from === from)
  .map((m) => m.to)
  .sort((x, y) => x - y);

/** 期望值也按索引升序，避免比较顺序受生成顺序影响 */
const sorted = (arr) => arr.slice().sort((a, b) => a - b);

test('1. 初始布局：90 格、双方各 16 子、红先、红方 44 个合法着法', () => {
  const g = createGame({ seed: 1 });
  const s = g.state();
  assert.equal(s.board.length, CELLS);
  assert.equal(s.cells, 90);
  assert.equal(s.turn, RED);
  assert.equal(s.winner, null);
  assert.equal(s.pieceCount.p1, 16);
  assert.equal(s.pieceCount.p2, 16);
  assert.equal(genLegalMoves(s.board, RED).length, 44, '开局红方合法着法数应为 44');
  assert.equal(findKing(s.board, RED), sq(9, 4));
  assert.equal(findKing(s.board, BLACK), sq(0, 4));
  // 底线车马象士将士象马车
  assert.equal(s.board[sq(9, 0)], pieceOf(RED, R));
  assert.equal(s.board[sq(9, 1)], pieceOf(RED, N));
  assert.equal(s.board[sq(9, 2)], pieceOf(RED, B));
  assert.equal(s.board[sq(9, 3)], pieceOf(RED, A));
  assert.equal(s.board[sq(9, 4)], pieceOf(RED, K));
  assert.equal(s.board[sq(0, 4)], pieceOf(BLACK, K));
  // 炮在 row 7/2，兵在 row 6/3
  assert.equal(s.board[sq(7, 1)], pieceOf(RED, C));
  assert.equal(s.board[sq(2, 1)], pieceOf(BLACK, C));
  assert.equal(s.board[sq(6, 0)], pieceOf(RED, P));
  assert.equal(s.board[sq(3, 8)], pieceOf(BLACK, P));
});

test('2. 车走直线：遇己子止步、吃第一个敌子、吃后不越子', () => {
  // 红车 (5,0)：上 (4,0) 空、己兵 (3,0) 挡；下 (8,0) 敌兵可吃；横向 row5 全空
  const g = gameOf([
    [sq(5, 0), pieceOf(RED, R)],
    [sq(3, 0), pieceOf(RED, P)],
    [sq(8, 0), pieceOf(BLACK, P)],
  ]);
  const s = g.state();
  const dests = destsOf(s.board, RED, sq(5, 0));
  assert.deepEqual(dests, sorted([
    sq(4, 0), sq(6, 0), sq(7, 0), sq(8, 0),
    sq(5, 1), sq(5, 2), sq(5, 3), sq(5, 4), sq(5, 5), sq(5, 6), sq(5, 7), sq(5, 8),
  ]));
  assert.ok(!dests.includes(sq(3, 0)), '己子占位不可落');
  assert.ok(!dests.includes(sq(2, 0)), '吃子后不能越子');
  const cap = genLegalMoves(s.board, RED).find((m) => m.from === sq(5, 0) && m.to === sq(8, 0));
  assert.equal(cap.capture, true);
  assert.equal(cap.captured, pieceOf(BLACK, P));
  // 斜走非法
  assert.equal(g.submit(RED, `move:${sq(5, 0)},${sq(4, 1)}`).ok, false);
});

test('3. 马走日字且蹩马腿：腿位被占则该向不可走', () => {
  // 红马 (4,4)；(3,4) 挡掉上两项，(4,5) 挡掉右上/右下两项
  const g = gameOf([
    [sq(4, 4), pieceOf(RED, N)],
    [sq(3, 4), pieceOf(RED, P)],
    [sq(4, 5), pieceOf(BLACK, P)],
  ]);
  const dests = destsOf(g.state().board, RED, sq(4, 4));
  assert.deepEqual(dests, sorted([sq(3, 2), sq(5, 2), sq(6, 3), sq(6, 5)]));
  assert.ok(!dests.includes(sq(2, 3)) && !dests.includes(sq(2, 5)), '上方马腿被蹩');
  assert.ok(!dests.includes(sq(3, 6)) && !dests.includes(sq(5, 6)), '右侧马腿被蹩');
  // 真实提交：蹩腿的单步被拒
  assert.equal(g.submit(RED, `move:${sq(4, 4)},${sq(2, 3)}`).ok, false);
  assert.equal(g.submit(RED, `move:${sq(4, 4)},${sq(3, 2)}`).ok, true);
});

test('4. 相走田、象眼被塞、不可过河', () => {
  // 红相 (5,2)：田字落点 (3,0)/(3,4) 过河非法，(7,0)/(7,4) 合法
  const g = gameOf([[sq(5, 2), pieceOf(RED, B)]]);
  let dests = destsOf(g.state().board, RED, sq(5, 2));
  assert.deepEqual(dests, sorted([sq(7, 0), sq(7, 4)]));
  assert.ok(!dests.includes(sq(3, 0)) && !dests.includes(sq(3, 4)), '相不可过河');
  // 塞象眼：(6,3) 有子 → (7,4) 不可走
  const g2 = gameOf([
    [sq(5, 2), pieceOf(RED, B)],
    [sq(6, 3), pieceOf(RED, P)],
  ]);
  dests = destsOf(g2.state().board, RED, sq(5, 2));
  assert.deepEqual(dests, [sq(7, 0)]);
  // 黑象同理：(2,2) → (0,0)/(0,4)/(4,0)/(4,4)；过河点 row5 非法
  const g3 = gameOf([[sq(2, 2), pieceOf(BLACK, B)]]);
  const bd = destsOf(g3.state().board, BLACK, sq(2, 2));
  // (0,4) 被默认黑将占着，不能落子
  assert.deepEqual(bd, sorted([sq(0, 0), sq(4, 0), sq(4, 4)]));
});

test('5. 帅/将与士只在九宫内走：一步正交 / 一步斜', () => {
  // 帅在九宫中心 (8,4)，四向都在九宫内
  const g = gameOf([[sq(8, 4), pieceOf(RED, K)]], RED, { kings: false });
  assert.deepEqual(destsOf(g.state().board, RED, sq(8, 4)), sorted([sq(7, 4), sq(9, 4), sq(8, 3), sq(8, 5)]));
  // 帅在九宫角 (7,3)：只能 (7,4)/(8,3)，不能 (6,3)/(7,2)
  const g2 = gameOf([[sq(7, 3), pieceOf(RED, K)]], RED, { kings: false });
  assert.deepEqual(destsOf(g2.state().board, RED, sq(7, 3)), sorted([sq(7, 4), sq(8, 3)]));
  // 黑将 (1,4) 四向；士 (9,3) → 只 (8,4)
  const g3 = gameOf([
    [sq(1, 4), pieceOf(BLACK, K)],
    [sq(9, 3), pieceOf(RED, A)],
  ], RED, { kings: false });
  assert.deepEqual(destsOf(g3.state().board, RED, sq(9, 3)), [sq(8, 4)]);
});

test('6. 炮：不吃子同车、吃子必须隔一个炮架', () => {
  // 红炮 (5,0)：上 (4,0) 空 → 架 (3,0) 己兵 → 越过后的 (2,0) 空点不可落，(1,0) 敌兵可打
  const g = gameOf([
    [sq(5, 0), pieceOf(RED, C)],
    [sq(3, 0), pieceOf(RED, P)],
    [sq(1, 0), pieceOf(BLACK, P)],
  ]);
  const dests = destsOf(g.state().board, RED, sq(5, 0));
  assert.ok(dests.includes(sq(4, 0)), '架前空点可走');
  assert.ok(dests.includes(sq(1, 0)), '隔一个炮架可打子');
  assert.ok(!dests.includes(sq(2, 0)), '越过炮架的空点不可落');
  assert.ok(!dests.includes(sq(0, 0)), '越过炮架后不可再越一格');
  const cap = genLegalMoves(g.state().board, RED).find((m) => m.from === sq(5, 0) && m.to === sq(1, 0));
  assert.equal(cap.capture, true);
  // 无炮架：敌子就在 (1,0)，中间无子 → 不能吃，只能停在 (2,0)
  const g2 = gameOf([
    [sq(5, 0), pieceOf(RED, C)],
    [sq(1, 0), pieceOf(BLACK, P)],
  ]);
  const d2 = destsOf(g2.state().board, RED, sq(5, 0));
  assert.ok(!d2.includes(sq(1, 0)), '无炮架不能吃子');
  assert.ok(d2.includes(sq(2, 0)));
});

test('7. 兵/卒：向前一步，过河才能横走，永不后退', () => {
  // 红兵 row4 已过河：前 (3,4) + 左右 (4,3)/(4,5)
  const g = gameOf([[sq(4, 4), pieceOf(RED, P)]]);
  assert.deepEqual(destsOf(g.state().board, RED, sq(4, 4)), sorted([sq(3, 4), sq(4, 3), sq(4, 5)]));
  // 红兵 row6 未过河：只能 (5,4)
  const g2 = gameOf([[sq(6, 4), pieceOf(RED, P)]]);
  assert.deepEqual(destsOf(g2.state().board, RED, sq(6, 4)), [sq(5, 4)]);
  // 黑卒 row5 已过河：前 (6,4) + 左右；黑卒 row3 未过河：只能 (4,4)
  const g3 = gameOf([[sq(5, 4), pieceOf(BLACK, P)]]);
  assert.deepEqual(destsOf(g3.state().board, BLACK, sq(5, 4)), sorted([sq(6, 4), sq(5, 3), sq(5, 5)]));
  const g4 = gameOf([[sq(3, 4), pieceOf(BLACK, P)]]);
  assert.deepEqual(destsOf(g4.state().board, BLACK, sq(3, 4)), [sq(4, 4)]);
  // 兵不能后退
  assert.equal(g2.submit(RED, `move:${sq(6, 4)},${sq(7, 4)}`).ok, false);
});

test('8. 将帅照面非法：让开中间的子会被拒，帅也不能主动走到照面', () => {
  // 红帅 (9,4)、黑将 (0,4) 同列，红兵 (4,4) 挡住。兵横走 (4,3) 会让两帅照面 → 非法
  const g = gameOf([
    [sq(9, 4), pieceOf(RED, K)],
    [sq(0, 4), pieceOf(BLACK, K)],
    [sq(4, 4), pieceOf(RED, P)],
  ], RED, { kings: false });
  assert.equal(inCheck(g.state().board, RED), false);
  assert.equal(kingsFacing(g.state().board), false);
  assert.equal(g.submit(RED, `move:${sq(4, 4)},${sq(4, 3)}`).ok, false);
  assert.match(g.submit(RED, `move:${sq(4, 4)},${sq(4, 3)}`).error, /照面|将军/);
  const dests = destsOf(g.state().board, RED, sq(4, 4));
  assert.ok(!dests.includes(sq(4, 3)) && !dests.includes(sq(4, 5)), '横走会让开同一列');
  assert.ok(dests.includes(sq(3, 4)), '沿列前进仍挡着，合法');
  // 默认局（红帅 (9,3)、黑将 (0,4)）：帅走到 (9,4) 会与黑将同列照面 → 非法
  const g2 = gameOf([]);
  assert.ok(!destsOf(g2.state().board, RED, sq(9, 3)).includes(sq(9, 4)));
  // 列上放一个挡子后，帅 (9,3)→(9,4) 就合法了
  const g3 = gameOf([[sq(5, 4), pieceOf(RED, P)]]);
  assert.ok(destsOf(g3.state().board, RED, sq(9, 3)).includes(sq(9, 4)));
});

test('9. 将军判定：车直线攻击、马攻击、炮隔子攻击都算将军', () => {
  const g = gameOf([[sq(0, 0), pieceOf(RED, R)]]);
  const s = g.state();
  assert.equal(inCheck(s.board, BLACK), true, '车沿 row0 直攻黑将');
  assert.equal(isAttacked(s.board, sq(0, 4), RED), true);
  assert.equal(inCheck(s.board, RED), false);
  // 炮隔子攻击黑将 (0,4)：红炮 (0,8)，炮架 (0,6)
  const g2 = gameOf([
    [sq(0, 8), pieceOf(RED, C)],
    [sq(0, 6), pieceOf(RED, P)],
  ]);
  assert.equal(inCheck(g2.state().board, BLACK), true);
  // 马攻击黑将 (0,4)：马在 (2,3) 或 (2,5)，马腿 (1,3)/(1,5) 空
  const g3 = gameOf([[sq(2, 3), pieceOf(RED, N)]]);
  assert.equal(inCheck(g3.state().board, BLACK), true);
  // 马腿被塞则不将军
  const g4 = gameOf([
    [sq(2, 3), pieceOf(RED, N)],
    [sq(1, 3), pieceOf(RED, P)],
  ]);
  assert.equal(inCheck(g4.state().board, BLACK), false);
});

test('10. 应将强制：被将军时只有解将着法合法，其余一律拒绝', () => {
  // 红车 (0,0) 将黑将 (0,4) 的军；黑方只有 (1,4) 一个合法着法
  const g = gameOf([
    [sq(0, 0), pieceOf(RED, R)],
    [sq(3, 0), pieceOf(BLACK, P)],
  ], BLACK);
  const s = g.state();
  assert.equal(s.inCheck, true);
  const legal = genLegalMoves(s.board, BLACK);
  assert.deepEqual(legal.map((m) => `${m.from},${m.to}`), [`${sq(0, 4)},${sq(1, 4)}`]);
  // 走卒不管将军 → 拒绝，且提示与「送将」无关（是没应将）
  const bad = g.submit(BLACK, `move:${sq(3, 0)},${sq(4, 0)}`);
  assert.equal(bad.ok, false);
  assert.equal(g.state().turn, BLACK);
  assert.equal(g.state().moveCount, 0);
  // 帅/将逃出同列 → 合法
  assert.equal(g.submit(BLACK, `move:${sq(0, 4)},${sq(1, 4)}`).ok, true);
  assert.equal(inCheck(g.state().board, BLACK), false);
});

test('11. 绝杀判胜：红车落底线形成无解将军，判红方胜（checkmate）', () => {
  // 红车 (3,0) 走到 (0,0) 将军；另一红车 (1,8) 控制 row1，黑将 (0,4) 无路可逃
  const g = gameOf([
    [sq(3, 0), pieceOf(RED, R)],
    [sq(1, 8), pieceOf(RED, R)],
  ]);
  assert.equal(g.state().inCheck, false, '开局黑方未被将军');
  const r = g.submit(RED, `move:${sq(3, 0)},${sq(0, 0)}`);
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.turn, BLACK);
  assert.equal(s.inCheck, true);
  assert.equal(s.checkmate, true);
  assert.equal(s.stalemate, false);
  assert.equal(s.winner, RED);
  assert.equal(s.reason, 'checkmate');
  const res = g.result();
  assert.equal(res.winner, RED);
  assert.equal(res.reason, 'checkmate');
  assert.equal(res.scores.p1, 1);
  assert.match(res.text, /红方绝杀/);
  assert.equal(g.submit(BLACK, `move:${sq(0, 4)},${sq(1, 4)}`).ok, false, '绝杀后不接受提交');
});

test('12. 困毙判负：未被将军但无子可走，判对方胜（stalemate）', () => {
  // 黑将 (0,4) 三个落点分别被三只红车控制，但当前并不被将军
  const g = gameOf([
    [sq(2, 3), pieceOf(RED, R)],
    [sq(1, 0), pieceOf(RED, R)],
    [sq(2, 5), pieceOf(RED, R)],
  ], BLACK);
  const s = g.state();
  assert.equal(s.inCheck, false);
  assert.equal(s.checkmate, false);
  assert.equal(s.stalemate, true);
  assert.equal(genLegalMoves(s.board, BLACK).length, 0);
  assert.equal(s.winner, RED);
  assert.equal(s.reason, 'stalemate');
  assert.equal(g.result().winner, RED);
  assert.match(g.result().text, /困毙/);
});

test('13. 非法着法一律拒绝：格式、越界、空点、对方棋子、走法不符、非当前方', () => {
  const g = createGame({ seed: 7 });
  const before = g.state();
  assert.equal(g.submit('p3', 'move:58,49').ok, false, '无效玩家');
  assert.equal(g.submit(BLACK, 'move:58,49').ok, false, '非当前方');
  assert.equal(g.submit(RED, 'place:58,49').ok, false, '格式错误');
  assert.equal(g.submit(RED, 'move:58;49').ok, false, '格式错误');
  assert.equal(g.submit(RED, 'move:-1,0').ok, false, '起点越界');
  assert.equal(g.submit(RED, 'move:0,90').ok, false, '终点越界');
  assert.equal(g.submit(RED, `move:${sq(5, 0)},${sq(5, 1)}`).ok, false, '起点无子');
  assert.equal(g.submit(RED, `move:${sq(0, 0)},${sq(1, 0)}`).ok, false, '不能走对方棋子');
  // 红车 (9,0) 斜走到 (8,8) 违规
  assert.equal(g.submit(RED, `move:${sq(9, 0)},${sq(8, 8)}`).ok, false, '走法不符');
  // 送将：红兵 (6,4) → (5,4) 是合法开局步；但把帅暴露的走法上面已单独覆盖
  const s = g.state();
  assert.equal(s.turn, before.turn);
  assert.equal(s.moveCount, 0);
  assert.equal(JSON.stringify(g.state().board), JSON.stringify(before.board));
  assert.equal(parseAction('move:58, 49').from, 58);
  assert.equal(parseAction('move:58,49').to, 49);
  assert.equal(parseAction('bad'), null);
  assert.equal(parseAction('move:90,1'), null);
});

test('14. playerId 兼容 p1/p2 与数字 0/1；悔棋、重置、人机连撤两步', () => {
  assert.equal(normalizePlayer('p1'), RED);
  assert.equal(normalizePlayer(0), RED);
  assert.equal(normalizePlayer('0'), RED);
  assert.equal(normalizePlayer('p2'), BLACK);
  assert.equal(normalizePlayer(1), BLACK);
  assert.equal(normalizePlayer('1'), BLACK);
  assert.equal(normalizePlayer('x'), null);

  const g = createGame({ seed: 3, mode: 'ai' });
  assert.equal(g.submit(0, `move:${sq(6, 4)},${sq(5, 4)}`).ok, true);
  assert.equal(g.state().turn, BLACK);
  assert.equal(g.submit(1, `move:${sq(3, 4)},${sq(4, 4)}`).ok, true);
  assert.equal(g.state().turn, RED);
  assert.equal(g.state().moveCount, 2);
  const r = g.undo();
  assert.equal(r.ok, true);
  assert.equal(g.state().turn, RED);
  assert.equal(g.state().moveCount, 0, '人机模式悔棋一次退两步');
  g.submit(0, `move:${sq(6, 4)},${sq(5, 4)}`);
  g.reset();
  assert.equal(g.state().moveCount, 0);
  assert.equal(g.state().turn, RED);
  assert.equal(g.state().winner, null);
  assert.deepEqual(g.state().board, initialBoard());

  // 联机模式：服务端用同一份逻辑跑权威对局，players 必须是 p1/p2，turn 必须可序列化
  const og = createGame({ seed: 4, mode: 'online', players: ['p1', 'p2'] });
  assert.deepEqual(og.state().players, ['p1', 'p2']);
  assert.equal(og.state().mode, 'online');
  assert.equal(og.state().turn, 'p1');
  assert.equal(og.submit('p2', `move:${sq(3, 4)},${sq(4, 4)}`).ok, false, '黑方不能抢先走');
  assert.equal(og.submit('p1', `move:${sq(6, 4)},${sq(5, 4)}`).ok, true);
  assert.equal(og.state().turn, 'p2');
  assert.equal(og.submit('p2', `move:${sq(3, 4)},${sq(4, 4)}`).ok, true);
  assert.equal(JSON.parse(JSON.stringify(og.state())).turn, 'p1');
});

test('15. 状态可 JSON 序列化、每次新对象、外改不污染内部', () => {
  const g = createGame({ seed: 9, mode: 'ai' });
  g.submit(RED, `move:${sq(7, 1)},${sq(7, 4)}`);
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.deepEqual(JSON.parse(json), s1);
  for (const key of ['turn', 'board', 'inCheck', 'checkmate', 'stalemate', 'moveHistory', 'legalMoves']) {
    assert.ok(json.includes(`"${key}"`), `state 必须含 ${key}`);
  }
  assert.equal(s1.moveHistory.length, 1);
  assert.equal(s1.moveHistory[0].from, sq(7, 1));
  assert.equal(s1.moveHistory[0].to, sq(7, 4));
  assert.equal(s1.moveHistory[0].player, RED);
  s1.board[sq(7, 4)] = 0;
  s1.moveHistory[0].to = 0;
  s1.pieceCount.p1 = 0;
  assert.equal(g.state().board[sq(7, 4)], pieceOf(RED, C), '外部改副本不影响内部');
  assert.equal(g.state().moveHistory[0].to, sq(7, 4));
  assert.equal(g.state().pieceCount.p1, 16);
  assert.notEqual(g.state(), g.state(), '每次返回新对象');
  assert.equal(JSON.stringify(g.state()), JSON.stringify(g.state()), '同一局面序列化稳定');
});

test('16. 重复局面判和：双方各自来回挪车，第三次同局面判 draw', () => {
  const g = gameOf([
    [sq(5, 0), pieceOf(RED, R)],
    [sq(0, 0), pieceOf(BLACK, R)],
  ]);
  const seq = [
    [RED, sq(5, 0), sq(6, 0)],
    [BLACK, sq(0, 0), sq(1, 0)],
    [RED, sq(6, 0), sq(5, 0)],
    [BLACK, sq(1, 0), sq(0, 0)],
  ];
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const [who, from, to] of seq) {
      const r = g.submit(who, `move:${from},${to}`);
      assert.equal(r.ok, true, `${who} ${from}->${to} 应合法`);
    }
  }
  const s = g.state();
  assert.equal(s.winner, 'draw');
  assert.equal(s.reason, 'repetition');
  assert.equal(g.result().winner, 'draw');
  assert.equal(g.result().scores.p1, 0);
  assert.equal(g.result().scores.p2, 0);
  assert.match(g.result().text, /判和/);
  assert.equal(g.result().title, '和棋', '结算面板标题');
});

test('17. 走子规则纯函数：genPseudoMoves/genLegalMoves 不改入参棋盘', () => {
  const b = initialBoard();
  const copy = b.slice();
  const pseudo = genPseudoMoves(b, RED);
  const legal = genLegalMoves(b, RED);
  assert.ok(pseudo.length >= legal.length);
  assert.equal(legal.length, 44);
  assert.deepEqual(b, copy, '入参棋盘未被改动');
  assert.equal(pseudo[0].from % 1, 0);
  assert.equal(sideOf(b[sq(9, 4)]), RED);
  assert.equal(kindOf(b[sq(9, 4)]), K);
  assert.equal(pieceOf(BLACK, P), 15);
  assert.equal(ROWS, 10);
});

test('18. AI：各 level 出招合法、纯函数不改 state、一步绝杀会抓、被将军只应将军', () => {
  // 各难度都是合法着法，且 chooseMove 不修改传入 state
  const g = createGame({ seed: 11, mode: 'ai' });
  const before = JSON.stringify(g.state());
  for (const level of [1, 2, 3]) {
    const s = g.state();
    const mv = chooseMove(s, s.turn, level);
    assert.match(mv, /^move:\d+,\d+$/, `level ${level} 应返回 move:from,to`);
    assert.equal(g.submit(s.turn, mv).ok, true, `level ${level} 的 ${mv} 必须合法`);
    g.undo();
  }
  assert.equal(JSON.stringify(g.state()), before, 'chooseMove 不得改传入 state');

  // 不替对手走：当前是红方回合，问黑方应返回 null
  assert.equal(chooseMove(g.state(), BLACK, 1), null);
  assert.equal(chooseMove(g.state(), 'p3', 1), null);

  // 一步成杀必须抓住（红车 (3,0)、(1,8) 的局面：绝杀或困毙都算赢，
  // 实测 AI 会选 17→14 —— 车封 row1，同时红帅 (9,3) 占住 col3 使黑将无路，构成困毙）
  const mate = gameOf([
    [sq(3, 0), pieceOf(RED, R)],
    [sq(1, 8), pieceOf(RED, R)],
  ]);
  for (const level of [1, 2, 3]) {
    const mv = chooseMove(mate.state(), RED, level);
    const probe = gameOf([
      [sq(3, 0), pieceOf(RED, R)],
      [sq(1, 8), pieceOf(RED, R)],
    ]);
    assert.equal(probe.submit(RED, mv).ok, true);
    assert.equal(probe.state().winner, RED, `level ${level} 应走出杀着（实际 ${mv}）`);
    assert.ok(['checkmate', 'stalemate'].includes(probe.state().reason));
    assert.equal(genLegalMoves(probe.state().board, BLACK).length, 0, '黑方必须无子可走');
  }

  // 被将军且只有一个合法着法时，AI 必须选它（应将强制）
  const checked = gameOf([
    [sq(0, 0), pieceOf(RED, R)],
    [sq(3, 0), pieceOf(BLACK, P)],
  ], BLACK);
  const only = `move:${sq(0, 4)},${sq(1, 4)}`;
  assert.equal(chooseMove(checked.state(), BLACK, 1), only);
});

test('19. AI 自对弈 10 手：全程合法、无非法提交、陷入终局即停', () => {
  const g = createGame({ seed: 21, mode: 'ai' });
  let plies = 0;
  for (; plies < 10; plies++) {
    const s = g.state();
    if (s.winner) break;
    const mv = chooseMove(s, s.turn, 1);
    assert.match(mv, /^move:\d+,\d+$/);
    const r = g.submit(s.turn, mv);
    assert.equal(r.ok, true, `第 ${plies + 1} 手 ${mv} 应合法`);
    const after = g.state();
    assert.equal(after.board.length, CELLS);
    assert.equal(sideOf(after.board[after.lastMove.to]), s.turn);
  }
  assert.ok(g.state().moveCount >= 1);
});
