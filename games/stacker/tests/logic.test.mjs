import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, COLS, ROWS, LOCK_DELAY } from '../logic.mjs';

function fresh(seed = 42) {
  return createGame({ seed });
}

/** 清空棋盘（调试用），让 7-bag 序列可以被持续收集而不顶出。 */
function clearBoard(g) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) g.debugSetCell(x, y, null);
  }
}

/** 收集前 n 个出块类型：每落一块后清空盘面，纯粹观察出块序列。 */
function collectTypes(g, n) {
  const seen = [];
  while (seen.length < n && !g.state().over) {
    const s = g.state();
    if (s.active) seen.push(s.active.type);
    g.submit('p1', 'hard');
    clearBoard(g);
  }
  return seen;
}

test('初始状态：10×20、有活动块、分数 0、turn=p1', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.cols, COLS);
  assert.equal(s.rows, ROWS);
  assert.equal(s.score, 0);
  assert.equal(s.lines, 0);
  assert.equal(s.over, false);
  assert.equal(s.turn, 'p1');
  assert.ok(s.active && s.active.type);
  assert.equal(s.next.length, 3);
  assert.equal(s.hold, null);
  assert.equal(s.holdUsed, false);
  assert.equal(s.board.length, ROWS);
  assert.equal(s.board[0].length, COLS);
});

test('7-bag：连续出块每 7 个一批恰含 7 种且不重复', () => {
  const types = collectTypes(fresh(7), 21);
  const all = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].sort();
  assert.equal(types.length, 21);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual([...types.slice(i * 7, i * 7 + 7)].sort(), all, `第 ${i + 1} 袋`);
  }
});

test('7-bag 可复现：同种子出块序列一致', () => {
  assert.deepEqual(collectTypes(fresh(123), 14), collectTypes(fresh(123), 14));
});

test('左右移动边界：不能越出左右墙', () => {
  const g = fresh();
  for (let i = 0; i < 20; i++) g.submit('p1', 'left');
  let s = g.state();
  assert.ok(s.active.x >= 0, `左边界 x=${s.active.x}`);
  const minX = s.active.x;
  for (let i = 0; i < 20; i++) g.submit('p1', 'right');
  s = g.state();
  assert.ok(s.active.x > minX, '右移应改变位置');
  assert.ok(s.active.x >= 0);
});

test('旋转四态可循环（I 块四次顺旋回到 0 态）', () => {
  const g = fresh();
  for (let i = 0; i < 20 && g.state().active.type !== 'I'; i++) {
    g.submit('p1', 'hard');
    clearBoard(g);
  }
  assert.equal(g.state().active.type, 'I');
  const rots = [];
  for (let i = 0; i < 4; i++) {
    rots.push(g.state().active.rot);
    g.submit('p1', 'rotCW');
  }
  assert.deepEqual(rots, [0, 1, 2, 3]);
  assert.equal(g.state().active.rot, 0);
});

test('旋转踢墙：贴右墙旋转后仍在盘内且不结束', () => {
  const g = fresh();
  for (let i = 0; i < 20 && g.state().active.type !== 'I'; i++) {
    g.submit('p1', 'hard');
    clearBoard(g);
  }
  assert.equal(g.state().active.type, 'I');
  for (let i = 0; i < 10; i++) g.submit('p1', 'right');
  g.submit('p1', 'rotCW');
  const after = g.state();
  assert.equal(after.over, false);
  assert.ok(after.active.x >= 0 && after.active.x <= COLS - 1);
});

test('硬降到底：落定一块且盘上出现格子', () => {
  const g = fresh();
  const before = g.state();
  g.submit('p1', 'hard');
  const after = g.state();
  assert.equal(after.pieces, 1, '应落定一块');
  assert.equal(after.active.type, before.next[0], '当前块换成队列首块');
  assert.ok(after.board.some((row) => row.some(Boolean)), '盘上应有落定格');
});

test('消行计分：铺满底行后硬降触发消行，单行得 100×等级', () => {
  const g = fresh();
  // 等一个 O 块（2×2 形状固定），用清盘避开顶出。
  for (let i = 0; i < 20 && g.state().active.type !== 'O'; i++) {
    g.submit('p1', 'hard');
    clearBoard(g);
  }
  assert.equal(g.state().active.type, 'O');
  // 底行留最左两列空，O 横放在 x=0 正好占 (0,18)(1,18)(0,19)(1,19)。
  for (let x = 2; x < COLS; x++) g.debugSetCell(x, ROWS - 1, 'J');
  for (let i = 0; i < 12; i++) g.submit('p1', 'left');
  g.submit('p1', 'hard');
  const s = g.state();
  assert.equal(s.lines, 1, '应消一行');
  assert.equal(s.lastClear, 1, '记录单行消除');
  assert.ok(s.score >= 100, `分数应含消行 100，实际 ${s.score}`);
  // 原底行的 J 格应全部消失（O 上半部分下落后只剩 O）。
  assert.equal(s.board[ROWS - 1].some((c) => c === 'J'), false, '消行后底行无残留 J');
});

test('锁定延迟：触底后约 500ms 才落定（不是立即锁定）', () => {
  const g = fresh();
  let sawLockTimer = false;
  for (let i = 0; i < 600; i++) {
    g.step(0.05, []);
    const s = g.state();
    if (s.pieces === 0 && s.lockTimer > 0 && s.lockTimer < LOCK_DELAY) sawLockTimer = true;
    if (s.pieces > 0) break;
  }
  assert.ok(sawLockTimer, '应观察到 lockTimer 在 0～500ms 之间累积');
  assert.equal(LOCK_DELAY, 0.5);
});

test('Hold 每块一次：同块内第二次无效，落定后恢复', () => {
  const g = fresh();
  const first = g.state().active.type;
  g.submit('p1', 'hold');
  let s = g.state();
  assert.equal(s.hold, first);
  assert.equal(s.holdUsed, true);
  assert.notEqual(s.active.type, first);
  const current = s.active.type;
  g.submit('p1', 'hold');
  s = g.state();
  assert.equal(s.hold, first, 'HOLD 内容不变');
  assert.equal(s.active.type, current, '当前块不变');
  g.submit('p1', 'hard');
  assert.equal(g.state().holdUsed, false, '落定后恢复');
});

test('顶出失败：持续堆叠最终 over 且 result 可读', () => {
  const g = fresh(1);
  for (let i = 0; i < 60 && !g.state().over; i++) g.submit('p1', 'hard');
  const s = g.state();
  assert.equal(s.over, true, '持续堆叠应顶出失败');
  assert.ok(g.result());
  assert.equal(g.result().over, true);
});

test('重置：reset 回到开局状态', () => {
  const g = fresh();
  for (let i = 0; i < 5; i++) g.submit('p1', 'hard');
  assert.ok(g.state().pieces >= 5);
  g.reset();
  const s = g.state();
  assert.equal(s.score, 0);
  assert.equal(s.lines, 0);
  assert.equal(s.pieces, 0);
  assert.equal(s.over, false);
  assert.equal(s.hold, null);
  assert.ok(s.active);
});

test('状态可序列化：JSON 往返后结构一致', () => {
  const g = fresh();
  g.submit('p1', 'rotate');
  g.submit('p1', 'hard');
  const s = g.state();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(s.turn, 'p1');
});

test('state() 每次返回新对象，外部修改不污染内部', () => {
  const g = fresh();
  const a = g.state();
  a.board[0][0] = 'X';
  a.score = 999;
  const b = g.state();
  assert.notEqual(b.board[0][0], 'X');
  assert.notEqual(b.score, 999);
});

test('连续 N 步混合动作不崩 + 非法动作/玩家校验', () => {
  const g = fresh(9);
  const acts = ['left', 'right', 'rotCW', 'rotCCW', 'soft', 'hard', 'hold', 'rotate'];
  for (let i = 0; i < 200; i++) {
    if (g.state().over) g.reset();
    g.submit('p1', acts[i % acts.length]);
    g.step(0.016, []);
  }
  assert.equal(g.submit('p2', 'left').ok, false, '非 p1 玩家被拒');
  assert.equal(g.submit('p1', 'bogus').ok, false, '非法动作被拒');
  assert.equal(g.submit(0, 'left').ok, true, 'shell 的数字下标 0 视为 p1');
});
