/**
 * 贪吃蛇大作战 · 霓虹渲染（480×640）。
 * 只读 state，不改游戏状态；动画相位只用 view.time。
 *
 * 坐标事实：网格 29×35、CELL=16，棋盘从 (8,64) 开始，所以 HUD 固定占顶部 64 px，
 * 棋盘刚好铺满其余空间，不需要按窗口尺寸做分支。
 */
import { drawBackdrop, roundRect, glowText } from '../../shared/engine.js';
import { W, H, CELL, COLS, ROWS, OFF_X, OFF_Y, TIME_TOTAL } from './logic.mjs';

const ACCENT = '#4ade80';
const ACCENT2 = '#22d3ee';
const FOOD = '#fbbf24';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const FIELD_W = COLS * CELL;
const FIELD_H = ROWS * CELL;

const DIR_VEC = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

function rgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, a) {
  const c = rgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/** 线性混色：t=0 取 a，t=1 取 b */
function mix(a, b, t) {
  const ca = rgb(a);
  const cb = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ca.r + (cb.r - ca.r) * k);
  const g = Math.round(ca.g + (cb.g - ca.g) * k);
  const bl = Math.round(ca.b + (cb.b - ca.b) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

function px(x) {
  return OFF_X + x * CELL;
}

function py(y) {
  return OFF_Y + y * CELL;
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function drawArena(ctx, time) {
  const pulse = 0.22 + Math.sin(time * 1.8) * 0.05;

  ctx.save();
  ctx.fillStyle = 'rgba(5, 10, 18, 0.72)';
  roundRect(ctx, OFF_X - 2, OFF_Y - 2, FIELD_W + 4, FIELD_H + 4, 12);
  ctx.fill();
  ctx.restore();

  // 网格：一条路径画完再描一次
  ctx.save();
  ctx.strokeStyle = rgba(ACCENT, 0.065);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= COLS; x++) {
    ctx.moveTo(px(x), OFF_Y);
    ctx.lineTo(px(x), OFF_Y + FIELD_H);
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.moveTo(OFF_X, py(y));
    ctx.lineTo(OFF_X + FIELD_W, py(y));
  }
  ctx.stroke();
  ctx.restore();

  // 四角括号：把「围墙」讲清楚（撞上就出局）
  const corner = 26;
  ctx.save();
  ctx.strokeStyle = rgba(ACCENT2, 0.55 + pulse * 0.3);
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  const corners = [
    [OFF_X - 2, OFF_Y - 2, 1, 1],
    [OFF_X + FIELD_W + 2, OFF_Y - 2, -1, 1],
    [OFF_X - 2, OFF_Y + FIELD_H + 2, 1, -1],
    [OFF_X + FIELD_W + 2, OFF_Y + FIELD_H + 2, -1, -1],
  ];
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of corners) {
    ctx.moveTo(cx, cy + sy * corner);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * corner, cy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFoods(ctx, foods, time) {
  if (!Array.isArray(foods) || !foods.length) return;

  ctx.save();
  ctx.shadowColor = FOOD;
  ctx.shadowBlur = 12;
  ctx.fillStyle = FOOD;
  ctx.beginPath();
  for (const food of foods) {
    const cx = px(food.x) + CELL / 2;
    const cy = py(food.y) + CELL / 2;
    const pulse = 1 + Math.sin(time * 4.2 + food.x * 0.7 + food.y * 1.3) * 0.14;
    ctx.moveTo(cx + 4.4 * pulse, cy);
    ctx.arc(cx, cy, 4.4 * pulse, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  // 高光点，让食物看起来在发光而不是一块色块
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  for (const food of foods) {
    const cx = px(food.x) + CELL / 2;
    const cy = py(food.y) + CELL / 2;
    ctx.moveTo(cx + 0.2, cy - 1.4);
    ctx.arc(cx - 1.1, cy - 1.4, 1.3, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

function drawSnake(ctx, snake) {
  const segs = Array.isArray(snake.segments) ? snake.segments : [];
  if (!segs.length) return;
  const color = snake.color || ACCENT;

  // 身段：从尾画到头，颜色与圆角都随位置渐变
  for (let i = segs.length - 1; i >= 1; i--) {
    const t = i / Math.max(1, segs.length - 1);
    const pad = 1.6 + t * 0.9;
    ctx.fillStyle = mix(color, '#081018', 0.12 + t * 0.6);
    roundRect(ctx, px(segs[i].x) + pad, py(segs[i].y) + pad, CELL - pad * 2, CELL - pad * 2, 5.6 - t * 2.2);
    ctx.fill();
  }

  const head = segs[0];
  const cx = px(head.x) + CELL / 2;
  const cy = py(head.y) + CELL / 2;
  const vec = DIR_VEC[snake.dir] || DIR_VEC.right;

  // 圆头 + 径向渐变
  const grad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, CELL * 0.62);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, mix(color, '#081018', 0.4));
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, CELL * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 眼睛：朝向决定瞳孔位置
  const sx = -vec.y;
  const sy = vec.x;
  for (const side of [1, -1]) {
    const ex = cx + vec.x * 3.4 + sx * 4.1 * side;
    const ey = cy + vec.y * 3.4 + sy * 4.1 * side;
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a1220';
    ctx.beginPath();
    ctx.arc(ex + vec.x * 0.9, ey + vec.y * 0.9, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 头顶小铭牌：4 条蛇同场时，先分清哪条是自己
  ctx.save();
  ctx.font = `700 9px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = rgba(color, 0.95);
  ctx.shadowColor = 'rgba(5,10,18,0.9)';
  ctx.shadowBlur = 4;
  ctx.fillText(snake.name || snake.id, cx, cy - CELL * 0.62);
  ctx.restore();
}

function drawHud(ctx, state, w, seat) {
  const snakes = Array.isArray(state.snakes) ? state.snakes : [];
  const total = Number(state.total) || snakes.length || 1;
  const alive = Number.isFinite(state.aliveCount) ? state.aliveCount : snakes.filter((s) => s.alive).length;
  const left = Number(state.timeLeft) || 0;
  const ratio = Math.max(0, Math.min(1, left / (state.timeTotal || TIME_TOTAL)));

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = `700 12px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.92)';
  ctx.fillText(`存活 ${alive}/${total}`, OFF_X, 16);

  ctx.textAlign = 'center';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = left <= 15 ? '#f87171' : '#e8edf7';
  ctx.fillText(fmtTime(left), w / 2, 16);

  // 联机拿不到“我的分”（state 是服务端公共快照），按自己的座位取
  const mine = seat ? snakes.find((s) => s.id === seat) : null;
  const scoreValue = mine ? mine.score : Number(state.score) || 0;
  ctx.textAlign = 'right';
  ctx.font = `700 12px ${FONT}`;
  ctx.fillStyle = rgba(ACCENT, 0.95);
  ctx.fillText(`得分 ${scoreValue}`, OFF_X + FIELD_W, 16);
  ctx.restore();

  // 每条蛇一条小信息条：名字 + 体长，出局变灰
  const n = Math.max(1, snakes.length);
  const gap = 5;
  const cw = (FIELD_W - gap * (n - 1)) / n;
  for (let i = 0; i < snakes.length; i++) {
    const snake = snakes[i];
    const x = OFF_X + i * (cw + gap);
    const y = 27;
    const dead = snake.alive === false;

    ctx.save();
    ctx.fillStyle = dead ? 'rgba(255,255,255,0.03)' : rgba(snake.color || ACCENT, 0.1);
    roundRect(ctx, x, y, cw, 17, 6);
    ctx.fill();
    ctx.fillStyle = dead ? 'rgba(147,160,184,0.45)' : snake.color || ACCENT;
    ctx.beginPath();
    ctx.arc(x + 7, y + 8.5, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dead ? 'rgba(147,160,184,0.6)' : 'rgba(232,237,247,0.92)';
    const len = snake.alive ? snake.length : snake.bestLength;
    ctx.fillText(dead ? `${snake.name} 出局` : `${snake.name} ${len}`, x + 13, y + 9);
    ctx.restore();
  }

  // 剩余时间条
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, OFF_X, 50, FIELD_W, 4, 2);
  ctx.fill();
  if (ratio > 0) {
    const grad = ctx.createLinearGradient(OFF_X, 0, OFF_X + FIELD_W, 0);
    grad.addColorStop(0, ACCENT2);
    grad.addColorStop(1, ACCENT);
    ctx.fillStyle = grad;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 8;
    roundRect(ctx, OFF_X, 50, Math.max(2, FIELD_W * ratio), 4, 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOver(ctx, state, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(5, 9, 16, 0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const soloLike = state.mode === 'solo' || state.mode === 'ai';
  let title;
  if (state.winner === 'draw') title = '同归于尽';
  else if (soloLike) title = state.winner === 'p1' ? '存活到最后' : '惜败';
  else title = `${String(state.winner || '').toUpperCase()} 获胜`;

  glowText(ctx, title, w / 2, h / 2 - 40, {
    size: 30,
    color: '#e8edf7',
    glow: state.winner === 'p1' || state.winner === 'draw' ? ACCENT : ACCENT2,
  });

  const snakes = Array.isArray(state.snakes) ? state.snakes : [];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 13px ${FONT}`;
  snakes.forEach((snake, i) => {
    const len = snake.alive ? snake.length : snake.bestLength;
    ctx.fillStyle = snake.alive ? rgba(snake.color || ACCENT, 0.95) : 'rgba(147,160,184,0.7)';
    ctx.fillText(`${snake.name} · ${len} 节 · ${snake.score} 分`, w / 2, h / 2 + 2 + i * 20);
  });
  ctx.restore();
}

export function render(ctx, state, view) {
  const w = view && view.w ? view.w : W;
  const h = view && view.h ? view.h : H;
  const time = view && Number.isFinite(view.time) ? view.time : 0;
  if (!state) return;

  drawBackdrop(ctx, w, h, ACCENT);
  drawArena(ctx, time);
  drawFoods(ctx, state.foods, time);

  for (const snake of Array.isArray(state.snakes) ? state.snakes : []) {
    if (snake.alive) drawSnake(ctx, snake);
  }

  const seat = view && view.shell && view.shell.online ? view.shell.online.seat : null;
  drawHud(ctx, state, w, seat);
  if (state.over) drawOver(ctx, state, w, h);
}
