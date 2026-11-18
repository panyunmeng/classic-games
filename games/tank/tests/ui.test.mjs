/**
 * 坦克战场 · 渲染 / 输入冒烟测试（假 Canvas，不启浏览器）。
 *
 * 目的：node --check 只能证明语法，证明不了 render.mjs 在真实 state 上不会调用
 * 不存在的字段或方法、input.mjs 的键位映射是否把空格映射成 'shoot'。
 * 这里用 Proxy 造一个「什么方法都有」的 2D 上下文，把 render 的完整绘制链跑一遍；
 * 再用假的 raw/shell 驱动 input，核对 actions 与 submit 词表。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { render } from '../render.mjs';
import { createInput } from '../input.mjs';

function makeCtx() {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        if (prop === 'measureText') return () => ({ width: 12 });
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

const VIEW = { w: 480, h: 640, dt: 1 / 60, time: 1.25 };

function makeWindow() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = handlers.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    fire(type, ev) {
      for (const fn of handlers.get(type) || []) fn(ev);
    },
  };
}

function makeRaw() {
  return {
    vbtn: {},
    down: new Set(),
    pressed: new Set(),
    swipe: null,
    isDown(a) {
      return this.down.has(a);
    },
    justPressed(a) {
      return this.pressed.has(a);
    },
    consumeSwipe() {
      const s = this.swipe;
      this.swipe = null;
      return s;
    },
  };
}

function keyEvent(code) {
  return { code, repeat: false, target: { tagName: 'DIV' }, preventDefault() {} };
}

test('render 在初始 / 交火 / 过关三种 state 上都能完整绘制', () => {
  const ctx = makeCtx();
  const g = createGame({ seed: 5 });

  render(ctx, g.state(), VIEW);

  g.submit(0, 'shoot');
  for (let i = 0; i < 30; i++) g.step(1 / 60, ['up']);
  const mid = g.state();
  assert.ok(mid.bullets.length + mid.effects.length > 0 || mid.enemies.length > 0);
  render(ctx, mid, { ...VIEW, time: 2.5 });

  g.debugClearEnemies();
  g.step(1 / 60, []);
  const over = g.state();
  assert.equal(over.over, true);
  assert.equal(over.solved, true);
  render(ctx, over, { ...VIEW, time: 3.5 });
});

test('input 单人：按住方向进 actions，空格 / 开火键都发 shoot', () => {
  global.window = makeWindow();
  const submits = [];
  const shell = { submit: (a) => submits.push(a), online: null };
  const raw = makeRaw();
  raw.down.add('left');

  const input = createInput({ raw, shell, mode: 'solo' });
  input.update(1 / 60);
  assert.deepEqual(input.actions, ['left']);

  raw.pressed.add('action'); // 空格 = KEYMAP action
  input.update(1 / 60);
  assert.deepEqual(submits, ['shoot']);

  raw.pressed.clear();
  raw.pressed.add('shoot'); // 屏幕「开火」按钮
  input.update(1 / 60);
  assert.deepEqual(submits, ['shoot', 'shoot']);

  raw.pressed.clear();
  raw.swipe = 'up';
  input.update(1 / 60);
  assert.deepEqual(submits, ['shoot', 'shoot', 'up']);
  input.dispose();
});

test('input 本地双人：p1 WASD+空格、p2 方向键+回车 各自归位', () => {
  const win = makeWindow();
  global.window = win;
  const submits = [];
  const shell = { submit: (a) => submits.push(a), online: null };
  const raw = makeRaw();
  const input = createInput({ raw, shell, mode: 'local2p' });

  win.fire('keydown', keyEvent('KeyW'));
  win.fire('keydown', keyEvent('ArrowLeft'));
  input.update(1 / 60);
  assert.deepEqual(input.actions, ['p1up', 'p2left']);

  win.fire('keydown', keyEvent('Space'));
  input.update(1 / 60);
  assert.deepEqual(submits, ['p1shoot']);

  win.fire('keydown', keyEvent('Enter'));
  input.update(1 / 60);
  assert.deepEqual(submits, ['p1shoot', 'p2shoot']);

  win.fire('keyup', keyEvent('KeyW'));
  win.fire('keyup', keyEvent('ArrowLeft'));
  input.update(1 / 60);
  assert.deepEqual(input.actions, []);

  input.dispose();
  assert.equal(win.handlers.get('keydown').length, 0);
});

test('input 联机：持续方向按节奏发裸词，开火发 shoot，不拼座位前缀', () => {
  global.window = makeWindow();
  const submits = [];
  const shell = { submit: (a) => submits.push(a), online: { seat: 'p2' } };
  const raw = makeRaw();
  raw.down.add('down');
  const input = createInput({ raw, shell, mode: 'online' });

  input.update(1 / 60);
  assert.deepEqual(submits, ['down']);
  input.update(1 / 60); // 30 Hz 节流内不重发
  assert.deepEqual(submits, ['down']);
  input.update(1 / 30);
  assert.deepEqual(submits, ['down', 'down']);

  raw.pressed.add('action');
  input.update(1 / 60);
  assert.equal(submits[submits.length - 1], 'shoot');
  input.dispose();
});
