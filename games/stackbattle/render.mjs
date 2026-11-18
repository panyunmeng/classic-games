/**
 * 方块对战 · 渲染。只读 state，不改状态。
 *
 * 画面事实与推导：
 * 1. 竖屏 480×640 里要并排放两个 10×20 的场：格子取 22px → 一场 220×440，
 *    两块共 440，剩 40 拆成「左 8 + 中间 24 + 右 8」，中间这 24px 正好当分隔带与垃圾指示条。
 * 2. 顶部 126px 给标题、双方比分、NEXT/HOLD 预览与统计；底部 74px 给模式与键位提示，
 *    这样 440 高的场不会被压扁，也不至于把预览挤到看不见。
 * 3. 垃圾行画法：整行灰底 + 缺口列红槽。玩家一眼就能看出「哪一行是垃圾、洞在哪」，
 *    这直接决定了往哪个洞塞方块，是玩法信息而不是装饰。
 * 4. 方块沿用圆角 + 渐变 + 外发光；幽灵落点单独用描边低透明度，避免和实体混淆。
 */
import { roundRect, glowText, drawBackdrop } from '../../shared/engine.js';
import { COLS, ROWS, PIECES, GARBAGE } from './logic.mjs';

const CELL = 22;
const BOARD_W = COLS * CELL; // 220
const BOARD_H = ROWS * CELL; // 440
const X1 = 8;
const X2 = X1 + BOARD_W + 24; // 252，中间留 24px 给分隔带
const BY = 126;
const CX = 240;
const ACCENT = '#818cf8';
const ACCENT2 = '#f472b6';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

// 每种方块的主色/亮色/暗色；G 是垃圾行的灰。
const COLORS = {
  I: ['#4be1ff', '#b8f6ff', '#0a5c78'],
  O: ['#ffd166', '#fff0b8', '#7a5a06'],
  T: ['#a78bfa', '#ded0ff', '#3f2a80'],
  S: ['#5ce6a5', '#c2ffe1', '#0f6b46'],
  Z: ['#f472b6', '#ffc7e0', '#7a1639'],
  J: ['#818cf8', '#cdd5ff', '#1f3f8a'],
  L: ['#ff9f5c', '#ffd8b8', '#8a3f0a'],
  [GARBAGE]: ['#6b7280', '#9ca3af', '#374151'],
};

const MODE_LABEL = {
  solo: '人机对战 · 你是左场',
  ai: '人机对战 · 你是左场',
  local2p: '同屏双人 · 左场 / 右场',
  online: '联机对战',
};

/** 画一个方块单元：圆角 + 渐变 + 霓虹发光 + 高光。 */
function drawCell(ctx, px, py, size, type, { ghost = false } = {}) {
  const [base, light, dark] = COLORS[type] || [ACCENT, '#ffffff', '#223355'];
  const pad = Math.max(1, size * 0.06);
  const x = px + pad;
  const y = py + pad;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const r = Math.max(2, size * 0.18);

  ctx.save();
  if (ghost) {
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = base;
    ctx.lineWidth = 2;
    ctx.shadowColor = base;
    ctx.shadowBlur = 8;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, light);
    grad.addColorStop(0.35, base);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.shadowColor = base;
    ctx.shadowBlur = size > 16 ? 10 : 5;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = light;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    roundRect(ctx, x + size * 0.14, y + size * 0.14, w - size * 0.28, Math.max(2, h * 0.16), 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGhost(ctx, cur, ghostY, bx, by) {
  if (ghostY == null || ghostY <= cur.y) return;
  for (const [cx, cy] of PIECES[cur.type][cur.rot]) {
    const row = ghostY + cy;
    if (row < 0 || row >= ROWS) continue;
    drawCell(ctx, bx + (cur.x + cx) * CELL, by + row * CELL, CELL, cur.type, { ghost: true });
  }
}

function drawGarbageRows(ctx, b, bx, by) {
  for (let r = 0; r < ROWS; r++) {
    const row = b.grid[r];
    if (!row || !row.some((c) => c === GARBAGE)) continue;
    const py = by + r * CELL;

    ctx.save();
    ctx.fillStyle = 'rgba(107,114,128,0.16)';
    roundRect(ctx, bx + 1, py + 1, BOARD_W - 2, CELL - 2, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 缺口：该行里唯一空的那一列，画成红色空槽
    for (let c = 0; c < COLS; c++) {
      if (row[c] !== null) continue;
      const px = bx + c * CELL;
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,0.28)';
      ctx.strokeStyle = 'rgba(239,68,68,0.75)';
      ctx.shadowColor = 'rgba(239,68,68,0.55)';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5;
      roundRect(ctx, px + CELL * 0.22, py + CELL * 0.2, CELL * 0.56, CELL * 0.6, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawBoard(ctx, b, bx, by) {
  // 面板底
  ctx.save();
  ctx.shadowColor = 'rgba(129,140,248,0.22)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(6,10,20,0.92)';
  roundRect(ctx, bx - 4, by - 4, BOARD_W + 8, BOARD_H + 8, 10);
  ctx.fill();
  ctx.restore();

  // 网格
  ctx.save();
  ctx.strokeStyle = 'rgba(129,140,248,0.09)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(bx + x * CELL, by);
    ctx.lineTo(bx + x * CELL, by + BOARD_H);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(bx, by + y * CELL);
    ctx.lineTo(bx + BOARD_W, by + y * CELL);
    ctx.stroke();
  }
  ctx.restore();

  drawGarbageRows(ctx, b, bx, by);

  // 已落定格
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = b.grid[y][x];
      if (t) drawCell(ctx, bx + x * CELL, by + y * CELL, CELL, t);
    }
  }

  // 幽灵落点 + 当前块
  if (b.cur) {
    drawGhost(ctx, b.cur, b.ghostY, bx, by);
    for (const [cx, cy] of PIECES[b.cur.type][b.cur.rot]) {
      const row = b.cur.y + cy;
      const col = b.cur.x + cx;
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
      drawCell(ctx, bx + col * CELL, by + row * CELL, CELL, b.cur.type);
    }
  }

  // 边框
  ctx.save();
  ctx.strokeStyle = b.over ? 'rgba(244,114,182,0.55)' : 'rgba(129,140,248,0.35)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx - 4, by - 4, BOARD_W + 8, BOARD_H + 8, 10);
  ctx.stroke();
  ctx.restore();

  if (b.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,16,0.66)';
    roundRect(ctx, bx - 4, by - 4, BOARD_W + 8, BOARD_H + 8, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT2;
    ctx.font = `700 26px ${FONT}`;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 14;
    ctx.fillText('顶出', bx + BOARD_W / 2, by + BOARD_H / 2);
    ctx.restore();
  }
}

/** NEXT / HOLD 小盒：标签贴在盒内左上角，省出两行高度。 */
function drawMini(ctx, type, x, y, w, h, label, dim = false) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,30,0.75)';
  ctx.strokeStyle = 'rgba(129,140,248,0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(147,160,184,0.55)';
  ctx.font = `600 8px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 4, y + 11);
  ctx.restore();

  if (!type) return;
  const cells = PIECES[type] && PIECES[type][0];
  if (!cells) return;
  let minX = 9;
  let maxX = -9;
  let minY = 9;
  let maxY = -9;
  for (const [cx, cy] of cells) {
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const scale = Math.max(4, Math.min(9, Math.floor((w - 8) / cw), Math.floor((h - 16) / ch)));
  const ox = x + (w - cw * scale) / 2 - minX * scale;
  const oy = y + 13 + (h - 15 - ch * scale) / 2 - minY * scale;
  ctx.save();
  if (dim) ctx.globalAlpha = 0.4;
  for (const [cx, cy] of cells) {
    drawCell(ctx, ox + cx * scale, oy + cy * scale, scale, type);
  }
  ctx.restore();
}

function drawHeader(ctx, b, bx, label) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(147,160,184,0.92)';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText(label, bx + 2, 58);

  ctx.textAlign = 'right';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 20px ${FONT}`;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  ctx.fillText(String(b.score), bx + BOARD_W - 2, 60);
  ctx.restore();

  drawMini(ctx, b.next[0], bx, 68, 46, 46, 'NEXT');
  drawMini(ctx, b.hold, bx + 52, 68, 46, 46, 'HOLD', b.holdUsed);

  const tx = bx + 108;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = 'rgba(147,160,184,0.85)';
  ctx.fillText(`消行 ${b.lines}`, tx, 82);
  ctx.fillStyle = b.incoming > 0 ? '#f87171' : 'rgba(147,160,184,0.6)';
  ctx.fillText(`垃圾 ${b.incoming}`, tx, 99);
  ctx.fillStyle = 'rgba(147,160,184,0.6)';
  ctx.fillText(`LV ${b.level}`, tx, 116);
  ctx.restore();
}

/** 中央垃圾指示条：待落垃圾一格一段，从下往上堆。 */
function drawGarbageBar(ctx, b, x) {
  const w = 6;
  ctx.save();
  ctx.fillStyle = 'rgba(148,163,184,0.10)';
  roundRect(ctx, x, BY, w, BOARD_H, 3.5);
  ctx.fill();

  const n = Math.min(ROWS, b.incoming);
  const seg = 6;
  const step = 8;
  for (let i = 0; i < n; i++) {
    const y0 = BY + BOARD_H - (i + 1) * step;
    ctx.fillStyle = i === n - 1 ? '#ef4444' : 'rgba(239,68,68,0.7)';
    ctx.shadowColor = 'rgba(239,68,68,0.5)';
    ctx.shadowBlur = 6;
    roundRect(ctx, x, y0, w, seg, 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawCenter(ctx, state) {
  ctx.save();
  ctx.strokeStyle = 'rgba(129,140,248,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(CX, BY);
  ctx.lineTo(CX, BY + BOARD_H);
  ctx.stroke();
  ctx.restore();

  drawGarbageBar(ctx, state.boards.p1, CX - 8);
  drawGarbageBar(ctx, state.boards.p2, CX + 2);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText(`${state.boards.p1.score}:${state.boards.p2.score}`, CX, 60);
  ctx.fillStyle = 'rgba(147,160,184,0.55)';
  ctx.font = `700 9px ${FONT}`;
  ctx.fillText('VS', CX, 78);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  glowText(ctx, '方块对战', CX, 24, { size: 21, color: ACCENT, glow: ACCENT });

  const b1 = state.boards.p1;
  const b2 = state.boards.p2;
  const leftLabel = state.mode === 'local2p' ? 'P1 · 左场' : 'P1 · 你';
  const rightLabel = state.mode === 'local2p' ? 'P2 · 右场' : 'P2 · 对手';

  drawHeader(ctx, b1, X1, leftLabel);
  drawHeader(ctx, b2, X2, rightLabel);

  drawBoard(ctx, b1, X1, BY);
  drawBoard(ctx, b2, X2, BY);
  drawCenter(ctx, state);

  // 底部信息区
  ctx.save();
  ctx.textAlign = 'center';
  if (state.over) {
    const who = state.winner === 'p1' ? '左场' : '右场';
    ctx.fillStyle = ACCENT2;
    ctx.font = `700 15px ${FONT}`;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 12;
    ctx.fillText(`${who}获胜 · ${state.boards.p1.score} : ${state.boards.p2.score}`, CX, 588);
  } else {
    ctx.fillStyle = ACCENT;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(MODE_LABEL[state.mode] || MODE_LABEL.solo, CX, 584);
    ctx.fillStyle = 'rgba(147,160,184,0.75)';
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText('消 2 / 3 / 4 行 → 送对手 1 / 2 / 4 行垃圾；垃圾行带一个缺口', CX, 604);
    ctx.fillStyle = 'rgba(147,160,184,0.5)';
    ctx.fillText('←→ 移动 · ↓ 软降 · 空格硬降 · X 旋转 · C/H 暂存', CX, 622);
  }
  ctx.restore();
}
