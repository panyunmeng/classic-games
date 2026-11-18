/**
 * 麻将消除 · Canvas 渲染（480×640，深色霓虹）。
 *
 * 只读 state，不改逻辑；所有动效时间取 view.time（performance.now 派生的单调秒），
 * 与逻辑层完全解耦：消除闪烁、选中呼吸、重排扫光都由渲染层自己计时。
 *
 * 深度表达：层数越高牌面越亮、投影越近；下层牌在四周露出一圈边，
 * 于是「梯形堆叠 + 每侧露半张」在俯视图里也能看出层次。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { TILE } from './layout.mjs';

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const ACCENT = '#38bdf8';
const ACCENT2 = '#f9a8d4';
const MUTED = 'rgba(148,163,184,0.92)';

/** 7 种图案配色：● ◆ ▲ ■ ★ ♥ ♠ */
const SYMBOL_COLORS = ['#38bdf8', '#f9a8d4', '#6cf0a8', '#fbbf24', '#c084fc', '#fb7185', '#7dd3fc'];

/** 各层牌面渐变：越高越亮，低层压暗，配合投影读出厚度 */
const LAYER_FILL = [
  ['#1a2438', '#101827'],
  ['#202c44', '#151f31'],
  ['#27354f', '#19243a'],
  ['#2f3f5c', '#1d2a43'],
];

const FLASH_MS = 0.42;
const SHUFFLE_MS = 0.38;
const SELECT_PULSE = 0.9;

let flashKey = '';
let flashAt = -100;
let flashIds = [];
let shuffleKey = -1;
let shuffleAt = -100;

/** 程序化图案（无图片资源） */
function drawSymbol(ctx, symbol, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = SYMBOL_COLORS[symbol % SYMBOL_COLORS.length];
  switch (symbol % 7) {
    case 0: // ●
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1: // ◆
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.06);
      ctx.lineTo(cx + r * 0.94, cy);
      ctx.lineTo(cx, cy + r * 1.06);
      ctx.lineTo(cx - r * 0.94, cy);
      ctx.closePath();
      ctx.fill();
      break;
    case 2: // ▲
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.02);
      ctx.lineTo(cx + r * 1.02, cy + r * 0.78);
      ctx.lineTo(cx - r * 1.02, cy + r * 0.78);
      ctx.closePath();
      ctx.fill();
      break;
    case 3: // ■
      roundRect(ctx, cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8, r * 0.26);
      ctx.fill();
      break;
    case 4: {
      // ★ 五角星
      const R = r * 1.12;
      const R2 = r * 0.46;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? R : R2;
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 5: // ♥
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.92);
      ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.18, cx - r * 0.76, cy - r * 1.28, cx, cy - r * 0.46);
      ctx.bezierCurveTo(cx + r * 0.76, cy - r * 1.28, cx + r * 1.6, cy - r * 0.18, cx, cy + r * 0.92);
      ctx.closePath();
      ctx.fill();
      break;
    default: {
      // ♠ 倒心 + 柄
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.06);
      ctx.bezierCurveTo(cx - r * 1.56, cy + r * 0.12, cx - r * 0.72, cy + r * 1.12, cx, cy + r * 0.28);
      ctx.bezierCurveTo(cx + r * 0.72, cy + r * 1.12, cx + r * 1.56, cy + r * 0.12, cx, cy - r * 1.06);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.18);
      ctx.lineTo(cx + r * 0.2, cy + r * 0.96);
      ctx.lineTo(cx - r * 0.2, cy + r * 0.96);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 一张牌：投影 + 牌面 + 斜角高光 + 图案 */
function drawTile(ctx, t, { selected, dim, time }) {
  const pad = 2.5;
  const x = t.x + pad;
  const y = t.y + pad;
  const w = t.w - pad * 2;
  const h = t.h - pad * 2;
  const layer = Math.max(0, Math.min(LAYER_FILL.length - 1, t.layer));

  // 投影：层越高压得越实（阴影偏移小），读起来像一摞牌
  ctx.save();
  ctx.shadowColor = 'rgba(2,6,16,0.72)';
  ctx.shadowBlur = 10 + layer * 2;
  ctx.shadowOffsetY = 5 + (LAYER_FILL.length - 1 - layer);
  ctx.fillStyle = 'rgba(6,10,20,0.9)';
  roundRect(ctx, x, y, w, h, 11);
  ctx.fill();
  ctx.restore();

  // 牌面
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, LAYER_FILL[layer][0]);
  grad.addColorStop(1, LAYER_FILL[layer][1]);
  ctx.save();
  ctx.globalAlpha = dim ? 0.82 : 1;
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, 11);
  ctx.fill();

  // 斜面高光 / 底边暗线：假的厚度
  ctx.strokeStyle = `rgba(255,255,255,${0.1 + layer * 0.035})`;
  ctx.lineWidth = 1.4;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(2,6,14,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + h - 1.5);
  ctx.lineTo(x + w - 6, y + h - 1.5);
  ctx.stroke();

  // 图案
  drawSymbol(ctx, t.symbol, t.x + t.w / 2, t.y + t.h / 2 + 1, TILE * 0.24);
  ctx.restore();

  // 选中：呼吸描边
  if (selected) {
    const pulse = 0.55 + 0.45 * Math.sin(time * SELECT_PULSE * 6);
    ctx.save();
    ctx.strokeStyle = ACCENT2;
    ctx.lineWidth = 3;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 14 * pulse + 6;
    roundRect(ctx, x, y, w, h, 11);
    ctx.stroke();
    ctx.restore();
  }
}

/** 消除闪烁：扩散圆环 + 渐隐残影 */
function drawRemovalFlash(ctx, tiles, age) {
  const k = Math.max(0, Math.min(1, age / FLASH_MS));
  if (k >= 1) return;
  for (const id of flashIds) {
    const t = tiles[id];
    if (!t) continue;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.9;
    ctx.strokeStyle = SYMBOL_COLORS[t.symbol % SYMBOL_COLORS.length];
    ctx.lineWidth = 3 * (1 - k) + 0.5;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, 12 + k * 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = (1 - k) * 0.35;
    ctx.fillStyle = SYMBOL_COLORS[t.symbol % SYMBOL_COLORS.length];
    roundRect(ctx, t.x + 2, t.y + 2, t.w - 4, t.h - 4, 11);
    ctx.fill();
    ctx.restore();
  }
}

/** 重排扫光：一道斜向高光掠过牌堆 */
function drawShuffleSweep(ctx, stackBox, age) {
  const k = Math.max(0, Math.min(1, age / SHUFFLE_MS));
  if (k >= 1) return;
  ctx.save();
  ctx.beginPath();
  const x = stackBox.x - 30 + (stackBox.w + 60) * k;
  ctx.rect(stackBox.x, stackBox.y, stackBox.w, stackBox.h);
  ctx.clip();
  const g = ctx.createLinearGradient(x - 60, 0, x + 60, 0);
  g.addColorStop(0, 'rgba(56,189,248,0)');
  g.addColorStop(0.5, 'rgba(249,168,212,0.32)');
  g.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 60, stackBox.y, 120, stackBox.h);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  const t = view.time;

  // 消除闪烁 / 重排扫光的时间戳
  const key = state.lastRemoved ? `${state.steps}:${state.lastRemoved.ids.join('-')}` : '';
  if (state.lastRemoved && key !== flashKey) {
    flashKey = key;
    flashAt = t;
    flashIds = state.lastRemoved.ids.slice();
  }
  if (state.shuffles !== shuffleKey) {
    if (shuffleKey >= 0) shuffleAt = t;
    shuffleKey = state.shuffles;
  }

  const tiles = state.tiles;
  const alive = tiles.filter((x) => !x.removed);
  const stackBox = { x: 20, y: 186, w: 440, h: 254 };

  // 牌堆底台：把「一摞牌」托起来
  ctx.save();
  const plate = ctx.createLinearGradient(0, stackBox.y, 0, stackBox.y + stackBox.h);
  plate.addColorStop(0, 'rgba(56,189,248,0.10)');
  plate.addColorStop(1, 'rgba(56,189,248,0.02)');
  ctx.fillStyle = plate;
  ctx.strokeStyle = 'rgba(56,189,248,0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, stackBox.x, stackBox.y, stackBox.w, stackBox.h, 22);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 顶部：标题 / 计时 / 进度条 / 统计
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText('麻将消除', view.w / 2, 38);

  const low = state.timeLeft <= 6;
  const timeColor = state.over ? MUTED : low ? '#ff7a7a' : ACCENT;
  ctx.fillStyle = timeColor;
  ctx.font = `800 ${low && !state.over ? 30 : 28}px ${FONT}`;
  const timeText = `${Math.max(0, state.timeLeft).toFixed(1)}s`;
  ctx.fillText(timeText, view.w / 2, 72);

  // 进度条：满格按初始 30 秒计，加时后可以超出（封顶显示）
  const ratio = Math.max(0, Math.min(1, state.timeLeft / Math.max(1, state.startTime)));
  const barX = 78;
  const barY = 84;
  const barW = view.w - barX * 2;
  ctx.fillStyle = 'rgba(148,163,184,0.18)';
  roundRect(ctx, barX, barY, barW, 8, 4);
  ctx.fill();
  if (ratio > 0) {
    const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    g.addColorStop(0, low ? '#fb7185' : ACCENT);
    g.addColorStop(1, low ? '#ff9f7a' : ACCENT2);
    ctx.fillStyle = g;
    roundRect(ctx, barX, barY, Math.max(6, barW * ratio), 8, 4);
    ctx.fill();
  }

  ctx.fillStyle = MUTED;
  ctx.font = `13px ${FONT}`;
  ctx.fillText(
    `剩余 ${state.pairsLeft} 对 · 步数 ${state.steps} · 重排 ${state.shuffles}`,
    view.w / 2,
    116
  );
  ctx.restore();

  // 牌堆：自下而上绘制，保证上层盖住下层
  const layers = state.layers.length;
  for (let layer = 0; layer < layers; layer++) {
    for (const tile of tiles) {
      if (tile.removed || tile.layer !== layer) continue;
      drawTile(ctx, tile, {
        selected: state.selected === tile.id,
        dim: !tile.free,
        time: t,
      });
    }
  }

  drawRemovalFlash(ctx, tiles, t - flashAt);
  drawShuffleSweep(ctx, stackBox, t - shuffleAt);

  // 底部提示 / 结算文案
  ctx.save();
  ctx.textAlign = 'center';
  if (state.over) {
    ctx.fillStyle = state.solved ? ACCENT2 : MUTED;
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText(state.solved ? '全部消除！' : state.dead ? '残局无解' : '时间到', view.w / 2, 520);
    ctx.fillStyle = 'rgba(148,163,184,0.75)';
    ctx.font = `12px ${FONT}`;
    ctx.fillText(
      state.solved ? `用 ${state.steps} 步清空牌堆` : `还剩 ${state.remaining} 张`,
      view.w / 2,
      544
    );
  } else {
    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText('点两张相同图案的顶层牌消除', view.w / 2, 522);
    ctx.fillStyle = 'rgba(100,116,139,0.95)';
    ctx.font = `12px ${FONT}`;
    ctx.fillText('被上层压住的牌点不动 · 每消一对 +3 秒', view.w / 2, 546);
    // 剩余牌数小徽标
    ctx.fillStyle = 'rgba(56,189,248,0.14)';
    roundRect(ctx, view.w / 2 - 54, 566, 108, 26, 13);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.35)';
    ctx.lineWidth = 1;
    roundRect(ctx, view.w / 2 - 54, 566, 108, 26, 13);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(`${alive.length} 张待消`, view.w / 2, 583);
  }
  ctx.restore();
}
