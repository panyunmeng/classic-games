/**
 * 记忆翻牌 · Canvas 渲染（480×640，深色霓虹）。
 *
 * 动画规则：state.flipped 长度变 2 时，渲染层记下 view.time 作为 mismatch 展示起点；
 * 0.75s 内两张正面可见，到时后视觉翻回（不改 state）；逻辑层在下一次 flip 时才清状态。
 * 卡片背面用程序化霓虹网格 + 圆环图案，无外部图片。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { levelConfig, boardLayout } from './layout.mjs';

const ACCENT = '#c084fc';
const ACCENT2 = '#f0abfc';
const MISMATCH_MS = 0.75;
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

let lastFlipKey = '';
let mismatchAt = 0;
let lastStateKey = '';
let timerStart = 0;
let timerRunning = false;
let timerFrozen = 0;

function faceColor(symbolIndex) {
  const palette = [
    '#c084fc', '#f0abfc', '#6ad9ff', '#6cf0a8', '#f2b84b', '#ff8a5c',
    '#f472b6', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185',
  ];
  return palette[symbolIndex % palette.length];
}

function drawCardBack(ctx, x, y, w, h, t, idx) {
  ctx.save();
  // 底板
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(192,132,252,0.18)');
  grad.addColorStop(1, 'rgba(24,18,44,0.92)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = 'rgba(192,132,252,0.55)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(192,132,252,0.25)';
  ctx.shadowBlur = 10;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 程序化图案：同心菱形 + 缓慢呼吸的圆环
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.28;
  const pulse = 1 + 0.06 * Math.sin(t * 2 + idx * 0.7);
  ctx.strokeStyle = 'rgba(240,171,252,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * pulse);
  ctx.lineTo(cx + r * pulse, cy);
  ctx.lineTo(cx, cy + r * pulse);
  ctx.lineTo(cx - r * pulse, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.52 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240,171,252,0.75)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCardFace(ctx, x, y, w, h, symbol, symbolIndex, matched, t) {
  const color = faceColor(symbolIndex);
  ctx.save();
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(14,20,34,0.98)');
  grad.addColorStop(1, 'rgba(28,16,48,0.98)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = matched ? 'rgba(108,240,168,0.85)' : color;
  ctx.lineWidth = matched ? 2 : 1.6;
  ctx.shadowColor = matched ? 'rgba(108,240,168,0.5)' : color;
  ctx.shadowBlur = matched ? 16 : 12;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.globalAlpha = matched ? 0.6 : 1;
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.floor(Math.min(w, h) * 0.44)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, x + w / 2, y + h / 2 + 2);
  if (matched) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#6cf0a8';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText('已配对', x + w / 2, y + h - 16);
  }
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  const t = view.time;
  const cfg = levelConfig(state.level);
  const layout = boardLayout(state.level, view.w, view.h);

  // 标题 / HUD
  // 秒表：第一张牌翻开时启动，胜利时停；只用 view.time，逻辑层不碰墙钟。
  const hasStarted = state.flipped.length > 0 || state.steps > 0 || state.matchedPairs > 0;
  if (!hasStarted && timerRunning) {
    timerRunning = false;
    timerStart = 0;
    timerFrozen = 0;
  }
  if (hasStarted && !timerRunning) {
    timerRunning = true;
    timerStart = t;
    timerFrozen = 0;
  }
  const elapsedSec = state.over
    ? (timerFrozen || (timerFrozen = Math.max(0, t - timerStart)))
    : timerRunning ? Math.max(0, t - timerStart) : 0;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText('记忆翻牌', view.w / 2, 42);
  ctx.fillStyle = 'rgba(148,163,184,0.92)';
  ctx.font = `13px ${FONT}`;
  ctx.fillText(`${cfg.label} · ${elapsedSec.toFixed(1)}s · 步数 ${state.steps} · 配对 ${state.matchedPairs}/${state.totalPairs}`, view.w / 2, 68);
  ctx.fillStyle = ACCENT;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText(`${state.score}`, view.w / 2, 108);
  ctx.restore();

  // mismatch 计时：flipped 从 <2 变为 2 时打时间戳
  const flipKey = `${state.level}:${state.flipped.join(',')}`;
  if (flipKey !== lastFlipKey) {
    if (state.flipped.length === 2) mismatchAt = t;
    lastFlipKey = flipKey;
  }
  const mismatchVisible = state.flipped.length === 2 && t - mismatchAt < MISMATCH_MS;

  // 若整局被重置（deck 变化），复位内部标记
  const stateKey = `${state.level}:${state.score}:${state.matchedPairs}:${state.steps}`;
  if (stateKey !== lastStateKey) {
    lastStateKey = stateKey;
    if (!state.flipped.length) lastFlipKey = '';
  }

  const flash = 0.5 + 0.5 * Math.sin(t * 6);
  for (let i = 0; i < layout.count; i++) {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const x = layout.x0 + col * (layout.cellW + layout.gap);
    const y = layout.y0 + row * (layout.cellH + layout.gap);
    const isMatched = state.matched[i];
    const isFlipped = state.flipped.includes(i);
    const isMismatchHidden = isFlipped && !mismatchVisible && !isMatched;

    if (isMatched || (isFlipped && !isMismatchHidden)) {
      const symIndex = state.deck[i];
      const symbol = state.symbols[symIndex] || '?';
      drawCardFace(ctx, x, y, layout.cellW, layout.cellH, symbol, symIndex, isMatched, t);
    } else if (isFlipped && isMismatchHidden) {
      // 视觉翻回：短暂用背面画一张，配合轻微透明过渡
      ctx.save();
      ctx.globalAlpha = 0.75 + 0.25 * flash;
      drawCardBack(ctx, x, y, layout.cellW, layout.cellH, t, i);
      ctx.restore();
    } else {
      drawCardBack(ctx, x, y, layout.cellW, layout.cellH, t, i);
    }
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(100,116,139,0.9)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText('点击两张相同图案配对 · 不同则短暂显示后翻回', view.w / 2, view.h - 22);
  ctx.restore();
}
