import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  fullDeckTokens,
  SUITS,
  DEAL_COUNTS,
  TOTAL_CARDS,
  CARD_SCORE,
  FOUNDATION_TAKEBACK,
} from '../logic.mjs';

const ALL_TOKENS = fullDeckTokens();

/**
 * 摆一个测试局面：
 * - columns: { 列号: ['S10', 'HA', ...] }，只写需要控制的列；未写的列保持空；
 * - freeCells / foundations 同理；
 * - 其余 52 张牌按固定顺序补进"已指定列"的**底部**，保证这些列的顶牌与顺序不变。
 */
function makeSetup({ columns = {}, freeCells = [], foundations = [] } = {}) {
  const used = new Set();
  const take = (tok) => {
    if (used.has(tok)) throw new Error(`测试局面重复牌 ${tok}`);
    used.add(tok);
    return tok;
  };
  const tableau = Array.from({ length: 8 }, (_, i) => (columns[i] || []).map(take));
  const fc = Array.from({ length: 4 }, (_, i) => (freeCells[i] == null ? null : take(freeCells[i])));
  const fnd = Array.from({ length: 4 }, (_, i) => (foundations[i] || []).map(take));
  const hosts = tableau.map((col, i) => i).filter((i) => tableau[i].length > 0);
  const leftover = ALL_TOKENS.filter((tok) => !used.has(tok));
  if (leftover.length && hosts.length === 0) throw new Error('测试局面没有可放剩余牌的列');
  leftover.forEach((tok, k) => {
    tableau[hosts[k % hosts.length]].unshift(tok); // 补在底部，不动顶牌
  });
  return { tableau, freeCells: fc, foundations: fnd };
}

function cardsOf(s) {
  return [...s.tableau.flat(), ...s.freeCells.filter(Boolean), ...s.foundations.flat()].map(
    (c) => `${c.suit}${c.rank}`,
  );
}

function foundationTokens(suit, from = 1, to = 13) {
  const out = [];
  for (let rank = from; rank <= to; rank++) {
    out.push(suit + ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank] || String(rank)));
  }
  return out;
}

test('初始：8 列按 7/7/7/7/6/6/6/6 发满 52 张且全部翻开，自由格与基础堆为空', () => {
  const g = createGame({ seed: 7 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.tableau.length, 8);
  assert.deepEqual(s.tableau.map((col) => col.length), DEAL_COUNTS);
  assert.equal(s.tableau.flat().length, TOTAL_CARDS);
  for (const col of s.tableau) for (const c of col) assert.equal(c.up, true, '空当接龙没有暗牌');
  assert.deepEqual(s.freeCells, [null, null, null, null]);
  assert.deepEqual(s.foundations, [[], [], [], []]);
  assert.equal(s.freeCellEmpty, 4);
  assert.equal(s.score, 0);
  assert.equal(s.moves, 0);
  assert.equal(s.won, false);
  assert.equal(s.canUndo, false);
});

test('牌完整唯一、同种子同一副牌、不同种子不同', () => {
  const a = createGame({ seed: 42 }).state();
  const b = createGame({ seed: 42 }).state();
  const c = createGame({ seed: 43 }).state();
  const cards = cardsOf(a);
  assert.equal(cards.length, TOTAL_CARDS);
  assert.equal(new Set(cards).size, TOTAL_CARDS);
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) assert.ok(cards.includes(`${suit}${rank}`), `缺 ${suit}${rank}`);
  }
  assert.deepEqual(cardsOf(a), cardsOf(b));
  assert.notDeepEqual(cardsOf(a), cardsOf(c));
});

test('自由格进出：每格 1 张、占用/互移被拒、可取回列，撤销可复原', () => {
  const g = createGame({ seed: 1, setup: makeSetup({ columns: { 0: ['S5'], 1: ['H6'] } }) });
  const s0 = g.state();
  assert.deepEqual(s0.freeCells, [null, null, null, null]);

  assert.equal(g.submit('p1', 'move:t0,f0').ok, true);
  let s = g.state();
  assert.equal(s.freeCells[0].suit, 'S');
  assert.equal(s.freeCells[0].rank, 5);
  assert.equal(s.freeCells[1], null);
  assert.equal(cardsOf(s).length, TOTAL_CARDS);

  assert.equal(g.submit('p1', 'move:t1,f0').ok, false, '自由格已占用');
  assert.equal(g.submit('p1', 'move:t1,f1').ok, true);
  assert.equal(g.submit('p1', 'move:f0,f1').ok, false, '自由格之间不能互移');
  assert.equal(g.submit('p1', 'move:f2,t7').ok, false, '空自由格不能当源');

  assert.equal(g.submit('p1', 'move:f0,t2').ok, true, '自由格的牌可以回列（空列放任意牌）');
  s = g.state();
  assert.equal(s.freeCells[0], null);
  assert.deepEqual(s.tableau[2].map((c) => `${c.suit}${c.rank}`), ['S5']);

  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.equal(g.state().freeCells[0].rank, 5, '撤销回到自由格里');
  assert.equal(g.state().tableau[2].length, 0);
});

test('基础堆：空堆只收 A、同花色递增收牌、异花色/断级被拒，取回扣分', () => {
  const g = createGame({
    seed: 1,
    setup: makeSetup({ columns: { 0: ['SA'], 1: ['S2'], 2: ['SK'], 3: ['H2'] } }),
  });
  assert.equal(g.submit('p1', 'move:t2,d0').ok, false, '空基础堆不收 K');
  assert.equal(g.submit('p1', 'move:t0,d0').ok, true);
  assert.equal(g.state().foundations[0].length, 1);
  assert.equal(g.state().score, CARD_SCORE);
  assert.equal(g.submit('p1', 'move:t3,d0').ok, false, '异花色不能进同一堆');
  assert.equal(g.submit('p1', 'move:t1,d0').ok, true);
  assert.equal(g.state().foundations[0].length, 2);
  assert.equal(g.state().score, CARD_SCORE * 2);

  assert.equal(g.submit('p1', 'move:d0,t6').ok, true, '可从基础堆取回');
  assert.equal(g.state().foundations[0].length, 1);
  assert.equal(g.state().score, CARD_SCORE * 2 - FOUNDATION_TAKEBACK);
  assert.equal(g.state().tableau[6][0].rank, 2);
  assert.equal(g.submit('p1', 'move:d0,t6').ok, false, 'A 不能压到 2 上');
  assert.equal(g.state().moves, 3, '被拒的动作不计步');
  assert.equal(g.state().foundationCount, 1);
});

test('红黑交替递减：合法整组搬迁，同色/断级/非序列被拒', () => {
  const g = createGame({
    seed: 1,
    setup: makeSetup({
      columns: {
        0: ['S10', 'H9', 'S8'],
        1: ['HJ'],
        3: ['S9'],
        4: ['C10'],
        5: ['H5'],
        6: ['C9', 'D8', 'D7'],
      },
    }),
  });
  assert.equal(g.submit('p1', 'move:t3,t4').ok, false, '同色不能叠');
  assert.equal(g.submit('p1', 'move:t5,t4').ok, false, '点数不相邻不能叠');
  const brokenIdx = g.state().tableau[6].findIndex((c) => c.suit === 'C' && c.rank === 9);
  const brokenRun = g.submit('p1', `move:t6:${brokenIdx},t1`);
  assert.equal(brokenRun.ok, false, '同色断开的牌组不能整组搬');
  assert.match(brokenRun.error, /红黑交替/);

  const r = g.submit('p1', 'move:t0,t1');
  assert.equal(r.ok, true);
  assert.equal(r.moved, 3);
  const dst = g.state().tableau[1].slice(-3).map((c) => `${c.suit}${c.rank}`);
  assert.deepEqual(dst, ['S10', 'H9', 'S8'], '整组按原顺序落到目标顶');
  assert.equal(g.state().tableau[0].length > 0, true, '底部补的牌仍在');
  assert.ok(g.state().tableau[0].every((c) => !(c.suit === 'S' && c.rank === 10)));
});

test('空列规则：任意牌可进空列，合法序列也能整组进空列', () => {
  const g1 = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: ['H5'], 1: ['H9', 'S8'], 2: ['S3'], 3: ['H4'], 4: ['S5'], 5: ['H6'], 6: ['S7'] },
    }),
  });
  assert.equal(g1.state().tableau[7].length, 0);
  assert.equal(g1.submit('p1', 'move:t0,t7').ok, true, '空列不要求 K');
  assert.deepEqual(
    g1.state().tableau[7].map((c) => `${c.suit}${c.rank}`),
    ['H5'],
  );

  const g2 = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: ['H5'], 1: ['H9', 'S8'], 2: ['S3'], 3: ['H4'], 4: ['S5'], 5: ['H6'], 6: ['S7'] },
    }),
  });
  assert.equal(g2.submit('p1', 'move:t1,t7').ok, true, '2 张合法序列进空列（空列够用时）');
  assert.deepEqual(
    g2.state().tableau[7].map((c) => `${c.suit}${c.rank}`),
    ['H9', 'S8'],
  );
});

test('可搬张数 = (空自由格 + 1) × 2^可用空列：0 空 / 1+1 / 目标空列排除', () => {
  const run4 = ['SQ', 'HJ', 'S10', 'H9'];
  const run5 = ['SQ', 'HJ', 'S10', 'H9', 'S8'];
  const run6 = ['SQ', 'HJ', 'S10', 'H9', 'S8', 'H7'];
  const fillers = { 2: ['H2'], 3: ['S3'], 4: ['H4'], 5: ['S5'], 6: ['H6'] };

  // 0 空自由格 + 0 空列 → 只能搬 1 张
  const gA = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: run6, 1: ['HK'], ...fillers, 7: ['S7'] },
      freeCells: ['C2', 'D2', 'C3', 'D3'],
    }),
  });
  assert.equal(gA.state().maxMovable, 1);
  const rA = gA.submit('p1', 'move:t0,t1');
  assert.equal(rA.ok, false);
  assert.match(rA.error, /最多只能整体搬 1 张/);
  assert.equal(gA.state().moves, 0, '被拒的移动不留痕');
  assert.equal(gA.submit('p1', 'move:t2,t3').ok, true, '单张永远可搬');

  // 1 个空自由格 + 1 个空列 → 上限 4
  const gB = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: run4, 1: ['HK'], ...fillers, 6: ['H6'] },
      freeCells: ['C2', 'D2', 'C3', null],
    }),
  });
  assert.equal(gB.state().maxMovable, 4);
  const rB = gB.submit('p1', 'move:t0,t1');
  assert.equal(rB.ok, true, '4 张正好等于上限');
  assert.equal(rB.moved, 4);

  // 同样是上限 4：5 张被拒
  const gB2 = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: run5, 1: ['HK'], ...fillers, 6: ['H6'] },
      freeCells: ['C2', 'D2', 'C3', null],
    }),
  });
  const rB2 = gB2.submit('p1', 'move:t0,t1');
  assert.equal(rB2.ok, false);
  assert.match(rB2.error, /最多只能整体搬 4 张/);

  // 目标本身就是空列时，它不能当周转位：0 空自由格 → 只能搬 1 张
  const gC = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: ['H9', 'S8'], 1: ['S3'], 2: ['H4'], 3: ['S5'], 4: ['H6'], 5: ['S7'], 6: ['H8'] },
      freeCells: ['C2', 'D2', 'C3', 'D3'],
    }),
  });
  assert.equal(gC.state().maxMovable, 2, 'state.maxMovable 未扣目标空列');
  assert.equal(gC.submit('p1', 'move:t0,t7').ok, false, '目标空列要扣掉');
  const topIdx = gC.state().tableau[0].length - 1; // H9、S8 是底部补牌之上的顶段
  assert.equal(gC.submit('p1', `move:t0:${topIdx},t7`).ok, true, '只搬顶张则允许');
});

test('自动收 auto：一次收完所有可收顶牌，整段只占一个撤销步', () => {
  const setup = makeSetup({
    columns: { 0: ['SA'], 1: ['S2'], 2: ['CA'] },
    freeCells: ['HA', null, null, null],
  });
  const g = createGame({ seed: 1, setup });
  const before = g.state();
  const r = g.submit('p1', 'auto');
  assert.equal(r.ok, true);
  assert.ok(r.collected >= 4, 'S A/S 2/C A/H A 至少 4 张');
  const s = g.state();
  assert.equal(s.foundationCount, r.collected);
  assert.equal(s.score, r.gained);
  assert.equal(s.score, r.collected * CARD_SCORE);
  assert.equal(s.undoDepth, 1, '整段自动收只压一个快照');

  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.deepEqual(g.state(), before, '撤销回到自动收之前');

  // 没有可收的牌时不产生撤销步
  const g2 = createGame({ seed: 1, setup: makeSetup({ columns: { 0: ['H5'] } }) });
  assert.equal(g2.submit('p1', 'auto').ok, false);
  assert.equal(g2.state().undoDepth, 0);
});

test('胜利判定：最后一张 K 进基础堆后 won=true，result 给出成绩', () => {
  const g = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: ['CK'] },
      foundations: [
        foundationTokens('S'),
        foundationTokens('H'),
        foundationTokens('D'),
        foundationTokens('C', 1, 12),
      ],
    }),
  });
  assert.equal(g.state().foundationCount, 51);
  assert.equal(g.state().won, false);
  assert.equal(g.result(), null);
  const r = g.submit('p1', 'move:t0,d3');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.won, true);
  assert.equal(s.over, true);
  assert.equal(s.foundationCount, TOTAL_CARDS);
  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.equal(res.score, s.score);
  assert.equal(g.submit('p1', 'auto').ok, false, '通关后不再收牌');
});

test('撤销：多步逐步回退，无步可撤时报错', () => {
  const g = createGame({ seed: 1, setup: makeSetup({ columns: { 0: ['S5'], 1: ['H6'], 2: ['S7'] } }) });
  const s0 = g.state();
  assert.equal(g.submit('p1', 'undo').ok, false);
  assert.equal(g.submit('p1', 'move:t0,f0').ok, true);
  const s1 = g.state();
  assert.equal(g.submit('p1', 'move:f0,t3').ok, true);
  const s2 = g.state();
  assert.equal(g.submit('p1', 'move:t1,t4').ok, true);

  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.deepEqual(g.state(), s2);
  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.deepEqual(g.state(), s1);
  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.deepEqual(g.state(), s0);
  assert.equal(g.submit('p1', 'undo').ok, false);
  assert.equal(g.state().moves, 0);
});

test('非法动作被拒且状态不变', () => {
  const g = createGame({ seed: 5 });
  const before = JSON.stringify(g.state());
  const bad = [
    'move:t0,t0',
    'move:f0,f1',
    'move:d0,d1',
    'move:t9,t0',
    'move:t0,f9',
    'move:x0,t1',
    'move:foo,bar',
    'move:t0',
    'jump',
  ];
  for (const action of bad) assert.equal(g.submit('p1', action).ok, false, action);
  assert.equal(g.submit('p1', 123).ok, false, '非字符串动作');
  assert.equal(JSON.stringify(g.state()), before);
});

test('状态可 JSON 序列化、每次返回新对象且与内部隔离', () => {
  const g = createGame({ seed: 4 });
  const s1 = g.state();
  assert.deepEqual(JSON.parse(JSON.stringify(s1)), s1);
  s1.tableau[0][0].rank = -999;
  s1.freeCells[0] = { suit: 'S', rank: 1, up: true };
  s1.foundations[0].push({ suit: 'S', rank: 1, up: true });
  s1.tableau[1].length = 0;
  const s2 = g.state();
  assert.notEqual(s2.tableau[0][0].rank, -999);
  assert.equal(s2.freeCells[0], null);
  assert.equal(s2.foundations[0].length, 0);
  assert.equal(s2.tableau[1].length, DEAL_COUNTS[1]);
  assert.notEqual(s1, s2);
});

test('重置：回到同种子的初始牌局，分数/步数/撤销栈清零', () => {
  const g = createGame({ seed: 8 });
  const initial = g.state();
  g.submit('p1', 'move:t0,f0');
  g.submit('p1', 'move:t1,f1');
  g.reset();
  const s = g.state();
  assert.deepEqual(s, initial);
  assert.equal(s.canUndo, false);
  assert.equal(s.score, 0);
  assert.equal(s.moves, 0);
});

test('连走 300 步（合法/非法混合）不崩，52 张牌始终守恒', () => {
  const g = createGame({ seed: 33 });
  const actions = [
    'move:t0,t1',
    'move:t0,f0',
    'move:f0,t0',
    'auto',
    'undo',
    'move:t7,t6',
    'move:t0,t0',
    'bogus',
  ];
  for (let i = 0; i < 300; i++) {
    const r = g.submit('p1', actions[i % actions.length]);
    assert.equal(typeof r.ok, 'boolean');
    const s = g.state();
    assert.equal(s.turn, 'p1');
    assert.equal(cardsOf(s).length, TOTAL_CARDS, '牌总数守恒');
    assert.equal(new Set(cardsOf(s)).size, TOTAL_CARDS, '没有重复牌');
    assert.ok(s.foundationCount >= 0 && s.foundationCount <= TOTAL_CARDS);
    assert.equal(s.tableau.length, 8);
    assert.equal(s.freeCells.length, 4);
    assert.equal(s.foundations.length, 4);
  }
});
