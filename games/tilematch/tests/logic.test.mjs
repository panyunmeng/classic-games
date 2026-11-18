import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, START_TIME, BONUS_TIME, SYMBOL_KINDS } from '../logic.mjs';
import { LAYERS, TILE, CANVAS, layoutTiles, hitTest, isFree, buildBlockers } from '../layout.mjs';

/** 小盘：底 3×2 + 上 2×1 = 8 张，上层 2 张居中，把底层 6 张全压住（便于构造「被压住」） */
const TINY = [
  { cols: 3, rows: 2 },
  { cols: 2, rows: 1 },
];

function alive(s) {
  return s.tiles.filter((t) => !t.removed);
}

/** 按符号分组的可消对（同一符号两张都可点） */
function freePairs(s) {
  const by = new Map();
  for (const t of s.tiles) {
    if (t.removed || !t.free) continue;
    if (!by.has(t.symbol)) by.set(t.symbol, []);
    by.get(t.symbol).push(t);
  }
  const out = [];
  for (const arr of by.values()) {
    for (let i = 0; i + 1 < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
  }
  return out;
}

/** 取「层数最高」的一对，模拟正常玩家的开牌顺序（先掀上面的） */
function topFreePair(s) {
  return freePairs(s).sort(
    (x, y) => y[0].layer + y[1].layer - (x[0].layer + x[1].layer)
  )[0];
}

function countSymbols(tiles) {
  const m = new Map();
  for (const t of tiles) m.set(t.symbol, (m.get(t.symbol) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function playPair(g, pair) {
  const a = g.submit('p1', `pick:${pair[0].id}`);
  const b = g.submit('p1', `pick:${pair[1].id}`);
  return { a, b };
}

test('T1 初始分层：4 层、每层张数递增、总数偶数、图案全成对、turn=p1', () => {
  const g = createGame({ seed: 42 });
  const s = g.state();

  assert.equal(s.total, 60);
  assert.equal(s.total % 2, 0, '总牌数必须为偶数');
  assert.equal(s.turn, 'p1');
  assert.equal(s.over, false);
  assert.equal(s.solved, false);
  assert.equal(s.steps, 0);
  assert.equal(s.remaining, s.total);
  assert.equal(s.timeLeft, START_TIME);
  assert.equal(s.tiles.length, s.total);

  // 层数 = 4，每层张数自下而上严格递减（底层最多、顶层居中几张）
  assert.equal(s.layers.length, 4);
  const counts = s.layers.map((l) => l.cols * l.rows);
  assert.deepEqual(counts, [28, 18, 10, 4]);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] < counts[i - 1]);
  assert.equal(s.layers[3].cols, 4, '顶层居中 4 张');

  // 每层逐层少一圈 → 下层每侧露出半张
  for (let i = 1; i < s.layers.length; i++) {
    assert.equal(s.layers[i].cols, s.layers[i - 1].cols - 1);
    assert.equal(s.layers[i].rows, s.layers[i - 1].rows - 1);
  }

  // 图案严格成对（每种符号出现偶数次）
  for (const [sym, n] of countSymbols(alive(s))) {
    assert.equal(n % 2, 0, `符号 ${sym} 应成对出现，实际 ${n}`);
  }
  assert.ok(countSymbols(alive(s)).length <= SYMBOL_KINDS);

  // 所有牌都在画布内，且开局至少存在一对可点同图案牌（有解）
  for (const t of s.tiles) {
    assert.ok(t.x >= 0 && t.x + t.w <= CANVAS.w, `牌 ${t.id} 横向越界`);
    assert.ok(t.y >= 0 && t.y + t.h <= CANVAS.h, `牌 ${t.id} 纵向越界`);
  }
  assert.ok(topFreePair(s), '开局必须至少有一对可消（洗牌保证）');
});

test('T2 可点判定：被上层压住的牌不可点，顶层才可点', () => {
  const g = createGame({ seed: 3, layers: TINY });
  const s = g.state();
  assert.equal(s.total, 8);

  const top = s.tiles.filter((t) => t.layer === 1);
  const bottom = s.tiles.filter((t) => t.layer === 0);
  assert.equal(top.length, 2);
  assert.equal(bottom.length, 6);
  assert.ok(top.every((t) => t.free), '顶层两张应可点');
  assert.ok(bottom.every((t) => !t.free), '底层 6 张都被上层压住');

  const r = g.submit('p1', `pick:${bottom[0].id}`);
  assert.equal(r.ok, false);
  assert.match(r.error, /压住/);
  assert.equal(g.state().selected, null, '非法点选不应产生选中态');

  // 顶层两张是同一图案（洗牌保证），选中一张
  const r2 = g.submit('p1', `pick:${top[0].id}`);
  assert.equal(r2.ok, true);
  assert.equal(g.state().selected, top[0].id);
});

test('T3 配对消除：同图案两张可点牌 → 移除、解锁下层、计步', () => {
  const g = createGame({ seed: 5, layers: TINY });
  const s0 = g.state();
  const top = s0.tiles.filter((t) => t.layer === 1);
  assert.equal(top[0].symbol, top[1].symbol);

  const { b } = playPair(g, top);
  assert.equal(b.ok, true);
  const s = g.state();
  assert.equal(s.tiles[top[0].id].removed, true);
  assert.equal(s.tiles[top[1].id].removed, true);
  assert.equal(s.remaining, 6);
  assert.equal(s.steps, 1);
  assert.equal(s.selected, null);
  assert.equal(s.lastRemoved.ids.length, 2);
  // 压牌移走后，底层 6 张全部解锁
  assert.ok(s.tiles.filter((t) => t.layer === 0).every((t) => t.free));
});

test('T4 无对自动重排：洗牌后整盘有解、图案多重集不变', () => {
  // 手动洗牌：图案只换位置，数量不变；洗后必须存在可消对
  const g = createGame({ seed: 11 });
  const before = countSymbols(alive(g.state()));
  const r = g.submit('p1', 'shuffle');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.shuffles, 1);
  assert.deepEqual(countSymbols(alive(s)), before);
  assert.ok(topFreePair(s), '洗牌后必须至少有一对可消');

  // 自动重排：消除后若无可消对自动触发，且全程每一步都有可消对
  let autoSeen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const gg = createGame({ seed });
    for (let i = 0; i < 200; i++) {
      const cur = gg.state();
      if (cur.over) break;
      const pair = topFreePair(cur);
      assert.ok(pair, `seed=${seed} 第 ${i} 步无可消对（自动重排失效）`);
      if (cur.autoShuffles > 0) autoSeen++;
      playPair(gg, pair);
    }
    const done = gg.state();
    assert.equal(done.solved, true, `seed=${seed} 应能被清空`);
    assert.equal(done.remaining, 0);
  }
  assert.ok(autoSeen > 0, '12 局中应至少触发过一次自动重排');
});

test('T5 计步：每消一对 steps +1，非法操作不记步', () => {
  const g = createGame({ seed: 8 });
  for (let i = 1; i <= 3; i++) {
    const s = g.state();
    const pair = topFreePair(s);
    playPair(g, pair);
    assert.equal(g.state().steps, i);
  }
  const s = g.state();
  assert.equal(g.submit('p1', 'pick:9999').ok, false);
  assert.equal(g.submit('p1', 'pick:abc').ok, false);
  assert.equal(g.submit('p1', 'nope').ok, false);
  assert.equal(g.state().steps, 3, '非法操作不增加步数');
});

test('T6 计时：30 秒倒计时、每消一对 +3 秒、归零判负', () => {
  const g = createGame({ seed: 21 });
  assert.equal(g.state().timeLeft, START_TIME);

  g.step(5); // 只喂确定性 dt，不碰墙钟
  assert.ok(Math.abs(g.state().timeLeft - (START_TIME - 5)) < 1e-9);

  const pair = topFreePair(g.state());
  playPair(g, pair);
  assert.ok(Math.abs(g.state().timeLeft - (START_TIME - 5 + BONUS_TIME)) < 1e-9);

  g.step(1000);
  const s = g.state();
  assert.equal(s.timeLeft, 0);
  assert.equal(s.over, true);
  assert.equal(s.solved, false);
  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p2');
  assert.match(res.text, /时间/);

  // 超时后不再接受操作
  const late = g.submit('p1', `pick:${pair[0].id}`);
  assert.equal(late.ok, false);
  assert.match(late.error, /结束/);
});

test('T7 胜利判定：全部消除 solved/over 且 result 判胜', () => {
  const g = createGame({ seed: 33 });
  let guard = 0;
  while (!g.state().over && guard++ < 300) {
    const pair = topFreePair(g.state());
    assert.ok(pair);
    playPair(g, pair);
  }
  const s = g.state();
  assert.equal(s.solved, true);
  assert.equal(s.over, true);
  assert.equal(s.remaining, 0);
  assert.equal(s.steps, s.total / 2);
  assert.ok(s.tiles.every((t) => t.removed));
  const res = g.result();
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.match(res.text, /通关/);
  assert.ok(res.score > 0);
});

test('T8 非法选择：越界/非数字/已消除/重复点同张', () => {
  const g = createGame({ seed: 4 });
  assert.equal(g.submit('p1', 'pick:-1').ok, false);
  assert.equal(g.submit('p1', 'pick:999').ok, false);
  assert.equal(g.submit('p1', 'pick:1.5').ok, false);
  assert.equal(g.submit('p1', 'pick:').ok, false);
  assert.equal(g.submit('p1', 123).ok, false, '非字符串 action 应拒绝');

  // 点一张 → 再点同一张 = 取消选择
  const s = g.state();
  const t = s.tiles.find((x) => x.free);
  assert.equal(g.submit('p1', `pick:${t.id}`).ok, true);
  assert.equal(g.state().selected, t.id);
  const cancel = g.submit('p1', `pick:${t.id}`);
  assert.equal(cancel.ok, true);
  assert.equal(cancel.selected, null);
  assert.equal(g.state().selected, null);

  // 已消除的牌不能再点
  const pair = topFreePair(g.state());
  playPair(g, pair);
  const dead = g.state().tiles[pair[0].id];
  assert.equal(dead.removed, true);
  const r = g.submit('p1', `pick:${dead.id}`);
  assert.equal(r.ok, false);
  assert.match(r.error, /已消除/);

  // 图案不同：改选而不是消除
  const s2 = g.state();
  const free = s2.tiles.filter((x) => x.free);
  const diff = free.find((x) => x.symbol !== free[0].symbol);
  if (diff) {
    g.submit('p1', `pick:${free[0].id}`);
    const r2 = g.submit('p1', `pick:${diff.id}`);
    assert.equal(r2.ok, false);
    assert.match(r2.error, /图案不同/);
    assert.equal(g.state().selected, diff.id);
  }
});

test('T9 状态可序列化：JSON 往返一致，且每次 state() 返回新对象', () => {
  const g = createGame({ seed: 9 });
  const s1 = g.state();
  const s2 = g.state();
  assert.notEqual(s1, s2, '每次应返回新对象');
  assert.notEqual(s1.tiles, s2.tiles);
  assert.deepEqual(JSON.parse(JSON.stringify(s1)), JSON.parse(JSON.stringify(s2)));

  s1.tiles[0].removed = true;
  s1.tiles[0].symbol = 99;
  assert.equal(g.state().tiles[0].removed, false, '外部改快照不能影响内部状态');
  assert.notEqual(g.state().tiles[0].symbol, 99);

  const pair = topFreePair(g.state());
  playPair(g, pair);
  const s3 = g.state();
  assert.deepEqual(JSON.parse(JSON.stringify(s3)), s3, '含消除记录的状态也必须可 JSON 往返');
});

test('T10 同种子一致：同种子同开局，换种子换牌面', () => {
  const a = createGame({ seed: 1234 }).state();
  const b = createGame({ seed: 1234 }).state();
  assert.deepEqual(a, b);

  const c = createGame({ seed: 1235 }).state();
  assert.notDeepEqual(
    a.tiles.map((t) => t.symbol),
    c.tiles.map((t) => t.symbol),
    '不同种子应得到不同牌面'
  );

  // 逐帧喂 dt 后同种子仍一致（逻辑完全确定）
  const g1 = createGame({ seed: 77 });
  const g2 = createGame({ seed: 77 });
  g1.step(1.5);
  g2.step(1.5);
  assert.deepEqual(g1.state(), g2.state());
});

test('T11 压制关系是几何的：hitTest 取最高层、移除压牌后下层变可点', () => {
  const g = createGame({ seed: 2, layers: TINY });
  const s = g.state();
  const lower = s.tiles.filter((t) => t.layer === 0)[0];
  const upper = s.tiles.filter((t) => t.layer === 1);

  // 上层牌中心点命中的必须是上层牌
  const cx = upper[0].x + upper[0].w / 2;
  const cy = upper[0].y + upper[0].h / 2;
  const hit = hitTest(s.tiles, cx, cy);
  assert.equal(s.tiles[hit].layer, 1, '重叠处应命中最高层牌');

  // 底层牌的可见边缘命中底层牌
  const edge = hitTest(s.tiles, lower.x + 4, lower.y + 4);
  assert.equal(edge, lower.id);
  assert.equal(g.submit('p1', `pick:${edge}`).ok, false, '可见边缘被压住仍不可点');

  // 画布外落空
  assert.equal(hitTest(s.tiles, -5, -5), -1);

  // 把上层清掉后，底层整片可点
  playPair(g, upper);
  const after = g.state();
  assert.ok(after.tiles.filter((t) => t.layer === 0).every((t) => t.free));
  assert.equal(after.tiles[edge].free, true);

  // 几何关系本身：每张上层牌都压住下层 4 张（层间错半张）
  const geo = layoutTiles(TINY);
  const blockers = buildBlockers(geo);
  const removed = new Array(geo.length).fill(false);
  for (const t of geo.filter((x) => x.layer === 1)) {
    const covers = geo.filter((x) => x.layer === 0 && blockers[x.id].includes(t.id));
    assert.equal(covers.length, 4, '错半张的上层牌应压住 4 张下层牌');
    assert.equal(isFree(t.id, removed, blockers), true);
  }
});

test('T12 reset：回到同一开局、清空步数与计时', () => {
  const g = createGame({ seed: 55 });
  const opening = g.state();
  const pair = topFreePair(opening);
  playPair(g, pair);
  g.step(7.5);
  assert.ok(g.state().steps > 0);

  g.reset();
  const again = g.state();
  assert.deepEqual(again, opening, 'reset 后应与同种子开局完全一致');
  assert.equal(again.steps, 0);
  assert.equal(again.timeLeft, START_TIME);
  assert.equal(again.remaining, again.total);
});

test('T13 洗牌与操作边界：剩 0 张不洗、对局中可反复洗、无解动作有错误信息', () => {
  const g = createGame({ seed: 6 });
  const s = g.state();
  assert.equal(s.shuffles, 0);
  assert.equal(g.submit('p1', 'shuffle').ok, true);
  assert.equal(g.submit('p1', 'shuffle').ok, true);
  assert.equal(g.state().shuffles, 2);
  assert.equal(g.state().steps, 0, '洗牌不算步数');

  // 清空后不许再操作
  let guard = 0;
  while (!g.state().over && guard++ < 300) playPair(g, topFreePair(g.state()));
  assert.equal(g.state().over, true);
  const r = g.submit('p1', 'shuffle');
  assert.equal(r.ok, false);
  assert.match(r.error, /结束/);
});

test('T14 连走 N 步不崩：逐张点选、改选、取消混合操作后状态仍自洽', () => {
  const g = createGame({ seed: 101 });
  const check = () => {
    const s = g.state();
    assert.equal(s.remaining, s.tiles.filter((t) => !t.removed).length);
    assert.equal(s.pairsLeft * 2, s.remaining);
    if (s.selected != null) {
      assert.equal(s.tiles[s.selected].removed, false);
      assert.equal(s.tiles[s.selected].free, true);
    }
    for (const t of s.tiles) {
      if (t.removed) assert.equal(t.free, false, '已消除的牌不可能可点');
    }
    return s;
  };

  for (let i = 0; i < 60; i++) {
    const s = check();
    if (s.over) break;
    const pair = topFreePair(s);
    if (!pair) {
      // 理论上不会发生：自动重排应保证总有可消对
      assert.fail('无可消对且未自动重排');
    }
    g.submit('p1', `pick:${pair[0].id}`); // 选中
    const diff = s.tiles.find((t) => t.free && t.symbol !== pair[1].symbol && t.id !== pair[0].id);
    if (diff && i % 3 === 0) g.submit('p1', `pick:${diff.id}`); // 改选
    const afterSelect = check();
    const target = afterSelect.selected != null ? pair[1] : null;
    if (target && afterSelect.tiles[target.id].free && afterSelect.tiles[target.id].symbol === afterSelect.tiles[afterSelect.selected].symbol) {
      g.submit('p1', `pick:${target.id}`);
    }
    check();
  }
  const end = g.state();
  assert.ok(end.over || end.remaining > 0);
  assert.equal(end.turn, 'p1');
});
