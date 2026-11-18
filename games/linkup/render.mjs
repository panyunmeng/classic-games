/**
 * 连连看 · 渲染。只读 logic.state()，不改状态。
 * 坐标系固定 480×640（与 game.json.canvas 一致）。
 * 图案全部程序化几何符号，零外部资源。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#38bdf8';
const ACCENT2 = '#f472b6';
const COLS = 8;
const ROWS = 6;
const CELL = 50;
const GAP = 6;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const OFF_X = Math.round((480 - BOARD_W) / 2); // 40
const OFF_Y = 118;

// 12 种图案的程序化配色（每种一个色相，零图片/字体外部依赖）
const PALETTE = [
  '#38bdf8', '#f472b6', '#fbbf24', '#34d399',
  '#a78bfa', '#fb7185', '#22d3ee', '#facc15',
  '#4ade80', '#c084fc', '#f97316', '#60a5fa',
];

function cellRect(index) {
  const x = index % COLS;
  const y = Math.floor(index / COLS);
  return {
    x: OFF_X + x * CELL + GAP / 2,
    y: OFF_Y + y * CELL + GAP / 2,
    w: CELL - GAP,
    h: CELL - GAP,
  };
}

/** 图案中心（连线路径用格中心，含 -1 外圈） */
function cellCenter(cx, cy) {
  return {
    x: OFF_X + cx * CELL + CELL / 2,
    y: OFF_Y + cy * CELL + CELL / 2,
  };
}

/** 程序化几何图案：用 index 决定形状 + 颜色，纯 Canvas 绘制 */
function drawSymbol(ctx, kind, cx, cy, r) {
  const color = PALETTE[(kind - 1) % PALETTE.length];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  switch ((kind - 1) % 8) {
    case 0: // 实心圆 + 环
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1: // 菱形 + 中心点
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.62);
      ctx.lineTo(cx + r * 0.62, cy);
      ctx.lineTo(cx, cy + r * 0.62);
      ctx.lineTo(cx - r * 0.62, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 2: // 正方形 + 内十字
      ctx.strokeRect(cx - r * 0.5, cy - r * 0.5, r, r);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.22, cy);
      ctx.lineTo(cx + r * 0.22, cy);
      ctx.moveTo(cx, cy - r * 0.22);
      ctx.lineTo(cx, cy + r * 0.22);
      ctx.stroke();
      break;
    case 3: // 三角形
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.62);
      ctx.lineTo(cx + r * 0.58, cy + r * 0.45);
      ctx.lineTo(cx - r * 0.58, cy + r * 0.45);
      ctx.closePath();
      ctx.stroke();
      break;
    case 4: // 五角星
      drawStar(ctx, cx, cy, r * 0.62, r * 0.28, 5);
      ctx.stroke();
      break;
    case 5: // 六边形
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + Math.cos(a) * r * 0.6;
        const py = cy + Math.sin(a) * r * 0.6;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    case 6: // 双环
      ctx.beginPath();
      ctx.arc(cx - r * 0.25, cy, r * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + r * 0.25, cy, r * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      break;
    default: // 斜十字（X）
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy - r * 0.5);
      ctx.lineTo(cx + r * 0.5, cy + r * 0.5);
      ctx.moveTo(cx + r * 0.5, cy - r * 0.5);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.5);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawStar(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 连线动画：沿路径按进度画折线，端点画光点 */
function drawLinkPath(ctx, path, progress, color) {
  if (!path || path.length < 2) return;
  const pts = path.map((p) => cellCenter(p.x, p.y));
  // 计算总长与各段长度
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(len);
    total += len;
  }
  if (total <= 0) return;
  let drawn = total * Math.min(1, Math.max(0, progress));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length && drawn > 0; i++) {
    const len = segs[i - 1];
    const t = Math.min(1, drawn / len);
    ctx.lineTo(
      pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t
    );
    drawn -= len;
  }
  ctx.stroke();
  // 光标光点
  const head = pts[pts.length - 1];
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  const time = view.time || 0;

  // 顶部标题与计分
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8edf7';
  ctx.font = '700 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('连连看', view.w / 2, 34);
  ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`剩余 ${state.remain} 对  ·  得分 ${state.score}  ·  提示 ${state.hintLeft}`, view.w / 2, 56);

  // 计时条：每一步限时，剩余越少越红
  const barW = 320;
  const barX = (view.w - barW) / 2;
  const barY = 74;
  const ratio = Math.max(0, Math.min(1, state.timeLeft / (state.stepTime || 1)));
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, barX, barY, barW, 8, 4);
  ctx.fill();
  ctx.fillStyle = ratio > 0.35 ? ACCENT : '#ef4444';
  roundRect(ctx, barX, barY, Math.max(2, barW * ratio), 8, 4);
  ctx.fill();
  ctx.restore();

  // 棋盘底板
  ctx.save();
  ctx.shadowColor = 'rgba(56, 189, 248, 0.16)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(8, 14, 26, 0.92)';
  roundRect(ctx, OFF_X - 8, OFF_Y - 8, BOARD_W + 16, BOARD_H + 16, 12);
  ctx.fill();
  ctx.restore();

  // 棋盘格
  for (let i = 0; i < state.board.length; i++) {
    const r = cellRect(i);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.fill();
  }

  // 提示闪烁：0.5 s 周期
  const flashOn = Math.floor(time * 2) % 2 === 0;
  const hintSet = new Set();
  if (state.hintPair && flashOn) {
    hintSet.add(state.hintPair.a);
    hintSet.add(state.hintPair.b);
  }

  // 图案
  for (let i = 0; i < state.board.length; i++) {
    const v = state.board[i];
    if (v == null || v === 0) continue;
    const r = cellRect(i);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;

    // 选中高亮
    if (state.selected === i) {
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3;
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 16;
      roundRect(ctx, r.x, r.y, r.w, r.h, 7);
      ctx.stroke();
      ctx.restore();
    }
    // 提示高亮（粉色闪烁边框）
    if (hintSet.has(i)) {
      ctx.save();
      ctx.strokeStyle = ACCENT2;
      ctx.lineWidth = 3;
      ctx.shadowColor = ACCENT2;
      ctx.shadowBlur = 18;
      roundRect(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 8);
      ctx.stroke();
      ctx.restore();
    }

    drawSymbol(ctx, v, cx, cy, r.w / 2 - 4);
  }

  // 连线动画：成功消除或提示时沿路径绘制（0.45 s 扫过）
  if (state.lastPath && state.lastPath.length >= 2) {
    const progress = (time % 0.9) / 0.45;
    drawLinkPath(ctx, state.lastPath, progress, state.hintPair ? ACCENT2 : ACCENT);
  }

  // 结束遮罩
  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.62)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = state.won ? '#34d399' : '#fb7185';
    ctx.font = '700 32px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(state.won ? '通关！' : '时间到', view.w / 2, view.h / 2 - 10);
    ctx.restore();
  }
}
