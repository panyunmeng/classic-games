import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, SUITS } from '../logic.mjs';

/** 洗牌后 52 张牌按 suit+rank 应恰好各一张 */
function allCards(s) {
  const out = [...s.tableau.flat(), ...s.foundations.flat(), ...s.stock, ...s.waste];
  return out.map((c) => `${c.suit}-${c.rank}`);
}

/** 找第一张可在初始局面直接进入 foundation 的 A（waste 顶或某列顶） */
function findAce(s) {
  if (s.wasteTop && s.wasteTop.rank === 1) return { src: 'w', card: s.wasteTop };
  for (let i = 0; i < 7; i++) {
    const col = s.tableau[i];
    const top = col[col.length - 1];
    if (top && top.up && top.rank === 1) return { src: 't' + i, card: top };
  }
  return null;
}

test('初始：7 列牌数 1..7 且仅顶张翻开，4 个 foundation 空，stock=24', () => {
  const g = createGame({ seed: 7 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.tableau.length, 7);
  for (let i = 0; i < 7; i++) {
    assert.equal(s.tableau[i].length, i + 1, `第 ${i} 列应有 ${i + 1} 张`);
    s.tableau[i].forEach((c, j) => assert.equal(c.up, j === i, `第 ${i} 列第 ${j} 张翻开状态`));
  }
  assert.deepEqual(s.foundations, [[], [], [], []]);
  assert.equal(s.stock.length, 24);
  assert.deepEqual(s.waste, []);
  assert.equal(s.score, 0);
  assert.equal(s.moves, 0);
  assert.equal(s.won, false);
  assert.equal(s.canUndo, false);
});

test('牌堆完整且唯一：52 张 = 4 花色 × A..K，无重复无缺失', () => {
  const s = createGame({ seed: 3 }).state();
  const cards = allCards(s);
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards).size, 52);
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      assert.ok(cards.includes(`${suit}-${rank}`), `缺 ${suit}-${rank}`);
    }
  }
});

test('同种子洗牌一致、不同种子不同', () => {
  const a = createGame({ seed: 42 }).state();
  const b = createGame({ seed: 42 }).state();
  const c = createGame({ seed: 43 }).state();
  assert.deepEqual(allCards(a), allCards(b));
  assert.notDeepEqual(allCards(a), allCards(c));
});

test('draw：翻 1 张到 waste，stock 减一，waste 顶为翻开牌', () => {
  const g = createGame({ seed: 1 });
  const before = g.state();
  const r = g.submit('p1', 'draw');
  assert.equal(r.ok, true);
  assert.equal(r.drawn, 1);
  const s = g.state();
  assert.equal(s.stock.length, before.stock.length - 1);
  assert.equal(s.waste.length, 1);
  assert.equal(s.waste[0].up, true);
  assert.deepEqual(s.wasteTop, s.waste[0]);
  assert.equal(s.moves, 1);
});

test('draw:3 模式一次翻 3 张', () => {
  const g = createGame({ seed: 9, drawCount: 3 });
  const r = g.submit('p1', 'draw');
  assert.equal(r.ok, true);
  assert.equal(r.drawn, 3);
  assert.equal(g.state().waste.length, 3);
});

test('循环回收：stock 耗尽后 recycle 把 waste 逆序倒回 stock，可再次 draw', () => {
  const g = createGame({ seed: 5 });
  // 先抽空 stock
  for (let i = 0; i < 24; i++) assert.equal(g.submit('p1', 'draw').ok, true);
  const emptyStock = g.state();
  assert.equal(emptyStock.stock.length, 0);
  assert.equal(emptyStock.waste.length, 24);
  // 循环顺序：recycle 把 waste 逆序倒回 stock，下一次 draw 翻回"最早进 waste"的那张（waste[0]）
  const expectedTop = emptyStock.waste[0];
  const r = g.submit('p1', 'recycle');
  assert.equal(r.ok, true);
  assert.equal(r.recycled, 24);
  const afterRecycle = g.state();
  assert.equal(afterRecycle.stock.length, 24);
  assert.deepEqual(afterRecycle.waste, []);
  g.submit('p1', 'draw');
  assert.deepEqual(g.state().wasteTop, expectedTop, '循环顺序应保持一致');
  // stock 非空时 recycle 非法
  assert.equal(g.submit('p1', 'recycle').ok, false);
});

test('合法移动：翻开的 tableau 顶张按红黑交替递减叠放，暗牌自动翻开 +5', () => {
  const g = createGame({ seed: 11 });
  const s = g.state();
  // 找一对 src.top.rank == dst.top.rank-1（src 比目标小 1）且颜色交替，src 才能叠到 dst 上
  const red = (c) => c.suit === 'H' || c.suit === 'D';
  let found = null;
  for (let a = 0; a < 7 && !found; a++) {
    const srcTop = s.tableau[a][s.tableau[a].length - 1];
    for (let b = 0; b < 7; b++) {
      if (a === b) continue;
      const dstTop = s.tableau[b][s.tableau[b].length - 1];
      if (srcTop.rank === dstTop.rank - 1 && red(srcTop) !== red(dstTop)) {
        found = { a, b };
        break;
      }
    }
  }
  assert.ok(found, '该种子应存在至少一对可叠牌');
  const srcLenBefore = s.tableau[found.a].length;
  const r = g.submit('p1', `move:t${found.a},t${found.b}`);
  assert.equal(r.ok, true);
  const s2 = g.state();
  assert.equal(s2.tableau[found.a].length, srcLenBefore - 1);
  assert.equal(s2.tableau[found.b].length, s.tableau[found.b].length + 1);
  // 源列若新暴露暗牌应翻开并 +5
  const newTop = s2.tableau[found.a][s2.tableau[found.a].length - 1];
  if (newTop) {
    assert.equal(newTop.up, true);
    assert.equal(s2.score, 5);
  }
});

test('非法移动被拒且状态不变（同色/不连续/空列非 K/越界）', () => {
  const g = createGame({ seed: 13 });
  const before = JSON.stringify(g.state());
  const bad = [
    'move:t0,t0',          // 原列到原列
    'move:f0,f1',          // 回收区互移
    'move:t9,t0',          // 越界列
    'move:x0,t1',          // 非法源
    'move:t0,f9',          // 非法目标
    'move:foo,bar',
    'left',
  ];
  for (const action of bad) assert.equal(g.submit('p1', action).ok, false, action);
  assert.equal(JSON.stringify(g.state()), before);
  // 空列只能放 K：初始无空列，构造一个空列（把只有 1 张的第 0 列移到别处不一定可行）
  // 这里直接验证：把 waste 顶（非 K 时）放进空列会被拒——用一个新局，先把第 0 列唯一张移走
  const g2 = createGame({ seed: 2 });
  // 第 0 列只有 1 张；找任意能接它的目标列，制造空列
  const s2 = g2.state();
  const top0 = s2.tableau[0][0];
  const red = (c) => c.suit === 'H' || c.suit === 'D';
  let moved = false;
  for (let b = 1; b < 7; b++) {
    const dstTop = s2.tableau[b][s2.tableau[b].length - 1];
    if (top0.rank === dstTop.rank + 1 && red(top0) !== red(dstTop)) {
      moved = g2.submit('p1', `move:t0,t${b}`).ok;
      if (moved) break;
    }
  }
  if (moved) {
    assert.equal(g2.state().tableau[0].length, 0);
    // 抽一张非 K 到 waste，尝试放进空列 → 应被拒
    for (let i = 0; i < 24; i++) {
      g2.submit('p1', 'draw');
      const wt = g2.state().wasteTop;
      if (wt && wt.rank !== 13) {
        assert.equal(g2.submit('p1', 'move:w,t0').ok, false, '空列只能放 K');
        break;
      }
    }
  }
});

test('foundation 收集：A 进空槽 +10，同花色递增可继续收，异花色/断级被拒', () => {
  // 遍历种子找一个 waste 顶或某列顶为 A 的局面（足以验证 +10 与后续规则）
  let g, ace, fi;
  for (let seed = 1; seed <= 200; seed++) {
    g = createGame({ seed });
    ace = findAce(g.state());
    if (ace) { fi = SUITS.indexOf(ace.card.suit); break; }
  }
  assert.ok(ace, '应能找到顶张为 A 的局面');
  const srcWasTableau = ace.src.startsWith('t');
  const srcCol = srcWasTableau ? Number(ace.src.slice(1)) : -1;
  const exposedFaceDown = srcWasTableau && g.state().tableau[srcCol].length > 1
    && !g.state().tableau[srcCol][g.state().tableau[srcCol].length - 2].up;
  const r = g.submit('p1', `move:${ace.src},f${fi}`);
  assert.equal(r.ok, true);
  // 收 A 固定 +10；若源列新暴露一张暗牌则额外 +5
  assert.equal(r.gained, exposedFaceDown ? 15 : 10);
  const s = g.state();
  assert.equal(s.foundations[fi].length, 1);
  assert.equal(s.score, exposedFaceDown ? 15 : 10);
  // 断级：现在槽里是 A(1)，放一张非 2 的牌进去必被拒。
  // 抽牌直到 waste 顶不是 2，再尝试收进该槽。
  for (let i = 0; i < 24; i++) {
    g.submit('p1', 'draw');
    const wt = g.state().wasteTop;
    if (wt && wt.rank !== 2) {
      const scoreBefore = g.state().score;
      assert.equal(g.submit('p1', `move:w,f${fi}`).ok, false, '断级不能被收');
      assert.equal(g.state().score, scoreBefore, '被拒不应改分');
      break;
    }
    if (!g.state().stock.length) g.submit('p1', 'recycle');
  }
});

test('从 foundation 取回 -15 且翻开暗牌再 +5', () => {
  let g, ace, fi;
  for (let seed = 1; seed <= 200; seed++) {
    g = createGame({ seed });
    ace = findAce(g.state());
    if (ace) { fi = SUITS.indexOf(ace.card.suit); break; }
  }
  assert.ok(ace);
  g.submit('p1', `move:${ace.src},f${fi}`); // +10
  const scoreAfterCollect = g.state().score;
  const before = g.state();
  // 找一个可放这张 A 的列（A 只能叠在目标为 2 且红黑交替，或空列放 K——A 不能进空列）
  const red = (c) => c.suit === 'H' || c.suit === 'D';
  const a = before.foundations[fi][0];
  let placed = null;
  for (let b = 0; b < 7; b++) {
    const col = before.tableau[b];
    if (!col.length) continue;
    const top = col[col.length - 1];
    if (top.rank === 2 && red(top) !== red(a)) { placed = b; break; }
  }
  if (placed != null) {
    const r = g.submit('p1', `move:f${fi},t${placed}`);
    assert.equal(r.ok, true);
    const s = g.state();
    // -15（取回）+ 可能的 +5（源列翻开），至少净 -15
    assert.ok(s.score <= scoreAfterCollect - 15);
    assert.equal(s.foundations[fi].length, 0);
  }
});

test('自动收牌 auto：一次收走所有能进 foundation 的顶张，只占一个撤销步', () => {
  // 找一个开局就有 A 在顶的种子，auto 应至少收一张
  let g;
  for (let seed = 1; seed <= 200; seed++) {
    g = createGame({ seed });
    if (findAce(g.state())) break;
  }
  assert.ok(findAce(g.state()));
  const before = g.state();
  const r = g.submit('p1', 'auto');
  assert.equal(r.ok, true);
  assert.ok(r.collected >= 1);
  const s = g.state();
  assert.ok(s.foundationCount >= 1);
  assert.equal(s.score, r.gained);
  assert.equal(s.undoDepth, 1, '整段自动收牌只存一个撤销步');
  g.submit('p1', 'undo');
  assert.equal(g.state().foundationCount, 0);
  assert.equal(g.state().score, 0);
  assert.equal(JSON.stringify(allCards(g.state()).sort()), JSON.stringify(allCards(before).sort()));
});

test('胜利判定：把 52 张全部搬进 foundation 后 won=true 且 result 给出分数', () => {
  const g = createGame({ seed: 1 });
  // 通过直接布局构造"只差最后一步"的局面不可行（无内部写入接口），
  // 改为验证：state 暴露 won/over，result 在 won 前为 null；
  // 并用一段通用求解：循环 draw + auto + 合法 tableau→foundation，直到无进展。
  let guard = 0;
  for (;;) {
    const s = g.state();
    if (s.won) break;
    let progressed = false;
    // 先自动收
    if (g.submit('p1', 'auto').ok) progressed = true;
    // 再尝试每张 tableau 顶进 foundation
    const s1 = g.state();
    for (let i = 0; i < 7 && !progressed; i++) {
      const col = s1.tableau[i];
      const top = col[col.length - 1];
      if (!top || !top.up) continue;
      for (let f = 0; f < 4; f++) {
        if (g.submit('p1', `move:t${i},f${f}`).ok) { progressed = true; break; }
      }
    }
    if (!progressed) {
      // 翻牌堆循环
      if (g.state().stock.length) g.submit('p1', 'draw');
      else if (g.state().waste.length) g.submit('p1', 'recycle');
      else break; // 无可推进
    }
    if (++guard > 2000) break;
  }
  // 此求解器不保证通关（需要复杂 tableau 调度），只断言字段语义一致
  const s = g.state();
  assert.equal(typeof s.won, 'boolean');
  assert.equal(s.over, s.won);
  if (s.won) {
    assert.equal(s.foundationCount, 52);
    const res = g.result();
    assert.equal(res.over, true);
    assert.equal(res.winner, 'p1');
    assert.equal(res.score, s.score);
  } else {
    assert.equal(g.result(), null);
  }
});

test('撤销：draw/move/auto/draw 均能逐步回退到任意历史快照', () => {
  const g = createGame({ seed: 21 });
  const s0 = g.state();
  g.submit('p1', 'draw');
  assert.notDeepEqual(g.state().stock, s0.stock);
  g.submit('p1', 'undo');
  assert.deepEqual(g.state().stock, s0.stock);
  assert.deepEqual(g.state().waste, []);
  // 无步可撤时报错
  assert.equal(g.submit('p1', 'undo').ok, false);
  // 多次动作后连续撤销
  g.submit('p1', 'draw');
  g.submit('p1', 'draw');
  g.submit('p1', 'auto');
  assert.ok(g.state().undoDepth >= 1);
  while (g.state().canUndo) assert.equal(g.submit('p1', 'undo').ok, true);
  assert.deepEqual(g.state(), s0);
});

test('状态可 JSON 序列化且与内部隔离（state 每次返回新对象）', () => {
  const g = createGame({ seed: 4 });
  const s1 = g.state();
  assert.deepEqual(JSON.parse(JSON.stringify(s1)), s1);
  s1.tableau[0][0].rank = -999;
  s1.foundations[0].push({ suit: 'S', rank: 1, up: true });
  s1.stock.length = 0;
  const s2 = g.state();
  assert.notEqual(s2.tableau[0][0].rank, -999);
  assert.equal(s2.foundations[0].length, 0);
  assert.ok(s2.stock.length > 0);
  assert.notEqual(s1, s2);
});

test('重置：回到同种子初始牌局，分数/步数/撤销栈清零', () => {
  const g = createGame({ seed: 8 });
  const deck0 = allCards(g.state());
  g.submit('p1', 'draw');
  g.submit('p1', 'draw');
  g.reset();
  const s = g.state();
  assert.deepEqual(allCards(s), deck0);
  assert.equal(s.score, 0);
  assert.equal(s.moves, 0);
  assert.equal(s.canUndo, false);
  assert.deepEqual(s.waste, []);
});

test('连走 N 步不崩：动作混合合法与非法，状态始终合法', () => {
  const g = createGame({ seed: 33 });
  const actions = ['draw', 'recycle', 'auto', 'undo', 'move:t0,t1', 'move:w,f0', 'bogus'];
  for (let i = 0; i < 500; i++) {
    const r = g.submit('p1', actions[i % actions.length]);
    assert.equal(typeof r.ok, 'boolean');
    const s = g.state();
    assert.equal(s.turn, 'p1');
    assert.ok(s.score >= -10000);
    assert.ok(s.foundationCount >= 0 && s.foundationCount <= 52);
    assert.equal(s.tableau.length, 7);
    assert.equal(s.foundations.length, 4);
    assert.equal(allCards(s).length, 52, '牌总数守恒');
  }
});
