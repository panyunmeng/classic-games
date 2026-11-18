/**
 * 敲地鼠 · Canvas 渲染。只读 state，不改状态。
 * 坐标固定 480×640（与 game.json.canvas 一致）。
 * 格子中心常量与 input.mjs 同源：CX=[120,240,360]，CY=[230,350,470]。
 */
import { roundRect, drawBackdrop, glowText } from '../../shared/engine.js';

const ACCENT = '#a3e635';
const ACCENT2 = '#fbbf24';
const CX = [120, 240, 360];
const CY = [230, 350, 470];
const FIELD = { x: 60, y: 170, w: 360, h: 360 };
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

// 锤子挥击：命中瞬间记墙钟（view.time），动画完全由 view.time 驱动
let hammerIndex = -1;
let hammerAt = -10;
let seenHitAt = -1;

function drawGrass(ctx, w, h, time) {
  drawBackdrop(ctx, w, h, ACCENT);

  ctx.save();
  ctx.shadowColor = 'rgba(163, 230, 53, 0.22)';
  ctx.shadowBlur = 26;
  const g = ctx.createLinearGradient(0, FIELD.y, 0, FIELD.y + FIELD.h);
  g.addColorStop(0, '#1d4a25');
  g.addColorStop(1, '#12331b');
  ctx.fillStyle = g;
  roundRect(ctx, FIELD.x - 12, FIELD.y - 12, FIELD.w + 24, FIELD.h + 24, 22);
  ctx.fill();
  ctx.restore();

  // 草纹用 view.time 做极慢摆动，纯视觉，不参与逻辑
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const gx = FIELD.x + 10 + ((i * 53) % 340);
    const gy = FIELD.y + ((i * 79) % 350);
    const sway = Math.sin(time * 1.4 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(gx, gy + 14);
    ctx.quadraticCurveTo(gx + sway, gy + 6, gx + sway * 1.5, gy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHole(ctx, cx, cy) {
  ctx.save();
  ctx.fillStyle = '#09170d';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 20, 44, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(163, 230, 53, 0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 20, 47, 20, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMole(ctx, i, type, time) {
  const cx = CX[i % 3];
  const cy = CY[Math.floor(i / 3)];
  const bob = Math.sin(time * 7 + i) * 2.5;
  const isGold = type === 'gold';
  const body = isGold ? '#eab308' : '#8b5a2b';
  const belly = isGold ? '#fde68a' : '#d9a066';

  ctx.save();
  ctx.shadowColor = isGold ? '#facc15' : 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = isGold ? 18 : 10;

  // 身体（椭圆，底部埋进洞里）
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2 + bob, 34, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 14 + bob, 23, 25, 0, 0, Math.PI * 2);
  ctx.fill();

  // 耳朵
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx - 27, cy - 20 + bob, 9, 0, Math.PI * 2);
  ctx.arc(cx + 27, cy - 20 + bob, 9, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(cx - 11, cy - 8 + bob, 7, 0, Math.PI * 2);
  ctx.arc(cx + 11, cy - 8 + bob, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.arc(cx - 10, cy - 7 + bob, 3.2, 0, Math.PI * 2);
  ctx.arc(cx + 12, cy - 7 + bob, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 鼻子 + 门牙
  ctx.fillStyle = '#f472b6';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 7 + bob, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff7ed';
  roundRect(ctx, cx - 6, cy + 12 + bob, 12, 8, 2);
  ctx.fill();
  ctx.restore();

  // 洞前沿遮住身体下缘，冒头感
  ctx.save();
  ctx.fillStyle = '#0d2414';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 24, 45, 14, 0, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

function drawHammer(ctx, state, time) {
  // 逻辑层 lastHitAt 是 elapsed 快照；变化即视为新的命中，记录墙钟基准
  if (state.lastHitAt !== seenHitAt) {
    seenHitAt = state.lastHitAt;
    hammerIndex = state.lastHitIndex;
    hammerAt = time;
  }
  const age = time - hammerAt;
  const swing = hammerIndex >= 0 ? Math.max(0, 1 - age / 0.28) : 0;

  ctx.save();
  if (swing > 0 && hammerIndex >= 0) {
    const cx = CX[hammerIndex % 3];
    const cy = CY[Math.floor(hammerIndex / 3)];
    const angle = -1.15 + (1 - swing) * 1.5;
    ctx.translate(cx + 30, cy - 58);
    ctx.rotate(angle);
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 16 + swing * 14;

    ctx.fillStyle = '#7c4a1e';
    roundRect(ctx, -5, -6, 10, 62, 5);
    ctx.fill();
    ctx.fillStyle = ACCENT2;
    roundRect(ctx, -30, -22, 60, 26, 8);
    ctx.fill();
    ctx.fillStyle = '#fef3c7';
    roundRect(ctx, -26, -19, 52, 6, 3);
    ctx.fill();
    ctx.restore();

    // 命中火花
    ctx.save();
    ctx.globalAlpha = swing;
    ctx.strokeStyle = ACCENT2;
    ctx.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 14, cy - 6 + Math.sin(a) * 14);
      ctx.lineTo(cx + Math.cos(a) * (24 + swing * 10), cy - 6 + Math.sin(a) * (24 + swing * 10));
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // 待机锤子：右下角，随 view.time 轻微摆动
  ctx.translate(408, 566);
  ctx.rotate(-0.5 + Math.sin(time * 2) * 0.08);
  ctx.fillStyle = '#7c4a1e';
  roundRect(ctx, -5, -6, 10, 62, 5);
  ctx.fill();
  ctx.fillStyle = ACCENT2;
  roundRect(ctx, -30, -22, 60, 26, 8);
  ctx.fill();
  ctx.fillStyle = '#fef3c7';
  roundRect(ctx, -26, -19, 52, 6, 3);
  ctx.fill();
  ctx.restore();
}

function drawHud(ctx, state, w) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232, 237, 247, 0.88)';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText('30 秒挑战 · 敲中冒头的地鼠', w / 2, 34);

  glowText(ctx, String(state.score), w / 2, 88, { size: 50, color: '#f8fafc', glow: ACCENT });

  ctx.textAlign = 'center';
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = state.combo >= 2 ? ACCENT2 : 'rgba(147, 160, 184, 0.9)';
  ctx.fillText(`连击 ×${state.combo}`, w / 2, 126);

  ctx.textAlign = 'right';
  ctx.font = `600 16px ${FONT}`;
  ctx.fillStyle = state.timeLeft <= 5 ? '#f87171' : 'rgba(232, 237, 247, 0.9)';
  ctx.fillText(`${state.timeLeft.toFixed(1)}s`, w - 24, 34);
  ctx.restore();
}

function drawOver(ctx, state, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(6, 12, 8, 0.5)';
  ctx.fillRect(0, 0, w, h);
  glowText(ctx, '时间到', w / 2, h / 2 - 78, { size: 40, color: '#f8fafc', glow: ACCENT });
  glowText(ctx, String(state.score), w / 2, h / 2 - 12, { size: 64, color: ACCENT2, glow: ACCENT2 });
  ctx.textAlign = 'center';
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = '#e8edf7';
  ctx.fillText(`最高连击 ×${state.maxCombo}`, w / 2, h / 2 + 40);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = 'rgba(147, 160, 184, 0.95)';
  ctx.fillText(`命中 ${state.hits} · 漏掉 ${state.misses}`, w / 2, h / 2 + 70);
  ctx.restore();
}

export function render(ctx, state, view) {
  const { w, h, time } = view;
  drawGrass(ctx, w, h, time);
  drawHud(ctx, state, w);

  for (let i = 0; i < state.holes.length; i++) {
    const hole = state.holes[i];
    drawHole(ctx, CX[i % 3], CY[Math.floor(i / 3)]);
    if (hole.active) drawMole(ctx, i, hole.type, time);
  }

  drawHammer(ctx, state, time);
  if (state.over) drawOver(ctx, state, w, h);
}
