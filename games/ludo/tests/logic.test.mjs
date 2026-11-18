import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame,
  legalMoves,
  applyMoveTo,
  initialPieces,
  isSafeCell,
  ringIndexAt,
  SAFE_CELLS,
  COLORS,
  PIECES,
  RING,
  LANE,
  GOAL,
  HOME,
} from '../logic.mjs';
import { chooseMove, pickMove, scoreMove } from '../ai.mjs';
import { RING_PATH, LANES, ringCell } from '../board.mjs';

/* ── 测试脚手架 ─────────────────────────────────────────── */

/** 某局面下的棋子模型：[[{home,progress}...], [...]] */
function model(rows) {
  const m = initialPieces();
  for (const [pi, k, progress] of rows) {
    m[pi][k] = progress === HOME ? { home: true, progress: HOME } : { home: false, progress };
  }
  return m;
}

/** 用 ai 模式（不会自动替人走子）把一个种子的前 count 次骰点录下来 */
function rollDice(seed, count) {
  const g = createGame({ seed, mode: 'ai' });
  const out = [];
  let guard = 0;
  while (out.length < count && guard < 80) {
    guard += 1;
    const s = g.state();
    if (!s.turn || s.winner) break;
    if (s.phase === 'roll') {
      const r = g.submit(s.turn, 'roll');
      out.push(r.dice);
    } else if (s.moves.length) {
      g.submit(s.turn, s.moves[0].action);
    } else {
      g.submit(s.turn, 'skip');
    }
  }
  return out;
}

/** 找一个种子，让前若干次掷骰正好是 values（本游戏所有随机只有骰子，可精确复现） */
function seedFor(values) {
  for (let seed = 1; seed < 50000; seed++) {
    const got = rollDice(seed, values.length);
    if (got.length === values.length && got.every((v, i) => v === values[i])) return seed;
  }
  throw new Error(`找不到前 ${values.length} 次掷出 ${values.join(',')} 的种子`);
}

/** 指定开局棋子位置 + 首个骰点的一局 */
function gameWith(setup, firstDice) {
  const seed = seedFor([firstDice]);
  return createGame({ seed, mode: 'ai', setup });
}

/* ── 1. 初始状态 ────────────────────────────────────────── */

test('1. 初始状态：两色各 4 子全在基地，等 p1 掷骰', () => {
  const g = createGame({ seed: 42, mode: 'ai' });
  const s = g.state();
  assert.equal(s.players.length, 2);
  assert.equal(s.turn, 'p1');
  assert.equal(s.phase, 'roll');
  assert.equal(s.dice, null);
  assert.equal(s.extraRoll, false);
  assert.equal(s.winner, null);
  assert.deepEqual(s.moves, []);
  assert.equal(s.players[0].color, 'red');
  assert.equal(s.players[1].color, 'blue');
  let home = 0;
  for (const pl of s.players) {
    assert.equal(pl.pieces.length, PIECES);
    for (const p of pl.pieces) {
      assert.equal(p.home, true);
      assert.equal(p.progress, HOME);
      home += 1;
    }
  }
  assert.equal(home, 8, '开局应有 8 个棋子全在基地');
});

/* ── 2. 掷骰范围与可复现 ────────────────────────────────── */

test('2. 掷骰恒在 1～6，且同种子同动作序列完全可复现', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const g = createGame({ seed, mode: 'ai' });
    const r = g.submit('p1', 'roll');
    assert.equal(r.ok, true);
    const dice = g.state().dice;
    assert.ok(Number.isInteger(dice) && dice >= 1 && dice <= 6, `骰点越界：${dice}`);
    seen.add(dice);
  }
  assert.ok(seen.size >= 4, `60 个种子应覆盖多数点数，实际 ${[...seen].join(',')}`);

  const seed = seedFor([5, 2, 6]);
  const a = rollDice(seed, 3);
  const b = rollDice(seed, 3);
  assert.deepEqual(a, [5, 2, 6]);
  assert.deepEqual(b, a, '同种子必须出同序列');
});

/* ── 3. 出子 ────────────────────────────────────────────── */

test('3. 任意点数都能出子：基地 → 起点格（progress -1 → 0）', () => {
  for (let d = 1; d <= 6; d++) {
    const g = gameWith(null, d);
    g.submit('p1', 'roll');
    const s = g.state();
    const dep = s.moves.filter((m) => m.deploy);
    assert.equal(dep.length, PIECES, `${d} 点应能让 4 个子全部出子`);
    assert.equal(dep[0].to, 0);
    assert.equal(dep[0].ringIndex, COLORS[0].start);

    const r = g.submit('p1', 'move:0');
    assert.equal(r.ok, true);
    const after = g.state().players[0].pieces[0];
    assert.equal(after.home, false);
    assert.equal(after.progress, 0);
    assert.equal(ringIndexAt(0, 0), COLORS[0].start);
  }
});

/* ── 4. 前进 ────────────────────────────────────────────── */

test('4. 走子步数 = 骰点', () => {
  for (let d = 1; d <= 6; d++) {
    const g = gameWith({ p1: [3, HOME, HOME, HOME] }, d);
    g.submit('p1', 'roll');
    const mv = g.state().moves.find((m) => m.piece === 0);
    assert.ok(mv, `${d} 点应能走 progress 3 的子`);
    assert.equal(mv.to, 3 + d);
    assert.equal(g.submit('p1', 'move:0').ok, true);
    assert.equal(g.state().players[0].pieces[0].progress, 3 + d);
  }
});

/* ── 5. 撞子 ────────────────────────────────────────────── */

test('5. 踩到非安全格上的异色子，把它撞回基地', () => {
  // 红 3 号格在环 15；蓝在环 18（progress 45）；红掷 3 正好落到 18
  const cell = 18;
  assert.equal(isSafeCell(cell), false);
  const g = gameWith({ p1: [3, HOME, HOME, HOME], p2: [45, HOME, HOME, HOME] }, 3);
  g.submit('p1', 'roll');
  const s = g.state();
  const mv = s.moves.find((m) => m.piece === 0);
  assert.ok(mv);
  assert.equal(mv.capture.length, 1);
  assert.deepEqual(mv.capture[0], { player: 1, piece: 0 });

  assert.equal(g.submit('p1', 'move:0').ok, true);
  const blue = g.state().players[1].pieces[0];
  assert.equal(blue.home, true, '被踩的子必须回基地');
  assert.equal(blue.progress, HOME);
  assert.equal(g.state().players[0].pieces[0].progress, 6);
});

/* ── 6. 安全格 ──────────────────────────────────────────── */

test('6. 安全格不撞：异色占住安全格时该走法非法；空格安全格可站', () => {
  assert.deepEqual(SAFE_CELLS, [7, 12, 20, 25, 33, 38, 46, 51]);
  assert.equal(isSafeCell(20), true);
  // 红 progress 5 = 环 17，掷 3 落到环 20（安全格），蓝在 20 上（progress 47）
  const g = gameWith({ p1: [5, HOME, HOME, HOME], p2: [47, HOME, HOME, HOME] }, 3);
  g.submit('p1', 'roll');
  const s = g.state();
  assert.equal(s.moves.find((m) => m.piece === 0), undefined, '安全格被异色占据应封路');
  assert.equal(g.submit('p1', 'move:0').ok, false);
  assert.equal(g.state().players[1].pieces[0].progress, 47, '蓝子不应被撞');

  // 同一落点没人时：可以站上去，且标记为安全
  const g2 = gameWith({ p1: [5, HOME, HOME, HOME] }, 3);
  g2.submit('p1', 'roll');
  const mv = g2.state().moves.find((m) => m.piece === 0);
  assert.ok(mv);
  assert.equal(mv.safe, true);
  assert.equal(mv.capture.length, 0);
  assert.equal(g2.submit('p1', 'move:0').ok, true);
});

/* ── 7. 叠子 ────────────────────────────────────────────── */

test('7. 同色可叠同一格；异色永不共格（安全格亦然）', () => {
  // 红 0 号在 progress 3，红 1 号在 0；掷 3：0 号走到 6，1 号走到 3（落在自己人原来的格，允许）
  const g = gameWith({ p1: [3, 0, HOME, HOME] }, 3);
  g.submit('p1', 'roll');
  const mv1 = g.state().moves.find((m) => m.piece === 1);
  assert.ok(mv1, '同色落点应允许叠子');
  assert.equal(mv1.capture.length, 0);
  assert.equal(g.submit('p1', 'move:1').ok, true);
  const s = g.state();
  assert.equal(s.players[0].pieces[0].progress, 3);
  assert.equal(s.players[0].pieces[1].progress, 3, '两子同格');

  // 环上同格里有异色子且非安全格 → 撞掉后独占，不会出现异色共格
  const g2 = gameWith({ p1: [3, HOME, HOME, HOME], p2: [45, HOME, HOME, HOME] }, 3);
  g2.submit('p1', 'roll');
  g2.submit('p1', 'move:0');
  const st = g2.state();
  const redCells = st.players[0].pieces.filter((p) => !p.home).map((p) => ringIndexAt(0, p.progress));
  const blueCells = st.players[1].pieces.filter((p) => !p.home).map((p) => ringIndexAt(1, p.progress));
  assert.equal(redCells.filter((c) => blueCells.includes(c)).length, 0, '异色不可共格');
});

/* ── 8. 终点跑道边界 ────────────────────────────────────── */

test('8. 终点跑道 6 格：不能越过终点，必须精确踩到 57', () => {
  const g6 = gameWith({ p1: [55, HOME, HOME, HOME] }, 6);
  g6.submit('p1', 'roll');
  assert.equal(g6.state().moves.find((m) => m.piece === 0), undefined, '55 + 6 越界应非法');
  assert.equal(g6.submit('p1', 'move:0').ok, false);

  const g2 = gameWith({ p1: [55, HOME, HOME, HOME] }, 2);
  g2.submit('p1', 'roll');
  const mv = g2.state().moves.find((m) => m.piece === 0);
  assert.ok(mv);
  assert.equal(mv.to, GOAL);
  assert.equal(mv.goal, true);
  assert.equal(g2.submit('p1', 'move:0').ok, true);
  assert.equal(g2.state().players[0].pieces[0].progress, GOAL);

  // 纯函数层再确认一次边界：RING+LANE-1 = 57，多一格就越界
  assert.equal(GOAL, RING + LANE - 1);
  const m = model([[0, 0, GOAL - 1], [0, 1, GOAL], [0, 2, GOAL], [0, 3, GOAL]]);
  assert.equal(legalMoves(m, 0, 1).length, 1);
  assert.equal(legalMoves(m, 0, 2).length, 0);
});

/* ── 9. 胜利 ────────────────────────────────────────────── */

test('9. 第 4 子到终点即胜，result() 带 winner/scores', () => {
  const g = gameWith({ p1: [55, GOAL, GOAL, GOAL] }, 2);
  g.submit('p1', 'roll');
  const r = g.submit('p1', 'move:0');
  assert.equal(r.ok, true);
  assert.equal(r.win, true);
  const s = g.state();
  assert.equal(s.winner, 'p1');
  assert.equal(s.phase, 'over');
  assert.equal(s.turn, null);
  assert.equal(s.players[0].pieces.filter((p) => p.progress === GOAL).length, 4);

  const res = g.result();
  assert.ok(res);
  assert.equal(res.over, true);
  assert.equal(res.winner, 'p1');
  assert.deepEqual(res.scores, { p1: 4, p2: 0 });
  assert.match(res.text, /红方/);

  // 终局后拒绝任何动作
  assert.equal(g.submit('p1', 'roll').ok, false);
  assert.equal(g.submit('p2', 'roll').ok, false);
});

/* ── 10. 6 点再掷 ───────────────────────────────────────── */

test('10. 掷出 6 走完后仍是本方回合且 extraRoll；非 6 换手', () => {
  const g6 = gameWith(null, 6);
  g6.submit('p1', 'roll');
  assert.equal(g6.state().dice, 6);
  assert.equal(g6.state().extraRoll, true);
  g6.submit('p1', 'move:0');
  let s = g6.state();
  assert.equal(s.turn, 'p1', '6 点不换人');
  assert.equal(s.phase, 'roll');
  assert.equal(s.dice, null);
  assert.equal(s.extraRoll, true);

  const g3 = gameWith(null, 3);
  g3.submit('p1', 'roll');
  g3.submit('p1', 'move:0');
  s = g3.state();
  assert.equal(s.turn, 'p2', '非 6 换人');
  assert.equal(s.extraRoll, false);
  assert.equal(s.phase, 'roll');
});

/* ── 11. skip ───────────────────────────────────────────── */

test('11. 无子可走时 skip 合法；有子可走时 skip 被拒', () => {
  // 4 子都在 55，掷 6 全部越界 → 只能 skip
  const g = gameWith({ p1: [55, 55, 55, 55] }, 6);
  g.submit('p1', 'roll');
  assert.deepEqual(g.state().moves, []);
  assert.equal(g.submit('p1', 'skip').ok, true);
  assert.equal(g.state().turn, 'p1', '6 点跳过也保留回合');
  assert.equal(g.state().phase, 'roll');

  const g2 = gameWith(null, 3);
  g2.submit('p1', 'roll');
  assert.ok(g2.state().moves.length > 0);
  const r = g2.submit('p1', 'skip');
  assert.equal(r.ok, false, '有子可走不许跳过');
});

/* ── 12. 越权与非法动作 ────────────────────────────────── */

test('12. 非回合方、非法动作、错误时机都被拒', () => {
  const g = createGame({ seed: 5, mode: 'ai' });
  assert.equal(g.submit('p2', 'roll').ok, false, '还没轮到 p2');
  assert.equal(g.submit('p3', 'roll').ok, false);
  assert.equal(g.submit('p1', 'move:0').ok, false, '没掷骰不能走子');
  assert.equal(g.submit('p1', 'skip').ok, false);
  assert.equal(g.submit('p1', 'teleport').ok, false);
  assert.equal(g.submit('p1', 'move:9').ok, false);

  g.submit('p1', 'roll');
  assert.equal(g.submit('p1', 'roll').ok, false, '掷过骰必须先走子');
});

/* ── 13. 状态序列化 ────────────────────────────────────── */

test('13. state() 可 JSON 序列化、每次是新对象、外部改动不影响内部', () => {
  const g = createGame({ seed: 9, mode: 'ai' });
  g.submit('p1', 'roll');
  const s1 = g.state();
  const json = JSON.stringify(s1);
  assert.ok(json.includes('"turn"'));
  assert.ok(json.includes('"dice"'));
  assert.ok(json.includes('"extraRoll"'));
  assert.deepEqual(JSON.parse(json), s1);

  s1.players[0].pieces[0].progress = 50;
  s1.players[0].pieces[0].home = false;
  s1.moves.push({ piece: 99 });
  assert.equal(g.state().players[0].pieces[0].home, true, '内部状态不被快照篡改');
  assert.ok(g.state().moves.every((m) => m.piece !== 99));
  assert.notEqual(g.state(), g.state(), '每次返回新对象');
  assert.equal(g.state().hud, '红 0/4 · 蓝 0/4');
});

/* ── 14. 重置 ──────────────────────────────────────────── */

test('14. reset() 回到开局（含 setup 注入的局面）', () => {
  const g = gameWith({ p1: [9, HOME, HOME, HOME] }, 3);
  g.submit('p1', 'roll');
  g.submit('p1', 'move:0');
  assert.notEqual(g.state().players[0].pieces[0].progress, 9);
  g.reset();
  const s = g.state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.dice, null);
  assert.equal(s.moveCount, 0);
  assert.equal(s.winner, null);
  assert.equal(s.players[0].pieces[0].progress, 9, 'reset 回到注入的起始局面');
  assert.equal(s.players[0].pieces[1].home, true);
  // 重置同时回到同种子的骰子序列起点：这一局的种子首掷就是 3
  assert.equal(g.submit('p1', 'roll').dice, 3);
});

/* ── 15. AI 动作合法 ───────────────────────────────────── */

test('15. AI 只返回合法动作，且不改动传入的 state', () => {
  const g = gameWith(null, 4);
  let s = g.state();
  const before = JSON.stringify(s);
  assert.equal(chooseMove(s, 'p1', 1), 'roll');
  assert.equal(chooseMove(s, 'p1', 3), 'roll');
  assert.equal(chooseMove(s, 'p2', 1), null, '不是本方回合应返回 null');
  assert.equal(JSON.stringify(s), before, 'chooseMove 不得改动 state');

  g.submit('p1', 'roll');
  s = g.state();
  const action = chooseMove(s, 'p1', 2);
  assert.match(action, /^move:\d$/);
  assert.ok(s.moves.some((m) => m.action === action), 'AI 的动作必须来自合法着法');
  assert.equal(g.submit('p1', action).ok, true);

  // 无子可走 → 'skip'
  const g2 = gameWith({ p1: [55, 55, 55, 55] }, 6);
  g2.submit('p1', 'roll');
  assert.equal(chooseMove(g2.state(), 'p1', 1), 'skip');
  assert.equal(g2.submit('p1', 'skip').ok, true);

  // 终局 → null
  const g3 = gameWith({ p1: [55, GOAL, GOAL, GOAL] }, 2);
  g3.submit('p1', 'roll');
  g3.submit('p1', 'move:0');
  assert.equal(chooseMove(g3.state(), 'p1', 1), null);
});

/* ── 16. AI 优先级 ─────────────────────────────────────── */

test('16. AI 贪心优先级：撞子 > 进终点 > 出子 > 前进最远', () => {
  const capture = { action: 'move:0', piece: 0, to: 8, deploy: false, goal: false, capture: [{ player: 1, piece: 0 }], safe: false };
  const goal = { action: 'move:1', piece: 1, to: GOAL, deploy: false, goal: true, capture: [], safe: false };
  const deploy = { action: 'move:2', piece: 2, to: 0, deploy: true, goal: false, capture: [], safe: true };
  const advance = { action: 'move:3', piece: 3, to: 12, deploy: false, goal: false, capture: [], safe: false };

  assert.equal(pickMove([advance, deploy, goal, capture], 1).action, 'move:0');
  assert.equal(pickMove([advance, deploy, goal], 1).action, 'move:1');
  assert.equal(pickMove([advance, deploy], 1).action, 'move:2');
  assert.equal(pickMove([advance], 1).action, 'move:3');

  const far = { ...advance, action: 'move:1', piece: 1, to: 40 };
  assert.equal(pickMove([advance, far], 1).action, 'move:1', '同档走最远');
  assert.ok(scoreMove(capture, 1) > scoreMove(goal, 1));
  assert.ok(scoreMove(goal, 1) > scoreMove(deploy, 1));
  assert.ok(scoreMove(deploy, 1) > scoreMove(advance, 1));
  assert.equal(pickMove([], 1), null);

  // 实战：撞子机会出现时 AI 一定选撞
  const g = gameWith({ p1: [3, HOME, HOME, HOME], p2: [45, HOME, HOME, HOME] }, 3);
  g.submit('p1', 'roll');
  assert.equal(chooseMove(g.state(), 'p1', 1), 'move:0');
});

/* ── 17. 完整对局 ───────────────────────────────────────── */

test('17. 双方 AI 完整跑完一局：必然分出胜负且 4 子都在终点', () => {
  const g = createGame({ seed: 7, mode: 'ai' });
  let guard = 0;
  while (!g.state().winner && guard < 4000) {
    guard += 1;
    const s = g.state();
    const action = chooseMove(s, s.turn, 2);
    assert.ok(action, `第 ${guard} 步 AI 应给出动作`);
    const r = g.submit(s.turn, action);
    assert.equal(r.ok, true, `第 ${guard} 步 ${action} 失败：${r.error}`);
  }
  const s = g.state();
  assert.ok(s.winner, `整局应在 ${guard} 步内结束`);
  const win = s.players.find((p) => p.id === s.winner);
  assert.equal(win.pieces.filter((p) => p.progress === GOAL).length, PIECES);
  assert.ok(g.result());
});

/* ── 18. 棋盘几何自洽 ──────────────────────────────────── */

test('18. 棋盘几何：环道 52 格闭合、起点 13 格等距、终点跑道与环衔接', () => {
  assert.equal(RING_PATH.length, RING);
  const keys = new Set(RING_PATH.map(([c, r]) => `${c},${r}`));
  assert.equal(keys.size, RING, '环道格子不能重复');

  // 相邻两格必定接触（切比雪夫距离 1）；内圈四个拐角是经典飞行棋的斜切（棋盘中心 3×3 的角格
  // 属于终点区，不在跑道上），所以正好出现 4 次斜步，且相隔 13 格。
  const diagonals = [];
  for (let i = 0; i < RING; i++) {
    const [c1, r1] = RING_PATH[i];
    const [c2, r2] = RING_PATH[(i + 1) % RING];
    const dc = Math.abs(c1 - c2);
    const dr = Math.abs(r1 - r2);
    assert.ok(dc <= 1 && dr <= 1 && dc + dr >= 1, `第 ${i} 格与下一格必须接触`);
    assert.ok(c1 >= 0 && c1 < 15 && r1 >= 0 && r1 < 15);
    if (dc + dr === 2) diagonals.push(i);
  }
  assert.deepEqual(diagonals, [4, 17, 30, 43], '只应有 4 个内圈拐角斜步，且相隔 13 格');

  assert.deepEqual(COLORS.map((c) => c.start), [12, 25, 38, 51]);
  for (let p = 0; p < 4; p++) {
    assert.equal(LANES[p].length, LANE);
    // 起点前一格必须挨着终点跑道入口
    const [bc, br] = ringCell(COLORS[p].start - 1);
    const [lc, lr] = LANES[p][0];
    assert.equal(Math.abs(bc - lc) + Math.abs(br - lr), 1, `色 ${p} 的跑道入口应与环相邻`);
    // 跑道要连续并接向中心
    for (let i = 1; i < LANE; i++) {
      const [pc, pr] = LANES[p][i - 1];
      const [cc, cr] = LANES[p][i];
      assert.equal(Math.abs(pc - cc) + Math.abs(pr - cr), 1);
    }
    const [ec, er] = LANES[p][LANE - 1];
    assert.equal(Math.abs(ec - 7) + Math.abs(er - 7), 1, '终点跑道最后一格应贴着中心');
  }

  // 安全格：8 个、互不重复、每色两格（起点 + 起点 +8）
  assert.equal(SAFE_CELLS.length, 8);
  assert.equal(new Set(SAFE_CELLS).size, 8);
});

/* ── 19. 单机模式的自动蓝方 ────────────────────────────── */

test('19. solo 模式：蓝方由逻辑自动走完自己的回合，回合必回 red', () => {
  const g = createGame({ seed: 11, mode: 'solo' });
  let guard = 0;
  while (!g.state().winner && guard < 400) {
    guard += 1;
    const s = g.state();
    if (s.phase === 'roll') {
      assert.equal(s.turn, 'p1', '自动蓝方走完后应回到 p1');
      assert.equal(g.submit('p1', 'roll').ok, true);
    } else if (s.moves.length) {
      assert.equal(s.turn, 'p1');
      assert.equal(g.submit('p1', s.moves[0].action).ok, true);
    } else {
      assert.equal(g.submit('p1', 'skip').ok, true);
    }
    assert.ok(['p1', null].includes(g.state().turn), '蓝方回合必须被自动消化');
  }
  assert.ok(guard < 400);
});

/* ── 20. 纯函数层：legalMoves / applyMoveTo 不改入参 ───── */

test('20. legalMoves / applyMoveTo 是纯函数', () => {
  const m = model([[0, 0, 3], [1, 0, 45]]);
  const snapshot = JSON.stringify(m);
  const moves = legalMoves(m, 0, 3);
  assert.equal(JSON.stringify(m), snapshot, 'legalMoves 不得改动模型');
  assert.equal(moves.length, PIECES);

  const next = applyMoveTo(m, 0, moves[0]);
  assert.equal(JSON.stringify(m), snapshot, 'applyMoveTo 不得改动模型');
  assert.equal(next[0][0].progress, 6);
  assert.equal(next[1][0].home, true, '被踩的子在新模型里回基地');
});
