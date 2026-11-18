/**
 * 推箱子 · Canvas 渲染。只读 logic.state()，不改状态。
 * 坐标系固定 480×640（与 game.json.canvas 一致），深色工业风，全部程序化绘制。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#e3a636';
const ACCENT2 = '#5fd08a';
const CELL = 48;
const BOARD_TOP = 158;

function boardOrigin(state) {
  return {
    x: Math.round((480 - state.cols * CELL) / 2),
    y: BOARD_TOP,
  };
}

function cellRect(origin, x, y) {
  return { x: origin.x + x * CELL, y: origin.y + y * CELL };
}

/** 工业金属墙：深色底 + 顶部高光 + 四角铆钉 */
function drawWall(ctx, r) {
  ctx.fillStyle = '#323d4d';
  ctx.fillRect(r.x, r.y, CELL, CELL);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(r.x, r.y, CELL, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(r.x, r.y + CELL - 5, CELL, 5);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, CELL - 1, CELL - 1);
  ctx.fillStyle = 'rgba(190,205,225,0.35)';
  for (const [ox, oy] of [[7, 7], [CELL - 7, 7], [7, CELL - 8], [CELL - 7, CELL - 8]]) {
    ctx.beginPath();
    ctx.arc(r.x + ox, r.y + oy, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 地板：深蓝灰 + 细网格 */
function drawFloor(ctx, r) {
  ctx.fillStyle = '#121b2a';
  ctx.fillRect(r.x, r.y, CELL, CELL);
  ctx.strokeStyle = 'rgba(227,166,54,0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, CELL - 1, CELL - 1);
}

/** 目标：琥珀警示环 + 内菱形 */
function drawGoal(ctx, r, time) {
  const cx = r.x + CELL / 2;
  const cy = r.y + CELL / 2;
  const pulse = 0.5 + Math.sin(time * 2.4) * 0.16;
  ctx.save();
  ctx.strokeStyle = `rgba(227,166,54,${0.55 + pulse * 0.35})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, CELL / 2 - 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `rgba(227,166,54,${0.12 + pulse * 0.1})`;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx, cy + 8);
  ctx.lineTo(cx - 8, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 箱子：木板 + 加固条；到目标变绿并带对勾 */
function drawBox(ctx, r, onGoal) {
  const x = r.x + 4;
  const y = r.y + 4;
  const w = CELL - 8;
  const h = CELL - 8;
  const base = onGoal ? '#3e9b68' : '#b06f2c';
  const light = onGoal ? '#7ce0a6' : '#e2a756';
  const dark = onGoal ? '#1d5c3b' : '#6b3d13';

  ctx.save();
  ctx.shadowColor = onGoal ? ACCENT2 : ACCENT;
  ctx.shadowBlur = onGoal ? 16 : 8;
  ctx.fillStyle = base;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 4);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 6);
  ctx.lineTo(x + w - 6, y + h - 6);
  ctx.moveTo(x + w - 6, y + 6);
  ctx.lineTo(x + 6, y + h - 6);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = light;
  for (const [ox, oy] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) {
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  if (onGoal) {
    ctx.strokeStyle = '#eafff2';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x + 9, y + h / 2);
    ctx.lineTo(x + 16, y + h / 2 + 6);
    ctx.lineTo(x + w - 8, y + h / 2 - 8);
    ctx.stroke();
  }
}

/** 玩家：安全帽工人剪影 */
function drawPlayer(ctx, r, onGoal) {
  const cx = r.x + CELL / 2;
  const cy = r.y + CELL / 2;
  const main = onGoal ? ACCENT2 : '#f2c45f';
  ctx.save();
  ctx.shadowColor = main;
  ctx.shadowBlur = 14;
  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 安全帽
  ctx.fillStyle = onGoal ? '#2b7f52' : '#a86a1f';
  ctx.beginPath();
  ctx.arc(cx, cy - 6, 11, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(cx - 13, cy - 7, 26, 3);
  // 肩部
  ctx.fillStyle = onGoal ? '#2b7f52' : '#a86a1f';
  roundRect(ctx, cx - 12, cy + 7, 24, 9, 4);
  ctx.fill();
  // 面罩高光
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(cx + 3, cy - 3, 2.4, 0, Math.PI * 2);
  ctx.fill();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  const origin = boardOrigin(state);
  const bw = state.cols * CELL;
  const bh = state.rows * CELL;

  // 标题 / 统计
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT;
  ctx.font = '700 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`第 ${state.level} / ${state.levelCount} 关`, view.w / 2, 44);
  ctx.fillStyle = 'rgba(147,160,184,0.92)';
  ctx.font = '13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`步数 ${state.steps}　推动 ${state.pushes}　归位 ${state.boxesOnGoal}/${state.boxesTotal}`, view.w / 2, 70);
  ctx.fillStyle = 'rgba(227,166,54,0.65)';
  ctx.fillRect(view.w / 2 - 90, 88, 180, 2);
  ctx.restore();

  // 工业底板 + 铆钉 + 警示条
  ctx.save();
  ctx.shadowColor = 'rgba(227,166,54,0.16)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#0a0f19';
  roundRect(ctx, origin.x - 12, origin.y - 12, bw + 24, bh + 24, 12);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(227,166,54,0.5)';
  for (const [px, py] of [[origin.x - 5, origin.y - 5], [origin.x + bw + 5, origin.y - 5],
    [origin.x - 5, origin.y + bh + 5], [origin.x + bw + 5, origin.y + bh + 5]]) {
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(origin.x, origin.y + bh + 3, bw, 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(227,166,54,0.35)';
  ctx.lineWidth = 4;
  for (let i = -bw; i < bw * 2; i += 16) {
    ctx.beginPath();
    ctx.moveTo(origin.x + i, origin.y + bh + 8);
    ctx.lineTo(origin.x + i + 10, origin.y + bh + 2);
    ctx.stroke();
  }
  ctx.restore();

  // 逐格绘制：地板 → 目标 → 墙
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      const c = state.grid[y][x];
      const r = cellRect(origin, x, y);
      if (c === '#') {
        drawWall(ctx, r);
        continue;
      }
      drawFloor(ctx, r);
      if (c === '.' || c === '*' || c === '+') drawGoal(ctx, r, view.time || 0);
    }
  }

  // 箱子与玩家盖在地板之上
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      const c = state.grid[y][x];
      const r = cellRect(origin, x, y);
      if (c === '$' || c === '*') drawBox(ctx, r, c === '*');
      if (c === '@' || c === '+') drawPlayer(ctx, r, c === '+');
    }
  }

  // 底部提示
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(147,160,184,0.8)';
  ctx.fillText('方向键 / 滑动移动　·　撤销 / 重做 / 下一关', view.w / 2, view.h - 16);
  if (state.solved) {
    ctx.fillStyle = ACCENT2;
    ctx.font = '700 18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('本关完成！点「下一关」继续', view.w / 2, view.h - 64);
    ctx.fillStyle = ACCENT2;
    ctx.font = '600 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${state.steps} 步 · ${state.pushes} 次推动`, view.w / 2, view.h - 44);
  }
  ctx.restore();
}
