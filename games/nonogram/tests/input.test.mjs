import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { createInput } from '../input.mjs';
import { getGeometry } from '../render.mjs';

/** 最小 raw 替身：只提供 input.mjs 用到的 pointer / consumeTap / justPressed */
function makeRaw() {
  return {
    pointer: { x: 0, y: 0, down: false, justDown: false, justUp: false },
    tap: null,
    consumeTap() {
      const t = this.tap;
      this.tap = null;
      return t;
    },
    justPressed() { return false; },
  };
}

function makeShell(game) {
  const actions = [];
  return {
    actions,
    state: () => game.state(),
    submit(action) {
      actions.push(action);
      return game.submit(0, action);
    },
  };
}

/** 模拟 shell 的一帧：input.update(dt) 之后 raw.endFrame() 会清掉 justDown/justUp */
function step(input, raw, dt) {
  input.update(dt);
  raw.pointer.justDown = false;
  raw.pointer.justUp = false;
}

function center(state, r, c) {
  const g = getGeometry(state);
  return { x: g.gridX + (c + 0.5) * g.cell, y: g.gridY + (r + 0.5) * g.cell };
}

function setup(seed = 41) {
  const game = createGame({ seed });
  const raw = makeRaw();
  const shell = makeShell(game);
  const input = createInput({ raw, shell });
  return { game, raw, shell, input };
}

test('I1. 短按点格 → toggle：坐标反算正确，落成填充', () => {
  const { game, raw, shell, input } = setup();
  const s = game.state();
  const i = s.solution.indexOf(1);
  const r = Math.floor(i / s.size);
  const c = i % s.size;
  const p = center(s, r, c);

  raw.pointer = { x: p.x, y: p.y, down: true, justDown: true, justUp: false };
  step(input, raw, 0.016);
  raw.pointer.down = false;
  raw.pointer.justUp = true;
  raw.tap = { x: p.x, y: p.y };
  step(input, raw, 0.016);

  assert.deepEqual(shell.actions, [`toggle:${r},${c}`]);
  assert.equal(game.state().cells[i], 1);
  assert.ok(input.actions.length === 0, '回合制没有持续动作');
});

test('I2. 长按 ≥400ms → mark，抬手不再 toggle', () => {
  const { game, raw, shell, input } = setup();
  const s = game.state();
  const i = s.solution.indexOf(1);
  const r = Math.floor(i / s.size);
  const c = i % s.size;
  const p = center(s, r, c);

  raw.pointer = { x: p.x, y: p.y, down: true, justDown: true, justUp: false };
  step(input, raw, 0.016);
  for (let t = 0; t < 0.45; t += 0.05) step(input, raw, 0.05);
  assert.deepEqual(shell.actions, [`mark:${r},${c}`], '越过 400ms 只提交一次 mark');
  assert.equal(game.state().cells[i], 2);

  // 抬手时 shared/input 仍可能给出 tap（<700ms），必须被 longFired 抑制
  raw.pointer.down = false;
  raw.pointer.justUp = true;
  raw.tap = { x: p.x, y: p.y };
  step(input, raw, 0.016);
  assert.deepEqual(shell.actions, [`mark:${r},${c}`], '长按抬手不应再 toggle');
  assert.equal(game.state().cells[i], 2);
});

test('I3. 按 300ms 后抬手 → 阈值内，按 tap 走 toggle', () => {
  const { game, raw, shell, input } = setup();
  const s = game.state();
  const i = s.solution.indexOf(1);
  const r = Math.floor(i / s.size);
  const c = i % s.size;
  const p = center(s, r, c);

  raw.pointer = { x: p.x, y: p.y, down: true, justDown: true, justUp: false };
  step(input, raw, 0.016);
  for (let t = 0; t < 0.3; t += 0.05) step(input, raw, 0.05);
  raw.pointer.down = false;
  raw.pointer.justUp = true;
  raw.tap = { x: p.x, y: p.y };
  step(input, raw, 0.016);

  assert.deepEqual(shell.actions, [`toggle:${r},${c}`]);
  assert.equal(game.state().cells[i], 1);
});

test('I4. 按 1 秒：mark 只发一次，抬手无额外动作', () => {
  const { game, raw, shell, input } = setup();
  const s = game.state();
  const p = center(s, 0, 0);

  raw.pointer = { x: p.x, y: p.y, down: true, justDown: true, justUp: false };
  step(input, raw, 0.016);
  for (let t = 0; t < 1.0; t += 0.05) step(input, raw, 0.05);
  raw.pointer.down = false;
  raw.pointer.justUp = true;
  step(input, raw, 0.016);

  assert.deepEqual(shell.actions, ['mark:0,0']);
  assert.equal(game.state().cells[0], 2);
});

test('I5. 点在线索区/网格外 → 不提交任何动作', () => {
  const { game, raw, shell, input } = setup();
  const s = game.state();
  const g = getGeometry(s);

  raw.pointer = { x: g.gridX - 10, y: g.gridY + 10, down: true, justDown: true, justUp: false };
  step(input, raw, 0.016);
  raw.pointer.down = false;
  raw.pointer.justUp = true;
  raw.tap = { x: g.gridX - 10, y: g.gridY + 10 };
  step(input, raw, 0.016);

  assert.deepEqual(shell.actions, []);
  assert.equal(game.state().cells.every((v) => v === 0), true);
});
