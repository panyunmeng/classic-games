import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  COLS,
  ROWS,
  GARBAGE,
  ATTACK,
  ACTION_WORDS,
  PIECES,
  SEATS,
} from '../logic.mjs';
import { aiAction, chooseMove, AI_WORDS } from '../ai.mjs';

const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** 把指定行的某列之外全部填满（用来构造确定性的消行场面）。 */
function fillRowsExcept(g, seat, rows, holeCol, type = 'J') {
  for (const y of rows) {
    for (let x = 0; x < COLS; x++) {
      if (x !== holeCol) g.debugSetCell(seat, x, y, type);
    }
  }
}

/** 收集某一场连续出现的方块类型（每落一块清一次盘，避免顶出干扰取样）。 */
function collectTypes(g, seat, n) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    const s = g.state();
    if (s.over || !s.boards[seat].cur) break;
    seen.push(s.boards[seat].cur.type);
    g.submit(seat, 'drop');
    g.debugClear(seat);
  }
  return seen;
}

test('初始状态：双场各 10×20、turn=null、tick=0、契约字段齐全', () => {
  const g = createGame({ seed: 42 });
  const s = g.state();
  assert.equal(s.turn, null);
  assert.equal(s.tick, 0);
  assert.equal(s.winner, null);
  assert.equal(s.over, false);
  assert.equal(s.cols, COLS);
  assert.equal(s.rows, ROWS);
  assert.deepEqual(Object.keys(s.boards).sort(), ['p1', 'p2']);
  for (const seat of SEATS) {
    const b = s.boards[seat];
    assert.equal(b.grid.length, ROWS);
    assert.equal(b.grid[0].length, COLS);
    assert.equal(b.score, 0);
    assert.equal(b.incoming, 0);
    assert.deepEqual(b.garbage, []);
    assert.equal(b.over, false);
    assert.ok(b.cur && TYPES.includes(b.cur.type), `${seat} 应有活动块`);
    assert.equal(b.next.length, 3);
    assert.equal(b.hold, null);
    assert.equal(b.holdUsed, false);
  }
});

test('双场独立：对 p1 的操作不碰 p2 的盘面与当前块', () => {
  const g = createGame({ seed: 5, mode: 'local2p' });
  const before = g.state();
  assert.equal(g.submit('p1', 'left').ok, true);
  let s = g.state();
  assert.equal(s.boards.p1.cur.x, before.boards.p1.cur.x - 1);
  assert.deepEqual(s.boards.p2.cur, before.boards.p2.cur);
  assert.deepEqual(s.boards.p2.grid, before.boards.p2.grid);

  g.submit('p1', 'drop');
  s = g.state();
  assert.ok(s.boards.p1.grid.flat().some(Boolean), 'p1 应有落定格');
  assert.equal(s.boards.p1.pieces, 1);
  assert.equal(s.boards.p2.grid.flat().some(Boolean), false, 'p2 盘面应仍然空');
  assert.equal(s.boards.p2.pieces, 0);
});

test('7-bag：连续 21 块里每种方块恰好 3 次，且同种子可复现', () => {
  const seen = collectTypes(createGame({ seed: 7, mode: 'local2p' }), 'p1', 21);
  assert.equal(seen.length, 21);
  for (const t of TYPES) {
    assert.equal(seen.filter((x) => x === t).length, 3, `${t} 应出现 3 次`);
  }
  // 3 张预览让取样窗口与「袋边界」错位，所以断言的是袋的配比而不是每 7 块一段。
  const a = collectTypes(createGame({ seed: 123, mode: 'local2p' }), 'p1', 14);
  const b = collectTypes(createGame({ seed: 123, mode: 'local2p' }), 'p1', 14);
  assert.deepEqual(a, b);
});

test('移动与旋转：撞墙停住、四态循环回到初始姿态', () => {
  const g = createGame({ seed: 3, mode: 'local2p' });
  for (let i = 0; i < 20; i++) g.submit('p1', 'left');
  let s = g.state();
  // 矩阵内相对列可能 >0（O/L 等），所以「贴墙」的判据是占用格都在盘内，而不是 x>=0
  const colsOf = (cur) => PIECES[cur.type][cur.rot].map(([cx]) => cx + cur.x);
  assert.ok(colsOf(s.boards.p1.cur).every((cx) => cx >= 0 && cx < COLS), '贴左墙后不能越界');
  const minX = s.boards.p1.cur.x;
  for (let i = 0; i < 20; i++) g.submit('p1', 'right');
  s = g.state();
  assert.ok(s.boards.p1.cur.x > minX, '右移应改变位置');
  assert.ok(colsOf(s.boards.p1.cur).every((cx) => cx >= 0 && cx < COLS), '贴右墙后不能越界');

  g.debugPiece('p1', 'T', 0, 3, 0);
  const rots = [];
  for (let i = 0; i < 4; i++) {
    rots.push(g.state().boards.p1.cur.rot);
    assert.equal(g.submit('p1', 'rotate').ok, true);
  }
  assert.deepEqual(rots, [0, 1, 2, 3]);
  assert.equal(g.state().boards.p1.cur.rot, 0, '顺时针四次回到 0 态');
  // 键盘/触屏走的是别名词，效果必须与 rotate 一致
  g.submit('p1', 'up');
  assert.equal(g.state().boards.p1.cur.rot, 1);
});

test('消行计分：底行补满后消 1 行，记 lines/lastClear 并加分', () => {
  const g = createGame({ seed: 11, mode: 'local2p' });
  // 底行只留 0、1 两列空，O 块从 x=-1 落下去正好补齐
  for (let x = 2; x < COLS; x++) g.debugSetCell('p1', x, ROWS - 1, 'J');
  g.debugPiece('p1', 'O', 0, -1, 0);
  g.submit('p1', 'drop');
  const s = g.state();
  assert.equal(s.boards.p1.lines, 1);
  assert.equal(s.boards.p1.lastClear, 1);
  assert.ok(s.boards.p1.score >= 100, `分数应含消行 100，实际 ${s.boards.p1.score}`);
  assert.equal(s.boards.p1.grid[ROWS - 1][0], 'O', '消行后 O 的上半部分落在底行');
});

test('攻击行数表：1/2/3/4 行 → 0/1/2/4 行；四消真的传给对手', () => {
  assert.deepEqual(ATTACK, [0, 0, 1, 2, 4]);
  const g = createGame({ seed: 13, mode: 'local2p' });
  fillRowsExcept(g, 'p1', [16, 17, 18, 19], 4);
  g.debugPiece('p1', 'I', 0);
  g.submit('p1', 'left'); // 生成列 3 → 2：I 竖态的格在 x+2 列，正好是空井
  g.submit('p1', 'rotate');
  g.submit('p1', 'drop');
  const s = g.state();
  assert.equal(s.boards.p1.lines, 4);
  assert.equal(s.boards.p1.lastClear, 4);
  assert.equal(s.boards.p1.incoming, 0);
  assert.equal(s.boards.p2.incoming, 4, '四消应送 4 行给对手');
  assert.equal(s.boards.p2.garbage.length, 4);
  assert.equal(s.boards.p1.grid.flat().some(Boolean), false, '四行被整段清掉');
});

test('垃圾插入：落到盘底、整堆上移、每行恰好一个缺口', () => {
  const g = createGame({ seed: 17, mode: 'local2p' });
  g.debugGarbage('p1', [2, 8]); // 明确缺口列，便于逐格断言
  g.debugSetCell('p1', 0, 18, 'T');
  g.debugPiece('p1', 'O', 0, -1, 0);
  g.submit('p1', 'drop');
  const s = g.state();
  assert.equal(s.boards.p1.lines, 0);
  assert.equal(s.boards.p1.incoming, 0, '缓冲全部落地');
  assert.deepEqual(s.boards.p1.garbage, []);

  const row19 = s.boards.p1.grid[19];
  const row18 = s.boards.p1.grid[18];
  assert.equal(row19.filter((c) => c === GARBAGE).length, COLS - 1);
  assert.equal(row19[8], null, '最后插入的行保留它的缺口列 8');
  assert.equal(row18[2], null, '先插入的行被顶到上一格，缺口列 2');
  assert.equal(s.boards.p1.grid[16][0], 'T', '原有格子被整堆顶高 2 行');
  assert.equal(s.boards.p1.grid[14][0], 'O');

  // 缺口由 rng 决定：同种子同操作 → 完全一致
  const run = (seed) => {
    const x = createGame({ seed, mode: 'local2p' });
    x.debugGarbage('p1', 3);
    x.debugPiece('p1', 'O', 0, -1, 0);
    x.submit('p1', 'drop');
    return x.state().boards.p1.grid;
  };
  assert.deepEqual(run(99), run(99));
  const bottom = run(99)[19];
  assert.equal(bottom.filter((c) => c === null).length, 1);
});

test('incoming 抵消：消 2 行抵掉 2 行待落垃圾，同时送对手 1 行', () => {
  const g = createGame({ seed: 23, mode: 'local2p' });
  g.debugGarbage('p2', [0, 3, 7]);
  assert.equal(g.state().boards.p2.incoming, 3);
  fillRowsExcept(g, 'p2', [18, 19], 4);
  g.debugPiece('p2', 'I', 0);
  g.submit('p2', 'left');
  g.submit('p2', 'rotate');
  g.submit('p2', 'drop');

  const s = g.state();
  assert.equal(s.boards.p2.lines, 2);
  assert.equal(s.boards.p1.incoming, 1, '消 2 行 → 送 1 行');
  assert.equal(s.boards.p2.incoming, 0, '3 行被抵 2 行、剩 1 行立刻落地');
  const bottom = s.boards.p2.grid[19];
  assert.equal(bottom.filter((c) => c === GARBAGE).length, COLS - 1);
  assert.equal(bottom[7], null, '抵消从最旧开始，剩下的最后一行缺口列是 7');
});

test('顶出判负：堆到生成位被占即负，winner 归对手', () => {
  const g = createGame({ seed: 31, mode: 'local2p' });
  let guard = 0;
  while (!g.state().over && guard++ < 200) g.submit('p1', 'drop');
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.boards.p1.over, true);
  assert.equal(s.boards.p2.over, false);
  assert.equal(s.winner, 'p2');
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.winner, 'p2');
  assert.equal(r.loser, 'p1');
  assert.equal(g.submit('p1', 'left').ok, false, '结束后不再接受动作');
});

test('顶出判负：垃圾把方块挤出盘面顶端同样判负', () => {
  const g = createGame({ seed: 32, mode: 'local2p' });
  // 只留最左一列当永久空洞，避免整行消掉；堆到第 2 行起
  for (let y = 2; y < ROWS; y++) {
    for (let x = 1; x < COLS; x++) g.debugSetCell('p2', x, y, 'J');
  }
  g.debugGarbage('p2', 4);
  g.debugPiece('p2', 'O', 0, 3, 0);
  g.submit('p2', 'drop');
  const s = g.state();
  assert.equal(s.boards.p2.over, true, '顶部有方块时再插垃圾 = 被顶出');
  assert.equal(s.winner, 'p1');
});

test('AI：出招只用白名单词，跑满 1200 帧不崩且合法落子', () => {
  for (const w of AI_WORDS) assert.ok(ACTION_WORDS.includes(w), `${w} 必须在白名单里`);
  for (const w of AI_WORDS) {
    assert.equal(createGame({ seed: 1, mode: 'local2p' }).submit('p2', w).ok, true, `${w} 应被 submit 接受`);
  }

  const g = createGame({ seed: 41, mode: 'solo' });
  for (let i = 0; i < 1200; i++) g.step(1 / 60, []);
  const s = g.state();
  assert.ok(s.boards.p2.pieces > 0, 'AI 应已落块');
  const legal = (cell) => cell === null || cell === GARBAGE || TYPES.includes(cell);
  assert.ok(s.boards.p2.grid.flat().every(legal));
  assert.ok(s.boards.p1.grid.flat().every(legal));

  const b = s.boards.p2;
  const word = aiAction({ grid: b.grid, cur: b.cur }, 1);
  assert.ok(AI_WORDS.includes(word), `AI 返回 ${word}`);
  const viaState = chooseMove(s, 'p2', 1);
  assert.ok(viaState === null || AI_WORDS.includes(viaState));
});

test('状态序列化：JSON 往返结构完全一致，且外部改动不污染内部', () => {
  const g = createGame({ seed: 55, mode: 'local2p' });
  g.submit('p1', 'rotate');
  g.submit('p1', 'drop');
  g.submit('p2', 'hold');
  g.debugGarbage('p1', 2);
  g.step(0.05, [{ seat: 'p2', action: 'left' }]);
  const s = g.state();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(typeof s.tick, 'number');

  const a = g.state();
  a.boards.p1.grid[0][0] = 'X';
  a.boards.p1.score = 9999;
  a.winner = 'p1';
  const b = g.state();
  assert.notEqual(b.boards.p1.grid[0][0], 'X');
  assert.notEqual(b.boards.p1.score, 9999);
  assert.equal(b.winner, null);
});

test('非法动作与座位校验', () => {
  const g = createGame({ seed: 61, mode: 'local2p' });
  assert.equal(g.submit('p1', 'bogus').ok, false);
  assert.equal(g.submit('p4', 'left').ok, false);
  assert.equal(g.submit('p1', 'none').ok, true, 'none 是白名单里的空动作');
  assert.equal(g.submit(0, 'left').ok, true, 'shell 传数字下标 0 表示 p1');
  assert.equal(g.submit(1, 'right').ok, true, 'shell 传数字下标 1 表示 p2');
  assert.equal(g.submit('p2', 'shoot').ok, true, 'shoot 是硬降别名');
  assert.equal(g.state().boards.p2.pieces, 1);
});

test('连走 2000 步：人机 + 双方混合动作不崩，状态始终可序列化', () => {
  const g = createGame({ seed: 77, mode: 'ai' });
  const words = ['left', 'right', 'down', 'rotate', 'drop', 'hold'];
  let k = 0;
  for (let i = 0; i < 2000; i++) {
    if (g.state().over) g.reset();
    if (i % 3 === 0) {
      g.submit('p1', words[k++ % words.length]);
    }
    g.step(1 / 60, i % 7 === 0 ? [{ seat: 'p1', action: 'rotate' }] : []);
  }
  const s = g.state();
  assert.ok(s.tick > 0, 'tick 应随子步增长');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.ok(s.boards.p1.pieces + s.boards.p2.pieces > 0);
  const legal = (cell) => cell === null || cell === GARBAGE || TYPES.includes(cell);
  assert.ok(s.boards.p1.grid.flat().every(legal));
  assert.ok(s.boards.p2.grid.flat().every(legal));
});
