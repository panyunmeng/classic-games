/**
 * 引擎小工具：固定步长常量、画布适配、绘图辅助。
 *
 * 画布策略：逻辑分辨率固定（每款游戏在 game.json.canvas 里声明），按容器等比缩放，
 * DPR 上限 2。这样一套坐标同时适配手机竖屏、横屏和桌面，渲染代码不用写响应式分支。
 */

export const STEP = 1 / 60;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 把逻辑尺寸画布放进容器：返回 CSS 尺寸与缩放比，并重设 ctx 变换。
 */
export function fitCanvas({ canvas, stage, logical, ctx }) {
  const rect = stage.getBoundingClientRect();
  const availW = Math.max(1, rect.width - 4);
  const availH = Math.max(1, rect.height - 4);
  const scale = Math.min(availW / logical.w, availH / logical.h);
  const cssW = Math.max(1, Math.floor(logical.w * scale));
  const cssH = Math.max(1, Math.floor(logical.h * scale));

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(logical.w * dpr);
  canvas.height = Math.round(logical.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { scale, dpr, cssW, cssH };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 常见霓虹风发光文字，游戏内标题/分数用 */
export function glowText(ctx, text, x, y, { size = 20, color = '#e8edf7', glow = null } = {}) {
  ctx.save();
  ctx.font = `700 ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 画布背景：深色渐变 + 网格，36 款游戏共用，改这里全局生效 */
export function drawBackdrop(ctx, w, h, accent = '#6cf0a8') {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0b1120');
  g.addColorStop(1, '#070a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}
