/**
 * 扫雷 · 渲染。只读 state，不改状态。深色矿洞风格，程序化绘制旗子/地雷。
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#c8863c';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

// 1～8 的经典配色：蓝 绿 红 紫 橙 青 灰 白
const NUM_COLORS = [
  null,
  '#5aa9ff', '#57d98a', '#ff6b5e', '#c08cff',
  '#ff9f43', '#4fd6d2', '#b9c2d0', '#f5f7fb',
];

/**
 * 棋盘几何：随难度自适应格宽，导出给 input.mjs 做点击/长按的坐标反算。
 * 约束：480×640 画布内，左右留 20px，顶部 HUD 150px，底部留 24px。
 */
export function getGeometry(state) {
  const cols = state.cols || 16;
  const rows = state.rows || 16;
  const availW = 480 - 40;
  const availH = 640 - 178;
  const cap = cols <= 9 ? 44 : cols <= 16 ? 28 : 15;
  const cell = Math.max(8, Math.min(cap, Math.floor(availW / cols), Math.floor(availH / rows)));
  const w = cell * cols;
  const h = cell * rows;
  const x = Math.floor((480 - w) / 2);
  const y = 142 + Math.floor((availH - h) / 2);
  return { cell, x, y, w, h, cols, rows };
}

/** 逻辑坐标 → 格子坐标；越界返回 null */
export function cellAt(state, px, py) {
  const g = getGeometry(state);
  if (px < g.x || py < g.y || px >= g.x + g.w || py >= g.y + g.h) return null;
  const cx = Math.floor((px - g.x) / g.cell);
  const cy = Math.floor((py - g.y) / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return null;
  return { x: cx, y: cy };
}

function drawCovered(ctx, x, y, s) {
  const pad = Math.max(1, s * 0.05);
  const r = Math.max(2, s * 0.14);
  ctx.save();
  ctx.fillStyle = '#2a3346'; // 立体侧面
  roundRect(ctx, x + pad, y + pad + Math.max(1, s * 0.07), s - pad * 2, s - pad * 2, r);
  ctx.fill();
  const grad = ctx.createLinearGradient(x, y, x, y + s);
  grad.addColorStop(0, '#4d5b74');
  grad.addColorStop(1, '#374359');
  ctx.fillStyle = grad;
  roundRect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2 - Math.max(1, s * 0.05), r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + pad + r, y + pad + 1);
  ctx.lineTo(x + s - pad - r, y + pad + 1);
  ctx.stroke();
  ctx.restore();
}

function drawFlag(ctx, x, y, s) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.save();
  ctx.shadowColor = '#ff6b5e';
  ctx.shadowBlur = s * 0.4;
  ctx.strokeStyle = '#d9dde6';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.18, cy + s * 0.28);
  ctx.lineTo(cx - s * 0.18, cy - s * 0.28);
  ctx.stroke();
  ctx.fillStyle = '#ff5a4f';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.16, cy - s * 0.26);
  ctx.lineTo(cx + s * 0.27, cy - s * 0.12);
  ctx.lineTo(cx - s * 0.16, cy + s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#b9c2d0';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.27, cy + s * 0.28, s * 0.13, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMine(ctx, x, y, s) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s * 0.26;
  ctx.save();
  ctx.shadowColor = '#ff4d4d';
  ctx.shadowBlur = s * 0.5;
  ctx.fillStyle = '#1a1f2b';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ff6b5e';
  ctx.lineWidth = Math.max(1, s * 0.06);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.lineTo(cx + Math.cos(a) * r * 1.45, cy + Math.sin(a) * r * 1.45);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.3, Math.max(1, s * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOpen(ctx, x, y, s, cell, exploded) {
  ctx.save();
  ctx.fillStyle = exploded ? '#5a2320' : '#151b28';
  roundRect(ctx, x + 1, y + 1, s - 2, s - 2, Math.max(1, s * 0.08));
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (cell.mine) {
    drawMine(ctx, x, y, s);
  } else if (cell.flagged) {
    drawFlag(ctx, x, y, s); // 胜利自动插旗 / 误判旗
  } else if (cell.adjacent > 0) {
    ctx.fillStyle = NUM_COLORS[cell.adjacent] || '#f5f7fb';
    ctx.font = `700 ${Math.max(9, Math.floor(s * 0.58))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cell.adjacent), x + s / 2, y + s / 2 + s * 0.02);
  }
  ctx.restore();
}

function drawCursor(ctx, g, cursor) {
  if (!cursor) return;
  const x = g.x + cursor.x * g.cell;
  const y = g.y + cursor.y * g.cell;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 10;
  roundRect(ctx, x + 1, y + 1, g.cell - 2, g.cell - 2, 4);
  ctx.stroke();
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f0d7a8';
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(`扫雷 · ${state.level || '中级'}`, view.w / 2, 34);
  ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
  ctx.font = `13px ${FONT}`;
  const remain = Math.max(0, state.mines - state.flags);
  ctx.fillText(`剩余雷 ${remain} / ${state.mines}   翻开 ${state.opened}`, view.w / 2, 58);
  // 插旗模式提示：手机端长按易被系统菜单打断，这是主要插旗入口
  const adapter = view.shell && view.shell.input;
  const flagMode = Boolean(adapter && typeof adapter.isFlagMode === 'function' && adapter.isFlagMode());
  if (flagMode) {
    ctx.fillStyle = 'rgba(229, 115, 105, 0.95)';
    roundRect(ctx, view.w / 2 - 96, 88, 192, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText('🚩 插旗模式 · 点格子插旗', view.w / 2, 108);
  } else if (state.canUndo) {
    ctx.fillStyle = 'rgba(200, 134, 60, 0.85)';
    ctx.font = `12px ${FONT}`;
    ctx.fillText('U / 撤销按钮 可回退', view.w / 2, 78);
  }
  ctx.restore();

  const g = getGeometry(state);

  // 矿洞边框
  ctx.save();
  ctx.shadowColor = 'rgba(242, 184, 75, 0.18)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(8, 12, 20, 0.92)';
  roundRect(ctx, g.x - 8, g.y - 8, g.w + 16, g.h + 16, 12);
  ctx.fill();
  ctx.restore();

  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const cell = state.cells[row * g.cols + col];
      const x = g.x + col * g.cell;
      const y = g.y + row * g.cell;
      if (cell.revealed) {
        drawOpen(ctx, x, y, g.cell, cell, Boolean(state.over && cell.mine && !state.won));
      } else if (cell.flagged) {
        drawCovered(ctx, x, y, g.cell);
        drawFlag(ctx, x, y, g.cell);
      } else {
        drawCovered(ctx, x, y, g.cell);
      }
    }
  }

  if (!state.over) drawCursor(ctx, g, state.cursor);

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.58)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = state.won ? '#8ef0b8' : '#ff8a80';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(state.won ? '排雷成功' : '踩雷了', view.w / 2, view.h / 2 - 8);
    ctx.fillStyle = 'rgba(232, 237, 247, 0.9)';
    ctx.font = `14px ${FONT}`;
    ctx.fillText(state.won ? '所有安全格已翻开' : '再来一局，注意数字提示', view.w / 2, view.h / 2 + 24);
    ctx.restore();
  }
}
