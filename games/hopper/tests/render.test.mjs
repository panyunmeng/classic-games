import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { render } from '../render.mjs';

/** 无 DOM 的 Canvas2D 桩：所有未声明的方法都当空操作，渐变对象只实现 addColorStop。 */
function mockCtx() {
  const gradient = { addColorStop() {} };
  const base = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 12 }),
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

const VIEW = { w: 480, h: 640, dt: 1 / 60, time: 3.5, meta: {}, shell: null, mode: 'solo' };

test('render：初始状态整帧绘制不抛异常', () => {
  const g = createGame({ seed: 1 });
  const ctx = mockCtx();
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));
});

test('render：行进中 + 洞位占满 + solved 三种状态都能绘制', () => {
  const g = createGame({ seed: 2 });
  for (let i = 0; i < 120; i++) g.step(1 / 60);
  g.submit('p1', 'move:up');
  const ctx = mockCtx();
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));

  const s = g.state();
  s.holes[0].occupied = true;
  s.holes[2].occupied = true;
  s.solved = true;
  s.player = { x: 4.5, y: 9 };
  assert.doesNotThrow(() => render(ctx, s, { ...VIEW, time: 7.25 }));
});
