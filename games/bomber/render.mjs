/**
 * 爆破迷宫 · 渲染（只读 state，不改状态）。
 * 坐标系固定 480×640，与 game.json.canvas 一致。
 *
 * 造型全部程序化原创：
 * - 钢墙 = 冷色金属块 + 高光 + 四角铆钉；
 * - 砖墙 = 位置哈希决定砖色与错缝纹路；
 * - 玩家 = 青蓝圆壳工兵（琥珀面罩 + 天线火花）；
 * - 敌人 = 旋转锯齿晶核 + 朝向单眼；
 * - 炸弹 = 黑球 + 引线火花 + 倒计时数字；火焰 = 加色混合的十字火团。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#f59e0b';
const ACCENT2 = '#fbbf24';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const CELL = 34;
const COLS = 13;
const ROWS = 11;
const OFF_X = (480 - COLS * CELL) / 2;
const OFF_Y = 112;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const ENEMY_COLORS = ['#f87171', '#a78bfa', '#34d399', '#fb7185'];

const ITEM_META = {
  bomb: { label: '炸弹 +1', color: '#fbbf24' },
  power: { label: '射程 +1', color: '#fb923c' },
  speed: { label: '速度 +', color: '#38bdf8' },
};

function cellRect(x, y) {
  return { x: OFF_X + x * CELL, y: OFF_Y + y * CELL, w: CELL, h: CELL };
}

/** 位置哈希：只依赖格坐标，保证每帧纹理稳定 */
function hash(x, y, salt = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/* ── 场景 ─────────────────────────────────────────────── */

function drawBoard(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(245, 158, 11, 0.20)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = 'rgba(7, 11, 20, 0.94)';
  roundRect(ctx, OFF_X - 8, OFF_Y - 8, BOARD_W + 16, BOARD_H + 16, 16);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, OFF_X - 8.5, OFF_Y - 8.5, BOARD_W + 17, BOARD_H + 17, 16);
  ctx.stroke();
  ctx.restore();
}

function drawFloor(ctx, maze) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = maze[y][x];
      if (ch === '#' || ch === '+') continue;
      const r = cellRect(x, y);
      const tone = hash(x, y, 1);
      ctx.fillStyle = tone > 0.5 ? '#0c1322' : '#0a101c';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.045)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
  }
}

function drawSteel(ctx, x, y) {
  const r = cellRect(x, y);
  const g = ctx.createLinearGradient(r.x, r.y, r.x + CELL, r.y + CELL);
  g.addColorStop(0, '#8b97a8');
  g.addColorStop(0.42, '#566273');
  g.addColorStop(1, '#1e2733');

  ctx.save();
  ctx.fillStyle = g;
  roundRect(ctx, r.x + 1, r.y + 1, CELL - 2, CELL - 2, 4);
  ctx.fill();

  // 顶部高光 / 底部暗边，制造金属倒角
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(r.x + 3, r.y + 2.5);
  ctx.lineTo(r.x + CELL - 3, r.y + 2.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.moveTo(r.x + 3, r.y + CELL - 2.5);
  ctx.lineTo(r.x + CELL - 3, r.y + CELL - 2.5);
  ctx.stroke();

  // 四角铆钉
  const inset = 6.5;
  for (const [ox, oy] of [
    [inset, inset],
    [CELL - inset, inset],
    [inset, CELL - inset],
    [CELL - inset, CELL - inset],
  ]) {
    ctx.fillStyle = 'rgba(203, 213, 225, 0.55)';
    ctx.beginPath();
    ctx.arc(r.x + ox, r.y + oy, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
    ctx.beginPath();
    ctx.arc(r.x + ox + 0.5, r.y + oy + 0.6, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBrick(ctx, x, y) {
  const r = cellRect(x, y);
  ctx.save();
  ctx.fillStyle = '#3a1c10';
  roundRect(ctx, r.x + 1, r.y + 1, CELL - 2, CELL - 2, 3);
  ctx.fill();

  const bx = r.x + 2;
  const by = r.y + 2;
  const bw = CELL - 4;
  const bh = (CELL - 5) / 2;
  for (let row = 0; row < 2; row++) {
    const yy = by + row * (bh + 1);
    const split = bw * (row === 0 ? 0.44 : 0.63);
    const parts = [
      [bx, split - 1],
      [bx + split + 0.5, bw - split - 0.5],
    ];
    for (let p = 0; p < 2; p++) {
      const [px, pw] = parts[p];
      const tone = hash(x * 2 + p, y * 2 + row, 2);
      const light = 0.55 + tone * 0.45;
      ctx.fillStyle = `rgb(${Math.round(150 + 55 * light)}, ${Math.round(62 + 30 * light)}, ${Math.round(28 + 14 * light)})`;
      roundRect(ctx, px, yy, Math.max(3, pw), bh, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 214, 170, 0.16)';
      ctx.fillRect(px + 1, yy + 0.6, Math.max(2, pw - 2), 1);
      if (tone > 0.72) {
        ctx.fillStyle = 'rgba(60, 20, 8, 0.35)';
        ctx.fillRect(px + pw * 0.35, yy + bh * 0.45, 2, 2);
      }
    }
  }
  ctx.restore();
}

function drawMaze(ctx, maze) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = maze[y][x];
      if (ch === '#') drawSteel(ctx, x, y);
      else if (ch === '+') drawBrick(ctx, x, y);
    }
  }
}

/* ── 道具 / 炸弹 / 火焰 ───────────────────────────────── */

function drawItemIcon(ctx, cx, cy, type, scale = 1) {
  const color = ITEM_META[type]?.color || ACCENT2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;

  if (type === 'bomb') {
    ctx.fillStyle = '#0b0f18';
    ctx.beginPath();
    ctx.arc(0, 1, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(2.5, -5.5);
    ctx.quadraticCurveTo(6, -9, 4, -12);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(4, -12.5, 2.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'power') {
    // 三瓣火苗
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.bezierCurveTo(-8, 4, -5, -2, -1.5, -6);
    ctx.bezierCurveTo(-2.5, -1, 1, -1.5, 1.5, -9);
    ctx.bezierCurveTo(7, -3, 8, 3, 0, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 253, 224, 0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 2.4, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 闪电
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(1, -10);
    ctx.lineTo(-6, 2);
    ctx.lineTo(-1, 2);
    ctx.lineTo(-2, 11);
    ctx.lineTo(7, -3);
    ctx.lineTo(1.5, -3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawItems(ctx, items, time) {
  for (const it of items) {
    const r = cellRect(it.x, it.y);
    const cx = r.x + CELL / 2;
    const cy = r.y + CELL / 2 + Math.sin(time * 4 + it.x * 1.7 + it.y) * 1.6;
    const color = ITEM_META[it.type]?.color || ACCENT2;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(9, 14, 24, 0.88)';
    roundRect(ctx, r.x + 5, r.y + 5, CELL - 10, CELL - 10, 6);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    roundRect(ctx, r.x + 5, r.y + 5, CELL - 10, CELL - 10, 6);
    ctx.stroke();
    ctx.restore();

    drawItemIcon(ctx, cx, cy, it.type, 0.92);
  }
}

function drawBombs(ctx, bombs, time) {
  for (const b of bombs) {
    const r = cellRect(b.x, b.y);
    const cx = r.x + CELL / 2;
    const cy = r.y + CELL / 2 + 1;
    const urgent = b.timer < 0.7;
    const blink = urgent ? 0.62 + 0.38 * Math.abs(Math.sin(time * 14)) : 1;
    const pulse = urgent ? 1 + 0.06 * Math.sin(time * 22) : 1;
    const radius = (CELL * 0.29) * pulse;

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.shadowColor = urgent ? '#ef4444' : 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = urgent ? 20 : 10;
    const g = ctx.createRadialGradient(cx - 4, cy - 5, 1.5, cx, cy, radius);
    g.addColorStop(0, '#4b5563');
    g.addColorStop(0.55, '#111827');
    g.addColorStop(1, '#010409');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 高光
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.ellipse(cx - radius * 0.35, cy - radius * 0.42, radius * 0.28, radius * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();

    // 引线 + 火花
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + radius * 0.45, cy - radius * 0.75);
    ctx.quadraticCurveTo(cx + radius * 0.9, cy - radius * 1.4, cx + radius * 0.45, cy - radius * 1.8);
    ctx.stroke();
    const spark = 0.8 + 0.2 * Math.sin(time * 26 + b.x);
    ctx.fillStyle = ACCENT2;
    ctx.shadowColor = ACCENT2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx + radius * 0.45, cy - radius * 1.85, 2.2 * spark, 0, Math.PI * 2);
    ctx.fill();

    // 倒计时数字
    ctx.shadowBlur = 0;
    ctx.fillStyle = urgent ? '#fecaca' : '#f8fafc';
    ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(1, Math.ceil(b.timer))), cx, cy + 1);
    ctx.restore();
  }
}

function drawFlames(ctx, flames, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of flames) {
    const r = cellRect(f.x, f.y);
    const cx = r.x + CELL / 2;
    const cy = r.y + CELL / 2;
    const life = Math.max(0, Math.min(1, f.timer / 0.45));
    const flick = 0.88 + 0.12 * Math.sin(time * 34 + f.x * 2.3 + f.y * 1.7);
    const radius = CELL * (f.tip ? 0.46 : 0.56) * (0.86 + 0.14 * life) * flick;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
    g.addColorStop(0, `rgba(255, 251, 214, ${0.95 * life})`);
    g.addColorStop(0.42, `rgba(251, 191, 36, ${0.82 * life})`);
    g.addColorStop(0.78, `rgba(245, 120, 11, ${0.5 * life})`);
    g.addColorStop(1, 'rgba(180, 40, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    // 中心是圆，四臂沿方向拉长，拼成十字火
    const horizontal = f.dir === 'left' || f.dir === 'right';
    const vertical = f.dir === 'up' || f.dir === 'down';
    ctx.ellipse(
      cx,
      cy,
      radius * (horizontal ? 1.18 : 0.92),
      radius * (vertical ? 1.18 : 0.92),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.fillStyle = `rgba(255, 255, 240, ${0.75 * life})`;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.15 * flick, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ── 角色 ─────────────────────────────────────────────── */

function drawPlayer(ctx, p, time) {
  const cx = OFF_X + p.x * CELL;
  const cy = OFF_Y + p.y * CELL;
  const bob = p.moving ? Math.sin(time * 20) * 1.4 : Math.sin(time * 3.2) * 0.8;
  const blink = p.invuln > 0 && Math.floor(time * 12) % 2 === 0;
  const dx = p.dir?.x ?? 0;
  const dy = p.dir?.y ?? 0;

  ctx.save();
  if (blink) ctx.globalAlpha = 0.4;

  // 落地阴影
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 11, 10, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, bob);

  // 无敌护盾
  if (p.invuln > 0) {
    ctx.strokeStyle = `rgba(103, 232, 249, ${0.35 + 0.25 * Math.sin(time * 10)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 腿（迈步时前后错开）
  const stride = p.moving ? Math.sin(time * 20) * 2.4 : 0;
  ctx.fillStyle = '#0e7490';
  roundRect(ctx, cx - 7 + stride, cy + 6, 5, 7, 2);
  ctx.fill();
  roundRect(ctx, cx + 2 - stride, cy + 6, 5, 7, 2);
  ctx.fill();

  // 身体圆壳
  ctx.save();
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 14;
  const body = ctx.createRadialGradient(cx - 5, cy - 7, 2, cx, cy, 13);
  body.addColorStop(0, '#a5f3fc');
  body.addColorStop(0.5, '#22d3ee');
  body.addColorStop(1, '#0e7490');
  ctx.fillStyle = body;
  roundRect(ctx, cx - 11, cy - 10, 22, 19, 8);
  ctx.fill();
  ctx.restore();

  // 琥珀面罩 + 朝向眼
  ctx.fillStyle = '#f59e0b';
  roundRect(ctx, cx - 9, cy - 6, 18, 8, 3);
  ctx.fill();
  ctx.fillStyle = '#1c1917';
  const ex = dx * 2.4;
  const ey = dy * 1.8;
  ctx.beginPath();
  ctx.arc(cx - 4 + ex, cy - 2 + ey, 1.7, 0, Math.PI * 2);
  ctx.arc(cx + 4 + ex, cy - 2 + ey, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(cx - 4.5 + ex, cy - 2.6 + ey, 0.6, 0, Math.PI * 2);
  ctx.arc(cx + 3.5 + ex, cy - 2.6 + ey, 0.6, 0, Math.PI * 2);
  ctx.fill();

  // 天线 + 火花
  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx + 1.5, cy - 16);
  ctx.stroke();
  ctx.fillStyle = ACCENT2;
  ctx.shadowColor = ACCENT2;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx + 1.5, cy - 17, 2 + Math.sin(time * 8) * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, e, time, index) {
  const cx = OFF_X + e.x * CELL;
  const cy = OFF_Y + e.y * CELL;
  const color = ENEMY_COLORS[index % ENEMY_COLORS.length];
  const rot = time * 1.4 + index * 1.3;
  const bob = Math.sin(time * 6 + index) * 1.2;
  const dx = e.dir?.x ?? 0;
  const dy = e.dir?.y ?? 0;

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;

  // 外层锯齿晶核（旋转）
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  const spikes = 8;
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (i / (spikes * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? 12.5 : 8;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.rotate(-rot);

  // 内核
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(0, 0, 7.2, 0, Math.PI * 2);
  ctx.fill();

  // 单眼，朝向移动方向
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(dx * 2.2, dy * 2.2, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(dx * 3.4, dy * 3.4, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ── HUD ──────────────────────────────────────────────── */

function drawHeart(ctx, x, y, size, filled, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 16, size / 16);
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-9, -3, -7, -11, 0, -6);
  ctx.bezierCurveTo(7, -11, 9, -3, 0, 4);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

function drawHud(ctx, state) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // 得分
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('得分', 22, 26);
  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(String(state.score), 22, 54);

  // 关卡
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(`第 ${state.level} 关`, 240, 32);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText(state.solved ? '本关已清空' : `剩余敌人 ${state.enemies.length}`, 240, 52);
  ctx.fillStyle = 'rgba(100, 116, 139, 0.9)';
  ctx.font = `10px ${FONT}`;
  ctx.fillText('2 秒引信 · 十字火焰', 240, 70);

  // 生命
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('生命', 458, 26);
  for (let i = 0; i < 3; i++) {
    drawHeart(ctx, 458 - i * 22, 44, 16, i < state.lives, '#fb7185');
  }

  // 炸弹 / 火力 / 速度 状态条
  const chips = [
    { label: `炸弹 ${state.player.bombs}/${state.player.maxBombs}`, color: ACCENT2 },
    { label: `火力 ${state.player.power}`, color: '#fb923c' },
    { label: `速度 ${state.player.speed.toFixed(1)}`, color: '#38bdf8' },
  ];
  const chipW = 132;
  chips.forEach((chip, i) => {
    const x = 22 + i * (chipW + 5);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    roundRect(ctx, x, 76, chipW, 20, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, 76, chipW, 20, 10);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = chip.color;
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(chip.label, x + chipW / 2, 90);
  });

  ctx.restore();
}

function drawLegend(ctx) {
  const y = 520;
  const entries = [
    { type: 'bomb', label: '炸弹上限' },
    { type: 'power', label: '射程' },
    { type: 'speed', label: '速度' },
  ];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  entries.forEach((entry, i) => {
    const x = 90 + i * 150;
    ctx.fillStyle = 'rgba(10, 16, 28, 0.85)';
    roundRect(ctx, x - 58, y - 18, 116, 44, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.stroke();
    drawItemIcon(ctx, x - 34, y + 3, entry.type, 0.82);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.9)';
    ctx.font = `11px ${FONT}`;
    ctx.fillText(entry.label, x + 12, y + 2);
  });
  ctx.fillStyle = 'rgba(100, 116, 139, 0.85)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('砖墙后藏道具 · 炸光敌人过关 · 别被自己的火圈扫到', 240, 566);
  ctx.restore();
}

/* ── 主渲染 ───────────────────────────────────────────── */

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  drawBoard(ctx);
  drawFloor(ctx, state.maze);
  drawMaze(ctx, state.maze);
  drawItems(ctx, state.items, view.time);
  drawFlames(ctx, state.flames, view.time);
  drawBombs(ctx, state.bombs, view.time);

  state.enemies.forEach((e, i) => drawEnemy(ctx, e, view.time, i));
  drawPlayer(ctx, state.player, view.time);

  drawHud(ctx, state);
  drawLegend(ctx);

  if (!state.started && !state.over) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(7, 11, 20, 0.72)';
    roundRect(ctx, 118, 282, 244, 62, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, 118, 282, 244, 62, 16);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText('按方向键 / 滑动开始', 240, 311);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.8)';
    ctx.font = `11px ${FONT}`;
    ctx.fillText('空格或「炸弹」按钮放置炸弹', 240, 331);
    ctx.restore();
  }

  if (state.solved) {
    const p = 1 - Math.max(0, Math.min(1, state.clearTimer / 1.2));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(7, 11, 20, 0.74)';
    roundRect(ctx, 108, 286, 264, 88, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, 108, 286, 264, 88, 18);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText('本关通过！', 240, 322);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`奖励 ${200 * state.level} 分 · 进入第 ${state.level + 1} 关`, 240, 350);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.fillRect(138, 362, 204 * p, 4);
    ctx.restore();
  }

  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 8, 14, 0.72)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText('游戏结束', 240, 286);
    ctx.fillStyle = ACCENT2;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(`得分 ${state.score}`, 240, 326);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.9)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText(`到达第 ${state.level} 关 · 清光敌人可继续深入`, 240, 356);
    ctx.restore();
  }
}
