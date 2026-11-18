/**
 * 渲染 / 输入冒烟测试：不启浏览器，用假 Canvas 2D 上下文与假 raw 输入，
 * 验证 render() 在各种 state（含将军/终局）下不抛异常、只读 state，
 * 以及 input 的两段式选子、AI 回合忽略、键盘光标与 Enter 的接线正确。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, pieceOf, KIND, COLS, RED, BLACK } from '../logic.mjs';
import { render, GEOM } from '../render.mjs';
import { createInput } from '../input.mjs';
import { cursor, selection } from '../cursor.mjs';

const { K, R } = KIND;
const sq = (r, c) => r * COLS + c;

function mockCtx() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return {
    canvas: { width: 480, height: 640 },
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, arc: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, clip: noop, setLineDash: noop,
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    fillText: noop, strokeText: noop, setTransform: noop, translate: noop, rotate: noop,
    scale: noop, measureText: () => ({ width: 10 }),
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
  };
}

test('render 在初始/选中/走子/被将/终局状态下都不抛异常', () => {
  const g = createGame({ seed: 5, mode: 'ai' });
  const ctx = mockCtx();
  const view = { w: 480, h: 640, dt: 0.016, time: 1.25, mode: 'ai' };
  const s0 = g.state();
  render(ctx, s0, view);
  selection.index = sq(6, 4);
  render(ctx, s0, view);
  selection.index = sq(6, 4);
  cursor.visible = true;
  render(ctx, s0, view);
  cursor.visible = false;
  selection.index = -1;
  g.submit(RED, `move:${sq(7, 1)},${sq(7, 4)}`);
  render(ctx, g.state(), view);

  const b = new Array(90).fill(0);
  b[sq(9, 3)] = pieceOf(RED, K);
  b[sq(0, 4)] = pieceOf(BLACK, K);
  b[sq(3, 0)] = pieceOf(RED, R);
  b[sq(1, 8)] = pieceOf(RED, R);
  const mate = createGame({ board: b });
  render(ctx, mate.state(), view);
  mate.submit(RED, `move:${sq(3, 0)},${sq(0, 0)}`);
  const over = mate.state();
  assert.equal(over.winner, RED);
  render(ctx, over, { ...view, time: 9.9 });
  assert.ok(GEOM.grid > 0 && GEOM.left > 0);
});

test('input：点击选子再点落点 → move:from,to；AI 回合忽略；键盘选中/取消', () => {
  const game = createGame({ seed: 6, mode: 'ai' });
  const submitted = [];
  const shell = {
    state: () => game.state(),
    submit: (action, player) => {
      submitted.push([action, player]);
      return game.submit(player, action);
    },
    toast: () => {},
  };
  const taps = [];
  const pressed = new Set();
  const raw = {
    justPressed: (a) => pressed.has(a),
    consumeTap: () => (taps.length ? taps.shift() : null),
    consumeSwipe: () => null,
    pointer: { x: 0, y: 0, down: false },
    bindButton: () => () => {},
  };
  const input = createInput({ raw, shell, mode: 'ai' });
  const px = (c) => GEOM.left + c * GEOM.grid;
  const py = (r) => GEOM.top + r * GEOM.grid;

  // 点空点：只提示，不提交
  taps.push({ x: px(0) + 3, y: py(0) + 3 });
  input.update(0.016);
  assert.equal(submitted.length, 0);
  assert.equal(selection.index, -1);

  // 点红兵 (6,4) 选中，再点 (5,4) 落子
  taps.push({ x: px(4), y: py(6) });
  input.update(0.016);
  assert.equal(selection.index, sq(6, 4));
  taps.push({ x: px(4), y: py(5) });
  input.update(0.016);
  assert.deepEqual(submitted, [[`move:${sq(6, 4)},${sq(5, 4)}`, 0]]);
  assert.equal(selection.index, -1);
  assert.equal(game.state().turn, BLACK);

  // AI 回合：点击不应提交（人机模式玩家恒为 p1）
  taps.push({ x: px(0), y: py(0) });
  input.update(0.016);
  assert.equal(submitted.length, 1);
  input.dispose();

  // 键盘：光标移动 + Enter 选中/取消（同屏双人，红方先）
  const g2 = createGame({ seed: 8, mode: 'local2p' });
  const sub2 = [];
  const shell2 = {
    state: () => g2.state(),
    submit: (action, player) => { sub2.push([action, player]); return g2.submit(player, action); },
    toast: () => {},
  };
  const input2 = createInput({ raw, shell: shell2, mode: 'local2p' });
  cursor.x = 3; cursor.y = 6; cursor.visible = false;
  pressed.add('right'); input2.update(0.016); pressed.clear();
  assert.equal(cursor.x, 4);
  assert.equal(cursor.visible, true);
  pressed.add('action'); input2.update(0.016); pressed.clear();
  assert.equal(selection.index, sq(6, 4), 'Enter 选中红兵');
  pressed.add('action'); input2.update(0.016); pressed.clear();
  assert.equal(selection.index, -1, '再按 Enter 取消选中');
  // 选中后按方向键再 Enter：不应提交非法着法
  pressed.add('action'); input2.update(0.016); pressed.clear();
  pressed.add('up'); input2.update(0.016); pressed.clear();
  pressed.add('action'); input2.update(0.016); pressed.clear();
  assert.equal(sub2.length, 1, '兵向前一步是合法着法，提交一次');
  assert.equal(sub2[0][0], `move:${sq(6, 4)},${sq(5, 4)}`);
  input2.dispose();
  assert.equal(selection.index, -1);
  assert.equal(cursor.visible, false);
});
