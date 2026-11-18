import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { boardLayout, levelConfig } from '../layout.mjs';

/** 找一对同符号 / 一对不同符号的索引（牌面来自 state().deck，纯确定性） */
function findPair(deck) {
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      if (deck[i] === deck[j]) return [i, j];
    }
  }
  return null;
}
function findMismatch(deck) {
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      if (deck[i] !== deck[j]) return [i, j];
    }
  }
  return null;
}

test('初始：全部卡片背面（flipped/matched 为空）、分数步数为 0、turn=p1', () => {
  const g = createGame({ seed: 7 });
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.deepEqual(s.flipped, []);
  assert.deepEqual(s.matched, Array(s.cols * s.rows).fill(false));
  assert.equal(s.score, 0);
  assert.equal(s.steps, 0);
  assert.equal(s.matchedPairs, 0);
  assert.equal(s.over, false);
});

test('牌堆可复现：每种符号恰好 2 张，同种子同牌堆', () => {
  const a = createGame({ seed: 42 }).state().deck;
  const b = createGame({ seed: 42 }).state().deck;
  const c = createGame({ seed: 43 }).state().deck;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const count = new Map();
  for (const v of a) count.set(v, (count.get(v) || 0) + 1);
  assert.ok([...count.values()].every((n) => n === 2));
});

test('翻一张：kind=flip，flipped 含该索引，步数不变', () => {
  const g = createGame({ seed: 1 });
  const r = g.submit('p1', 'flip:0');
  assert.deepEqual(r, { ok: true, kind: 'flip', index: 0 });
  const s = g.state();
  assert.deepEqual(s.flipped, [0]);
  assert.equal(s.steps, 0);
  assert.equal(s.score, 0);
});

test('同一张牌不能重复翻开', () => {
  const g = createGame({ seed: 1 });
  g.submit('p1', 'flip:3');
  const r = g.submit('p1', 'flip:3');
  assert.equal(r.ok, false);
  assert.deepEqual(g.state().flipped, [3]);
});

test('配对成功：kind=match，两张消除、+100 分、步数+1', () => {
  const g = createGame({ seed: 5 });
  const deck = g.state().deck;
  const [i, j] = findPair(deck);
  g.submit('p1', `flip:${i}`);
  const r = g.submit('p1', `flip:${j}`);
  assert.equal(r.kind, 'match');
  assert.equal(r.gained, 100);
  const s = g.state();
  assert.equal(s.score, 100);
  assert.equal(s.steps, 1);
  assert.equal(s.matchedPairs, 1);
  assert.equal(s.matched[i], true);
  assert.equal(s.matched[j], true);
  assert.deepEqual(s.flipped, []);
});

test('配对失败：kind=mismatch，两张保持翻开；下一次翻牌时翻回', () => {
  const g = createGame({ seed: 9 });
  const deck = g.state().deck;
  const [i, j] = findMismatch(deck);
  g.submit('p1', `flip:${i}`);
  const r = g.submit('p1', `flip:${j}`);
  assert.equal(r.kind, 'mismatch');
  assert.deepEqual(g.state().flipped, [i, j]);
  assert.equal(g.state().score, 0);
  // 第三张：上一轮自动翻回，只留新翻的这张
  const k = (i + 1) % deck.length === j ? (i + 2) % deck.length : (i + 1) % deck.length;
  g.submit('p1', `flip:${k}`);
  assert.deepEqual(g.state().flipped, [k]);
});

test('胜利判定：全部配对后 over=true 且 result 给出分数与步数', () => {
  const g = createGame({ seed: 11, level: 1 });
  let deck = g.state().deck;
  // 每轮用当前剩余牌的第一对同符号
  while (!g.state().over) {
    deck = g.state().deck;
    const s = g.state();
    const avail = deck.map((v, idx) => ({ v, idx })).filter((o) => !s.matched[o.idx]);
    let pair = null;
    for (let a = 0; a < avail.length && !pair; a++) {
      for (let b = a + 1; b < avail.length; b++) {
        if (avail[a].v === avail[b].v) { pair = [avail[a].idx, avail[b].idx]; break; }
      }
    }
    assert.ok(pair, '总能找到未消除的一对');
    g.submit('p1', `flip:${pair[0]}`);
    g.submit('p1', `flip:${pair[1]}`);
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.matchedPairs, s.totalPairs);
  assert.equal(s.score, s.totalPairs * 100);
  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.equal(res.score, s.score);
  assert.match(res.text, /全部 6 对配对完成/);
});

test('计分：每对固定 100 分，失败不计分', () => {
  const g = createGame({ seed: 21, level: 2 });
  const deck = g.state().deck;
  const [a, b] = findMismatch(deck);
  g.submit('p1', `flip:${a}`);
  g.submit('p1', `flip:${b}`);
  assert.equal(g.state().score, 0);
  const [i, j] = findPair(deck);
  g.submit('p1', `flip:${i}`);
  g.submit('p1', `flip:${j}`);
  assert.equal(g.state().score, 100);
});

test('撤销：恢复上一次翻牌前的 matched/score/steps', () => {
  const g = createGame({ seed: 3 });
  const deck = g.state().deck;
  const [i, j] = findPair(deck);
  g.submit('p1', `flip:${i}`);
  g.submit('p1', `flip:${j}`);
  assert.equal(g.state().score, 100);
  const r = g.submit('p1', 'undo');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.score, 0);
  assert.equal(s.steps, 0);
  assert.equal(s.matchedPairs, 0);
  assert.deepEqual(s.matched, Array(s.cols * s.rows).fill(false));
});

test('无步可撤时 undo 返回错误', () => {
  const g = createGame({ seed: 3 });
  assert.equal(g.submit('p1', 'undo').ok, false);
  assert.equal(g.state().canUndo, false);
});

test('非法索引与非法动作：越界/负数/非整数/乱字符串均被拒且状态不变', () => {
  const g = createGame({ seed: 3 });
  const before = JSON.stringify(g.state());
  for (const action of ['flip:-1', 'flip:999', 'flip:1.5', 'flip:abc', 'flip:', 'left', 'flip:NaN']) {
    const r = g.submit('p1', action);
    assert.equal(r.ok, false, action);
  }
  assert.equal(JSON.stringify(g.state()), before);
});

test('重置：回到初始牌局（同种子同牌堆）、分数步数清零', () => {
  const g = createGame({ seed: 77 });
  const deck0 = g.state().deck;
  g.submit('p1', 'flip:0');
  g.submit('p1', 'flip:1');
  g.reset();
  const s = g.state();
  assert.deepEqual(s.deck, deck0);
  assert.equal(s.score, 0);
  assert.deepEqual(s.flipped, []);
  assert.equal(s.canUndo, false);
});

test('状态可 JSON 序列化且与内部隔离（state 每次返回新对象）', () => {
  const g = createGame({ seed: 4 });
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.deepEqual(JSON.parse(json), s1);
  s1.deck[0] = -999;
  s1.matched[0] = true;
  const s2 = g.state();
  assert.notEqual(s2.deck[0], -999);
  assert.equal(s2.matched[0], false);
  assert.notEqual(s1, s2);
});

test('三档难度维度正确：4×3 / 4×4 / 6×4，布局换算落在格内', () => {
  for (const [level, cols, rows] of [[1, 4, 3], [2, 4, 4], [3, 6, 4]]) {
    const g = createGame({ seed: 1, level });
    const s = g.state();
    assert.equal(s.cols, cols);
    assert.equal(s.rows, rows);
    assert.equal(s.deck.length, cols * rows);
    assert.equal(s.totalPairs, cols * rows / 2);
    const layout = boardLayout(level);
    assert.equal(layout.count, cols * rows);
    const centerX = layout.x0 + layout.cellW / 2;
    const centerY = layout.y0 + layout.cellH / 2;
    assert.equal(layout.indexAt(centerX, centerY), 0);
    assert.equal(layout.indexAt(-1, -1), -1);
  }
  assert.deepEqual(levelConfig(9), levelConfig(1));
});

test('切换难度重建牌局且清空进度', () => {
  const g = createGame({ seed: 8, level: 1 });
  g.submit('p1', 'flip:0');
  g.submit('p1', 'level:3');
  const s = g.state();
  assert.equal(s.level, 3);
  assert.equal(s.cols, 6);
  assert.equal(s.deck.length, 24);
  assert.equal(s.score, 0);
  assert.deepEqual(s.flipped, []);
});

test('连走 N 步不崩（含反复失败翻牌），状态始终合法', () => {
  const g = createGame({ seed: 13, level: 3 });
  for (let i = 0; i < 300; i++) {
    const idx = i % g.state().deck.length;
    const r = g.submit('p1', `flip:${idx}`);
    assert.equal(typeof r.ok, 'boolean');
    const s = g.state();
    assert.ok(s.flipped.length <= 2);
    assert.ok(s.score >= 0);
    assert.ok(s.matchedPairs <= s.totalPairs);
  }
});
