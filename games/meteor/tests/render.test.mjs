/**
 * 渲染冒烟测试：用桩 ctx 跑真实的 render()，验证
 * 1) 不抛异常（画布 API 调用面没写错）；
 * 2) 严格只读 state（渲染前后 JSON 完全一致）。
 * 该测试不启动浏览器，也不依赖 DOM。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { render } from '../render.mjs';

function stubCtx() {
  const gradient = { addColorStop() {} };
  const noop = () => {};
  return {
    canvas: {},
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    shadowColor: 'transparent',
    shadowBlur: 0,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    strokeText: noop,
    setTransform: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
}

const VIEW = { w: 480, h: 640, dt: 1 / 60, time: 0, meta: {}, shell: null, mode: 'solo' };

test('R1 连续 90 帧渲染不抛异常，且不改传入的 state', () => {
  const g = createGame({ seed: 42 });
  const ctx = stubCtx();
  for (let i = 0; i < 90; i++) {
    g.step(1 / 60, i % 3 === 0 ? ['shoot', 'up'] : []);
    const s = g.state();
    const before = JSON.stringify(s);
    VIEW.time = i / 60;
    assert.doesNotThrow(() => render(ctx, s, VIEW));
    assert.equal(JSON.stringify(s), before, 'render 必须只读 state');
  }
});

test('R2 接缝副本 / 结束态 / 波次横幅三条分支都能画', () => {
  const g = createGame({ seed: 5 });
  const ctx = stubCtx();
  VIEW.time = 0.5;

  // 实体贴左上/右下边界，触发 forEachWrap 的对侧副本
  g.debugSet({
    ship: { x: 1, y: 1 },
    rocks: [{ x: 479, y: 639, size: 3, vx: 0, vy: 0 }],
    invuln: 0,
  });
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));

  // 波次横幅（waveTimer 在 1.4 s 内才画）
  g.debugSet({ over: false, waveTimer: 0.05 });
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));

  // 结束态
  g.debugSet({ over: true, lives: 0 });
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));
});
