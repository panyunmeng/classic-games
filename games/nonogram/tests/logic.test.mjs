import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createGame,
  generatePuzzle,
  lineClues,
  clampSize,
  HINTS_DEFAULT,
} from '../logic.mjs';

/**
 * 独立重算一条线的线索（不复用被测的 lineClues），用于交叉验证生成结果。
 * 空线按 0 处理，与规则书一致。
 */
function refClues(line) {
  const out = [];
  let run = 0;
  for (const v of line) {
    if (v) run++;
    else if (run) { out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out.length ? out : [0];
}

function indexOfFirstFilled(solution) {
  return solution.indexOf(1);
}

/** 把解里所有该填的格都点成 1（只按规定动作，不碰内部状态） */
function fillSolution(g) {
  const s = g.state();
  for (let i = 0; i < s.solution.length; i++) {
    if (s.solution[i] === 1) {
      const r = Math.floor(i / s.size);
      const c = i % s.size;
      const res = g.submit('p1', `toggle:${r},${c}`);
      assert.equal(res.ok, true, `填 (${r},${c}) 应成功`);
    }
  }
}

test('1. 生成线索与原图一致：逐行逐列独立重算，5×5 与 10×10 多组种子', () => {
  for (const size of [5, 10]) {
    for (const seed of [1, 2, 3, 7, 42]) {
      const p = generatePuzzle(seed, size);
      const n = p.size;
      assert.equal(n, size);
      assert.equal(p.solution.length, n * n);
      assert.equal(p.rowClues.length, n);
      assert.equal(p.colClues.length, n);

      for (let r = 0; r < n; r++) {
        const line = p.solution.slice(r * n, r * n + n);
        assert.deepEqual(p.rowClues[r], refClues(line), `seed=${seed} 第 ${r} 行线索`);
      }
      for (let c = 0; c < n; c++) {
        const line = [];
        for (let r = 0; r < n; r++) line.push(p.solution[r * n + c]);
        assert.deepEqual(p.colClues[c], refClues(line), `seed=${seed} 第 ${c} 列线索`);
      }
      // 拒绝采样应保证每条线非退化：线索不是 [0] 也不是 [n]
      for (const clues of [...p.rowClues, ...p.colClues]) {
        assert.ok(clues[0] !== 0 && clues[0] !== n, `线索不应退化：${clues}`);
      }
    }
  }
});

test('2. 线索计算的多段/连续/空线规则', () => {
  assert.deepEqual(lineClues([1, 1, 0, 1, 1, 1]), [2, 3]);
  assert.deepEqual(lineClues([1, 1, 1, 1]), [4]);
  assert.deepEqual(lineClues([0, 1, 0, 1, 0]), [1, 1]);
  assert.deepEqual(lineClues([0, 0, 0]), [0]);
  assert.deepEqual(lineClues([1, 0, 1, 0, 1]), [1, 1, 1]);
  assert.deepEqual(lineClues([1]), [1]);
  // 段间至少要空一格：1,0,1 是两段，不能算成 3
  assert.notDeepEqual(lineClues([1, 0, 1]), [3]);
});

test('3. 初始状态：默认 10×10、turn=p1、cells 全 0、库存 3 次提示、未完成', () => {
  const s = createGame({ seed: 3 }).state();
  assert.equal(s.size, 10);
  assert.equal(s.turn, 'p1');
  assert.equal(s.mode, 'solo');
  assert.equal(s.cells.length, 100);
  assert.ok(s.cells.every((v) => v === 0));
  assert.equal(s.solution.length, 100);
  assert.equal(s.rowClues.length, 10);
  assert.equal(s.colClues.length, 10);
  assert.equal(s.solved, false);
  assert.equal(s.mistakes, 0);
  assert.deepEqual(s.conflicts, []);
  assert.equal(s.hintsLeft, HINTS_DEFAULT);
  assert.equal(s.canUndo, false);
  assert.ok(s.progress.total > 0 && s.progress.filled === 0);
  assert.equal(s.focus, null);
});

test('4. 尺寸与难度：level 1→5×5、level 2→10×10、size 显式覆盖并夹到 5～12', () => {
  assert.equal(createGame({ seed: 1, level: 1 }).state().size, 5);
  assert.equal(createGame({ seed: 1, level: 2 }).state().size, 10);
  assert.equal(createGame({ seed: 1, level: 3 }).state().size, 12);
  assert.equal(createGame({ seed: 1, size: 7 }).state().size, 7);
  assert.equal(createGame({ seed: 1, size: 99 }).state().size, 12);
  assert.equal(createGame({ seed: 1, size: 1 }).state().size, 5);
  assert.equal(clampSize(6.9), 6);
  assert.equal(clampSize('abc'), 10);
});

test('5. toggle 填充与取消：解里该填的格点一次变 1，再点回 0', () => {
  const g = createGame({ seed: 5 });
  const s = g.state();
  const i = indexOfFirstFilled(s.solution);
  const r = Math.floor(i / s.size);
  const c = i % s.size;

  const on = g.submit('p1', `toggle:${r},${c}`);
  assert.deepEqual(on, { ok: true, cell: 1 });
  assert.equal(g.state().cells[i], 1);
  assert.deepEqual(g.state().focus, { r, c });

  const off = g.submit('p1', `toggle:${r},${c}`);
  assert.deepEqual(off, { ok: true, cell: 0 });
  assert.equal(g.state().cells[i], 0);
  assert.equal(g.state().canUndo, true);
});

test('6. mark 标记：X→空、空→X、已填→X（可互相覆盖）', () => {
  const g = createGame({ seed: 6 });
  const s = g.state();
  const i = indexOfFirstFilled(s.solution) + 1;
  const r = Math.floor(i / s.size);
  const c = i % s.size;

  assert.deepEqual(g.submit('p1', `mark:${r},${c}`), { ok: true, cell: 2 });
  assert.equal(g.state().cells[i], 2);
  assert.deepEqual(g.submit('p1', `mark:${r},${c}`), { ok: true, cell: 0 });
  assert.equal(g.state().cells[i], 0);

  g.submit('p1', `toggle:${r},${c}`);
  assert.equal(g.state().cells[i], 1);
  assert.deepEqual(g.submit('p1', `mark:${r},${c}`), { ok: true, cell: 2 });
  assert.equal(g.state().cells[i], 2);
});

test('7. 完成判定：填充模式与原图逐格一致才 solved，X 标在解外不算错', () => {
  const g = createGame({ seed: 8 });
  fillSolution(g);
  const s = g.state();
  assert.equal(s.solved, true);
  assert.equal(s.mistakes, 0);
  assert.equal(s.progress.filled, s.progress.total);

  const info = g.result();
  assert.ok(info && info.over === true);
  assert.equal(info.winner, 'p1');
  assert.ok(Number.isFinite(info.score));

  // 全部解格填满后再把某个解为 0 的格标 X，仍然是已完成
  const emptyIdx = s.solution.indexOf(0);
  const markRes = g.submit('p1', `mark:${Math.floor(emptyIdx / s.size)},${emptyIdx % s.size}`);
  assert.equal(markRes.ok, false, '完成后棋盘冻结');
  assert.equal(g.state().solved, true);
});

test('8. 完成判定是否严格：解格全填但多填一个空格，不判胜；撤掉该格才判胜', () => {
  const g = createGame({ seed: 9 });
  const s = g.state();
  const emptyIdx = s.solution.indexOf(0);
  const r = Math.floor(emptyIdx / s.size);
  const c = emptyIdx % s.size;

  // 先错填一个解外格，再把解里该填的都填上
  g.submit('p1', `toggle:${r},${c}`);
  fillSolution(g);
  assert.equal(g.state().cells[emptyIdx], 1);
  assert.equal(g.state().solved, false, '多填一格不算完成');
  assert.equal(g.state().mistakes, 1);
  assert.deepEqual(g.state().conflicts, [emptyIdx]);
  assert.equal(g.result(), null, '不判负也不判胜');

  g.submit('p1', `toggle:${r},${c}`);
  assert.equal(g.state().solved, true);
});

test('9. 错误不惩罚：错填只产生矛盾高亮，不结束对局、不改 solved', () => {
  const g = createGame({ seed: 11 });
  const s = g.state();
  const emptyIdx = s.solution.indexOf(0);
  const r = Math.floor(emptyIdx / s.size);
  const c = emptyIdx % s.size;

  const res = g.submit('p1', `toggle:${r},${c}`);
  assert.equal(res.ok, true, '错填不是非法动作');
  const after = g.state();
  assert.equal(after.mistakes, 1);
  assert.deepEqual(after.conflicts, [emptyIdx]);
  assert.equal(after.solved, false);
  assert.equal(g.result(), null);

  // 错标 X 在解为该填的格上，同样算矛盾
  const filledIdx = indexOfFirstFilled(s.solution);
  g.submit('p1', `mark:${Math.floor(filledIdx / s.size)},${filledIdx % s.size}`);
  const third = g.state();
  assert.equal(third.mistakes, 2);
  assert.ok(third.conflicts.includes(filledIdx));
  assert.ok(third.conflicts.includes(emptyIdx));
});

test('10. 提示：优先补解里该填未填的第一格，库存递减且可撤销', () => {
  const g = createGame({ seed: 13 });
  const before = g.state();
  const target = indexOfFirstFilled(before.solution);

  const res = g.submit('p1', 'hint');
  assert.equal(res.ok, true);
  assert.deepEqual(res.hint, { r: Math.floor(target / 10), c: target % 10, value: 1 });
  assert.equal(res.hintsLeft, HINTS_DEFAULT - 1);

  const after = g.state();
  assert.equal(after.cells[target], 1);
  assert.equal(after.hintsLeft, HINTS_DEFAULT - 1);
  assert.equal(after.mistakes, 0);

  // 撤销提示：格子与库存一起回退
  g.submit('p1', 'undo');
  const back = g.state();
  assert.equal(back.cells[target], 0);
  assert.equal(back.hintsLeft, HINTS_DEFAULT);
});

test('11. 提示用完：库存 0 后返回错误；解格填满只剩错填时提示改为清错填', () => {
  const g = createGame({ seed: 17 });
  for (let i = 0; i < HINTS_DEFAULT; i++) {
    assert.equal(g.submit('p1', 'hint').ok, true);
  }
  assert.equal(g.state().hintsLeft, 0);
  const exhausted = g.submit('p1', 'hint');
  assert.equal(exhausted.ok, false);
  assert.match(exhausted.error, /提示已用完/);

  // 另一局：解格全填、只多一个错填，此时提示应改为「清错填」
  const h = createGame({ seed: 18 });
  const hs = h.state();
  const targetIdx = [];
  for (let i = 0; i < hs.solution.length; i++) if (hs.solution[i] === 1) targetIdx.push(i);
  // 先填到倒数第二格，插入一个错填，再补最后一格：保证解格全满且盘面仍有矛盾
  for (const i of targetIdx.slice(0, -1)) h.submit('p1', `toggle:${Math.floor(i / hs.size)},${i % hs.size}`);
  const emptyIdx = hs.solution.indexOf(0);
  h.submit('p1', `toggle:${Math.floor(emptyIdx / hs.size)},${emptyIdx % hs.size}`);
  const last = targetIdx[targetIdx.length - 1];
  h.submit('p1', `toggle:${Math.floor(last / hs.size)},${last % hs.size}`);
  assert.equal(h.state().mistakes, 1);
  assert.equal(h.state().solved, false);

  const res = h.submit('p1', 'hint');
  assert.equal(res.ok, true);
  assert.deepEqual(res.hint, { r: Math.floor(emptyIdx / hs.size), c: emptyIdx % hs.size, value: 0 });
  assert.equal(h.state().cells[emptyIdx], 0);
  assert.equal(h.state().solved, true, '清掉唯一错填后即完成');
});

test('12. 撤销：单步回退、空栈报错、重置后栈清空', () => {
  const g = createGame({ seed: 19 });
  const empty = g.submit('p1', 'undo');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /没有可撤销/);

  const s = g.state();
  const i = indexOfFirstFilled(s.solution);
  g.submit('p1', `toggle:${Math.floor(i / s.size)},${i % s.size}`);
  assert.equal(g.state().canUndo, true);
  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.equal(g.state().cells[i], 0);
  assert.equal(g.state().canUndo, false);

  // 撤销栈最多 200 步，长时间连点不崩
  for (let k = 0; k < 260; k++) {
    g.submit('p1', `toggle:${Math.floor((k % 100) / 10)},${k % 10}`);
  }
  assert.ok(g.state().undoDepth <= 200);

  g.submit('p1', 'reset');
  assert.equal(g.state().undoDepth, 0);
  assert.equal(g.state().cells.every((v) => v === 0), true);
});

test('13. 非法坐标与非法动作被拒绝，且不改变盘面', () => {
  const g = createGame({ seed: 21 });
  const snapshot = JSON.stringify(g.state().cells);
  for (const bad of ['toggle:10,0', 'toggle:0,10', 'mark:10,10', 'toggle:-1,0', 'toggle:a,b', 'toggle:1', 'mark:', '', 'jump:1,1', 42, null, undefined]) {
    const res = g.submit('p1', bad);
    assert.equal(res.ok, false, `动作 ${String(bad)} 应被拒绝`);
  }
  assert.equal(JSON.stringify(g.state().cells), snapshot);
  assert.equal(g.state().canUndo, false);

  // 坐标允许 0 与 size-1
  assert.equal(g.submit('p1', 'toggle:0,0').ok, true);
  assert.equal(g.submit('p1', 'toggle:9,9').ok, true);
  // 非 p1 玩家被拒绝
  assert.equal(g.submit('p2', 'toggle:1,1').ok, false);
});

test('14. 状态序列化：JSON 往返等价，且外部改返回对象不影响内部', () => {
  const g = createGame({ seed: 23 });
  g.submit('p1', 'toggle:0,0');
  g.submit('p1', 'mark:1,1');
  g.submit('p1', 'hint');

  const s = g.state();
  const round = JSON.parse(JSON.stringify(s));
  assert.deepEqual(round, s);
  assert.equal(round.turn, 'p1');
  assert.equal(typeof round.solved, 'boolean');

  round.cells[0] = 99;
  round.solution[0] = 99;
  round.rowClues[0][0] = 99;
  const fresh = g.state();
  assert.notEqual(fresh.cells[0], 99);
  assert.notEqual(fresh.solution[0], 99);
  assert.notEqual(fresh.rowClues[0][0], 99);
  assert.notEqual(fresh, s, 'state() 每次返回新对象');
});

test('15. 同种子一致：generatePuzzle 与 createGame 都确定性，异种子不同图', () => {
  const a = generatePuzzle(1234, 10);
  const b = generatePuzzle(1234, 10);
  assert.deepEqual(a, b);

  const g1 = createGame({ seed: 1234 });
  const g2 = createGame({ seed: 1234 });
  assert.deepEqual(g1.state(), g2.state());
  assert.equal(g1.state().solved, false);
  assert.deepEqual(g1.result(), g2.result());

  const c = generatePuzzle(4321, 10);
  assert.notDeepEqual(a.solution, c.solution);
  assert.notDeepEqual(createGame({ seed: 1 }).state().solution, createGame({ seed: 2 }).state().solution);
});

test('16. 重置：清空盘面、库存回满、栈清空，但图案不变', () => {
  const g = createGame({ seed: 29 });
  const solution = g.state().solution.slice();
  g.submit('p1', 'toggle:0,0');
  g.submit('p1', 'toggle:0,1');
  g.submit('p1', 'hint');

  const res = g.submit('p1', 'reset');
  assert.equal(res.ok, true);
  const s = g.state();
  assert.ok(s.cells.every((v) => v === 0));
  assert.equal(s.hintsLeft, HINTS_DEFAULT);
  assert.equal(s.undoDepth, 0);
  assert.equal(s.solved, false);
  assert.equal(s.mistakes, 0);
  assert.equal(s.focus, null);
  assert.deepEqual(s.solution, solution);
  assert.equal(g.result(), null);
});

test('17. 纯逻辑源码约束：代码里不出现 DOM / Math.random / Date.now（注释不算）', () => {
  const raw = readFileSync(fileURLToPath(new URL('../logic.mjs', import.meta.url)), 'utf8');
  // 文档注释里会写「无 Math.random」这类字面，先剥掉块注释与行注释再看代码
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['document', 'window', 'Math.random', 'Date.now', 'requestAnimationFrame', 'localStorage']) {
    assert.equal(code.includes(banned), false, `logic.mjs 代码不应出现 ${banned}`);
  }
  assert.match(raw, /import \{ createRng \} from '\.\.\/\.\.\/shared\/rng\.js'/);
});
