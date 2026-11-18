/**
 * 蓄力跳 · 渲染。只读 logic.state()，不改状态。
 * 坐标固定 480×640（与 game.json.canvas 一致），世界坐标减去 state.camX 得到屏幕坐标。
 *
 * 画面要素（自上而下）：霓虹夜空（星点/月/视差楼群）→ 平台发光柱 →
 * 抛物线预测虚线 → 角色与蓄力条 → 落地粒子 → HUD 与提示。
 * 粒子与拖尾只存在于渲染层，纯视觉，不进逻辑状态。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#a78bfa';
const ACCENT2 = '#c4b5fd';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/* ── 纯视觉缓存 ─────────────────────────────────────────── */

let particles = [];
let seenLand = 0;
let trail = [];
let trailOn = false;

function hash01(i) {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const STARS = Array.from({ length: 64 }, (_, i) => ({
  x: hash01(i * 2 + 1) * 480,
  y: hash01(i * 2 + 2) * 400,
  r: 0.6 + hash01(i * 3 + 7) * 1.2,
  ph: i * 0.7,
}));

function spawnLanding(s) {
  const l = s.lastLand;
  if (!l) return;
  const sx = l.x - s.camX;
  const n = l.perfect ? 22 : 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(i + l.seq) * 0.6;
    const sp = 40 + hash01(i * 5 + l.seq) * 110;
    particles.push({
      x: sx + Math.cos(a) * 6,
      y: l.y - 4,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.5 - 40,
      life: 0.42 + hash01(i + 3) * 0.28,
      age: 0,
      r: l.perfect ? 2.4 : 1.8,
      warm: l.perfect && i % 3 === 0,
    });
  }
  if (particles.length > 160) particles = particles.slice(-160);
}

function updateParticles(dt) {
  if (!particles.length) return;
  const step = Math.min(0.05, dt || 0);
  for (const p of particles) {
    p.age += step;
    p.vy += 520 * step;
    p.x += p.vx * step;
    p.y += p.vy * step;
  }
  particles = particles.filter((p) => p.age < p.life);
}

/* ── 夜空 ───────────────────────────────────────────────── */

function drawNight(ctx, w, h, time, camX) {
  // 夜色叠加：上方偏紫、下方近黑
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(46, 28, 92, 0.85)');
  g.addColorStop(0.45, 'rgba(22, 15, 48, 0.55)');
  g.addColorStop(1, 'rgba(6, 4, 16, 0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 星点
  for (const st of STARS) {
    const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 1.6 + st.ph));
    ctx.globalAlpha = tw * 0.9;
    ctx.fillStyle = st.r > 1.3 ? '#e9e2ff' : '#c9bfff';
    ctx.beginPath();
    ctx.arc(st.x - ((camX * 0.04) % w), st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 月
  ctx.save();
  const mx = w - 74;
  const my = 96;
  const halo = ctx.createRadialGradient(mx, my, 6, mx, my, 66);
  halo.addColorStop(0, 'rgba(214, 198, 255, 0.5)');
  halo.addColorStop(1, 'rgba(167, 139, 250, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(mx, my, 66, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#efe9ff';
  ctx.beginPath();
  ctx.arc(mx, my, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(190, 176, 235, 0.55)';
  ctx.beginPath();
  ctx.arc(mx - 7, my - 5, 4.5, 0, Math.PI * 2);
  ctx.arc(mx + 6, my + 7, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawSkyline(ctx, w, h, camX);
}

function drawSkyline(ctx, w, h, camX) {
  const layers = [
    { speed: 0.18, base: h * 0.78, unit: 52, maxH: 130, fill: 'rgba(46, 34, 82, 0.55)', win: 'rgba(167, 139, 250, 0.30)' },
    { speed: 0.4, base: h * 0.88, unit: 68, maxH: 170, fill: 'rgba(24, 17, 46, 0.92)', win: 'rgba(196, 181, 253, 0.35)' },
  ];
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const shift = camX * L.speed;
    const i0 = Math.floor((shift - L.unit) / L.unit);
    const i1 = Math.floor((shift + w + L.unit) / L.unit);
    for (let i = i0; i <= i1; i++) {
      const bx = i * L.unit - shift;
      const bh = 26 + hash01(i + li * 97) * L.maxH;
      const bw = L.unit - 6;
      ctx.fillStyle = L.fill;
      ctx.fillRect(bx, L.base - bh, bw, bh + 8);
      // 少量窗户点光
      if (li === 1) {
        ctx.fillStyle = L.win;
        const cols = 2;
        const rows = Math.max(1, Math.floor(bh / 22));
        for (let c = 0; c < cols; c++) {
          for (let r0 = 0; r0 < rows; r0++) {
            if (hash01(i * 31 + c * 7 + r0 * 13) > 0.62) {
              ctx.fillRect(bx + 8 + c * 20, L.base - bh + 10 + r0 * 22, 5, 7);
            }
          }
        }
      }
    }
  }
  // 地平线辉光
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, 'rgba(167, 139, 250, 0)');
  g.addColorStop(1, 'rgba(94, 62, 168, 0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
}

/* ── 平台 ───────────────────────────────────────────────── */

function drawPlatforms(ctx, s, time) {
  const ph = s.platformH || 16;
  for (const p of s.platforms) {
    const x = p.x - s.camX;
    if (x > s.w + 60 || x + p.w < -60) continue;
    const y = p.y;

    // 柱身：从台面往下到底，透明渐变
    const col = ctx.createLinearGradient(0, y + ph, 0, s.h);
    col.addColorStop(0, p.next ? 'rgba(167, 139, 250, 0.24)' : 'rgba(120, 100, 190, 0.16)');
    col.addColorStop(1, 'rgba(90, 70, 150, 0)');
    ctx.fillStyle = col;
    ctx.fillRect(x + 4, y + ph - 2, p.w - 8, s.h - y - ph);

    // 柱身两侧细光边
    ctx.strokeStyle = 'rgba(196, 181, 253, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + ph);
    ctx.lineTo(x + 4, s.h);
    ctx.moveTo(x + p.w - 4, y + ph);
    ctx.lineTo(x + p.w - 4, s.h);
    ctx.stroke();

    // 台面
    ctx.save();
    ctx.shadowColor = p.next ? ACCENT : 'rgba(167, 139, 250, 0.6)';
    ctx.shadowBlur = p.next ? 22 : 12;
    const g = ctx.createLinearGradient(x, y, x + p.w, y + ph);
    g.addColorStop(0, p.next ? '#b9a2ff' : '#7d6bb8');
    g.addColorStop(0.5, p.next ? '#8b6cf0' : '#63548f');
    g.addColorStop(1, p.next ? '#b9a2ff' : '#7d6bb8');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, p.w, ph, 7);
    ctx.fill();
    ctx.restore();

    // 台面高光线
    ctx.strokeStyle = p.next ? 'rgba(233, 226, 255, 0.95)' : 'rgba(220, 212, 255, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 1.6);
    ctx.lineTo(x + p.w - 8, y + 1.6);
    ctx.stroke();

    // 完美落点区（中心 ±PERFECT_R）用亮斑标出来
    const cx = x + p.w / 2;
    const pr = Math.min(s.perfectR || 12, p.w / 2 - 2);
    const spot = ctx.createRadialGradient(cx, y + 3, 0, cx, y + 3, Math.max(4, pr * 1.6));
    spot.addColorStop(0, p.next ? 'rgba(255, 252, 255, 0.85)' : 'rgba(230, 220, 255, 0.35)');
    spot.addColorStop(1, 'rgba(196, 181, 253, 0)');
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(cx, y + 3, Math.max(4, pr * 1.6), 0, Math.PI * 2);
    ctx.fill();

    // 目标平台：上方浮动箭头
    if (p.next) {
      const bob = Math.sin(time * 4) * 3;
      ctx.save();
      ctx.fillStyle = 'rgba(196, 181, 253, 0.9)';
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(cx - 7, y - 20 + bob);
      ctx.lineTo(cx + 7, y - 20 + bob);
      ctx.lineTo(cx, y - 10 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ── 抛物线预测 ─────────────────────────────────────────── */

function drawPrediction(ctx, s) {
  if (!s.player.charging || s.player.power <= 0.5) return;
  const sx = s.player.x - s.camX;
  const sy = s.player.y;
  const vx = s.aimVx;
  const vy = s.jumpVy !== undefined ? s.jumpVy : -560;
  const g = s.gravity !== undefined ? s.gravity : 1500;
  const dt = 0.075;
  const pts = [];
  for (let i = 1; i <= 10; i++) {
    const t = i * dt;
    pts.push({ x: sx + vx * t, y: sy + vy * t + 0.5 * g * t * t });
  }

  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(196, 181, 253, 0.55)';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < pts.length; i++) {
    const k = 1 - i / (pts.length + 2);
    ctx.globalAlpha = 0.25 + k * 0.6;
    ctx.fillStyle = i === pts.length - 1 ? '#ffffff' : ACCENT2;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, i === pts.length - 1 ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ── 角色与蓄力条 ───────────────────────────────────────── */

function drawPlayer(ctx, s, time) {
  const sx = s.player.x - s.camX;
  const sy = s.player.y;
  const r = s.r || 15;
  const airborne = !s.player.onGround;

  // 拖尾（仅空中）
  if (airborne) {
    trail.push({ x: sx, y: sy });
    if (trail.length > 14) trail.shift();
    trailOn = true;
  } else if (trailOn) {
    trail = [];
    trailOn = false;
  }
  for (let i = 0; i < trail.length; i++) {
    const k = (i + 1) / trail.length;
    ctx.globalAlpha = 0.05 + k * 0.25;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, r * (0.25 + k * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  // 蓄力时外圈脉冲
  const pulse = s.player.charging ? 1 + Math.sin(time * 12) * 0.08 : 1;
  const halo = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 3 * pulse);
  halo.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  halo.addColorStop(0.35, 'rgba(196, 181, 253, 0.85)');
  halo.addColorStop(1, 'rgba(167, 139, 250, 0)');
  ctx.fillStyle = halo;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = s.player.charging ? 30 : 20;
  ctx.beginPath();
  ctx.arc(sx, sy, r * 3 * pulse, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.4, 1, sx, sy, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.45, '#e3d9ff');
  body.addColorStop(1, '#8b6cf0');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();

  // 朝向小尖角
  const d = s.dir || 1;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(sx + d * (r - 1), sy - 5);
  ctx.lineTo(sx + d * (r + 8), sy);
  ctx.lineTo(sx + d * (r - 1), sy + 5);
  ctx.closePath();
  ctx.fill();

  // 眼睛朝下一平台看
  ctx.fillStyle = '#221445';
  ctx.beginPath();
  ctx.arc(sx + d * 4 - 3, sy - 3, 2.1, 0, Math.PI * 2);
  ctx.arc(sx + d * 4 + 3, sy - 3, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawChargeBar(ctx, s) {
  const power = s.player.power;
  if (!s.player.charging && power <= 0.5) return;
  const sx = s.player.x - s.camX;
  const sy = s.player.y;
  const r = s.r || 15;
  const bw = 66;
  const bh = 8;
  const bx = sx - bw / 2;
  const by = sy - r - 30;
  const k = Math.max(0, Math.min(1, power / 100));

  ctx.save();
  // 底槽
  ctx.fillStyle = 'rgba(10, 6, 24, 0.78)';
  roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(196, 181, 253, 0.55)';
  ctx.lineWidth = 1;
  roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 6);
  ctx.stroke();

  // 填充
  if (k > 0) {
    const g = ctx.createLinearGradient(bx, by, bx + bw, by);
    g.addColorStop(0, '#7c5ce0');
    g.addColorStop(0.6, ACCENT);
    g.addColorStop(1, k > 0.92 ? '#ffffff' : ACCENT2);
    ctx.save();
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 12;
    ctx.fillStyle = g;
    roundRect(ctx, bx, by, Math.max(3, bw * k), bh, 4);
    ctx.fill();
    ctx.restore();
  }

  // 刻度：25/50/75
  ctx.strokeStyle = 'rgba(10, 6, 24, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const tx = bx + (bw * i) / 4;
    ctx.beginPath();
    ctx.moveTo(tx, by);
    ctx.lineTo(tx, by + bh);
    ctx.stroke();
  }

  // 数值
  ctx.fillStyle = 'rgba(233, 226, 255, 0.92)';
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`力度 ${Math.round(power)}`, sx, by - 6);
  ctx.restore();
}

function drawParticles(ctx) {
  for (const p of particles) {
    const k = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = p.warm ? '#ffffff' : ACCENT2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ── HUD 与提示 ─────────────────────────────────────────── */

function drawHud(ctx, s, w) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `800 54px ${FONT}`;
  ctx.shadowColor = 'rgba(167, 139, 250, 0.7)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#f4efff';
  ctx.fillText(String(s.score), w / 2, 62);
  ctx.shadowBlur = 0;

  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = 'rgba(196, 181, 253, 0.85)';
  const bits = [`平台 ${Math.max(0, (s.nextId || 1) - 1)}`];
  if (s.perfects) bits.push(`完美 ${s.perfects}`);
  if (s.combo > 1) bits.push(`连击 ×${s.combo}`);
  ctx.fillText(bits.join('  ·  '), w / 2, 96);

  if (s.combo >= 2) {
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = ACCENT2;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 14;
    ctx.fillText(`完美连击 ×${s.combo}`, w / 2, 120);
  }
  ctx.restore();
}

function drawOverlay(ctx, s, w, h) {
  if (s.ready) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(8, 5, 20, 0.55)';
    roundRect(ctx, w / 2 - 168, h * 0.3 - 34, 336, 92, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.45)';
    ctx.lineWidth = 1;
    roundRect(ctx, w / 2 - 168, h * 0.3 - 34, 336, 92, 16);
    ctx.stroke();

    ctx.fillStyle = '#f4efff';
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText('按住蓄力 · 松开起跳', w / 2, h * 0.3 - 8);
    ctx.fillStyle = 'rgba(196, 181, 253, 0.85)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText('力度决定水平速度 · 落平台中心 +5', w / 2, h * 0.3 + 20);
    ctx.fillStyle = 'rgba(160, 150, 200, 0.8)';
    ctx.font = `12px ${FONT}`;
    ctx.fillText('← → 选边 · 掉出屏幕即结束', w / 2, h * 0.3 + 42);
    ctx.restore();
    return;
  }

  if (s.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 4, 16, 0.62)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4efff';
    ctx.font = `800 34px ${FONT}`;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 20;
    ctx.fillText('掉下去了', w / 2, h / 2 - 20);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(233, 226, 255, 0.95)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`得分 ${s.score}`, w / 2, h / 2 + 20);
    ctx.fillStyle = 'rgba(196, 181, 253, 0.8)';
    ctx.font = `13px ${FONT}`;
    ctx.fillText(`完美落点 ${s.perfects} 次 · 按 R 重开`, w / 2, h / 2 + 50);
    ctx.restore();
  }
}

/* ── 入口 ───────────────────────────────────────────────── */

export function render(ctx, state, view) {
  const s = state;
  const time = view.time || 0;
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  drawNight(ctx, view.w, view.h, time, s.camX || 0);

  updateParticles(view.dt);
  if (!s.lastLand) {
    seenLand = 0;
  } else if (s.lastLand.seq > seenLand) {
    seenLand = s.lastLand.seq;
    spawnLanding(s);
  }

  drawPlatforms(ctx, s, time);
  drawPrediction(ctx, s);

  // 角色投影（落地时的椭圆影子）
  if (s.player.onGround) {
    const sx = s.player.x - (s.camX || 0);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(sx, s.player.y + (s.r || 15), (s.r || 15) * 0.85, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer(ctx, s, time);
  drawChargeBar(ctx, s);
  drawParticles(ctx);
  drawHud(ctx, s, view.w);
  drawOverlay(ctx, s, view.w, view.h);
}
