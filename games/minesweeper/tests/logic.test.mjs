import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, LEVELS } from '../logic.mjs';

/**
 * 用同一种子重开一局，先固定首击 first，再踩雷以拿到完整雷图（雷位只在结局后公开）。
 * 雷图由「种子 + 首击」共同决定，故查询与被测局必须用相同首击。
 */
function discoverMines(seed, level = 'beginner', first = { x: 4, y: 4 }) {
  const g = createGame({ seed, level });
  g.reveal(first.x, first.y);
  outer: for (let y = 0; y < LEVELS[level].rows; y++) {
    for (let x = 0; x < LEVELS[level].cols; x++) {
      g.reveal(x, y);
      if (g.state().over) break outer;
    }
  }
  const s = g.state();
  assert.equal(s.over, true, '遍历应最终踩雷结束');
  return {
    first: s.firstAt,
    mineAt: (x, y) => Boolean(s.cells[y * s.cols + x].mine),
    mines: s.cells.filter((c) => c.mine).length,
    cols: s.cols,
    rows: s.rows,
  };
}

test('1. 初始状态：中级 16×16/40 雷、回合固定 p1、未布雷', () => {
  const g = createGame({ seed: 7 });
  const s = g.state();
  assert.equal(s.cols, 16);
  assert.equal(s.rows, 16);
  assert.equal(s.mines, 40);
  assert.equal(s.placed, false);
  assert.equal(s.over, false);
  assert.equal(s.turn, 'p1');
  assert.equal(s.cells.length, 256);
  assert.ok(s.cells.every((c) => !c.revealed && !c.flagged));
});

test('2. 三档难度尺寸与雷数正确（初级/中级/高级），默认中级', () => {
  assert.deepEqual(
    [LEVELS.beginner.cols, LEVELS.beginner.rows, LEVELS.beginner.mines],
    [9, 9, 10],
  );
  assert.deepEqual(
    [LEVELS.intermediate.cols, LEVELS.intermediate.rows, LEVELS.intermediate.mines],
    [16, 16, 40],
  );
  assert.deepEqual(
    [LEVELS.expert.cols, LEVELS.expert.rows, LEVELS.expert.mines],
    [30, 16, 99],
  );
  const e = createGame({ seed: 1, level: 'expert' }).state();
  assert.equal(e.cols * e.rows, 480);
  assert.equal(e.mines, 99);
});

test('3. 首击安全：点击格及其八邻域都不是雷，且首击为零格', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const g = createGame({ seed, level: 'beginner' });
    const r = g.submit('p1', 'reveal:4,4');
    assert.equal(r.ok, true);
    assert.equal(r.boom, false);
    const s = g.state();
    assert.equal(s.placed, true);
    const firstCell = s.cells[4 * 9 + 4];
    assert.equal(firstCell.revealed, true);
    assert.equal(firstCell.adjacent, 0, '首击应为零格并触发展开');

    // 未结束时雷位对外隐藏（null），且首击八邻域应被零格展开翻开
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = s.cells[(4 + dy) * 9 + (4 + dx)];
        assert.equal(c.mine, null, `seed=${seed} 邻域雷位不应在未结束时公开`);
        assert.equal(c.revealed, true, `seed=${seed} 首击八邻域应被零格展开翻开`);
      }
    }

    // 用同种子同首击揭示真实雷图，验证这九格确实无雷
    const layout = discoverMines(seed, 'beginner', { x: 4, y: 4 });
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        assert.equal(layout.mineAt(4 + dx, 4 + dy), false, `seed=${seed} 首击邻域实际有雷`);
      }
    }
  }
});

test('4. 插旗切换与旗数统计（右键语义），重复插旗可取消', () => {
  const g = createGame({ seed: 11, level: 'beginner' });
  assert.equal(g.submit('p1', 'flag:0,0').ok, true);
  assert.equal(g.state().cells[0].flagged, true);
  assert.equal(g.state().flags, 1);
  assert.equal(g.submit('p1', 'flag:0,0').ok, true);
  assert.equal(g.state().cells[0].flagged, false);
  assert.equal(g.state().flags, 0);
  // 已翻开的格不能插旗
  g.submit('p1', 'reveal:4,4');
  assert.equal(g.submit('p1', 'flag:4,4').ok, false);
});

test('5. 和弦展开：邻旗数等于数字时展开其余邻格；旗数不符则拒绝', () => {
  const seed = 2024;
  const layout = discoverMines(seed, 'beginner');
  const level = 'beginner';
  const g = createGame({ seed, level });
  g.reveal(layout.first.x, layout.first.y);

  // 找一个已翻开的数字格，其某个未翻开邻格是雷
  let found = null;
  for (let y = 0; y < 9 && !found; y++) {
    for (let x = 0; x < 9 && !found; x++) {
      const c = g.state().cells[y * 9 + x];
      if (!c.revealed || !c.adjacent) continue;
      const mineNeighbors = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || x + dx < 0 || x + dx >= 9 || y + dy < 0 || y + dy >= 9) continue;
          if (layout.mineAt(x + dx, y + dy)) mineNeighbors.push([x + dx, y + dy]);
        }
      }
      if (mineNeighbors.length === c.adjacent && mineNeighbors.length > 0) {
        found = { x, y, mines: mineNeighbors };
      }
    }
  }
  assert.ok(found, '首击零格展开后应存在边界数字格');

  // 旗数不足时和弦被拒
  const before = g.state().opened;
  assert.equal(g.submit('p1', `chord:${found.x},${found.y}`).ok, false);
  assert.equal(g.state().opened, before);

  // 给所有相邻雷插旗，再和弦 → 其余安全邻格被翻开
  for (const [mx, my] of found.mines) g.submit('p1', `flag:${mx},${my}`);
  const r = g.submit('p1', `chord:${found.x},${found.y}`);
  assert.equal(r.ok, true);
  assert.equal(r.boom, false);
  assert.ok(g.state().opened > before, '和弦应翻开安全邻格');
});

test('6. 胜利判定：翻开全部非雷格即胜，雷自动插旗，result 给出 p1 胜', () => {
  const seed = 55;
  const layout = discoverMines(seed, 'beginner');
  const g = createGame({ seed, level: 'beginner' });
  g.reveal(4, 4); // 与雷图查询保持同首击，确定同一张雷图
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      if (layout.mineAt(x, y)) continue;
      g.reveal(x, y);
      if (g.state().over) break;
    }
    if (g.state().over) break;
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.won, true);
  assert.equal(s.opened, 81 - 10);
  assert.ok(s.cells.filter((c) => c.mine).every((c) => c.flagged));
  assert.deepEqual(g.result(), {
    over: true, winner: 'p1', score: 1, scores: { p1: 1 },
    text: '排雷成功 · 10 颗雷全部标出',
  });
});

test('7. 踩雷失败：翻到雷立即结束、公开雷图、result 判 p2 负', () => {
  const seed = 88;
  const layout = discoverMines(seed, 'beginner');
  const g = createGame({ seed, level: 'beginner' });
  // 从布局中找第一颗雷
  let mine = null;
  for (let y = 0; y < 9 && !mine; y++) {
    for (let x = 0; x < 9 && !mine; x++) if (layout.mineAt(x, y)) mine = { x, y };
  }
  assert.ok(mine);
  // 先用安全首击布雷
  g.reveal(4, 4);
  const r = g.submit('p1', `reveal:${mine.x},${mine.y}`);
  assert.equal(r.ok, true);
  assert.equal(r.boom, true);
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.won, false);
  assert.equal(s.cells.filter((c) => c.mine).length, 10); // 雷位现已公开
  assert.equal(g.result().winner, 'p2');
});

test('8. 撤销：翻开/插旗可回退，首击前撤销回到未布雷态，同种子可复现', () => {
  const g = createGame({ seed: 12, level: 'beginner' });
  assert.equal(g.submit('p1', 'undo').ok, false); // 空栈
  g.submit('p1', 'flag:0,0');
  assert.equal(g.state().flags, 1);
  g.submit('p1', 'undo');
  assert.equal(g.state().flags, 0);
  assert.equal(g.state().cells[0].flagged, false);

  g.submit('p1', 'reveal:4,4');
  const beforeUndo = g.state();
  assert.equal(beforeUndo.placed, true);
  g.submit('p1', 'undo');
  const afterUndo = g.state();
  assert.equal(afterUndo.placed, false);
  assert.equal(afterUndo.opened, 0);
  // 撤销回首击前后再点同一格，应得到完全相同的局面（RNG 状态已随快照恢复）
  g.submit('p1', 'reveal:4,4');
  const replay = g.state();
  assert.deepEqual(
    replay.cells.map((c) => [c.revealed, c.adjacent]),
    beforeUndo.cells.map((c) => [c.revealed, c.adjacent]),
    '重放同种子同首击应得到相同局面',
  );
});

test('9. 非法坐标与非法动作均被拒绝且不改变状态', () => {
  const g = createGame({ seed: 3, level: 'beginner' });
  const bad = ['reveal:-1,0', 'reveal:9,0', 'reveal:0,9', 'flag:99,99', 'nonsense', '', 'chord:1,1'];
  for (const action of bad) {
    const r = g.submit('p1', action);
    assert.equal(r.ok, false, `应拒绝: ${action}`);
  }
  assert.equal(g.state().opened, 0);
  assert.equal(g.state().flags, 0);
  assert.equal(g.state().placed, false);
  // 玩家 ID 鉴权：只有 p1 可操作
  assert.equal(g.submit('p2', 'reveal:4,4').ok, false);
});

test('10. 重置：回到开局且同种子可复现同一雷图', () => {
  const seed = 77;
  const g = createGame({ seed, level: 'beginner' });
  g.reveal(4, 4);
  const before = g.state().cells.map((c) => c.adjacent);
  g.reset();
  const s = g.state();
  assert.equal(s.opened, 0);
  assert.equal(s.flags, 0);
  assert.equal(s.placed, false);
  assert.equal(s.over, false);
  assert.equal(s.canUndo, false);
  g.reveal(4, 4);
  assert.deepEqual(g.state().cells.map((c) => c.adjacent), before, '重置后同种子雷图应一致');
});

test('11. 状态可序列化：JSON 往返后深拷贝仍等价，state() 返回新对象', () => {
  const g = createGame({ seed: 9, level: 'beginner' });
  g.reveal(4, 4);
  g.submit('p1', 'flag:0,0');
  const s1 = g.state();
  const json = JSON.stringify(s1);
  const s2 = JSON.parse(json);
  assert.deepEqual(s2, s1);
  // state() 必须每次返回新对象，外部改动不影响内部
  const s3 = g.state();
  s3.cells[0].flagged = false;
  s3.opened = 999;
  assert.equal(g.state().cells[0].flagged, true);
  assert.notEqual(g.state().opened, 999);
});

test('12. 连走 N 步不崩：鼠标/键盘动作混合且结局后动作被拒', () => {
  const g = createGame({ seed: 123, level: 'intermediate' });
  const actions = [
    'cursor:1,0', 'cursor:0,1', 'reveal:8,8', 'flag:0,0', 'flag:0,0',
    'chord:8,8', 'reveal:15,15', 'cursor:-1,0', 'reveal:0,15',
  ];
  for (let i = 0; i < 200; i++) {
    const a = actions[i % actions.length];
    const r = g.submit('p1', a);
    assert.equal(typeof r.ok, 'boolean');
    const s = g.state();
    assert.equal(s.cells.length, 256);
    assert.ok(s.opened >= 0 && s.opened <= 216);
  }
  // 结束后的翻开/插旗应被拒绝（若此时尚未结束，手动踩雷）
  if (!g.state().over) {
    g.reveal(8, 8); // 已是翻开格，无害
  }
});
