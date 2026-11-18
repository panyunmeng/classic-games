/**
 * 蛇梯棋 · 渲染（只读 state，不改状态）。坐标系固定 480×640。
 *
 * 布局事实（与 game.json.canvas 对齐，不读 window 尺寸）：
 * - 10×10 格，格边 42px，盘面 420×420，左 30 / 上 102，盘面底边 522；
 * - 顶部 8～88 是回合条与玩家筹码，底部 538～604 是起点区 / 上一手 / 骰子；
 * - 格号与蛇形方向完全由 logic.cellOf 决定，渲染层只负责把 row 0 翻到底部，
 *   这样「编号顺序」只有一个来源，不会出现渲染和规则各算一遍还方向相反。
 *
 * 美术全程序化：格盘是 tint 方块 + 编号，蛇是正弦扰动折线 + 头，梯是双轨 + 踏板，
 * 棋子是径向渐变圆片。没有图片资源，符合合集「零外部素材」约束。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { SIZE, LAST, cellOf } from './logic.mjs';

const W = 480;
const H = 640;
const ACCENT = '#34d399';
const ACCENT2 = '#f472b6';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

// 棋盘几何
const CELL = 42;
const LEFT = 30;
const TOP = 102;
const BOARD = CELL * SIZE; // 420
const PLATE = { x: LEFT - 10, y: TOP - 10, w: BOARD + 20, h: BOARD + 20 };

// 玩家配色：只用程序化色板，p1 用主题绿，其余取高辨识度冷/暖色
const PLAYERS = [
  { base: '#34d399', light: '#bbf7d0' },
  { base: '#60a5fa', light: '#dbeafe' },
  { base: '#c084fc', light: '#f3e8ff' },
  { base: '#fb923c', light: '#ffedd5' },
];

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.29, 0.29], [0.71, 0.71]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.29, 0.29], [0.71, 0.29], [0.29, 0.71], [0.71, 0.71]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.3, 0.24], [0.3, 0.5], [0.3, 0.76], [0.7, 0.24], [0.7, 0.5], [0.7, 0.76]],
};

/** 格号 → 格中心屏幕坐标（row 0 是最底一行，要翻过来） */
function center(n) {
  const c = cellOf(n);
  if (!c) return null;
  return {
    x: LEFT + c.col * CELL + CELL / 2,
    y: TOP + (SIZE - 1 - c.row) * CELL + CELL / 2,
  };
}

const colorOf = (i) => PLAYERS[i % PLAYERS.length];

/* ── 顶部：回合条 + 玩家筹码 ─────────────────────────────── */

function drawBanner(ctx, state, time) {
  const players = state.players || [];
  const cur = players.find((p) => p.id === state.turn);
  const winner = players.find((p) => p.id === state.winner);
  const idx = winner ? players.indexOf(winner) : Math.max(0, players.indexOf(cur));
  const tone = colorOf(idx).base;

  ctx.save();
  roundRect(ctx, 24, 8, 432, 36, 18);
  ctx.fillStyle = 'rgba(148,163,184,0.09)';
  ctx.fill();
  ctx.strokeStyle = state.winner ? 'rgba(52,211,153,0.55)' : 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 当前行动方的色点；进行中时做呼吸，一眼能看出轮到谁
  const pulse = state.winner ? 1 : 0.72 + Math.sin((time || 0) * 3.2) * 0.22;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = tone;
  ctx.shadowColor = tone;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(46, 26, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = state.winner ? ACCENT : '#e8edf7';
  const label = state.winner
    ? `${winner ? winner.name : ''} 抵达 100 · 获胜`
    : (cur ? `轮到 ${cur.name} 掷骰` : '准备开始');
  ctx.fillText(label, 60, 27);

  ctx.textAlign = 'right';
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.fillText(state.winner ? `共 ${state.moveCount} 手` : `第 ${state.moveCount + 1} 手`, 444, 27);
  ctx.restore();
}

function drawChips(ctx, state) {
  const players = state.players || [];
  const n = Math.max(1, players.length);
  const gap = 8;
  const total = 432;
  const w = (total - gap * (n - 1)) / n;
  const y = 50;
  const h = 38;

  players.forEach((p, i) => {
    const x = 24 + i * (w + gap);
    const tone = colorOf(i);
    const active = !state.winner && p.id === state.turn;
    const won = p.id === state.winner;

    ctx.save();
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = active ? 'rgba(52,211,153,0.14)' : 'rgba(148,163,184,0.06)';
    ctx.fill();
    ctx.strokeStyle = won ? ACCENT : active ? 'rgba(52,211,153,0.6)' : 'rgba(148,163,184,0.14)';
    ctx.lineWidth = won || active ? 1.5 : 1;
    ctx.stroke();

    ctx.fillStyle = tone.base;
    ctx.beginPath();
    ctx.arc(x + 14, y + 19, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = active || won ? '#e8edf7' : 'rgba(203,213,225,0.82)';
    ctx.fillText(p.name, x + 25, y + 17);

    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = p.pos === LAST ? ACCENT : p.pos === 0 ? 'rgba(148,163,184,0.72)' : tone.light;
    ctx.fillText(p.pos === 0 ? '起点' : `第 ${p.pos} 格`, x + 25, y + 31);
    ctx.restore();
  });
}

/* ── 棋盘 ─────────────────────────────────────────────────── */

function drawPlate(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, 14);
  ctx.fillStyle = 'rgba(13,20,33,0.92)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, 14);
  ctx.strokeStyle = 'rgba(52,211,153,0.22)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawCells(ctx, state) {
  const snakes = state.snakes || {};
  const ladders = state.ladders || {};

  for (let n = 1; n <= LAST; n++) {
    const c = cellOf(n);
    const x = LEFT + c.col * CELL;
    const y = TOP + (SIZE - 1 - c.row) * CELL;
    const ladderBase = ladders[n] != null;
    const snakeHead = snakes[n] != null;
    const finish = n === LAST;

    ctx.fillStyle = finish
      ? 'rgba(52,211,153,0.34)'
      : ladderBase
        ? 'rgba(52,211,153,0.15)'
        : snakeHead
          ? 'rgba(244,114,182,0.15)'
          : (c.col + c.row) % 2 === 0
            ? 'rgba(148,163,184,0.075)'
            : 'rgba(148,163,184,0.032)';
    ctx.fillRect(x, y, CELL, CELL);

    ctx.strokeStyle = 'rgba(7,11,18,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

    // 编号：小字贴左上，不抢棋子与蛇梯的视觉重心
    ctx.save();
    ctx.font = `9px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = finish
      ? '#d1fae5'
      : ladderBase
        ? 'rgba(167,243,208,0.95)'
        : snakeHead
          ? 'rgba(251,207,232,0.95)'
          : 'rgba(148,163,184,0.55)';
    ctx.fillText(String(n), x + 4, y + 4);
    ctx.restore();
  }

  // 100 格加一圈高亮，终点一眼可辨
  const fin = center(LAST);
  if (fin) {
    ctx.save();
    ctx.strokeStyle = 'rgba(52,211,153,0.85)';
    ctx.lineWidth = 2;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 12;
    ctx.strokeRect(fin.x - CELL / 2 + 1, fin.y - CELL / 2 + 1, CELL - 2, CELL - 2);
    ctx.restore();
  }
}

/**
 * 蛇形走位：每行一条虚线「跑道」，行末用竖向虚线折到下一行，
 * 方向完全跟随编号（偶数行左→右，奇数行右→左）。
 * 虚线压在格子下缘而不是中心，避免和棋子圆片打架。
 */
function drawRoute(ctx) {
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148,163,184,0.16)';

  for (let screenRow = 0; screenRow < SIZE; screenRow++) {
    const row = SIZE - 1 - screenRow;
    const y = TOP + screenRow * CELL + CELL - 6;
    const leftToRight = row % 2 === 0;
    const x1 = leftToRight ? LEFT + 5 : LEFT + BOARD - 5;
    const x2 = leftToRight ? LEFT + BOARD - 5 : LEFT + 5;

    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();

    // 折返竖线：偶数行在 col 9 上折，奇数行在 col 0 上折
    if (screenRow < SIZE - 1) {
      const col = leftToRight ? SIZE - 1 : 0;
      const x = LEFT + col * CELL + CELL / 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + CELL - 2);
      ctx.stroke();

      // 向上的小箭头，明确「这一行到头要往上走」
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(148,163,184,0.34)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y + CELL - 7);
      ctx.lineTo(x, y + CELL - 11);
      ctx.lineTo(x + 3.5, y + CELL - 7);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ── 蛇与梯 ───────────────────────────────────────────────── */

function drawLadder(ctx, base, top) {
  const a = center(base);
  const b = center(top);
  if (!a || !b) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const half = 5.5;

  const rail = (sign) => {
    ctx.beginPath();
    ctx.moveTo(a.x + nx * half * sign, a.y + ny * half * sign);
    ctx.lineTo(b.x + nx * half * sign, b.y + ny * half * sign);
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 投影
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 4;
  rail(1);
  rail(-1);

  // 双轨
  ctx.strokeStyle = 'rgba(203,213,225,0.85)';
  ctx.lineWidth = 2.4;
  rail(1);
  rail(-1);

  // 踏板：按长度均分，至少 2 级
  const steps = Math.max(2, Math.round(len / 16));
  ctx.strokeStyle = 'rgba(148,163,184,0.9)';
  ctx.lineWidth = 1.8;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    ctx.beginPath();
    ctx.moveTo(cx - nx * half, cy - ny * half);
    ctx.lineTo(cx + nx * half, cy + ny * half);
    ctx.stroke();
  }

  // 两端小圆头，收口更像实物
  ctx.fillStyle = 'rgba(226,232,240,0.9)';
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSnake(ctx, head, tail) {
  const a = center(head); // 头在格号大的一侧
  const b = center(tail);
  if (!a || !b) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const amp = Math.min(7, len * 0.1);

  // 正弦扰动折线：两端偏移为 0，所以头尾仍落在格中心
  const pts = [];
  const seg = 26;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = Math.sin(t * Math.PI * 3) * amp * Math.sin(Math.PI * t);
    pts.push({ x: a.x + dx * t + nx * w, y: a.y + dy * t + ny * w });
  }

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.lineWidth = 9;
  trace();

  ctx.strokeStyle = 'rgba(244,114,182,0.78)';
  ctx.lineWidth = 6.5;
  trace();

  ctx.strokeStyle = 'rgba(252,231,243,0.45)';
  ctx.lineWidth = 2;
  trace();

  // 尾巴
  ctx.fillStyle = 'rgba(244,114,182,0.9)';
  ctx.beginPath();
  ctx.arc(b.x, b.y, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 头：朝外侧（远离身体的方向）
  const hx = -ux;
  const hy = -uy;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#f472b6';
  ctx.beginPath();
  ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(157,23,77,0.9)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 眼睛
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const s of [1, -1]) {
    const ex = a.x + hx * 3 + nx * 3.6 * s;
    const ey = a.y + hy * 3 + ny * 3.6 * s;
    ctx.beginPath();
    ctx.arc(ex, ey, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1e293b';
  for (const s of [1, -1]) {
    const ex = a.x + hx * 3.6 + nx * 3.6 * s;
    const ey = a.y + hy * 3.6 + ny * 3.6 * s;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 信子：短双叉
  ctx.strokeStyle = 'rgba(248,113,113,0.95)';
  ctx.lineWidth = 1.5;
  const tx = a.x + hx * 9;
  const ty = a.y + hy * 9;
  const fx = a.x + hx * 14;
  const fy = a.y + hy * 14;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + hx * 3 + nx * 3.4 * s, fy + hy * 3 + ny * 3.4 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLinks(ctx, state) {
  const ladders = state.ladders || {};
  const snakes = state.snakes || {};
  // 先梯后蛇：蛇盖在梯上，视觉上「蛇更危险」
  for (const [base, top] of Object.entries(ladders)) drawLadder(ctx, Number(base), Number(top));
  for (const [head, tail] of Object.entries(snakes)) drawSnake(ctx, Number(head), Number(tail));
}

/* ── 棋子 ─────────────────────────────────────────────────── */

const OFFSETS = {
  1: [[0, 0]],
  2: [[-8.5, 0], [8.5, 0]],
  3: [[0, -9], [-8, 6], [8, 6]],
  4: [[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]],
};

function drawToken(ctx, x, y, r, tone, active, time) {
  ctx.save();
  if (active) {
    const glow = 0.5 + Math.sin((time || 0) * 4) * 0.3;
    ctx.globalAlpha = glow;
    ctx.strokeStyle = tone.base;
    ctx.lineWidth = 2;
    ctx.shadowColor = tone.base;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
  g.addColorStop(0, tone.light);
  g.addColorStop(0.55, tone.base);
  g.addColorStop(1, tone.base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = 'rgba(248,250,252,0.85)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.3, r * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTokens(ctx, state, time) {
  const players = state.players || [];
  const start = { x: 66, y: 578 };
  const startSlots = [[-16, -10], [16, -10], [-16, 10], [16, 10]];

  // 同一格上的棋子错开摆，避免完全重叠；轮到的那颗最后画、带呼吸光环
  const groups = new Map();
  players.forEach((p, i) => {
    const key = p.pos;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ p, i });
  });

  for (const [pos, list] of groups) {
    const sorted = list.slice().sort((a, b) => {
      const aa = !state.winner && a.p.id === state.turn ? 1 : 0;
      const bb = !state.winner && b.p.id === state.turn ? 1 : 0;
      return aa - bb;
    });

    if (pos === 0) {
      sorted.forEach(({ p, i }, k) => {
        const slot = startSlots[k % startSlots.length];
        const r = list.length === 1 ? 9 : 8;
        drawToken(ctx, start.x + slot[0], start.y + slot[1], r, colorOf(i),
          !state.winner && p.id === state.turn, time);
      });
      continue;
    }

    const c = center(pos);
    if (!c) continue;
    const set = OFFSETS[Math.min(4, Math.max(1, list.length))];
    sorted.forEach(({ p, i }, k) => {
      const r = list.length === 1 ? 10 : 8;
      drawToken(ctx, c.x + set[k][0], c.y + set[k][1], r, colorOf(i),
        !state.winner && p.id === state.turn, time);
    });
  }
}

/* ── 底部：起点区 / 上一手描述 / 骰子 / 提示 ─────────────── */

function drawStartPad(ctx) {
  ctx.save();
  roundRect(ctx, 24, 540, 84, 64, 10);
  ctx.fillStyle = 'rgba(148,163,184,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `10px ${FONT}`;
  ctx.fillStyle = 'rgba(148,163,184,0.75)';
  ctx.fillText('起点', 66, 556);
  ctx.restore();
}

function describe(state) {
  const m = state.lastMove;
  const players = state.players || [];
  const who = m ? players.find((p) => p.id === m.player) : null;
  if (!m) {
    if (!state.winner && state.turn) {
      const cur = players.find((p) => p.id === state.turn);
      return { lead: '点击「掷骰」开始', sub: cur ? `${cur.name} 先手` : '', tone: ACCENT };
    }
    return { lead: '点击「掷骰」开始', sub: '', tone: ACCENT };
  }

  if (m.action === 'skip') {
    return { lead: `${who ? who.name : m.player} 放弃本回合`, sub: `停在 ${m.to} 格`, tone: 'rgba(203,213,225,0.92)' };
  }

  const lead = `${who ? who.name : m.player} 掷出 ${m.dice}`;
  if (m.event === 'ladder') {
    return { lead, sub: `梯子 ${m.jumpFrom} → ${m.jumpTo}，直接上冲`, tone: '#a7f3d0' };
  }
  if (m.event === 'snake') {
    return { lead, sub: `踩到蛇 ${m.jumpFrom} → ${m.jumpTo}，滑下去了`, tone: '#fbcfe8' };
  }
  if (m.event === 'stuck') {
    return { lead, sub: `${m.from} + ${m.dice} 超过 100，停在原地`, tone: 'rgba(203,213,225,0.92)' };
  }
  return { lead, sub: `前进到第 ${m.to} 格`, tone: 'rgba(203,213,225,0.92)' };
}

function drawDice(ctx, state, time) {
  const x = 392;
  const y = 538;
  const size = 64;
  const players = state.players || [];
  const cur = players.find((p) => p.id === state.turn);
  const idx = cur ? players.indexOf(cur) : 0;
  const tone = colorOf(idx);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, size, size, 14);
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#f8fafc');
  g.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, size, size, 14);
  ctx.strokeStyle = state.winner ? 'rgba(52,211,153,0.8)' : 'rgba(248,250,252,0.25)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (!state.winner && cur) {
    ctx.globalAlpha = 0.5 + Math.sin((time || 0) * 3.2) * 0.25;
    ctx.strokeStyle = tone.base;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  if (!state.dice) {
    ctx.save();
    ctx.fillStyle = 'rgba(71,85,105,0.75)';
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + size / 2, y + size / 2 + 1);
    ctx.restore();
    return;
  }

  const pips = PIPS[state.dice] || PIPS[1];
  ctx.save();
  ctx.fillStyle = '#0f172a';
  for (const [px, py] of pips) {
    ctx.beginPath();
    ctx.arc(x + px * size, y + py * size, 5.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFooter(ctx, state) {
  const info = describe(state);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = info.tone;
  ctx.fillText(info.lead, 254, 562);
  if (info.sub) {
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = 'rgba(148,163,184,0.88)';
    ctx.fillText(info.sub, 254, 584);
  }

  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = 'rgba(148,163,184,0.6)';
  ctx.fillText('点击盘面 / 空格掷骰 · 超出 100 停在原地 · 蛇只滑一次', 240, 622);
  ctx.restore();
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function render(ctx, state, view = {}) {
  if (!state) return;
  const w = view.w || W;
  const h = view.h || H;
  const time = view.time || 0;

  drawBackdrop(ctx, w, h, ACCENT);
  drawBanner(ctx, state, time);
  drawChips(ctx, state);
  drawPlate(ctx);
  drawCells(ctx, state);
  drawRoute(ctx);
  drawLinks(ctx, state);
  drawStartPad(ctx); // 起点底板先铺，棋子再压上去
  drawTokens(ctx, state, time);
  drawFooter(ctx, state);
  drawDice(ctx, state, time);
}
