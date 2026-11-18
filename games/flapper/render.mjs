/**
 * 单键飞行 · 渲染。只读 logic.state()，不改状态。
 * 坐标固定 480×640（与 game.json.canvas 一致）。
 * 深空霓虹：渐变管道、飞行器拖尾、云层视差（view.time）、分数大字。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#facc15';
const ACCENT2 = '#f97316';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

// 纯视觉拖尾：只在渲染层缓存位置，不改逻辑状态。
let trail = [];
let lastSteps = -1;

function pushTrail(s) {
  if (s.ready || s.steps < lastSteps || s.over) {
    if (s.ready || s.steps < lastSteps) trail = [];
  } else {
    trail.push({ x: s.player.x, y: s.player.y });
    if (trail.length > 16) trail.shift();
  }
  lastSteps = s.steps;
}

function drawClouds(ctx, w, h, time, scroll) {
  // 两层视差：近层随滚动快，远层慢；均用 view.time 做缓慢漂移。
  const layers = [
    { y: h * 0.22, speed: 0.18, alpha: 0.06, scale: 1.0, drift: 6 },
    { y: h * 0.62, speed: 0.42, alpha: 0.1, scale: 1.35, drift: 10 },
  ];
  ctx.save();
  for (const L of layers) {
    ctx.fillStyle = `rgba(186, 214, 255, ${L.alpha})`;
    const span = 300 * L.scale;
    const offset = ((scroll * L.speed + time * L.drift) % span + span) % span;
    for (let bx = -span + offset; bx < w + span; bx += span) {
      const cy = L.y + Math.sin((bx + time * 12) * 0.01) * 8;
      ctx.beginPath();
      ctx.arc(bx + 40 * L.scale, cy, 34 * L.scale, 0, Math.PI * 2);
      ctx.arc(bx + 82 * L.scale, cy + 10 * L.scale, 26 * L.scale, 0, Math.PI * 2);
      ctx.arc(bx + 14 * L.scale, cy + 12 * L.scale, 22 * L.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPipes(ctx, s) {
  for (const p of s.pipes) {
    const gapTop = p.gapY - s.gap / 2;
    const gapBottom = p.gapY + s.gap / 2;

    // 上管体：从顶部到缺口上缘；下管体：从缺口下缘到底部。
    const bodies = [
      { x: p.x, y: 0, w: s.pw, h: gapTop, capY: gapTop - 18 },
      { x: p.x, y: gapBottom, w: s.pw, h: s.h - gapBottom, capY: gapBottom },
    ];

    for (const b of bodies) {
      if (b.h <= 0) continue;
      const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
      g.addColorStop(0, '#3b2a5a');
      g.addColorStop(0.5, '#6d3fa8');
      g.addColorStop(1, '#3b2a5a');
      ctx.save();
      ctx.shadowColor = 'rgba(169, 92, 255, 0.35)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();

      // 管身竖线高光
      ctx.strokeStyle = 'rgba(196, 160, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x + 8, b.y);
      ctx.lineTo(b.x + 8, b.y + b.h);
      ctx.stroke();

      // 管口（缺口侧）加亮边
      const capY = Math.max(0, Math.min(s.h - 16, b.capY));
      ctx.save();
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 14;
      ctx.fillStyle = ACCENT2;
      roundRect(ctx, b.x - 4, capY, b.w + 8, 16, 4);
      ctx.fill();
      ctx.restore();
    }

    // 缺口上下的细引导线
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, gapTop);
    ctx.lineTo(p.x + s.pw, gapTop);
    ctx.moveTo(p.x, gapBottom);
    ctx.lineTo(p.x + s.pw, gapBottom);
    ctx.stroke();
  }
}

function drawPlayer(ctx, s, time) {
  const { x, y } = s.player;
  const r = s.r;

  // 拖尾：越旧越淡越小
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const k = (i + 1) / trail.length;
    ctx.save();
    ctx.globalAlpha = 0.05 + k * 0.35;
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r * (0.3 + k * 0.55), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 飞行器：发光圆点 + 内核 + 定向推进火花
  ctx.save();
  const pulse = 1 + Math.sin(time * 9) * 0.06;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 26;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2 * pulse);
  glow.addColorStop(0, 'rgba(255, 255, 230, 0.95)');
  glow.addColorStop(0.45, ACCENT);
  glow.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fffdf0';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.fill();

  // 简易姿态：上升时火花朝下，下落时朝上
  const dir = s.player.vy < 0 ? -1 : 1;
  ctx.shadowColor = ACCENT2;
  ctx.fillStyle = ACCENT2;
  ctx.beginPath();
  ctx.moveTo(x - 4, y + dir * (r + 3));
  ctx.lineTo(x + 4, y + dir * (r + 3));
  ctx.lineTo(x, y + dir * (r + 13 + Math.sin(time * 20) * 3));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawScore(ctx, s, w, h) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 76px ${FONT}`;
  ctx.shadowColor = 'rgba(250, 204, 21, 0.55)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#fff8e1';
  ctx.fillText(String(s.score), w / 2, h * 0.16);
  ctx.restore();
}

function drawHint(ctx, s, w, h) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232, 237, 247, 0.92)';
  ctx.font = `600 20px ${FONT}`;
  if (s.ready) {
    ctx.fillText('点击 / 空格 / ↑ 起飞', w / 2, h * 0.62);
    ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText('穿过光栅得 1 分 · 撞管道或边界即结束', w / 2, h * 0.62 + 26);
  } else if (s.over) {
    ctx.fillStyle = 'rgba(6, 9, 16, 0.62)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff8e1';
    ctx.font = `800 34px ${FONT}`;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 18;
    ctx.fillText('飞行结束', w / 2, h / 2 - 16);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(232, 237, 247, 0.95)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`得分 ${s.score}`, w / 2, h / 2 + 22);
    ctx.fillStyle = 'rgba(147, 160, 184, 0.85)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText('按 R 重开', w / 2, h / 2 + 52);
  }
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  pushTrail(state);
  drawClouds(ctx, view.w, view.h, view.time, state.scroll || 0);
  drawPipes(ctx, state);
  drawPlayer(ctx, state, view.time);
  drawScore(ctx, state, view.w, view.h);
  drawHint(ctx, state, view.w, view.h);
}
