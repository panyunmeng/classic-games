import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { render } from '../render.mjs';

/**
 * 渲染冒烟测试：用只记账的假 ctx 跑一遍 render，抓「方法名拼错 / undefined 访问」
 * 这类只有到浏览器才会炸的问题。真实像素效果由主代理的三视口截图验收。
 */
function makeCtx() {
  const gradient = { addColorStop() {} };
  const texts = [];
  let ops = 0;
  const noop = () => { ops++; };

  const ctx = {
    texts,
    get ops() {
      return ops;
    },
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clip: noop,
    setLineDash: noop,
    translate: noop,
    rotate: noop,
    fillText(text) {
      texts.push(String(text));
      ops++;
    },
    measureText() {
      return { width: 10 };
    },
    createLinearGradient() {
      return gradient;
    },
    createRadialGradient() {
      return gradient;
    },
    // 下列属性由 render 直接赋值，普通对象即可承接
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  return ctx;
}

const view = { w: 480, h: 640, dt: 1 / 60, time: 1.234, meta: {}, mode: 'local2p' };

function draw(state) {
  const ctx = makeCtx();
  render(ctx, state, { ...view, mode: state.mode });
  return ctx;
}

test('渲染：开局 / 走子 / 踩蛇 / 踩梯 / 胜局 / 1～4 人都能画完不抛错', () => {
  const cases = [];

  cases.push(createGame({ seed: 11, mode: 'solo' }).state());
  cases.push(createGame({ seed: 11, mode: 'ai' }).state());

  const local = createGame({ seed: 12, mode: 'local2p', rolls: [5, 1, 4] });
  cases.push(local.state());
  for (let i = 0; i < 3; i++) local.submit(local.state().turn, 'roll');
  cases.push(local.state()); // 含梯子/蛇之后的多手局面

  const four = createGame({
    seed: 13,
    mode: 'local2p',
    players: ['p1', 'p2', 'p3', 'p4'],
    rolls: [1, 2, 3, 4],
  });
  for (let i = 0; i < 3; i++) four.submit(four.state().turn, 'roll');
  cases.push(four.state());

  const solo = createGame({ seed: 14, players: ['p1'], rolls: [...Array(11).fill(6), 3, 6] });
  for (let i = 0; i < 13; i++) solo.submit('p1', 'roll');
  cases.push(solo.state()); // winner + turn null

  for (const s of cases) {
    const ctx = draw(s);
    assert.ok(ctx.ops > 200, `渲染调用次数过少（${ctx.ops}），可能有分支没跑到`);
    assert.ok(ctx.texts.some((t) => t === String(s.players[0].pos) || t.length > 0), '应画出文字');
  }
});

test('渲染：只读 state，不改传进去的快照', () => {
  const g = createGame({ seed: 21, mode: 'local2p', rolls: [6, 2] });
  g.submit('p1', 'roll'); // 6 → 梯 31
  const s = g.state();
  const before = JSON.stringify(s);
  draw(s);
  assert.equal(JSON.stringify(s), before, 'render 不得改动 state');
});