/**
 * 空当接龙 · 渲染 / 布局 / 输入 的离线冒烟测试（无浏览器、无 Canvas 实现）。
 * 用一个会记录调用的假 2D 上下文跑 render，验证：不抛异常、关键文案画得出来；
 * 再验证命中检测与输入映射真的把"点牌 → 点目标"翻译成 move 动作。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fullDeckTokens } from '../logic.mjs';
import { render } from '../render.mjs';
import { createInput } from '../input.mjs';
import {
  ui, hitTest, hitAsSource, hitAsDest, selectedRun,
  CARD_W, CARD_H, TABLEAU_Y, colX, fanY, VIEW_W, VIEW_H,
  FREE_RECTS, FOUNDATION_RECTS,
} from '../layout.mjs';

const ALL_TOKENS = fullDeckTokens();

/** 摆局面：未指定的牌补到已指定列底部，保证顶牌可控 */
function makeSetup({ columns = {}, freeCells = [], foundations = [] } = {}) {
  const used = new Set();
  const take = (tok) => {
    if (used.has(tok)) throw new Error(`重复牌 ${tok}`);
    used.add(tok);
    return tok;
  };
  const tableau = Array.from({ length: 8 }, (_, i) => (columns[i] || []).map(take));
  const fc = Array.from({ length: 4 }, (_, i) => (freeCells[i] == null ? null : take(freeCells[i])));
  const fnd = Array.from({ length: 4 }, (_, i) => (foundations[i] || []).map(take));
  const hosts = tableau.map((col, i) => i).filter((i) => tableau[i].length > 0);
  const leftover = ALL_TOKENS.filter((tok) => !used.has(tok));
  leftover.forEach((tok, k) => tableau[hosts[k % hosts.length]].unshift(tok));
  return { tableau, freeCells: fc, foundations: fnd };
}

/** 记录所有调用的假 CanvasRenderingContext2D */
function mockCtx() {
  const calls = [];
  const base = { calls, createLinearGradient: () => ({ addColorStop() {} }) };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push([String(prop), ...args]);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

const VIEW = { w: VIEW_W, h: VIEW_H, dt: 1 / 60, time: 0, meta: {}, mode: 'solo' };

test('render 冒烟：初始局面不抛异常且画出标题/分数/自由格', () => {
  const g = createGame({ seed: 3 });
  const ctx = mockCtx();
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
  assert.ok(texts.includes('空当接龙'), '标题');
  assert.ok(texts.some((t) => t.includes('回收 0/52')), '回收进度');
  assert.ok(texts.includes('自由'), '4 个空自由格标签');
  assert.equal(texts.filter((t) => t === '♠').length >= 1, true, '空基础堆花色槽');
});

test('render 冒烟：胜利局面画出通关横幅', () => {
  const fnd = (suit, to) => {
    const label = (r) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[r] || String(r));
    const out = [];
    for (let r = 1; r <= to; r++) out.push(suit + label(r));
    return out;
  };
  const g = createGame({
    seed: 1,
    setup: makeSetup({
      columns: { 0: ['CK'] },
      foundations: [fnd('S', 13), fnd('H', 13), fnd('D', 13), fnd('C', 12)],
    }),
  });
  assert.equal(g.submit('p1', 'move:t0,d3').ok, true);
  const ctx = mockCtx();
  assert.doesNotThrow(() => render(ctx, g.state(), VIEW));
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
  assert.ok(texts.some((t) => t.includes('通关')), '胜利横幅');
});

test('命中检测：槽位/牌列/列下空白都落在正确区域', () => {
  const g = createGame({ seed: 9 });
  const s = g.state();
  const freeHit = hitTest(FREE_RECTS[0].x + CARD_W / 2, FREE_RECTS[0].y + CARD_H / 2, s);
  assert.deepEqual(freeHit, { kind: 'free', i: 0 });
  const fHit = hitTest(FOUNDATION_RECTS[2].x + 4, FOUNDATION_RECTS[2].y + 4, s);
  assert.deepEqual(fHit, { kind: 'foundation', i: 2 });

  const col = s.tableau[3];
  const topY = fanY(col, col.length - 1);
  const topHit = hitTest(colX(3) + CARD_W / 2, topY + CARD_H / 2, s);
  assert.equal(topHit.kind, 'tableau');
  assert.equal(topHit.i, 3);
  assert.equal(topHit.index, col.length - 1, '点最上面的牌命中末张');
  const blankHit = hitTest(colX(3) + CARD_W / 2, TABLEAU_Y + 420, s);
  assert.equal(blankHit.index, col.length, '列下空白当作该列目标');

  assert.equal(hitAsSource(topHit, s), `t3:${col.length - 1}`);
  assert.equal(hitAsDest(blankHit), 't3');
  assert.equal(hitAsDest(fHit), 'd2');
});

test('selectedRun：合法序列整组高亮，断开的序列不高亮', () => {
  const g = createGame({ seed: 1, setup: makeSetup({ columns: { 0: ['H9', 'S8'], 1: ['H5', 'S6'] } }) });
  const s = g.state();
  const col0 = s.tableau[0];
  const run = selectedRun(s, `t0:${col0.length - 2}`);
  assert.equal(run.length, 2, 'H9-S8 是合法交替递减');
  assert.equal(run[0].h < CARD_H, true, '非末张只高亮露出的顶部一条');
  assert.equal(run[1].h, CARD_H);

  const col1 = s.tableau[1];
  assert.equal(selectedRun(s, `t1:${col1.length - 2}`).length, 0, 'H5-S6 不是递减序列');
});

test('input：点源 → 点目标发出 move；按钮发 auto/undo', () => {
  const g = createGame({ seed: 1, setup: makeSetup({ columns: { 0: ['S5'] } }) });
  const taps = [];
  const submitted = [];
  let pressed = null;
  const raw = {
    justPressed: (id) => id === pressed,
    consumeTap: () => taps.shift() ?? null,
  };
  const shell = {
    state: () => g.state(),
    submit: (action) => {
      submitted.push(action);
      return g.submit('p1', action);
    },
    toast: () => {},
  };
  const input = createInput({ raw, shell });

  const col0 = g.state().tableau[0];
  const idx = col0.length - 1;
  const topY = fanY(col0, idx);
  taps.push({ x: colX(0) + CARD_W / 2, y: topY + CARD_H / 2 });
  input.update();
  assert.equal(ui.selected, `t0:${idx}`, '点顶牌选中');

  taps.push({ x: colX(7) + CARD_W / 2, y: TABLEAU_Y + 20 });
  input.update();
  assert.deepEqual(submitted, [`move:t0:${idx},t7`]);
  assert.equal(ui.selected, null, '移动后清空选中');
  assert.deepEqual(
    g.state().tableau[7].map((c) => `${c.suit}${c.rank}`),
    ['S5'],
  );

  pressed = 'undo';
  input.update();
  assert.equal(submitted[1], 'undo');
  assert.equal(g.state().tableau[7].length, 0);

  pressed = 'auto';
  input.update();
  assert.equal(submitted[2], 'auto');
});
