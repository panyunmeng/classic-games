import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
import { render, getGeometry, cellAt } from '../render.mjs';

/** 记录调用与文字的假 2D 上下文：足以跑完 render 的全部绘制分支 */
function makeCtx() {
  const calls = [];
  const texts = [];
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: { width: 480, height: 640 },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
    fill() {}, stroke() {}, fillRect() { calls.push(['fillRect']); }, strokeRect() {}, clearRect() {},
    fillText(text, x, y) {
      texts.push({ text, x, y, fillStyle: ctx.fillStyle, font: ctx.font });
    },
    measureText(text) { return { width: String(text).length * 8 }; },
    createLinearGradient() { return grad; },
    setLineDash() {},
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '12px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    shadowColor: '', shadowBlur: 0, lineCap: 'butt',
  };
  return { ctx, texts, calls };
}

function fakeState(overrides = {}) {
  const size = 5;
  return {
    size,
    seed: 1,
    turn: 'p1',
    mode: 'solo',
    solution: new Array(size * size).fill(0),
    cells: new Array(size * size).fill(0),
    rowClues: Array.from({ length: size }, () => [0]),
    colClues: Array.from({ length: size }, () => [0]),
    mistakes: 0,
    conflicts: [],
    solved: false,
    hintsLeft: 3,
    hintsTotal: 3,
    focus: null,
    progress: { filled: 0, total: 0 },
    canUndo: false,
    undoDepth: 0,
    hud: '',
    level: '初级',
    ...overrides,
  };
}

test('R1. 几何：网格与线索区都落在 480×640 内，任何支持尺寸都不重叠', () => {
  const g = getGeometry(fakeState({ size: 10 }));
  assert.equal(g.size, 10);
  assert.equal(g.cell, 34);
  assert.ok(g.gridX >= g.clueL, '网格右侧要给行线索留位');
  assert.ok(g.gridX + g.gridW <= 480, '网格不能超出画布右边界');
  assert.ok(g.gridY >= g.clueT, '网格上方要给列线索留位');
  assert.ok(g.gridY + g.gridH <= 640, '网格不能超出画布下边界');
  assert.ok(g.gridX >= g.x0 + g.clueL, '行线索区宽度与 gridX 一致');

  const small = getGeometry(fakeState({ size: 5 }));
  assert.equal(small.cell, 44);
  assert.ok(small.gridX + small.gridW <= 480);

  // 列线索最多 ⌈size/2⌉ 段，段间 1 格空白；任何尺寸都要能塞进 clueT 预留高度
  for (const size of [5, 6, 7, 8, 9, 10, 11, 12]) {
    const geo = getGeometry(fakeState({ size }));
    const lineH = Math.max(12, Math.min(17, Math.round(geo.cell * 0.48)));
    assert.ok(
      Math.ceil(size / 2) * lineH + 8 <= geo.clueT,
      `size=${size} 的列线索高度应放得下（clueT=${geo.clueT}）`,
    );
    assert.ok(geo.gridX > geo.x0 && geo.gridY > 92, `size=${size} 网格应在线索区右下`);
    assert.ok(geo.gridX + geo.gridW <= geo.x0 + geo.clueL + geo.gridW);
  }
});

test('R2. 命中测试：格子中心映射回原格，网格外/线索区返回 null', () => {
  const s = fakeState({ size: 10 });
  const g = getGeometry(s);
  for (const [r, c] of [[0, 0], [3, 4], [9, 9], [7, 2]]) {
    const px = g.gridX + (c + 0.5) * g.cell;
    const py = g.gridY + (r + 0.5) * g.cell;
    assert.deepEqual(cellAt(s, px, py), { r, c });
  }
  assert.equal(cellAt(s, g.gridX - 1, g.gridY + 5), null, '行线索区不响应点击');
  assert.equal(cellAt(s, g.gridX + 5, g.gridY - 1), null, '列线索区不响应点击');
  assert.equal(cellAt(s, g.gridX + g.gridW, g.gridY + 5), null);
  assert.equal(cellAt(s, g.gridX + 5, g.gridY + g.gridH), null);
  assert.equal(cellAt(s, NaN, 10), null);
});

test('R3. render 跑通全部视觉分支且不修改 state', () => {
  const g = createGame({ seed: 31 });
  // 造一个同时含填充、X、矛盾、焦点、已满足行的局面
  const s = g.state();
  const target = s.solution.indexOf(1);
  g.submit('p1', `toggle:${Math.floor(target / s.size)},${target % s.size}`);
  const wrong = s.solution.indexOf(0);
  g.submit('p1', `toggle:${Math.floor(wrong / s.size)},${wrong % s.size}`);
  const mark = s.solution.indexOf(0, wrong + 1);
  g.submit('p1', `mark:${Math.floor(mark / s.size)},${mark % s.size}`);
  g.submit('p1', 'hint');
  const live = g.state();
  const before = JSON.stringify(live);

  const { ctx, texts } = makeCtx();
  assert.doesNotThrow(() => render(ctx, live, { w: 480, h: 640, dt: 16, time: 1000 }));
  assert.equal(JSON.stringify(live), before, 'render 必须只读 state');
  assert.ok(texts.some((t) => String(t.text).includes('数织')), '标题应被绘制');
  assert.ok(texts.some((t) => String(t.text).includes('提示')), '页脚/头部应绘制提示信息');
});

test('R4. 已满足的行线索变暗，未满足的保持亮色', () => {
  const size = 5;
  const cells = new Array(size * size).fill(0);
  const rowClues = Array.from({ length: size }, () => [0]);
  // 第 0 行填成 3 连 + 1 段，与线索 [3,1] 完全一致 → 该行满足
  cells[0] = 1; cells[1] = 1; cells[2] = 1; cells[4] = 1;
  rowClues[0] = [3, 1];
  // 第 1 行只填了一半 → 未满足
  cells[5] = 1;
  rowClues[1] = [2];
  const state = fakeState({ size, cells, rowClues });

  const { ctx, texts } = makeCtx();
  render(ctx, state, { w: 480, h: 640, dt: 16, time: 0 });

  // 取每行的标记文字（数字），按 y 归行：第 0 行与第 1 行的线索文字颜色应不同
  const g = getGeometry(state);
  const clueTexts = texts.filter((t) => /^\d+$/.test(String(t.text)));
  const row0 = clueTexts.filter((t) => Math.abs(t.y - (g.gridY + 0.5 * g.cell)) < 2);
  const row1 = clueTexts.filter((t) => Math.abs(t.y - (g.gridY + 1.5 * g.cell)) < 2);
  assert.ok(row0.length >= 2 && row1.length >= 1, '两行都应有线索数字');
  const dim = row0.every((t) => String(t.fillStyle).includes('0.28'));
  const bright = row1.every((t) => String(t.fillStyle).toLowerCase() === '#e2fdf8');
  assert.equal(dim, true, '满足的 3,1 线索应变暗');
  assert.equal(bright, true, '未满足的线索应保持亮色');
});
