import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame } from '../logic.mjs';
import { render } from '../render.mjs';

/** 零依赖 Canvas 2D 替身：只记录调用，不实际绘图 */
function fakeCtx() {
  const calls = { fill: 0, stroke: 0, fillText: 0, fillRect: 0, arc: 0 };
  const gradient = () => ({ addColorStop() {} });
  return {
    calls,
    canvas: { width: 480, height: 640 },
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {
      calls.arc += 1;
    },
    ellipse() {},
    rect() {},
    fill() {
      calls.fill += 1;
    },
    stroke() {
      calls.stroke += 1;
    },
    clip() {},
    fillRect() {
      calls.fillRect += 1;
    },
    strokeRect() {},
    clearRect() {},
    fillText() {
      calls.fillText += 1;
    },
    strokeText() {},
    translate() {},
    scale() {},
    rotate() {},
    setTransform() {},
    transform() {},
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern() {
      return null;
    },
    measureText() {
      return { width: 40 };
    },
    setLineDash() {},
  };
}

function draw(g) {
  const ctx = fakeCtx();
  render(ctx, g.state(), { w: 480, h: 640, dt: 1 / 60, time: 1.234, meta: {}, mode: 'solo' });
  return ctx.calls;
}

test('game.json 元数据符合契约：id / 标题 / 画布 / 配色 / 按钮 / 顺序', () => {
  const meta = JSON.parse(readFileSync(new URL('../game.json', import.meta.url), 'utf8'));
  assert.equal(meta.id, 'bomber');
  assert.equal(meta.title, '爆破迷宫');
  assert.equal(meta.subtitle, 'Blast Maze');
  assert.equal(meta.category, 'action');
  assert.deepEqual(meta.modes, ['solo']);
  assert.deepEqual(meta.inputs, ['keys', 'swipe']);
  assert.deepEqual(meta.buttons, [{ id: 'bomb', label: '炸弹' }]);
  assert.deepEqual(meta.canvas, { w: 480, h: 640 });
  assert.equal(meta.accent, '#f59e0b');
  assert.equal(meta.accent2, '#fbbf24');
  assert.equal(meta.turnBased, false);
  assert.equal(meta.order, 31);
  assert.equal(typeof meta.desc, 'string');
  assert.ok(meta.desc.length > 0);
  assert.equal(typeof meta.hint, 'string');
  assert.equal(meta.audio, true);
});

test('render 开始态：未开局提示可绘制', () => {
  const g = createGame({ seed: 42 });
  const calls = draw(g);
  assert.ok(calls.fill > 20);
  assert.ok(calls.fillText > 5);
});

test('render 对局态：炸弹、火焰、道具、敌人、无敌状态都不报错', () => {
  const g = createGame({ seed: 42 });
  g.debugSetPlayer({ x: 1, y: 1, invuln: 1.2 });
  g.debugSpawnItem(2, 1, 'power');
  g.debugSpawnItem(2, 1, 'speed');
  g.debugSpawnItem(2, 1, 'bomb');
  g.debugSetEnemies([{ x: 6, y: 5, interval: 99, timer: 99 }]);
  g.debugPlaceBomb({ x: 5, y: 5, timer: 0.2, power: 3 });
  for (let i = 0; i < 20; i++) g.step(1 / 60, []);
  const s = g.state();
  assert.ok(s.bombs.length > 0 || s.flames.length > 0);
  const calls = draw(g);
  assert.ok(calls.fill > 20);
  assert.ok(calls.arc > 0);
  assert.ok(calls.fillText > 5);
});

test('render 过关与结束态：结算覆盖层可绘制', () => {
  const solved = createGame({ seed: 42 });
  solved.debugSetEnemies([{ x: 6, y: 5, interval: 99, timer: 99 }]);
  solved.debugSetPlayer({ x: 1, y: 1 });
  solved.debugSetCell(6, 6, ' ');
  solved.debugSetCell(6, 7, ' ');
  solved.debugPlaceBomb({ x: 6, y: 7, timer: 0.05, power: 3 });
  for (let i = 0; i < 30; i++) solved.step(1 / 60, []);
  assert.equal(solved.state().solved, true);
  draw(solved);

  const over = createGame({ seed: 42 });
  over.debugSetEnemies([{ x: 11, y: 9, interval: 99, timer: 99 }]);
  over.debugHurt();
  over.debugHurt();
  over.debugHurt();
  const s = over.state();
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);
  const calls = draw(over);
  assert.ok(calls.fillText > 0);
});
