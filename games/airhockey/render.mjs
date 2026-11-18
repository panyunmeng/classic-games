/**
 * 空气曲棍球 · 霓虹渲染（480×640）。
 * 只读 logic.state() 快照，不改任何游戏状态；动画相位一律取 view.time。
 *
 * 视觉分工：
 *   accent  #38bdf8 → 上方 p1、桌面轮廓、球门光
 *   accent2 #e0f2fe → 下方 p2、中线、球芯高光
 */
import { drawBackdrop, roundRect, glowText } from '../../shared/engine.js';
import { TABLE, CENTER_Y, GOAL_X0, GOAL_X1 } from './logic.mjs';

const ACCENT = '#38bdf8';
const ACCENT2 = '#e0f2fe';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const W = 480;
const H = 640;
const WALL = 10; // 桌面墙厚（内框之外）
const OUT = { x0: TABLE.x0 - WALL, y0: TABLE.y0 - WALL, x1: TABLE.x1 + WALL, y1: TABLE.y1 + WALL };
const GOAL_DEPTH = 24;

function wallSegments() {
  return [
    // [x0, y0, x1, y1] 只画实体墙，球门口留空
    [TABLE.x0, TABLE.y0, TABLE.x0, TABLE.y1], // 左
    [TABLE.x1, TABLE.y0, TABLE.x1, TABLE.y1], // 右
    [TABLE.x0, TABLE.y0, GOAL_X0, TABLE.y0], // 上左
    [GOAL_X1, TABLE.y0, TABLE.x1, TABLE.y0], // 上右
    [TABLE.x0, TABLE.y1, GOAL_X0, TABLE.y1], // 下左
    [GOAL_X1, TABLE.y1, TABLE.x1, TABLE.y1], // 下右
  ];
}

function drawTable(ctx, time) {
  const pulse = 0.72 + Math.sin(time * 2.1) * 0.12;

  // 桌面底：冷色渐变 + 外框
  ctx.save();
  const g = ctx.createLinearGradient(0, OUT.y0, 0, OUT.y1);
  g.addColorStop(0, 'rgba(56,189,248,0.13)');
  g.addColorStop(0.5, 'rgba(8,15,30,0.72)');
  g.addColorStop(1, 'rgba(224,242,254,0.12)');
  ctx.fillStyle = g;
  roundRect(ctx, OUT.x0, OUT.y0, OUT.x1 - OUT.x0, OUT.y1 - OUT.y0, 22);
  ctx.fill();
  ctx.strokeStyle = `rgba(56,189,248,${0.30 * pulse})`;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();

  // 球门凹口：门外是桌体，门口是暗腔 + 发光口沿
  for (const goal of [
    { top: true, color: ACCENT }, // 上方球门由 p1 守
    { top: false, color: ACCENT2 }, // 下方球门由 p2 守
  ]) {
    const yEdge = goal.top ? TABLE.y0 : TABLE.y1;
    const yOut = goal.top ? yEdge - GOAL_DEPTH : yEdge + GOAL_DEPTH;
    const color = goal.color;
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,16,0.9)';
    roundRect(ctx, GOAL_X0, goal.top ? yOut : yEdge, GOAL_X1 - GOAL_X0, GOAL_DEPTH, 6);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5 * pulse;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(GOAL_X0, yEdge);
    ctx.lineTo(GOAL_X1, yEdge);
    ctx.stroke();
    ctx.restore();

    // 门柱
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    for (const x of [GOAL_X0, GOAL_X1]) {
      roundRect(ctx, x - 2.5, Math.min(yEdge, yOut), 5, GOAL_DEPTH, 2.5);
      ctx.fill();
    }
    ctx.restore();
  }

  // 实体墙（球门口留空）
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = ACCENT;
  ctx.globalAlpha = 0.4 + 0.28 * pulse;
  ctx.lineWidth = 4;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 20;
  for (const [x0, y0, x1, y1] of wallSegments()) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();

  // 中线 + 中圈
  ctx.save();
  ctx.strokeStyle = 'rgba(224,242,254,0.30)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([14, 12]);
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(TABLE.x0 + 2, CENTER_Y);
  ctx.lineTo(TABLE.x1 - 2, CENTER_Y);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(56,189,248,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(W / 2, CENTER_Y, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, CENTER_Y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBigScore(ctx, state, mode) {
  const aiP1 = mode === 'solo' || mode === 'ai';
  const items = [
    { side: 'p1', x: 402, y: 126, color: ACCENT, label: aiP1 ? '上方 · AI' : '上方 · P1' },
    { side: 'p2', x: 78, y: 574, color: ACCENT2, label: '下方 · P2' },
  ];
  for (const it of items) {
    const value = state.score ? state.score[it.side] : 0;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.font = `900 96px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = it.color;
    ctx.shadowColor = it.color;
    ctx.shadowBlur = 24;
    ctx.fillText(String(value), it.x, it.y);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = it.color;
    ctx.fillText(it.label, it.x, it.y + (it.side === 'p1' ? 54 : -52));
    ctx.restore();
  }
}

function drawPaddle(ctx, p, side, time, mode) {
  if (!p) return;
  const color = side === 'p1' ? ACCENT : ACCENT2;
  const other = side === 'p1' ? ACCENT2 : ACCENT;
  const pulse = 0.78 + Math.sin(time * 3 + (side === 'p1' ? 0 : Math.PI)) * 0.16;

  // 光晕
  ctx.save();
  ctx.globalAlpha = pulse * 0.55;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 盘面
  ctx.save();
  const g = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.15, p.x, p.y, p.r);
  g.addColorStop(0, other);
  g.addColorStop(0.45, color);
  g.addColorStop(1, 'rgba(6,14,28,0.95)');
  ctx.fillStyle = g;
  roundRect(ctx, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2, p.r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // 内圈 + 高光
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(p.x - p.r * 0.34, p.y - p.r * 0.38, p.r * 0.2, p.r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 标签
  const isAi = (mode === 'solo' || mode === 'ai') && side === 'p1';
  ctx.save();
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isAi ? 'P1 · AI' : side.toUpperCase(), p.x, p.y + (side === 'p1' ? -p.r - 12 : p.r + 14));
  ctx.restore();
}

function drawDisc(ctx, state) {
  const d = state.disc;
  if (!d) return;
  const trail = Array.isArray(d.trail) ? d.trail : [];

  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const k = (i + 1) / trail.length;
    ctx.save();
    ctx.globalAlpha = k * 0.35;
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(t.x, t.y, d.r * k * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(224,242,254,0.55)';
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  const g = ctx.createRadialGradient(d.x, d.y, 1, d.x, d.y, d.r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, ACCENT2);
  g.addColorStop(1, ACCENT);
  ctx.fillStyle = g;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawServe(ctx, state, time) {
  if (!state.serving) return;
  const down = state.serveSide === 'p1';
  const pulse = 0.5 + Math.sin(time * 4.5) * 0.3;
  const cx = W / 2;
  const cy = CENTER_Y;

  ctx.save();
  ctx.globalAlpha = 0.35 + pulse * 0.4;
  ctx.strokeStyle = down ? ACCENT : ACCENT2;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.shadowColor = down ? ACCENT : ACCENT2;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(cx, cy, 34 + pulse * 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 发球方向箭头：发球方把球推向对手
  const dir = down ? 1 : -1;
  ctx.save();
  ctx.globalAlpha = 0.5 + pulse * 0.4;
  ctx.strokeStyle = down ? ACCENT : ACCENT2;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = down ? ACCENT : ACCENT2;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(cx, cy + dir * 46);
  ctx.lineTo(cx, cy + dir * 78);
  ctx.moveTo(cx - 7, cy + dir * 70);
  ctx.lineTo(cx, cy + dir * 80);
  ctx.lineTo(cx + 7, cy + dir * 70);
  ctx.stroke();
  ctx.restore();

  glowText(ctx, `${down ? 'P1' : 'P2'} 发球`, cx, cy - 44, {
    size: 15,
    color: 'rgba(232,240,252,0.92)',
    glow: down ? ACCENT : ACCENT2,
  });
  glowText(ctx, '空格 / 点击 立即发球', cx, cy + 96, {
    size: 11,
    color: 'rgba(147,168,195,0.75)',
  });
}

function drawOver(ctx, state) {
  ctx.save();
  ctx.fillStyle = 'rgba(5,9,18,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const win = state.winner === 'p1';
  glowText(ctx, win ? 'P1 获胜' : 'P2 获胜', W / 2, H / 2 - 14, {
    size: 34,
    color: '#eef6ff',
    glow: win ? ACCENT : ACCENT2,
  });
  glowText(ctx, `${state.score.p1} : ${state.score.p2}`, W / 2, H / 2 + 34, {
    size: 18,
    color: 'rgba(232,240,252,0.92)',
    glow: win ? ACCENT2 : ACCENT,
  });
}

export function render(ctx, state, view) {
  const w = view.w || W;
  const h = view.h || H;
  const time = Number.isFinite(view.time) ? view.time : 0;
  const mode = view.mode || state.mode || 'solo';

  drawBackdrop(ctx, w, h, ACCENT);
  drawTable(ctx, time);

  ctx.save();
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(147,168,195,0.5)';
  ctx.fillText('先到 7 分 · 失分方发球 · 拍不过中线', w / 2, 8);
  ctx.restore();

  drawBigScore(ctx, state, mode);
  drawPaddle(ctx, state.paddles?.p1, 'p1', time, mode);
  drawPaddle(ctx, state.paddles?.p2, 'p2', time, mode);
  drawDisc(ctx, state);
  drawServe(ctx, state, time);
  if (state.over) drawOver(ctx, state);
}
