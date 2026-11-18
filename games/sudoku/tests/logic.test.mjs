import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, generatePuzzle, LEVELS, SIZE, CELLS, FULL } from '../logic.mjs';

/** 独立的暴力解数器（最多数 limit 个），与被测实现的求解器相互独立 */
function countSolutions(grid, limit = 2) {
  const rm = Array(SIZE).fill(0);
  const cm = Array(SIZE).fill(0);
  const bm = Array(SIZE).fill(0);
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i];
    if (!v) continue;
    const bit = 1 << (v - 1);
    const r = (i / SIZE) | 0;
    const c = i % SIZE;
    const box = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    rm[r] |= bit;
    cm[c] |= bit;
    bm[box] |= bit;
  }
  function rec() {
    let best = -1;
    let bestMask = 0;
    let bestCnt = 10;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const r = (i / SIZE) | 0;
      const c = i % SIZE;
      const box = ((r / 3) | 0) * 3 + ((c / 3) | 0);
      const mask = FULL & ~(rm[r] | cm[c] | bm[box]);
      let cnt = 0;
      for (let x = mask; x; x &= x - 1) cnt++;
      if (cnt === 0) return 0;
      if (cnt < bestCnt) {
        bestCnt = cnt;
        best = i;
        bestMask = mask;
        if (cnt === 1) break;
      }
    }
    if (best < 0) return 1;
    let total = 0;
    for (let d = 1; d <= SIZE; d++) {
      if (!(bestMask & (1 << (d - 1)))) continue;
      const r = (best / SIZE) | 0;
      const c = best % SIZE;
      const box = ((r / 3) | 0) * 3 + ((c / 3) | 0);
      const bit = 1 << (d - 1);
      grid[best] = d;
      rm[r] |= bit;
      cm[c] |= bit;
      bm[box] |= bit;
      total += rec();
      grid[best] = 0;
      rm[r] &= ~bit;
      cm[c] &= ~bit;
      bm[box] &= ~bit;
      if (total >= limit) return total;
    }
    return total;
  }
  return rec();
}

function firstEmpty(state) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!state.puzzle[r][c]) return { r, c };
    }
  }
  throw new Error('没有空格，无法测试');
}

function assertValidSolution(sol) {
  assert.equal(sol.length, CELLS);
  for (let i = 0; i < CELLS; i++) {
    assert.ok(Number.isInteger(sol[i]) && sol[i] >= 1 && sol[i] <= 9);
  }
  for (let g = 0; g < 9; g++) {
    const row = new Set();
    const col = new Set();
    const box = new Set();
    for (let k = 0; k < 9; k++) {
      row.add(sol[g * 9 + k]);
      col.add(sol[k * 9 + g]);
      const br = ((g / 3) | 0) * 3 + ((k / 3) | 0);
      const bc = (g % 3) * 3 + (k % 3);
      box.add(sol[br * 9 + bc]);
    }
    assert.equal(row.size, 9, `第 ${g} 行不合法`);
    assert.equal(col.size, 9, `第 ${g} 列不合法`);
    assert.equal(box.size, 9, `第 ${g} 宫不合法`);
  }
}

// 1
test('生成的题有唯一解（独立求解器验证多种子多难度）', () => {
  for (const level of [1, 2, 3]) {
    for (const seed of [1, 7, 42, 12345, 99999]) {
      const gen = generatePuzzle(seed, level);
      assert.equal(countSolutions(gen.puzzle.slice(), 2), 1, `seed=${seed} level=${level} 非唯一解`);
    }
  }
});

// 2
test('完整解合法（行列宫均含 1～9 不重复）', () => {
  for (const level of [1, 2, 3]) {
    assertValidSolution(generatePuzzle(2024, level).solution);
  }
});

// 3
test('给定格与解一致，且三档难度挖洞数不同', () => {
  const holes = [];
  for (const level of [1, 2, 3]) {
    const gen = generatePuzzle(555, level);
    holes.push(gen.holes);
    assert.equal(gen.givens, CELLS - gen.holes);
    assert.equal(gen.holes, LEVELS[level].holes);
    for (let i = 0; i < CELLS; i++) {
      if (gen.puzzle[i] !== 0) assert.equal(gen.puzzle[i], gen.solution[i]);
    }
  }
  assert.ok(holes[0] < holes[1] && holes[1] < holes[2], '难度越高挖洞越多');
});

// 4
test('初始状态完整且 turn 固定为 p1', () => {
  const g = createGame({ seed: 3, level: 2 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.level, 2);
  assert.equal(s.size, SIZE);
  assert.equal(s.solved, false);
  assert.equal(s.mistakes, 0);
  assert.equal(s.hintsLeft, LEVELS[2].hints);
  assert.equal(s.canUndo, false);
  assert.equal(s.values.flat().filter(Boolean).length, 0);
});

// 5
test('合法填数：values 写入正确数字、mistakes 不增加', () => {
  const g = createGame({ seed: 8, level: 1 });
  const { r, c } = firstEmpty(g.state());
  const n = g.state().solution[r][c];
  const res = g.submit('p1', `set:${r},${c},${n}`);
  assert.equal(res.ok, true);
  assert.equal(g.state().values[r][c], n);
  assert.equal(g.state().mistakes, 0);
  assert.equal(g.state().canUndo, true);
});

// 6
test('错误填数：记一次 mistake 并标红依据（值≠解）', () => {
  const g = createGame({ seed: 9, level: 1 });
  const { r, c } = firstEmpty(g.state());
  const wrong = (g.state().solution[r][c] % 9) + 1;
  g.submit('p1', `set:${r},${c},${wrong}`);
  const s = g.state();
  assert.equal(s.mistakes, 1);
  assert.notEqual(s.values[r][c], s.solution[r][c], '渲染层据此标红');
});

// 7
test('给定格不可修改，越界与非法动作被拒', () => {
  const g = createGame({ seed: 10 });
  const s = g.state();
  let gr = -1;
  let gc = -1;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (s.puzzle[r][c]) { gr = r; gc = c; break; }
    }
    if (gr >= 0) break;
  }
  assert.equal(g.submit('p1', `set:${gr},${gc},5`).ok, false);
  assert.equal(g.submit('p1', 'set:9,0,5').ok, false);
  assert.equal(g.submit('p1', 'set:0,0,10').ok, false);
  assert.equal(g.submit('p1', 'garbage').ok, false);
  assert.equal(g.submit('p2', 'undo').ok, false);
});

// 8
test('笔记切换：同一格重复切候选可开可关，且自动排序', () => {
  const g = createGame({ seed: 11 });
  const { r, c } = firstEmpty(g.state());
  assert.deepEqual(g.submit('p1', `note:${r},${c},7`), { ok: true, r, c, n: 7, on: true });
  g.submit('p1', `note:${r},${c},3`);
  assert.deepEqual(g.state().notes[r][c], [3, 7]);
  assert.equal(g.submit('p1', `note:${r},${c},7`).on, false);
  assert.deepEqual(g.state().notes[r][c], [3]);
});

// 9
test('提示：揭示一格正确数字并消耗次数，用完再提示失败', () => {
  const g = createGame({ seed: 12, level: 3 });
  const { r, c } = firstEmpty(g.state());
  const before = g.state().hintsLeft;
  const res = g.submit('p1', 'hint');
  assert.equal(res.ok, true);
  assert.equal(res.n, g.state().solution[res.r][res.c]);
  assert.equal(g.state().values[res.r][res.c], res.n);
  assert.equal(g.state().hintsLeft, before - 1);
  for (let i = 0; i < before - 1; i++) g.submit('p1', 'hint');
  assert.equal(g.state().hintsLeft, 0);
  assert.equal(g.submit('p1', 'hint').ok, false);
  assert.equal(g.state().values[r][c], g.state().solution[r][c] || g.state().values[r][c]);
});

// 10
test('撤销：恢复上一步的 values/notes/mistakes/hintsLeft', () => {
  const g = createGame({ seed: 13, level: 1 });
  const { r, c } = firstEmpty(g.state());
  const wrong = (g.state().solution[r][c] % 9) + 1;
  assert.equal(g.submit('p1', 'undo').ok, false, '空栈撤销失败');
  g.submit('p1', `set:${r},${c},${wrong}`);
  assert.equal(g.state().mistakes, 1);
  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.equal(g.state().values[r][c], 0);
  assert.equal(g.state().mistakes, 0);
  assert.equal(g.state().canUndo, false);
  // 提示也可撤销：恢复提示次数
  const h0 = g.state().hintsLeft;
  g.submit('p1', 'hint');
  g.submit('p1', 'undo');
  assert.equal(g.state().hintsLeft, h0);
});

// 11
test('擦除：set 的 n=0 与 erase 别名都能清空格子', () => {
  const g = createGame({ seed: 14 });
  const { r, c } = firstEmpty(g.state());
  const n = g.state().solution[r][c];
  g.submit('p1', `set:${r},${c},${n}`);
  assert.equal(g.submit('p1', `set:${r},${c},0`).ok, true);
  assert.equal(g.state().values[r][c], 0);
  g.submit('p1', `set:${r},${c},${n}`);
  assert.equal(g.submit('p1', `erase:${r},${c}`).ok, true);
  assert.equal(g.state().values[r][c], 0);
});

// 12
test('完成判定：填满所有正确数字后 solved=true 且 result 给出结算', () => {
  const g = createGame({ seed: 15, level: 1 });
  assert.equal(g.result(), null);
  const s = g.state();
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!s.puzzle[r][c] && !s.values[r][c]) {
        g.submit('p1', `set:${r},${c},${s.solution[r][c]}`);
      }
    }
  }
  assert.equal(g.state().solved, true);
  const result = g.result();
  assert.equal(result.over, true);
  assert.equal(result.winner, 'p1');
  assert.ok(result.score > 0);
  assert.equal(g.submit('p1', 'set:0,3,5').ok, false, '完成后不再接受落子');
});

// 13
test('状态可 JSON 序列化且每次 state() 返回新对象', () => {
  const g = createGame({ seed: 16 });
  const s = g.state();
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  const a = g.state();
  const b = g.state();
  assert.notStrictEqual(a, b);
  a.values[0][0] = 99;
  assert.notEqual(g.state().values[0][0], 99, '外部改动不得污染内部状态');
});

// 14
test('生成性能：单局 ≤ 300ms，批量平均远低于预算', () => {
  let worst = 0;
  for (const level of [1, 2, 3]) {
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      generatePuzzle(1000 + k * 37 + level, level);
      const dt = performance.now() - t0;
      if (dt > worst) worst = dt;
    }
  }
  assert.ok(worst < 300, `最慢生成 ${worst.toFixed(2)}ms 超过 300ms`);
});

// 15
test('reset 与 level 切换：清空盘面并重发题目', () => {
  const g = createGame({ seed: 17, level: 1 });
  const { r, c } = firstEmpty(g.state());
  g.submit('p1', `set:${r},${c},${g.state().solution[r][c]}`);
  g.submit('p1', 'hint');
  g.reset();
  assert.equal(g.state().values.flat().filter(Boolean).length, 0);
  assert.equal(g.state().mistakes, 0);
  assert.equal(g.state().hintsLeft, LEVELS[1].hints);
  assert.equal(g.submit('p1', 'level:3').ok, true);
  assert.equal(g.state().level, 3);
  assert.equal(g.state().hintsLeft, LEVELS[3].hints);
  assert.equal(g.submit('p1', 'level:9').ok, false);
});
