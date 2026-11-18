import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame, W, H, INTERVAL } from '../logic.mjs';
import { render } from '../render.mjs';
import { createInput } from '../input.mjs';

test('16 渲染冒烟：四种模式与结算态都不抛异常，且不改 state', () => {
  const gradient = { addColorStop() {} };
  const base = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  const drawn = [];
  const ctx = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => {
        drawn.push(String(k));
        return args;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  const view = { w: W, h: H, dt: INTERVAL, time: 1.5, meta: {}, mode: 'ai' };

  for (const mode of ['solo', 'ai', 'local2p', 'online']) {
    const g = createGame({ seed: 4, mode });
    g.submit('p1', 'up');
    g.step(INTERVAL);
    const st = g.state();
    const before = JSON.stringify(st);
    assert.doesNotThrow(() => render(ctx, st, { ...view, mode }), `${mode} 渲染不得抛错`);
    assert.equal(JSON.stringify(st), before, 'render 不得改 state');
  }

  const g = createGame({ seed: 5, mode: 'local2p' });
  const over = g.state();
  over.over = true;
  over.winner = 'p1';
  over.aliveCount = 1;
  assert.doesNotThrow(() => render(ctx, over, view));
  assert.ok(drawn.includes('fillText'), 'HUD/结算文字被绘制');
  assert.ok(drawn.includes('arc'), '食物/蛇头被绘制');
  assert.ok(drawn.includes('quadraticCurveTo'), '圆角蛇身被绘制');
  assert.ok(drawn.includes('fillRect'), '棋盘/遮罩被绘制');

  // 极端：空状态也不能抛
  assert.doesNotThrow(() => render(ctx, { snakes: [], foods: [], over: false }, view));
});

test('17 输入映射：单人全键控 p1、双人 WASD→P1/方向键→P2、滑动与虚拟键', () => {
  const prevWindow = globalThis.window;
  const listeners = {};
  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
  const fire = (type, code) => {
    for (const fn of listeners[type] || []) fn({ code, target: null, repeat: false, preventDefault() {} });
  };
  const calls = [];
  const makeShell = (game) => ({
    online: null,
    state: () => game.state(),
    submit(action, idx = 0) {
      calls.push(`${idx}:${action}`);
    },
  });
  const makeRaw = () => ({
    vbtn: {},
    justPressed: () => false,
    consumeSwipe: () => null,
  });

  try {
    const game = createGame({ seed: 1, mode: 'solo' });
    const raw = makeRaw();
    const input = createInput({ raw, shell: makeShell(game), mode: 'solo' });

    fire('keydown', 'ArrowLeft');
    fire('keydown', 'KeyW');
    assert.deepEqual(calls, ['0:left', '0:up']);
    calls.length = 0;

    // 虚拟方向键：vbtn 与 justPressed 同时为真才算按下沿
    raw.vbtn.right = true;
    raw.justPressed = (a) => a === 'right';
    input.update(INTERVAL);
    assert.deepEqual(calls, ['0:right']);
    calls.length = 0;

    // 滑动
    raw.justPressed = () => false;
    raw.consumeSwipe = () => 'down';
    input.update(INTERVAL);
    assert.deepEqual(calls, ['0:down']);

    const before = (listeners.keydown || []).length;
    input.dispose();
    assert.equal((listeners.keydown || []).length, before - 1, 'dispose 摘掉键盘监听');

    // 双人同屏：WASD 控 P1、方向键控 P2
    calls.length = 0;
    const duo = createGame({ seed: 1, mode: 'local2p' });
    const in2 = createInput({ raw: makeRaw(), shell: makeShell(duo), mode: 'local2p' });
    fire('keydown', 'KeyA');
    fire('keydown', 'ArrowDown');
    assert.deepEqual(calls, ['0:left', '1:down']);
    in2.dispose();

    // 联机：只发动作词，座位由服务端定
    calls.length = 0;
    const net = createGame({ seed: 1, mode: 'online', players: ['p1', 'p2'] });
    const in3 = createInput({ raw: makeRaw(), shell: makeShell(net), mode: 'online' });
    fire('keydown', 'ArrowUp');
    assert.deepEqual(calls, ['0:up']);
    in3.dispose();
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('18 元数据与文件清单符合契约（id/尺寸/配色/模式/文件齐全）', () => {
  const meta = JSON.parse(readFileSync(new URL('../game.json', import.meta.url), 'utf8'));
  assert.equal(meta.id, 'snakebattle');
  assert.equal(meta.title, '贪吃蛇大作战');
  assert.equal(meta.subtitle, 'Snake Battle');
  assert.equal(meta.category, 'action');
  assert.deepEqual(meta.modes, ['solo', 'ai', 'local2p', 'online']);
  assert.deepEqual(meta.inputs, ['keys', 'swipe']);
  assert.deepEqual(meta.canvas, { w: 480, h: 640 });
  assert.equal(meta.accent, '#4ade80');
  assert.equal(meta.accent2, '#22d3ee');
  assert.equal(meta.turnBased, false);
  assert.equal(meta.online, true);
  assert.equal(meta.ai, true);
  assert.equal(meta.order, 28);
  assert.ok(meta.desc && meta.hint);

  const root = new URL('../', import.meta.url);
  for (const rel of ['game.json', 'index.html', 'logic.mjs', 'render.mjs', 'input.mjs', 'game.js', 'tests/logic.test.mjs']) {
    assert.ok(existsSync(fileURLToPath(new URL(rel, root))), `缺少 ${rel}`);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /贪吃蛇大作战/);
  assert.match(html, /shared\/theme\.css/);
  assert.match(html, /src="\.\/game\.js"/);
  const js = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
  assert.match(js, /createShell/);
  assert.match(js, /metaUrl: '\.\/game\.json'/);
});
