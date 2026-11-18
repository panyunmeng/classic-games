/**
 * 坦克战场 · 渲染（只读 state，不改状态）。
 *
 * 画布固定 480×640，与 game.json.canvas 一致：
 *   顶部 96 px  HUD（得分 / 关卡 / 生命）
 *   中部 468×468 阵地（13×13 格，每格 36 px）
 *   底部 76 px  敌军余量 + 操作提示
 *
 * 所有贴图都是程序化绘制：砖墙的错缝、钢墙的铆钉与倒角、水面的正弦波纹、
 * 坦克的履带纹与炮管、子弹的拖尾、爆炸粒子。动画只依赖 view.time（外壳传入），
 * 粒子方向由效果坐标做确定性哈希，不用随机数，所以同一帧渲染结果可复现。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { CELL, COLS, ROWS, BOARD_W, BOARD_H } from './logic.mjs';

const OFF_X = 6;
const OFF_Y = 96;
const ACCENT = '#7ac043';
const ACCENT2 = '#f5c542';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const ANG = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

const PALETTE = {
  p1: { body: '#7ac043', light: '#c9f18c', dark: '#3d6b1f', track: '#2a3a22', trim: ACCENT2 },
  p2: { body: '#5ab6e8', light: '#b4e3ff', dark: '#2b6484', track: '#1f3340', trim: '#8ef0ff' },
  grunt: { body: '#e05a4f', light: '#ffa096', dark: '#8b2b24', track: '#3a1f1c', trim: '#ffd2cc' },
  swift: { body: '#f5a742', light: '#ffd98f', dark: '#8c5a1e', track: '#3a2a18', trim: '#ffe6b8' },
  gunner: { body: '#b978f0', light: '#e6c2ff', dark: '#6f3f96', track: '#2c1f3a', trim: '#eed7ff' },
};

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ── 地形 ─────────────────────────────────────────────── */

function drawFloor(ctx, px, py) {
  ctx.fillStyle = '#0b1420';
  ctx.fillRect(px, py, CELL, CELL);
  ctx.strokeStyle = 'rgba(122, 192, 67, 0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
}

function drawSteel(ctx, px, py) {
  ctx.fillStyle = '#4e5765';
  ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);

  // 倒角：左上亮、右下暗，做出金属块体积
  ctx.fillStyle = 'rgba(228, 240, 255, 0.16)';
  ctx.fillRect(px + 2, py + 2, CELL - 4, 3);
  ctx.fillRect(px + 2, py + 2, 3, CELL - 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fillRect(px + 2, py + CELL - 5, CELL - 4, 3);
  ctx.fillRect(px + CELL - 5, py + 2, 3, CELL - 4);

  // 中央压筋
  ctx.fillStyle = 'rgba(160, 176, 196, 0.22)';
  ctx.fillRect(px + 8, py + CELL / 2 - 1, CELL - 16, 2);

  // 四角铆钉
  for (const [ox, oy] of [[7, 7], [CELL - 7, 7], [7, CELL - 7], [CELL - 7, CELL - 7]]) {
    ctx.fillStyle = '#262c34';
    circle(ctx, px + ox, py + oy, 2);
    ctx.fillStyle = 'rgba(225, 238, 255, 0.45)';
    circle(ctx, px + ox - 0.7, py + oy - 0.7, 0.8);
  }
}

function drawBrick(ctx, px, py, x, y) {
  const tint = (x * 7 + y * 13) % 3;
  ctx.fillStyle = tint === 0 ? '#7d4031' : tint === 1 ? '#763a2c' : '#864637';
  ctx.fillRect(px, py, CELL, CELL);

  ctx.strokeStyle = 'rgba(30, 16, 12, 0.62)';
  ctx.lineWidth = 1.5;
  const rows = 3;
  const rh = CELL / rows;
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(px, py + r * rh + 0.5);
    ctx.lineTo(px + CELL, py + r * rh + 0.5);
    ctx.stroke();
  }
  // 错缝立缝：奇数行半块，偶数行整块
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? CELL / 4 : CELL / 2;
    for (let c = 0; c < 2; c++) {
      const vx = px + off + c * (CELL / 2);
      if (vx <= px + 1 || vx >= px + CELL - 1) continue;
      ctx.beginPath();
      ctx.moveTo(vx + 0.5, py + r * rh);
      ctx.lineTo(vx + 0.5, py + (r + 1) * rh);
      ctx.stroke();
    }
  }

  // 砖面高光，避免整片死红
  ctx.fillStyle = 'rgba(255, 176, 132, 0.12)';
  ctx.fillRect(px + 1, py + 1, CELL - 2, 2);
}

function drawWater(ctx, px, py, x, y, time) {
  ctx.fillStyle = '#0f3350';
  ctx.fillRect(px, py, CELL, CELL);

  ctx.strokeStyle = 'rgba(116, 202, 255, 0.42)';
  ctx.lineWidth = 1.6;
  for (let lane = 0; lane < 2; lane++) {
    ctx.beginPath();
    for (let t = 0; t <= CELL; t += 3) {
      const yy =
        py + 12 + lane * 13 + Math.sin(t / 8 + time * 2.6 + x * 0.8 + lane * 1.7) * 2.3;
      if (t === 0) ctx.moveTo(px + t, yy);
      else ctx.lineTo(px + t, yy);
    }
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(180, 230, 255, 0.18)';
  ctx.fillRect(px + 1, py + 1, CELL - 2, 1);
}

/* ── 坦克 ─────────────────────────────────────────────── */

function drawTank(ctx, cx, cy, dir, pal, { time = 0, invuln = 0, marker = false } = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ANG[dir] || 0);

  // 履带 + 滚动纹（纹路随 time 平移，视觉上像在走）
  const tread = (time * 26) % 7;
  ctx.fillStyle = pal.track;
  roundRect(ctx, -15, -14, 6, 28, 2);
  ctx.fill();
  roundRect(ctx, 9, -14, 6, 28, 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const ty = -13 + ((i * 7 + tread) % 27);
    ctx.beginPath();
    ctx.moveTo(-15, ty);
    ctx.lineTo(-9, ty);
    ctx.moveTo(9, ty);
    ctx.lineTo(15, ty);
    ctx.stroke();
  }

  // 车体
  ctx.fillStyle = pal.dark;
  roundRect(ctx, -10, -14, 20, 28, 4);
  ctx.fill();
  ctx.fillStyle = pal.body;
  roundRect(ctx, -9, -13, 18, 26, 3);
  ctx.fill();
  ctx.fillStyle = pal.light;
  ctx.globalAlpha = 0.32;
  roundRect(ctx, -7, -11, 14, 4, 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 炮塔
  ctx.fillStyle = pal.dark;
  circle(ctx, 0, 0, 6.4);
  ctx.fillStyle = pal.body;
  circle(ctx, 0, -0.5, 4.6);

  // 炮管（本地方向 -y 即车头）
  ctx.fillStyle = pal.dark;
  ctx.fillRect(-2.4, -20, 4.8, 13);
  ctx.fillStyle = pal.light;
  ctx.fillRect(-1.2, -20, 1.8, 12);
  ctx.fillStyle = pal.trim;
  ctx.fillRect(-3, -21, 6, 2.4);

  // 玩家标记：车头小箭头，方便一眼分清敌我
  if (marker) {
    ctx.fillStyle = ACCENT2;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(3, -20);
    ctx.lineTo(-3, -20);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // 无敌护盾：世界坐标圆形，脉动
  if (invuln > 0) {
    const a = 0.35 + 0.35 * Math.sin(time * 12);
    ctx.save();
    ctx.strokeStyle = `rgba(245, 197, 66, ${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 17.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 20.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/* ── 子弹与粒子 ───────────────────────────────────────── */

function drawBullet(ctx, b) {
  const px = OFF_X + b.x;
  const py = OFF_Y + b.y;
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const nx = b.vx / sp;
  const ny = b.vy / sp;
  const len = 18;

  const tail = b.side === 'player' ? 'rgba(245, 197, 66, 0)' : 'rgba(255, 110, 80, 0)';
  const head = b.side === 'player' ? 'rgba(245, 197, 66, 0.85)' : 'rgba(255, 110, 80, 0.85)';
  const grad = ctx.createLinearGradient(px - nx * len, py - ny * len, px, py);
  grad.addColorStop(0, tail);
  grad.addColorStop(1, head);

  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px - nx * len, py - ny * len);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.shadowColor = b.side === 'player' ? ACCENT2 : '#ff6e50';
  ctx.shadowBlur = 12;
  ctx.fillStyle = b.side === 'player' ? '#fff6cf' : '#ffd9cc';
  circle(ctx, px, py, 3.2);
  ctx.restore();
}

function drawEffect(ctx, e) {
  const p = Math.min(1, e.age / Math.max(0.001, e.life));
  const cx = OFF_X + e.x;
  const cy = OFF_Y + e.y;

  ctx.save();
  if (e.kind === 'boom') {
    const n = 14;
    const seed = (e.x * 0.13 + e.y * 0.29) % (Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = seed + i * 2.399;
      const d = 5 + p * 32;
      const size = (1 - p) * 4.2 + 1;
      ctx.globalAlpha = (1 - p) * 0.95;
      ctx.fillStyle = i % 3 === 0 ? '#fff3c4' : i % 3 === 1 ? ACCENT2 : '#ff7a4a';
      ctx.fillRect(cx + Math.cos(a) * d - size / 2, cy + Math.sin(a) * d - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(255, 206, 110, ${(1 - p) * 0.65})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 4 + p * 22, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = '#fff2c0';
    for (let i = 0; i < 5; i++) {
      const a = i * 1.7 + e.x * 0.05;
      const d = 2 + p * 12;
      ctx.fillRect(cx + Math.cos(a) * d - 1.5, cy + Math.sin(a) * d - 1.5, 3, 3);
    }
  }
  ctx.restore();
}

/* ── HUD ──────────────────────────────────────────────── */

function drawLifeIcon(ctx, x, y, on) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = on ? 1 : 0.22;
  ctx.fillStyle = '#3d6b1f';
  ctx.fillRect(-7, -6, 2.5, 12);
  ctx.fillRect(4.5, -6, 2.5, 12);
  ctx.fillStyle = ACCENT;
  roundRect(ctx, -4.5, -6, 9, 12, 2);
  ctx.fill();
  ctx.fillStyle = '#3d6b1f';
  ctx.fillRect(-1.2, -12, 2.4, 7);
  ctx.restore();
}

function drawHud(ctx, state) {
  // 得分
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('得分', 20, 28);
  ctx.fillStyle = '#e8edf7';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(String(state.score).padStart(4, '0'), 20, 52);

  // 关卡
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(`第 ${state.level} 关`, 240, 34);
  ctx.fillStyle = 'rgba(147, 160, 184, 0.85)';
  ctx.font = `11px ${FONT}`;
  const left = state.remaining ?? state.enemies?.length ?? 0;
  ctx.fillText(`敌军 ${left} / ${state.total ?? left}`, 240, 54);

  // 生命
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.9)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('生命', 460, 28);
  const lives = Math.max(0, state.lives | 0);
  for (let i = 0; i < 3; i++) {
    drawLifeIcon(ctx, 460 - i * 22, 44, i < lives);
  }
}

function drawFooter(ctx, state) {
  const y = OFF_Y + BOARD_H + 26;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(147, 160, 184, 0.85)';
  ctx.font = `12px ${FONT}`;
  const left = state.remaining ?? state.enemies?.length ?? 0;
  ctx.fillText(`剩余敌军 ${left}`, 240, y);

  ctx.fillStyle = 'rgba(122, 192, 67, 0.75)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('方向键 / WASD 移动 · 空格或「开火」射击 · 滑动换向', 240, y + 20);
}

/* ── 主入口 ───────────────────────────────────────────── */

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  const time = view.time || 0;
  const maze = state.maze || [];

  // 阵地底板 + 外发光
  ctx.save();
  ctx.shadowColor = 'rgba(122, 192, 67, 0.25)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.92)';
  roundRect(ctx, OFF_X - 5, OFF_Y - 5, BOARD_W + 10, BOARD_H + 10, 10);
  ctx.fill();
  ctx.restore();

  // 地形
  for (let y = 0; y < ROWS; y++) {
    const row = maze[y] || '';
    for (let x = 0; x < COLS; x++) {
      const ch = row[x] || ' ';
      const px = OFF_X + x * CELL;
      const py = OFF_Y + y * CELL;
      if (ch === '#') drawSteel(ctx, px, py);
      else if (ch === '%') drawBrick(ctx, px, py, x, y);
      else if (ch === '~') drawWater(ctx, px, py, x, y, time);
      else drawFloor(ctx, px, py);
    }
  }

  // 阵地内框
  ctx.strokeStyle = 'rgba(122, 192, 67, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(OFF_X - 2.5, OFF_Y - 2.5, BOARD_W + 5, BOARD_H + 5);

  // 坦克：p1 / p2 / 敌军
  const player = state.player;
  if (player) {
    drawTank(ctx, OFF_X + (player.x + 0.5) * CELL, OFF_Y + (player.y + 0.5) * CELL, player.dir, PALETTE.p1, {
      time,
      invuln: player.invuln,
      marker: true,
    });
  }
  const player2 = state.player2;
  if (player2) {
    drawTank(
      ctx,
      OFF_X + (player2.x + 0.5) * CELL,
      OFF_Y + (player2.y + 0.5) * CELL,
      player2.dir,
      PALETTE.p2,
      { time, invuln: player2.invuln, marker: true }
    );
  }
  for (const e of state.enemies || []) {
    const pal = PALETTE[e.type] || PALETTE.grunt;
    drawTank(ctx, OFF_X + (e.x + 0.5) * CELL, OFF_Y + (e.y + 0.5) * CELL, e.dir, pal, { time });
  }

  // 子弹与爆炸（画在坦克之上，命中看得清）
  for (const b of state.bullets || []) drawBullet(ctx, b);
  for (const e of state.effects || []) drawEffect(ctx, e);

  drawHud(ctx, state);
  drawFooter(ctx, state);

  // 结算遮罩：过关 / 结束
  if (state.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 16, 0.58)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.solved ? ACCENT : '#e05a4f';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(state.solved ? '过关！' : '游戏结束', view.w / 2, view.h / 2 - 24);
    ctx.fillStyle = '#e8edf7';
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(`得分 ${state.score}`, view.w / 2, view.h / 2 + 18);
    ctx.fillStyle = 'rgba(147, 160, 184, 0.95)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText(
      state.solved ? '敌军全部击毁' : `剩余敌军 ${state.remaining ?? 0}`,
      view.w / 2,
      view.h / 2 + 48
    );
    ctx.restore();
  }
}
