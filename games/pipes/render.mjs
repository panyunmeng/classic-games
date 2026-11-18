/**
 * 管道连接 · 渲染。只读 logic.state()，不改状态。
 * 坐标系固定 480×640。深色工业风 + 圆头粗管 + 通水发光动画。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#22d3ee';
const ACCENT2 = '#67e8f9';
const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

function rotate(mask, n) {
  const k = ((n % 4) + 4) % 4;
  return ((mask << k) | (mask >> (4 - k))) & 15;
}

/** 每格当前开口方向掩码（端点固定 base） */
function curMask(cell) {
  return cell.type === 'endpoint' ? cell.base : rotate(cell.base, cell.rot);
}

/** 提示箭头：该格旋转到解状态时朝上的那条口应指向哪（显示一个目标朝向指示） */
function solMask(cell) {
  return cell.type === 'endpoint' ? cell.base : rotate(cell.base, cell.solRot);
}

const DIR_VEC = [
  [UP, 0, -1],
  [RIGHT, 1, 0],
  [DOWN, 0, 1],
  [LEFT, -1, 0],
];

// 墙钟计时起点：首次操作时记下 view.time，胜利时冻结（纯 UI 状态，不写回 game state）。
let startAt = null;
let frozen = 0;
let lastSeed = null;
let lastSteps = 0;

export function render(ctx, state, view) {
  const { w, h, time } = view;

  // 新局检测：seed 变化，或步数回退到 0（重置）
  if (lastSeed !== state.seed || state.steps < lastSteps) {
    startAt = null;
    frozen = 0;
  }
  lastSeed = state.seed;
  lastSteps = state.steps;
  if (state.steps > 0 && startAt === null && !state.solved) startAt = time;
  if (state.solved && startAt !== null && !frozen) frozen = time - startAt;
  const elapsed = state.solved ? frozen : startAt === null ? 0 : time - startAt;
  drawBackdrop(ctx, w, h, ACCENT);

  const n = state.n;
  const grid = state.grid;
  const endpoints = state.endpoints;
  const wet = state.wet || [];

  const pad = 26;
  const availW = w - pad * 2;
  const cell = Math.floor(Math.min(availW / n, 300 / n));
  const boardW = cell * n;
  const boardH = cell * n;
  const ox = Math.floor((w - boardW) / 2);
  const oy = 108;

  // 标题与状态
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText('管道连接', w / 2, 40);
  ctx.fillStyle = 'rgba(147,160,184,0.9)';
  ctx.font = `13px ${FONT}`;
  const src = endpoints.find((e) => e.role === 'source');
  const sinks = endpoints.filter((e) => e.role === 'sink').length;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
  ctx.fillText(`水源 ${src ? '1' : 0} · 终点 ${sinks} · 步数 ${state.steps} · 用时 ${mm}:${ss}`, w / 2, 62);
  if (state.solved) {
    ctx.fillStyle = ACCENT;
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText('✓ 全部连通', w / 2, 84);
  }
  ctx.restore();

  // 工业风底板
  ctx.save();
  ctx.shadowColor = 'rgba(34,211,238,0.18)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(9,16,26,0.92)';
  roundRect(ctx, ox - 10, oy - 10, boardW + 20, boardH + 20, 14);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(34,211,238,0.18)';
  ctx.lineWidth = 1;
  roundRect(ctx, ox - 10, oy - 10, boardW + 20, boardH + 20, 14);
  ctx.stroke();

  // 网格
  ctx.strokeStyle = 'rgba(103,232,249,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(ox + i * cell, oy);
    ctx.lineTo(ox + i * cell, oy + boardH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, oy + i * cell);
    ctx.lineTo(ox + boardW, oy + i * cell);
    ctx.stroke();
  }

  const lineW = Math.max(6, cell * 0.26);
  const isHint = (x, y) => state.hint && state.hint.x === x && state.hint.y === y;

  // 画所有管道（先暗管，再通水发光）
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const c = grid[i];
        if (!c) continue;
        const mask = curMask(c);
        const cx = ox + x * cell + cell / 2;
        const cy = oy + y * cell + cell / 2;
        const isWet = wet[i] === 1;
        if (pass === 0 && isWet) continue;
        if (pass === 1 && !isWet) continue;

        const active = pass === 1;
        // 通水脉冲：亮度随时间波动，流动感由虚线偏移产生
        const pulse = active ? 0.75 + 0.25 * Math.sin(time * 4 + i * 0.4) : 1;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (active) {
          ctx.strokeStyle = ACCENT;
          ctx.shadowColor = ACCENT;
          ctx.shadowBlur = 14 * pulse;
          ctx.globalAlpha = pulse;
        } else {
          ctx.strokeStyle = 'rgba(120,140,160,0.55)';
          ctx.shadowBlur = 0;
        }
        ctx.lineWidth = lineW;
        // 中心到每个开口画一条；端点单口也同理
        for (const [bit, dx, dy] of DIR_VEC) {
          if (!(mask & bit)) continue;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx * cell * 0.5, cy + dy * cell * 0.5);
          ctx.stroke();
        }
        // 中心圆点（弯管/三通/四通汇合处）
        ctx.beginPath();
        ctx.arc(cx, cy, lineW * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = active ? ACCENT2 : 'rgba(120,140,160,0.55)';
        if (active) ctx.shadowColor = ACCENT2;
        ctx.fill();
        ctx.restore();

        if (active) {
          // 流动高光：沿各开口画一小段亮色虚线
          ctx.save();
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(230,255,255,0.85)';
          ctx.lineWidth = lineW * 0.35;
          const t = (time * 0.9 + i * 0.13) % 1;
          for (const [bit, dx, dy] of DIR_VEC) {
            if (!(mask & bit)) continue;
            const len = cell * 0.5;
            const s = t * len;
            ctx.beginPath();
            ctx.moveTo(cx + dx * s, cy + dy * s);
            ctx.lineTo(cx + dx * Math.min(len, s + len * 0.22), cy + dy * Math.min(len, s + len * 0.22));
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
  }

  // 端点标记
  for (const e of endpoints) {
    const cx = ox + e.x * cell + cell / 2;
    const cy = oy + e.y * cell + cell / 2;
    const isSource = e.role === 'source';
    ctx.save();
    if (isSource) {
      ctx.shadowColor = ACCENT2;
      ctx.shadowBlur = 16 + 4 * Math.sin(time * 3);
      ctx.fillStyle = ACCENT2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#06232b';
      ctx.font = `700 ${Math.max(9, cell * 0.22)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('源', cx, cy);
    } else {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3;
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = wet[e.y * n + e.x] ? 18 : 6;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = wet[e.y * n + e.x] ? ACCENT : 'rgba(34,211,238,0.35)';
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 提示高亮：描边 + 正确方向箭头
  if (state.hint) {
    const hx = state.hint.x;
    const hy = state.hint.y;
    const c = grid[hy * n + hx];
    const rx = ox + hx * cell;
    const ry = oy + hy * cell;
    const blink = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.save();
    ctx.strokeStyle = `rgba(250,204,21,${0.5 + 0.5 * blink})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 12;
    roundRect(ctx, rx + 2, ry + 2, cell - 4, cell - 4, 6);
    ctx.stroke();
    // 用正确解朝向画一条虚线十字提示（目标形状轮廓），引导玩家旋转
    if (c) {
      const target = solMask(c);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(250,204,21,0.9)';
      ctx.lineWidth = lineW * 0.5;
      const cx = rx + cell / 2;
      const cy = ry + cell / 2;
      for (const [bit, dx, dy] of DIR_VEC) {
        if (!(target & bit)) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * cell * 0.5, cy + dy * cell * 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 图例
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.8)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText('点击管道顺时针旋转 90° · 让水从「源」流到所有终点', w / 2, h - 26);
  ctx.restore();
}
