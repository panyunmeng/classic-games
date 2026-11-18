import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  COLUMNS,
  TOTAL_CARDS,
  SUITS,
  SET_SIZE,
  isMovableRun,
  findCompleteSet,
} from '../logic.mjs';

/** 标准双花色 104 张：♠/♥ 各 4 份 × A..K */
function baseDeck() {
  const out = [];
  for (const suit of SUITS) {
    for (let copy = 0; copy < 4; copy++) {
      for (let rank = 1; rank <= SET_SIZE; rank++) out.push({ suit, rank });
    }
  }
  return out;
}

/**
 * 生成固定牌序：placements 为 [下标, 花色, 点数]。
 * 用交换实现，保证整副牌仍是 104 张标准牌（不丢不重）。
 */
function makeDeck(placements) {
  const deck = baseDeck();
  const reserved = new Set(placements.map(([i]) => i));
  for (const [i, suit, rank] of placements) {
    if (deck[i].suit === suit && deck[i].rank === rank) continue;
    const k = deck.findIndex(
      (c, idx) => !reserved.has(idx) && idx !== i && c.suit === suit && c.rank === rank,
    );
    assert.ok(k >= 0, `牌序里找不到可交换的 ${suit}${rank}`);
    [deck[i], deck[k]] = [deck[k], deck[i]];
  }
  return deck;
}

/** 一列同花色 K→A（13 张，全部翻开） */
function runKtoA(suit) {
  const col = [];
  for (let rank = SET_SIZE; rank >= 1; rank--) col.push({ suit, rank, faceUp: true });
  return col;
}

function cardKey(c) {
  return `${c.suit}-${c.rank}`;
}

/** 桌面上的牌数（收走的 13 张一组不在其中） */
function boardCount(s) {
  return s.tableau.flat().length + s.stockCards;
}

test('初始：10 列按 6/5 张发牌，仅顶张翻开，发牌堆 50 张 = 5 轮', () => {
  const s = createGame({ seed: 7 }).state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.tableau.length, COLUMNS);
  for (let i = 0; i < COLUMNS; i++) {
    assert.equal(s.tableau[i].length, i < 4 ? 6 : 5, `第 ${i} 列张数`);
    s.tableau[i].forEach((c, j) => {
      assert.equal(c.faceUp, j === s.tableau[i].length - 1, `第 ${i} 列第 ${j} 张翻开状态`);
    });
  }
  assert.equal(s.stock, 5);
  assert.equal(s.stockCards, 50);
  assert.equal(boardCount(s), TOTAL_CARDS);
  assert.equal(s.score, 0);
  assert.equal(s.completedSets, 0);
  assert.equal(s.won, false);
  assert.equal(s.over, false);
  assert.equal(s.moves, 0);
  assert.equal(s.canUndo, false);
});

test('牌面完整：发完 5 轮后 104 张全在桌上，♠/♥ 每点数各 4 张', () => {
  const g = createGame({ deck: baseDeck() }); // 固定牌序，只验证张数与组成
  for (let i = 0; i < 5; i++) assert.equal(g.submit('p1', 'stock').ok, true);
  const s = g.state();
  assert.equal(s.stockCards, 0);
  const cards = s.tableau.flat();
  assert.equal(cards.length, TOTAL_CARDS - s.completedSets * SET_SIZE);
  const counts = new Map();
  for (const c of cards) counts.set(cardKey(c), (counts.get(cardKey(c)) || 0) + 1);
  assert.equal(s.completedSets, 0);
  for (const suit of SUITS) {
    for (let rank = 1; rank <= SET_SIZE; rank++) {
      assert.equal(counts.get(`${suit}-${rank}`), 4, `${suit}-${rank} 应恰好 4 张`);
    }
  }
});

test('发牌轮：点击发牌堆每列各得 1 张翻开牌，5 轮后不可再发', () => {
  const g = createGame({ seed: 11 });
  const before = g.state().tableau.map((c) => c.length);
  const r = g.submit('p1', 'stock');
  assert.equal(r.ok, true);
  assert.equal(r.dealt, 10);
  let s = g.state();
  assert.equal(s.stock, 4);
  assert.equal(s.stockCards, 40);
  assert.equal(s.moves, 1);
  for (let i = 0; i < COLUMNS; i++) {
    assert.equal(s.tableau[i].length, before[i] + 1);
    assert.equal(s.tableau[i][s.tableau[i].length - 1].faceUp, true);
  }

  for (let i = 0; i < 4; i++) assert.equal(g.submit('p1', 'stock').ok, true);
  s = g.state();
  assert.equal(s.stock, 0);
  assert.equal(s.stockCards, 0);
  assert.equal(s.moves, 5);
  assert.equal(before.length, COLUMNS);
  const empty = g.submit('p1', 'stock');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /发牌堆已空/);
  assert.equal(g.state().moves, 5);
});

test('同花色递减序列可整体移动（省略 n 时搬顶部最长合法段），源列新顶暗牌翻开', () => {
  // 列 0 首轮 6 张，顶张 ♠Q；发牌时 ♠J 落到列 0，列 1 顶张 ♥K 做落点。
  const deck = makeDeck([
    [4, 'H', 7], // 搬走 ♥7 下面的 ♠Q/♠J 后，这张暗牌应被翻开
    [5, 'S', 12], // 列 0 原顶张 ♠Q
    [54, 'S', 11], // 第一轮发给列 0 的 ♠J
    [55, 'H', 13], // 第一轮发给列 1 的 ♥K
  ]);
  const g = createGame({ seed: 1, deck });
  assert.equal(g.submit('p1', 'stock').ok, true);

  const before = g.state();
  assert.deepEqual(before.tableau[0].slice(-2), [
    { suit: 'S', rank: 12, faceUp: true },
    { suit: 'S', rank: 11, faceUp: true },
  ]);
  assert.deepEqual(before.tableau[1][before.tableau[1].length - 1], {
    suit: 'H',
    rank: 13,
    faceUp: true,
  });

  const r = g.submit('p1', 'move:t0,t1');
  assert.equal(r.ok, true);
  assert.equal(r.moved, 2); // ♠Q + ♠J 整段搬走

  const s = g.state();
  assert.deepEqual(s.tableau[1].slice(-3), [
    { suit: 'H', rank: 13, faceUp: true },
    { suit: 'S', rank: 12, faceUp: true },
    { suit: 'S', rank: 11, faceUp: true },
  ]);
  assert.equal(s.tableau[0].length, 5);
  assert.equal(s.tableau[0][4].faceUp, true); // 暗牌被翻开
  assert.equal(s.moves, 2);
  assert.equal(s.score, 0);
});

test('异花色连续牌组整段移动被拒绝，单张不受花色限制', () => {
  // 列 0 顶部：♠Q 上压 ♥J（不同花色，不能整段搬）；列 1 顶张 ♥Q 可接单张 ♥J。
  const deck = makeDeck([
    [5, 'S', 12],
    [54, 'H', 11],
    [55, 'H', 12],
  ]);
  const g = createGame({ seed: 1, deck });
  assert.equal(g.submit('p1', 'stock').ok, true);

  const bad = g.submit('p1', 'move:t0,t1,2');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /同花色/);
  assert.equal(g.state().moves, 1, '被拒绝的动作不改变状态');

  assert.equal(isMovableRun(g.state().tableau[0], g.state().tableau[0].length - 1), true);
  const ok = g.submit('p1', 'move:t0,t1'); // 省略 n：顶部只有 ♥J 这一张合法
  assert.equal(ok.ok, true);
  assert.equal(ok.moved, 1);
  const s = g.state();
  assert.deepEqual(s.tableau[1].slice(-2), [
    { suit: 'H', rank: 12, faceUp: true },
    { suit: 'H', rank: 11, faceUp: true },
  ]);
});

test('凑成同花色 K→A 十三张自动移除，+100，并翻开新顶暗牌', () => {
  const col = [{ suit: 'H', rank: 9, faceUp: false }];
  for (let rank = 13; rank >= 2; rank--) col.push({ suit: 'S', rank, faceUp: true });
  const g = createGame({
    tableau: [col, [{ suit: 'S', rank: 1, faceUp: true }]],
    stock: [],
  });
  assert.equal(g.state().completedSets, 0);
  assert.equal(findCompleteSet(g.state().tableau[0]), -1);

  const r = g.submit('p1', 'move:t1,t0'); // ♠A 接到 ♠2 上，补齐 K→A
  assert.equal(r.ok, true);
  assert.equal(r.sets, 1);

  const s = g.state();
  assert.equal(s.completedSets, 1);
  assert.equal(s.score, 100);
  assert.equal(s.moves, 1);
  assert.deepEqual(s.tableau[0], [{ suit: 'H', rank: 9, faceUp: true }]);
  assert.deepEqual(s.tableau[1], []);
  assert.equal(s.won, false);
});

test('撤销：收组与发牌都可回退，空撤销栈返回错误', () => {
  const col = [{ suit: 'H', rank: 9, faceUp: false }];
  for (let rank = 13; rank >= 2; rank--) col.push({ suit: 'S', rank, faceUp: true });
  const g = createGame({
    tableau: [col, [{ suit: 'S', rank: 1, faceUp: true }]],
    stock: [],
  });
  const before = g.state();
  assert.equal(g.submit('p1', 'move:t1,t0').ok, true);
  assert.equal(g.state().completedSets, 1);
  assert.equal(g.submit('p1', 'undo').ok, true);
  assert.deepEqual(g.state(), before);
  assert.equal(g.submit('p1', 'undo').ok, false);

  const g2 = createGame({ seed: 5 });
  const s0 = g2.state();
  assert.equal(g2.submit('p1', 'stock').ok, true);
  assert.notDeepEqual(g2.state().tableau, s0.tableau);
  assert.equal(g2.submit('p1', 'undo').ok, true);
  assert.deepEqual(g2.state(), s0);
});

test('空列可放整段或单牌；点数不匹配（差大于 1）被拒绝', () => {
  const g = createGame({
    tableau: [
      [
        { suit: 'S', rank: 7, faceUp: true },
        { suit: 'S', rank: 6, faceUp: true },
        { suit: 'S', rank: 5, faceUp: true },
      ],
      [],
      [{ suit: 'H', rank: 3, faceUp: true }],
      [],
    ],
    stock: [],
  });

  const mismatch = g.submit('p1', 'move:t0,t2'); // ♠7 不能放到 ♥3
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /大 1/);

  assert.equal(g.submit('p1', 'move:t0,t1').ok, true); // 整段 3 张进空列
  let s = g.state();
  assert.equal(s.tableau[1].length, 3);
  assert.equal(s.tableau[0].length, 0);

  assert.equal(g.submit('p1', 'move:t1,t3,1').ok, true); // 单牌进空列
  s = g.state();
  assert.equal(s.tableau[3].length, 1);
  assert.equal(s.tableau[3][0].rank, 5);
  assert.equal(s.tableau[1].length, 2);
});

test('胜利判定：8 组全部移除即胜，result 给出胜者与得分', () => {
  const tableau = [];
  for (let i = 0; i < 4; i++) tableau.push(runKtoA('S'));
  for (let i = 0; i < 3; i++) tableau.push(runKtoA('H'));
  const last = [];
  for (let rank = 13; rank >= 2; rank--) last.push({ suit: 'H', rank, faceUp: true });
  tableau.push(last); // 第 8 组只差 A
  tableau.push([{ suit: 'H', rank: 1, faceUp: true }]);

  const g = createGame({ tableau, stock: [] });
  let s = g.state();
  assert.equal(s.completedSets, 7, '开局已有的 7 组完整序列自动收走');
  assert.equal(s.score, 700);
  assert.equal(s.won, false);

  assert.equal(g.submit('p1', 'move:t8,t7').ok, true);
  s = g.state();
  assert.equal(s.completedSets, 8);
  assert.equal(s.score, 800);
  assert.equal(s.won, true);
  assert.equal(s.over, true);

  const info = g.result();
  assert.equal(info.over, true);
  assert.equal(info.winner, 'p1');
  assert.equal(info.score, 800);
  assert.equal(info.scores.p1, 800);

  assert.equal(g.submit('p1', 'stock').ok, false);
  assert.equal(g.submit('p1', 'move:t7,t8').ok, false);
});

test('状态可序列化且每次返回新对象，外部修改不影响内部状态', () => {
  const g = createGame({ seed: 9 });
  const s = g.state();
  const round = JSON.parse(JSON.stringify(s));
  assert.deepEqual(round, s);
  assert.notEqual(g.state(), s);

  assert.equal(s.tableau[0][0].faceUp, false);
  s.tableau[0][0].faceUp = true;
  s.tableau[0].push({ suit: 'S', rank: 13, faceUp: true });
  s.score = 9999;
  const after = g.state();
  assert.equal(after.tableau[0][0].faceUp, false);
  assert.equal(after.tableau[0].length, 6);
  assert.equal(after.score, 0);
});

test('同种子初始牌面一致，不同种子不同', () => {
  const a = createGame({ seed: 42 }).state();
  const b = createGame({ seed: 42 }).state();
  const c = createGame({ seed: 43 }).state();
  assert.deepEqual(a.tableau, b.tableau);
  assert.notDeepEqual(a.tableau, c.tableau);
});

test('连续动作不崩：多轮发牌 + 各种移动后牌数守恒', () => {
  const g = createGame({ seed: 3 });
  for (let i = 0; i < 5; i++) assert.equal(g.submit('p1', 'stock').ok, true);
  for (let step = 0; step < 60; step++) {
    let acted = false;
    outer: for (let a = 0; a < COLUMNS; a++) {
      for (let b = 0; b < COLUMNS; b++) {
        if (a === b) continue;
        const r = g.submit('p1', `move:t${a},t${b},1`);
        if (r.ok) {
          acted = true;
          break outer;
        }
      }
    }
    if (!acted) assert.equal(g.submit('p1', 'stock').ok, false);
    const s = g.state();
    assert.equal(boardCount(s) + s.completedSets * SET_SIZE, TOTAL_CARDS);
    for (const col of s.tableau) {
      let seenFaceUp = false;
      for (const c of col) {
        if (c.faceUp) seenFaceUp = true;
        else assert.equal(seenFaceUp, false, '暗牌只应连续出现在列首，翻开牌在列末');
      }
    }
  }
});
