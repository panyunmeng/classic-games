/**
 * 过河青蛙 · 渲染。只读 logic.state()，不改任何逻辑状态。
 * 坐标固定 480×640（与 game.json.canvas 一致），所有几何量取自 state.geom。
 *
 * 造型全部程序化、几何化（不复刻原作青蛙/车辆美术）：
 * - 青蛙：淡绿圆形躯干 + 双白眼球 + 梯形腿 + 头顶菱形冠，按移动方向看向前方；
 * - 车辆：圆角车身 + 车顶玻璃 + 前后车灯，朝向由车道 dir 决定；
 * - 原木：圆角木身 + 两端年轮 + 两道木纹；
 * - 洞位：暗色圆孔 + 槽位底纹，占满后亮起四角星。
 * 视觉缓存（青蛙朝向、波相位）只存本模块闭包，不写回 state。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#84cc16';
const ACCENT2 = '#a3e635';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const ROAD_TOP = '#1b2230';
const ROAD_BOTTOM = '#141a26';
const RIVER_TOP = '#0d3350';
const RIVER_BOTTOM = '#0a2338';
const CAR_COLORS = ['#f59e0b', '#38bdf8', '#f43f5e', '#a78bfa'];

// 视觉状态（不影响逻辑）
let faceX = 0;
let faceY = 0;
let lastX = null;
let lastY = null;
let lastSteps = -1;

function trackFacing(s) {
  if (lastX === null || s.steps < lastSteps) {
    faceX = 0;
    faceY = 0;
  } else {
    const dx = s.player.x - lastX;
    const dy = s.player.y - lastY;
    if (Math.abs(dx) > 1e-6) {
      faceX = Math.sign(dx);
      faceY = 0;
    } else if (Math.abs(dy) > 1e-6) {
      faceX = 0;
      faceY = Math.sign(dy);
    }
  }
  lastX = s.player.x;
  lastY = s.player.y;
  lastSteps = s.steps;
}

export function rowCenterY(G, row) {
  if (row === 0) return G.startTop + G.startH / 2;
  if (row === 9) return G.holeTop + G.holeH / 2;
  return G.laneTop + (row - 1) * G.laneH + G.laneH / 2;
}

function drawZones(ctx, s, w, h, time) {
  const G = s.geom;

  // 顶部安全区（洞位所在的河岸）
  const holeGrad = ctx.createLinearGradient(0, G.holeTop, 0, G.holeTop + G.holeH);
  holeGrad.addColorStop(0, '#2c3d22');
  holeGrad.addColorStop(1, '#1d2a19');
  ctx.fillStyle = holeGrad;
  ctx.fillRect(0, G.holeTop, w, G.holeH);

  // 中部车道
  for (let row = 1; row <= 8; row++) {
    const y = G.laneTop + (row - 1) * G.laneH;
    const lane = s.lanes[row - 1];
    if (lane.kind === 'road') {
      const g = ctx.createLinearGradient(0, y, 0, y + G.laneH);
      g.addColorStop(0, ROAD_TOP);
      g.addColorStop(1, ROAD_BOTTOM);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, G.laneH);

      // 沥青颗粒感：固定相位点阵，不依赖随机
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      for (let k = 0; k < 5; k++) {
        const px = ((k * 97 + row * 41) % 470) + 5;
        const py = y + 8 + ((k * 13 + row * 7) % (G.laneH - 16));
        ctx.fillRect(px, py, 2, 2);
      }
    } else {
      const g = ctx.createLinearGradient(0, y, 0, y + G.laneH);
      g.addColorStop(0, RIVER_TOP);
      g.addColorStop(1, RIVER_BOTTOM);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, G.laneH);

      // 水波：两条正弦虚线，相位随 view.time 缓慢流动
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, w, G.laneH);
      ctx.clip();
      for (let k = 0; k < 2; k++) {
        const wy = y + 14 + k * 20;
        ctx.strokeStyle = `rgba(125, 211, 252, ${0.16 - k * 0.05})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 16]);
        ctx.lineDashOffset = -time * (18 + k * 10) + k * 9;
        ctx.beginPath();
        for (let px = -16; px <= w + 16; px += 8) {
          const py = wy + Math.sin(px * 0.055 + time * 1.6 + k * 1.7) * 3;
          if (px === -16) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // 底部起点区（草地）
  const startGrad = ctx.createLinearGradient(0, G.startTop, 0, G.startTop + G.startH);
  startGrad.addColorStop(0, '#20402a');
  startGrad.addColorStop(1, '#16301f');
  ctx.fillStyle = startGrad;
  ctx.fillRect(0, G.startTop, w, G.startH);

  // 画布最底部留一条深色河岸
  ctx.fillStyle = '#080c14';
  ctx.fillRect(0, G.startTop + G.startH, w, h - (G.startTop + G.startH));

  // 起点石台
  const padX = (5 + 0.5) * G.cell;
  const padY = G.startTop + G.startH / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(163, 230, 53, 0.14)';
  ctx.strokeStyle = 'rgba(163, 230, 53, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(padX, padY + 8, 30, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 岸线分隔
  ctx.fillStyle = 'rgba(163, 230, 53, 0.28)';
  ctx.fillRect(0, G.laneTop - 2, w, 2);
  ctx.fillStyle = 'rgba(125, 211, 252, 0.22)';
  ctx.fillRect(0, G.startTop - 2, w, 2);
}

function drawLaneMarks(ctx, s, w) {
  const G = s.geom;
  for (let row = 1; row <= 8; row++) {
    const y = G.laneTop + (row - 1) * G.laneH;
    const lane = s.lanes[row - 1];
    const isRoad = lane.kind === 'road';
    ctx.save();
    ctx.strokeStyle = isRoad ? 'rgba(255,255,255,0.22)' : 'rgba(147, 197, 253, 0.2)';
    ctx.lineWidth = 2;
    ctx.setLineDash(isRoad ? [18, 18] : [10, 22]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();

    // 车道方向箭头（贴在两端）
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = isRoad ? '#ffffff' : '#93c5fd';
    const ay = y + G.laneH / 2;
    const arrow = (ax) => {
      const d = lane.dir;
      ctx.beginPath();
      ctx.moveTo(ax - d * 9, ay - 7);
      ctx.lineTo(ax + d * 3, ay);
      ctx.lineTo(ax - d * 9, ay + 7);
      ctx.closePath();
      ctx.fill();
    };
    arrow(12);
    arrow(w - 12);
    ctx.restore();
  }
  // 最上面与最下面的车道边界
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, G.laneTop + 8 * G.laneH);
  ctx.lineTo(w, G.laneTop + 8 * G.laneH);
  ctx.stroke();
  ctx.restore();
}

function drawHoles(ctx, s, time) {
  const G = s.geom;
  const cy = G.holeTop + G.holeH / 2;
  for (let i = 0; i < s.holes.length; i++) {
    const hole = s.holes[i];
    const cx = (hole.col + 0.5) * G.cell;
    // 槽位底纹
    ctx.save();
    roundRect(ctx, i * 96 + 8, G.holeTop + 8, 80, G.holeH - 16, 16);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fill();
    ctx.strokeStyle = hole.occupied ? 'rgba(163, 230, 53, 0.35)' : 'rgba(163, 230, 53, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 暗色洞口
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy - 4, 2, cx, cy, 30);
    grad.addColorStop(0, hole.occupied ? 'rgba(163,230,53,0.9)' : '#0a1016');
    grad.addColorStop(0.65, hole.occupied ? 'rgba(132,204,22,0.75)' : '#0c141c');
    grad.addColorStop(1, hole.occupied ? 'rgba(60,110,10,0.9)' : '#111b24');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 29, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hole.occupied ? ACCENT2 : 'rgba(163, 230, 53, 0.28)';
    ctx.lineWidth = hole.occupied ? 3 : 2;
    ctx.stroke();
    ctx.restore();

    if (hole.occupied) {
      // 四角星标记
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 0.6 + i);
      ctx.fillStyle = '#f7fee7';
      ctx.shadowColor = ACCENT2;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const r = k % 2 === 0 ? 13 : 4;
        const a = (Math.PI / 4) * k;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      // 空槽里的暗淡小菱形，提示可填
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = ACCENT2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx + 7, cy);
      ctx.lineTo(cx, cy + 7);
      ctx.lineTo(cx - 7, cy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawCar(ctx, G, lane, o, ox) {
  const yc = rowCenterY(G, lane.row);
  const bodyY = yc - G.vehicleH / 2;
  const color = CAR_COLORS[(lane.row - 1) % CAR_COLORS.length];

  // 车轮
  ctx.save();
  ctx.fillStyle = '#070a10';
  ctx.beginPath();
  ctx.arc(ox + 14, yc + 13, 5.5, 0, Math.PI * 2);
  ctx.arc(ox + o.w - 14, yc + 13, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 车身
  ctx.save();
  const grad = ctx.createLinearGradient(0, bodyY, 0, bodyY + G.vehicleH);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(10, 14, 22, 0.9)');
  ctx.fillStyle = grad;
  roundRect(ctx, ox + 2, bodyY, o.w - 4, G.vehicleH, 9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 车顶玻璃
  ctx.fillStyle = 'rgba(12, 24, 38, 0.62)';
  roundRect(ctx, ox + o.w * 0.27, bodyY + 6, o.w * 0.46, 13, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(190, 230, 255, 0.22)';
  ctx.fillRect(ox + o.w * 0.3, bodyY + 7, o.w * 0.4, 2);
  ctx.restore();

  // 前灯 / 尾灯（朝向由 dir 决定）
  const frontX = lane.dir > 0 ? ox + o.w - 7 : ox + 7;
  const backX = lane.dir > 0 ? ox + 7 : ox + o.w - 7;
  ctx.save();
  ctx.shadowColor = '#fef9c3';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#fef9c3';
  ctx.beginPath();
  ctx.arc(frontX, bodyY + 11, 2.6, 0, Math.PI * 2);
  ctx.arc(frontX, bodyY + 25, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(backX, bodyY + 11, 2.1, 0, Math.PI * 2);
  ctx.arc(backX, bodyY + 25, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLog(ctx, G, lane, o, ox) {
  const yc = rowCenterY(G, lane.row);
  const top = yc - 21;
  ctx.save();
  // 木身
  const grad = ctx.createLinearGradient(0, top, 0, top + 42);
  grad.addColorStop(0, '#8a6134');
  grad.addColorStop(0.35, '#6f4a26');
  grad.addColorStop(1, '#4a3018');
  ctx.fillStyle = grad;
  roundRect(ctx, ox + 1, top, o.w - 2, 42, 13);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25, 14, 6, 0.65)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 顶端亮边
  ctx.fillStyle = 'rgba(226, 178, 112, 0.35)';
  roundRect(ctx, ox + 8, top + 4, o.w - 16, 5, 3);
  ctx.fill();

  // 木纹
  ctx.strokeStyle = 'rgba(46, 28, 12, 0.5)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    const yy = yc - 3 + k * 12;
    for (let px = ox + 16; px <= ox + o.w - 16; px += 8) {
      const py = yy + Math.sin(px * 0.09 + k) * 1.6;
      if (px === ox + 16) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 两端年轮
  ctx.strokeStyle = 'rgba(40, 24, 10, 0.8)';
  ctx.lineWidth = 2;
  for (const ex of [ox + 11, ox + o.w - 11]) {
    ctx.beginPath();
    ctx.ellipse(ex, yc, 7, 15, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(ex, yc, 3, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawObstacles(ctx, s) {
  const G = s.geom;
  for (const lane of s.lanes) {
    for (const o of lane.obstacles) {
      for (const ox of [o.x, o.x - G.track]) {
        if (ox > G.w || ox + o.w < 0) continue;
        if (lane.kind === 'road') drawCar(ctx, G, lane, o, ox);
        else drawLog(ctx, G, lane, o, ox);
      }
    }
  }
}

function drawFrog(ctx, s, time) {
  const G = s.geom;
  const x = (s.player.x + 0.5) * G.cell;
  const y = rowCenterY(G, s.player.y);
  const hop = s.solved ? 1 + Math.sin(time * 10) * 0.08 : 1;
  const r = 15 * hop;

  ctx.save();
  // 落地阴影
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 腿（左右各一只，横向移动时略微前后错开）
  ctx.fillStyle = '#5f9f1a';
  const legShift = faceX * 2;
  roundRect(ctx, x - 18 + legShift, y + 6, 12, 9, 4);
  ctx.fill();
  roundRect(ctx, x + 6 + legShift, y + 6, 12, 9, 4);
  ctx.fill();

  // 躯干
  const body = ctx.createRadialGradient(x - 4, y - 6, 2, x, y, r + 4);
  body.addColorStop(0, '#e6ffa8');
  body.addColorStop(0.55, ACCENT2);
  body.addColorStop(1, '#5f9f1a');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#365c10';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 肚皮高光
  ctx.fillStyle = 'rgba(247, 254, 231, 0.45)';
  ctx.beginPath();
  ctx.ellipse(x - 3, y + 5, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 头顶菱形冠（几何精灵标识）
  ctx.fillStyle = ACCENT2;
  ctx.beginPath();
  ctx.moveTo(x, y - r - 3);
  ctx.lineTo(x + 5, y - r + 4);
  ctx.lineTo(x, y - r + 10);
  ctx.lineTo(x - 5, y - r + 4);
  ctx.closePath();
  ctx.fill();

  // 眼睛：朝移动方向偏移瞳孔
  const ex = faceX * 2.5;
  const ey = faceY < 0 ? -1.5 : 0;
  for (const sx of [-8, 8]) {
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(x + sx, y - 7, 5.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14210a';
    ctx.beginPath();
    ctx.arc(x + sx + ex, y - 7 + ey, 2.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHud(ctx, s, w) {
  const G = s.geom;
  ctx.save();
  const bar = ctx.createLinearGradient(0, 0, 0, G.hudH);
  bar.addColorStop(0, 'rgba(9, 14, 22, 0.92)');
  bar.addColorStop(1, 'rgba(9, 14, 22, 0.72)');
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, w, G.hudH);
  ctx.fillStyle = 'rgba(163, 230, 53, 0.3)';
  ctx.fillRect(0, G.hudH - 2, w, 2);

  // 分数
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(203, 213, 225, 0.7)';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillText('分数', 16, 16);
  ctx.fillStyle = '#f7fee7';
  ctx.font = `800 24px ${FONT}`;
  ctx.fillText(String(s.score), 16, 42);

  // 关卡
  ctx.fillStyle = 'rgba(163, 230, 53, 0.85)';
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(`第 ${s.level} 关`, 92, 42);

  // 倒计时条
  const barX = 196;
  const barY = 20;
  const barW = 150;
  const barH = 9;
  const ratio = Math.max(0, Math.min(1, s.timeLeft / 30));
  ctx.fillStyle = 'rgba(203, 213, 225, 0.65)';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillText('倒计时', barX, 14);
  roundRect(ctx, barX, barY, barW, barH, 5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fill();
  const timeColor = ratio > 0.5 ? ACCENT2 : ratio > 0.25 ? '#facc15' : '#f87171';
  ctx.save();
  ctx.shadowColor = timeColor;
  ctx.shadowBlur = 8;
  ctx.fillStyle = timeColor;
  roundRect(ctx, barX, barY, Math.max(3, barW * ratio), barH, 5);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(`${Math.ceil(s.timeLeft)}s`, barX + barW + 8, 30);

  // 生命
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(203, 213, 225, 0.7)';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillText('命', w - 14, 16);
  for (let i = 0; i < 3; i++) {
    const lx = w - 20 - i * 16;
    roundRect(ctx, lx - 9, 24, 12, 12, 4);
    if (i < s.lives) {
      ctx.fillStyle = ACCENT2;
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawSolved(ctx, s, w, h, time) {
  if (!s.solved) return;
  ctx.save();
  ctx.fillStyle = 'rgba(6, 10, 16, 0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#f7fee7';
  ctx.font = `800 36px ${FONT}`;
  ctx.fillText(`第 ${s.level} 关完成`, w / 2, h * 0.44 + Math.sin(time * 6) * 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = ACCENT2;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText('准备进入下一关', w / 2, h * 0.44 + 42);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  trackFacing(state);
  drawZones(ctx, state, view.w, view.h, view.time);
  drawLaneMarks(ctx, state, view.w);
  drawHoles(ctx, state, view.time);
  drawObstacles(ctx, state);
  drawFrog(ctx, state, view.time);
  drawHud(ctx, state, view.w);
  drawSolved(ctx, state, view.w, view.h, view.time);
}
