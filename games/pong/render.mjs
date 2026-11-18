/**
 * 乒乓对决 · 霓虹渲染（480×640）。
 * 只读 logic.state()，不改游戏状态；动画相位用 view.time。
 */
import { drawBackdrop, roundRect, glowText } from '../../shared/engine.js';

const ACCENT = '#f472b6';
const ACCENT2 = '#fb7185';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const WALL_L = 16;
const WALL_R = 464;

function drawCourt(ctx, w, h, time) {
  const pulse = 0.7 + Math.sin(time * 2.2) * 0.12;

  // 左右边墙（球会反弹的实体墙）
  ctx.save();
  ctx.strokeStyle = `rgba(244,114,182,${0.32 * pulse})`;
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(WALL_L, 0);
  ctx.lineTo(WALL_L, h);
  ctx.moveTo(WALL_R, 0);
  ctx.lineTo(WALL_R, h);
  ctx.stroke();
  ctx.restore();

  // 中线虚线
  ctx.save();
  ctx.strokeStyle = 'rgba(232,237,247,0.28)';
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 14]);
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(WALL_L + 4, h / 2);
  ctx.lineTo(WALL_R - 4, h / 2);
  ctx.stroke();
  ctx.restore();

  // 中圈
  ctx.save();
  ctx.strokeStyle = 'rgba(251,113,133,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 上下边线（失分线）淡描
  ctx.save();
  ctx.strokeStyle = 'rgba(232,237,247,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WALL_L, 3);
  ctx.lineTo(WALL_R, 3);
  ctx.moveTo(WALL_L, h - 3);
  ctx.lineTo(WALL_R, h - 3);
  ctx.stroke();
  ctx.restore();
}

function drawBigScore(ctx, state, w, h) {
  const items = [
    { side: 'p1', color: ACCENT, y: h / 2 - 104 },
    { side: 'p2', color: ACCENT2, y: h / 2 + 104 },
  ];
  for (const it of items) {
    const value = state.score ? state.score[it.side] : 0;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.font = `900 116px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = it.color;
    ctx.shadowColor = it.color;
    ctx.shadowBlur = 26;
    ctx.fillText(String(value), w / 2, it.y);
    ctx.restore();

    // 比分旁的小字：先到 11 分
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = it.color;
    ctx.fillText(it.side === 'p1' ? '上方 · P1' : '下方 · P2', w / 2, it.y + 62);
    ctx.restore();
  }
}

function drawPaddles(ctx, state, time) {
  const sides = [
    { side: 'p1', color: ACCENT, other: ACCENT2 },
    { side: 'p2', color: ACCENT2, other: ACCENT },
  ];
  for (const { side, color, other } of sides) {
    const p = state.paddles ? state.paddles[side] : null;
    if (!p) continue;
    const pulse = 0.75 + Math.sin(time * 3 + (side === 'p1' ? 0 : Math.PI)) * 0.18;

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    const grad = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, other);
    ctx.fillStyle = grad;
    roundRect(ctx, p.x, p.y, p.w, p.h, 6);
    ctx.fill();
    ctx.restore();

    // 拍子两端的接点，强调"落点"判定
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    for (const dx of [3, p.w - 3]) {
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y + p.h / 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 标签 + AI 标记
    const isAi = (state.mode === 'solo' || state.mode === 'ai') && side === 'p1';
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    const label = isAi ? 'P1 · AI' : side === 'p1' ? 'P1' : 'P2';
    const ty = side === 'p1' ? p.y - 12 : p.y + p.h + 14;
    ctx.fillText(label, WALL_L + 4, ty);
    ctx.restore();
  }
}

function drawBall(ctx, state) {
  const b = state.ball;
  if (!b) return;
  const trail = Array.isArray(b.trail) ? b.trail : [];

  // 拖尾：越旧越淡越小
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const k = (i + 1) / trail.length;
    ctx.save();
    ctx.globalAlpha = k * 0.5;
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(t.x, t.y, b.r * k * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 外圈光晕
  ctx.save();
  ctx.strokeStyle = 'rgba(251,113,133,0.55)';
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 球芯
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawServe(ctx, state, w, h, time) {
  if (!state.serving) return;
  const b = state.ball;
  const down = state.serverSide === 'p1';
  const pulse = 0.55 + Math.sin(time * 5) * 0.3;

  // 发球方向的箭头
  if (b) {
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = down ? ACCENT : ACCENT2;
    ctx.lineWidth = 2;
    ctx.shadowColor = down ? ACCENT : ACCENT2;
    ctx.shadowBlur = 12;
    const y0 = down ? b.y + 14 : b.y - 14;
    const y1 = down ? b.y + 40 : b.y - 40;
    ctx.beginPath();
    ctx.moveTo(b.x, y0);
    ctx.lineTo(b.x, y1);
    ctx.moveTo(b.x - 6, y1 + (down ? -8 : 8));
    ctx.lineTo(b.x, y1);
    ctx.lineTo(b.x + 6, y1 + (down ? -8 : 8));
    ctx.stroke();
    ctx.restore();
  }

  glowText(ctx, '点击 / 空格 立即发球', w / 2, h / 2 + 2, {
    size: 14,
    color: 'rgba(232,237,247,0.85)',
    glow: down ? ACCENT : ACCENT2,
  });
  glowText(ctx, `${down ? 'P1' : 'P2'} 发球`, w / 2, h / 2 + 28, {
    size: 12,
    color: 'rgba(147,160,184,0.9)',
  });
}

function drawOver(ctx, state, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,9,16,0.66)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const win = state.winner === 'p1';
  glowText(ctx, win ? 'P1 获胜' : 'P2 获胜', w / 2, h / 2 - 18, {
    size: 32,
    color: '#e8edf7',
    glow: win ? ACCENT : ACCENT2,
  });
  glowText(ctx, `${state.score.p1} : ${state.score.p2}`, w / 2, h / 2 + 28, {
    size: 18,
    color: 'rgba(232,237,247,0.9)',
    glow: win ? ACCENT2 : ACCENT,
  });
}

export function render(ctx, state, view) {
  const w = view.w || 480;
  const h = view.h || 640;
  const time = Number.isFinite(view.time) ? view.time : 0;

  drawBackdrop(ctx, w, h, ACCENT);
  drawCourt(ctx, w, h, time);
  // 规则提示（很淡，不抢比分）
  ctx.save();
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(147,160,184,0.5)';
  ctx.fillText('先到 11 分 · 失分方发球', w / 2, 8);
  ctx.restore();
  drawBigScore(ctx, state, w, h);
  drawPaddles(ctx, state, time);
  drawBall(ctx, state);
  drawServe(ctx, state, w, h, time);
  if (state.over) drawOver(ctx, state, w, h);
}
