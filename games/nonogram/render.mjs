/**
 * 数织 · 渲染。只读 state，不改状态。坐标系固定 480×640（与 game.json.canvas 一致）。
 *
 * 布局推导（480×640 竖屏）：
 * - 顶部 92px 放标题/进度/库存；底部 70px 放操作说明；
 * - 网格左侧放行线索、上方放列线索，两者尺寸由 size 推出（列线索最多 ⌈size/2⌉ 段）；
 * - 剩余空间给网格，格宽取 min(可用宽/大小, 可用高/大小, 上限)，10×10 落在 34px；
 * - 线索区与网格之间留 8px，网格整体在画布内水平居中。
 *
 * 语义映射：
 * - cells: 0 未定 / 1 填充 / 2 标 X；solution 只用于矛盾高亮，不泄漏未填格答案；
 * - 「已满足」的线索按当前填充段与线索逐项相等判定，满足后变暗，避免玩家重复演算；
 * - 矛盾格画红色描边，这是「错误不惩罚」的唯一反馈：不遮答案、不判负。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#2dd4bf';
const ACCENT2 = '#99f6e4';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const W = 480;
const H = 640;
const HEADER_H = 92;
const BOTTOM_RESERVE = 70;
const CLUE_GAP = 8;

/** 棋盘几何；导出给 input.mjs 做点击/长按的坐标反算 */
export function getGeometry(state) {
  const size = Math.max(2, Math.floor(state?.size) || 10);
  const clueL = Math.round(Math.min(96, 26 + size * 6.2)); // 5→57, 10→88, 12→96
  const maxGroups = Math.ceil(size / 2);                    // 一段填充至少占 2 格（段 + 空）
  const clueT = Math.min(112, 18 + maxGroups * 16);         // 10→98
  const cap = size <= 6 ? 44 : 34;
  const availW = W - 44 - clueL;
  const availH = H - HEADER_H - clueT - BOTTOM_RESERVE;
  const cell = Math.max(14, Math.min(cap, Math.floor(availW / size), Math.floor(availH / size)));
  const gridW = cell * size;
  const gridH = cell * size;
  const x0 = 22 + Math.max(0, Math.floor((availW - gridW) / 2));
  const gridX = x0 + clueL;
  const gridY = HEADER_H + clueT;
  return { size, cell, clueL, clueT, x0, gridX, gridY, gridW, gridH };
}

/** 逻辑坐标 → 格子 {r,c}；落在网格外返回 null */
export function cellAt(state, px, py) {
  const g = getGeometry(state);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  if (px < g.gridX || py < g.gridY) return null;
  if (px >= g.gridX + g.gridW || py >= g.gridY + g.gridH) return null;
  const c = Math.floor((px - g.gridX) / g.cell);
  const r = Math.floor((py - g.gridY) / g.cell);
  if (r < 0 || c < 0 || r >= g.size || c >= g.size) return null;
  return { r, c };
}

/** 一条线的填充段（只认 1，X 与未定等价），全空返回 [0] */
function runsOf(line) {
  const out = [];
  let run = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === 1) run++;
    else if (run > 0) { out.push(run); run = 0; }
  }
  if (run > 0) out.push(run);
  return out.length ? out : [0];
}

function sameClues(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function drawGridBase(ctx, g) {
  ctx.save();
  // 线索区 + 网格的整块底板，把两者视觉上绑在一起
  ctx.fillStyle = 'rgba(8, 14, 24, 0.92)';
  roundRect(ctx, g.x0 - 6, HEADER_H - 2, g.clueL + g.gridW + 12, g.clueT + g.gridH + 10, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.20)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawCellSurface(ctx, g, r, c) {
  const x = g.gridX + c * g.cell;
  const y = g.gridY + r * g.cell;
  ctx.fillStyle = '#0d1726';
  ctx.fillRect(x, y, g.cell, g.cell);
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, g.cell - 1, g.cell - 1);
}

/**
 * 填充格。渐变对象按整块网格创建一次再共用（绝对画布坐标），
 * 避免每格每帧 createLinearGradient 造成无谓分配；也不逐格开 shadowBlur，
 * 低端机 100 格发光会掉帧，视觉靠高光边与整块底板暗底拉出层次。
 */
function drawFilled(ctx, g, r, c, grad) {
  const x = g.gridX + c * g.cell;
  const y = g.gridY + r * g.cell;
  const pad = 1;
  ctx.fillStyle = grad;
  roundRect(ctx, x + pad, y + pad, g.cell - pad * 2, g.cell - pad * 2, Math.max(2, g.cell * 0.10));
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + pad + 3, y + pad + 1.5);
  ctx.lineTo(x + g.cell - pad - 3, y + pad + 1.5);
  ctx.stroke();
  ctx.restore();
}

function drawCross(ctx, g, r, c) {
  const x = g.gridX + c * g.cell;
  const y = g.gridY + r * g.cell;
  const inset = g.cell * 0.30;
  ctx.save();
  ctx.strokeStyle = 'rgba(167, 186, 208, 0.85)';
  ctx.lineWidth = Math.max(1.5, g.cell * 0.075);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + inset, y + inset);
  ctx.lineTo(x + g.cell - inset, y + g.cell - inset);
  ctx.moveTo(x + g.cell - inset, y + inset);
  ctx.lineTo(x + inset, y + g.cell - inset);
  ctx.stroke();
  ctx.restore();
}

function drawConflict(ctx, g, r, c) {
  const x = g.gridX + c * g.cell;
  const y = g.gridY + r * g.cell;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 88, 74, 0.18)';
  ctx.fillRect(x + 1, y + 1, g.cell - 2, g.cell - 2);
  ctx.strokeStyle = '#ff6b5e';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1.5, y + 1.5, g.cell - 3, g.cell - 3, 3);
  ctx.stroke();
  ctx.restore();
}

function drawSelection(ctx, g, focus) {
  if (!focus) return;
  const x = g.gridX + focus.c * g.cell;
  const y = g.gridY + focus.r * g.cell;
  ctx.save();
  ctx.strokeStyle = ACCENT2;
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  roundRect(ctx, x + 1, y + 1, g.cell - 2, g.cell - 2, 3);
  ctx.stroke();
  ctx.restore();
}

/** 3 格一组的粗线：让玩家能数格子而不必逐格对齐 */
function drawGroupLines(ctx, g) {
  ctx.save();
  ctx.strokeStyle = 'rgba(153, 246, 228, 0.42)';
  ctx.lineWidth = 2;
  for (let k = 3; k < g.size; k += 3) {
    const x = g.gridX + k * g.cell;
    const y = g.gridY + k * g.cell;
    ctx.beginPath();
    ctx.moveTo(x, g.gridY);
    ctx.lineTo(x, g.gridY + g.gridH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(g.gridX, y);
    ctx.lineTo(g.gridX + g.gridW, y);
    ctx.stroke();
  }
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.strokeRect(g.gridX - 0.5, g.gridY - 0.5, g.gridW + 1, g.gridH + 1);
  ctx.restore();
}

function clueFont(cell) {
  return Math.max(11, Math.min(16, Math.round(cell * 0.44)));
}

function drawRowClues(ctx, state, g, satisfied) {
  const font = clueFont(g.cell);
  ctx.save();
  ctx.font = `700 ${font}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < g.size; r++) {
    const clues = state.rowClues?.[r] || [0];
    const cy = g.gridY + (r + 0.5) * g.cell;
    ctx.fillStyle = satisfied.rows[r] ? 'rgba(153, 246, 228, 0.28)' : '#e2fdf8';
    let x = g.gridX - CLUE_GAP;
    for (let k = clues.length - 1; k >= 0; k--) {
      const txt = String(clues[k]);
      ctx.fillText(txt, x, cy);
      x -= ctx.measureText(txt).width + Math.max(4, font * 0.42);
    }
  }
  ctx.restore();
}

function drawColClues(ctx, state, g, satisfied) {
  const font = clueFont(g.cell);
  const lineH = Math.max(12, Math.min(17, Math.round(g.cell * 0.48)));
  ctx.save();
  ctx.font = `700 ${font}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c < g.size; c++) {
    const clues = state.colClues?.[c] || [0];
    const cx = g.gridX + (c + 0.5) * g.cell;
    ctx.fillStyle = satisfied.cols[c] ? 'rgba(153, 246, 228, 0.28)' : '#e2fdf8';
    // 从网格上沿往上排：最后一行的数字底边贴着 gridY - CLUE_GAP，段多时向上生长
    let y = g.gridY - CLUE_GAP - clues.length * lineH;
    for (let k = 0; k < clues.length; k++) {
      ctx.fillText(String(clues[k]), cx, y);
      y += lineH;
    }
  }
  ctx.restore();
}

function drawHeader(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(45, 212, 191, 0.55)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#eafdf9';
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(`数织 · ${state.size}×${state.size}`, W / 2, 32);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(165, 186, 205, 0.92)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText(
    `已填 ${state.progress.filled}/${state.progress.total}   ·   提示 ${state.hintsLeft}   ·   矛盾 ${state.mistakes}`,
    W / 2,
    54,
  );

  // 进度条：只反映「填对/填错的总量」是不够的，这里就是简单完成度（填充数/目标数）
  const barW = 300;
  const barX = (W - barW) / 2;
  const barY = 66;
  const ratio = state.progress.total > 0 ? Math.min(1, state.progress.filled / state.progress.total) : 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  roundRect(ctx, barX, barY, barW, 6, 3);
  ctx.fill();
  if (ratio > 0) {
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, ACCENT);
    grad.addColorStop(1, ACCENT2);
    ctx.fillStyle = grad;
    roundRect(ctx, barX, barY, Math.max(4, barW * ratio), 6, 3);
    ctx.fill();
  }
  ctx.restore();
}

function drawFooter(ctx, state, g) {
  const y = g.gridY + g.gridH + 28;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = 'rgba(150, 168, 190, 0.9)';
  ctx.fillText('点按填充 / 取消   ·   长按或右键标 X', W / 2, y);
  if (state.mistakes > 0) {
    ctx.fillStyle = 'rgba(255, 138, 128, 0.95)';
    ctx.fillText(`红框为与答案矛盾的 ${state.mistakes} 格`, W / 2, y + 24);
  } else {
    ctx.fillStyle = 'rgba(150, 168, 190, 0.62)';
    ctx.fillText('提示揭示一格 · 撤销可回退', W / 2, y + 24);
  }
  if (state.solved) {
    ctx.fillStyle = ACCENT2;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText('图案还原完成', W / 2, y + 48);
  }
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w || W, view.h || H, ACCENT);

  const g = getGeometry(state);

  // 预先算好每条线是否已满足（填充段与线索逐项相等），行/列各一份
  const satisfied = { rows: new Array(g.size).fill(false), cols: new Array(g.size).fill(false) };
  for (let r = 0; r < g.size; r++) {
    const line = state.cells.slice(r * g.size, r * g.size + g.size);
    satisfied.rows[r] = sameClues(runsOf(line), state.rowClues?.[r] || [0]);
  }
  for (let c = 0; c < g.size; c++) {
    const line = new Array(g.size);
    for (let r = 0; r < g.size; r++) line[r] = state.cells[r * g.size + c];
    satisfied.cols[c] = sameClues(runsOf(line), state.colClues?.[c] || [0]);
  }

  drawHeader(ctx, state);
  drawGridBase(ctx, g);

  // 网格底
  for (let r = 0; r < g.size; r++) {
    for (let c = 0; c < g.size; c++) drawCellSurface(ctx, g, r, c);
  }

  // 填充 / X / 矛盾
  const conflictSet = new Set(state.conflicts || []);
  const fillGrad = ctx.createLinearGradient(g.gridX, g.gridY, g.gridX + g.gridW, g.gridY + g.gridH);
  fillGrad.addColorStop(0, ACCENT2);
  fillGrad.addColorStop(0.55, ACCENT);
  fillGrad.addColorStop(1, '#189e8b');
  for (let r = 0; r < g.size; r++) {
    for (let c = 0; c < g.size; c++) {
      const i = r * g.size + c;
      const v = state.cells[i];
      if (v === 1) drawFilled(ctx, g, r, c, fillGrad);
      else if (v === 2) drawCross(ctx, g, r, c);
      if (conflictSet.has(i)) drawConflict(ctx, g, r, c);
    }
  }

  drawGroupLines(ctx, g);
  drawRowClues(ctx, state, g, satisfied);
  drawColClues(ctx, state, g, satisfied);
  drawSelection(ctx, g, state.focus);
  drawFooter(ctx, state, g);
}
