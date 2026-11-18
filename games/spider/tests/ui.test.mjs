import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { render } from '../render.mjs';
import { createInput } from '../input.mjs';
import { ui, colX, cardYs, STOCK_RECT } from '../layout.mjs';

/** 无 DOM 的 Canvas 2D 打桩：任何非有限坐标都抛错，用来兜住布局算错 */
function makeCtx() {
  const gradient = { addColorStop() {} };
  const texts = [];
  const finite = (...args) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`非有限坐标: ${args.join(',')}`);
    }
  };
  const ctx = {
    createLinearGradient: (...a) => {
      finite(...a);
      return gradient;
    },
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo: (...a) => finite(...a),
    lineTo: (...a) => finite(...a),
    quadraticCurveTo: (...a) => finite(...a),
    fill() {},
    stroke() {},
    clip() {},
    fillRect: (...a) => finite(...a),
    fillText: (t, x, y) => {
      finite(x, y);
      texts.push(String(t));
    },
    setLineDash() {},
    translate() {},
    rotate() {},
    arc() {},
    clearRect() {},
  };
  return { ctx, texts };
}

function emptyTableau(fill = []) {
  return Array.from({ length: 10 }, (_, i) => fill[i] || []);
}

test('render：初始 / 发牌后 / 选中 / 通关四种局面均可绘制，坐标全部有限', () => {
  const states = [];
  const g = createGame({ seed: 2 });
  states.push(g.state());
  for (let i = 0; i < 5; i++) g.submit('p1', 'stock');
  states.push(g.state());

  const tableau = emptyTableau();
  for (let i = 0; i < 8; i++) {
    for (let rank = 13; rank >= 1; rank--) {
      tableau[i].push({ suit: i % 2 ? 'H' : 'S', rank, faceUp: true });
    }
  }
  const wg = createGame({ tableau, stock: [] });
  states.push(wg.state());
  assert.equal(wg.state().won, true);

  for (const state of states) {
    ui.selected = state.won ? null : { col: 0, index: Math.max(0, state.tableau[0].length - 1) };
    const { ctx, texts } = makeCtx();
    render(ctx, state, { w: 480, h: 640 });
    assert.ok(texts.some((t) => t.startsWith('得分')), '应画出得分信息');
  }
  ui.selected = null;
});

test('input：点牌选源 → 点目标列发出 move:src,dst,n，点空白取消', () => {
  const game = createGame({
    tableau: emptyTableau([
      [
        { suit: 'S', rank: 12, faceUp: true },
        { suit: 'S', rank: 11, faceUp: true },
      ],
      [{ suit: 'H', rank: 13, faceUp: true }],
      [{ suit: 'H', rank: 5, faceUp: false }],
    ]),
    stock: [],
  });
  const submitted = [];
  const shell = {
    state: () => game.state(),
    submit: (a) => {
      submitted.push(a);
      return game.submit('p1', a);
    },
  };
  const taps = [];
  const raw = {
    justPressed: () => false,
    consumeTap: () => (taps.length ? taps.pop() : null),
  };
  const input = createInput({ raw, shell, mode: 'solo' });

  const s = game.state();
  // 点列 0 的 ♠Q（选中，整段 ♠Q♠J）
  taps.push({ x: colX(0) + 12, y: cardYs(s.tableau[0])[0] + 6 });
  input.update();
  assert.deepEqual(ui.selected, { col: 0, index: 0 });

  // 点列 1 的 ♥K → 整段搬到列 1
  taps.push({ x: colX(1) + 12, y: cardYs(s.tableau[1])[0] + 6 });
  input.update();
  assert.equal(submitted[0], 'move:t0,t1,2');
  assert.equal(ui.selected, null);
  assert.deepEqual(
    game.state().tableau[1].map((c) => `${c.suit}${c.rank}`),
    ['H13', 'S12', 'S11'],
  );

  // 点暗牌不能选源
  const s2 = game.state();
  taps.push({ x: colX(2) + 12, y: cardYs(s2.tableau[2])[0] + 6 });
  input.update();
  assert.equal(ui.selected, null);

  // 点发牌堆 → 发一轮
  taps.push({ x: STOCK_RECT.x + 10, y: STOCK_RECT.y + 10 });
  input.update();
  assert.equal(submitted[submitted.length - 1], 'stock');
});

test('input：发牌 / 撤销按钮（raw.justPressed）与键盘 action 都能驱动逻辑', () => {
  const game = createGame({ seed: 13 });
  const submitted = [];
  const shell = {
    state: () => game.state(),
    submit: (a) => {
      submitted.push(a);
      return game.submit('p1', a);
    },
  };
  let pressed = null;
  const raw = {
    justPressed: (id) => id === pressed,
    consumeTap: () => null,
  };
  const input = createInput({ raw, shell, mode: 'solo' });

  pressed = 'deal';
  input.update();
  assert.equal(submitted[0], 'stock');
  assert.equal(game.state().stock, 4);

  pressed = 'undo';
  input.update();
  assert.equal(submitted[1], 'undo');
  assert.equal(game.state().stock, 5);

  pressed = 'action';
  input.update();
  assert.equal(submitted[2], 'stock');
  assert.equal(game.state().stock, 4);
});
