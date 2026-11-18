/**
 * 飞行棋 · 渲染（只读 state，不改状态）。坐标系固定 480×640，与 board.mjs 一致。
 *
 * 视觉结构（自下而上）：
 *   深色底盘 → 四色基地（各 4 个洞）→ 52 格四色环道（安全格带星标、起点带箭头）
 *   → 四色 6 格终点跑道 → 中心终点盘 → 合法落点高亮 → 棋子圆片
 *   → 顶部双方状态卡与骰子面板。
 * 全部图形程序化生成，无图片资源。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { COLORS, RING, GOAL, PIECES, SAFE_CELLS } from './logic.mjs';
import {
  CELL,
  BOARD_X,
  BOARD_Y,
  BOARD_PX,
  DICE,
  RING_PATH,
  LANES,
  BASE_ORIGIN,
  baseHole,
  cellCenter,
  laneCenter,
  quadrantOfRing,
  piecePositions,
  targetPos,
} from './board.mjs';

const ACCENT = '#facc15';
const ACCENT2 = '#f472b6';
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const SAFE = new Set(SAFE_CELLS);

/* ── 颜色小工具 ─────────────────────────────────────────── */

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function tint(hex, t) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const m = c.map((v) => Math.round(v + (255 - v) * t));
  return `rgb(${m.join(',')})`;
}

function shade(hex, t) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const m = c.map((v) => Math.round(v * (1 - t)));
  return `rgb(${m.join(',')})`;
}

const activeColor = (index) => COLORS[index].hex;

/* ── 底盘 / 基地 ────────────────────────────────────────── */

function drawPlate(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, BOARD_X - 10, BOARD_Y - 10, BOARD_PX + 20, BOARD_PX + 20, 22);
  ctx.fillStyle = 'rgba(10, 15, 28, 0.9)';
  ctx.fill();
  ctx.restore();

  roundRect(ctx, BOARD_X - 10, BOARD_Y - 10, BOARD_PX + 20, BOARD_PX + 20, 22);
  ctx.strokeStyle = rgba(ACCENT, 0.22);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawBases(ctx, state) {
  for (let c = 0; c < COLORS.length; c++) {
    const [ox, oy] = BASE_ORIGIN[c];
    const x = BOARD_X + ox * CELL;
    const y = BOARD_Y + oy * CELL;
    const s = 6 * CELL;
    const hex = activeColor(c);
    const live = c < state.players.length;

    roundRect(ctx, x + 7, y + 7, s - 14, s - 14, 20);
    ctx.fillStyle = rgba(hex, live ? 0.16 : 0.08);
    ctx.fill();
    ctx.strokeStyle = rgba(hex, live ? 0.45 : 0.22);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (let k = 0; k < PIECES; k++) {
      const p = baseHole(c, k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 10, 18, 0.85)';
      ctx.fill();
      ctx.strokeStyle = rgba(hex, live ? 0.5 : 0.28);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

/* ── 环道 / 终点跑道 ────────────────────────────────────── */

function ringDir(index) {
  const [c1, r1] = RING_PATH[((index % RING) + RING) % RING];
  const [c2, r2] = RING_PATH[(((index + 1) % RING) + RING) % RING];
  const dx = Math.sign(c2 - c1);
  const dy = Math.sign(r2 - r1);
  return { dx, dy };
}

function drawArrow(ctx, cx, cy, dx, dy, hex, alpha) {
  const len = 6.5;
  const wid = 5.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(-len, -wid);
  ctx.lineTo(-len * 0.2, 0);
  ctx.lineTo(-len, wid);
  ctx.closePath();
  ctx.fillStyle = rgba(hex, alpha);
  ctx.fill();
  ctx.restore();
}

function drawSafeMark(ctx, cx, cy, hex) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    ctx.lineTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
    const a2 = a + Math.PI / 4;
    ctx.lineTo(Math.cos(a2) * 2.4, Math.sin(a2) * 2.4);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(hex, 0.85);
  ctx.fill();
  ctx.restore();
}

function drawTrack(ctx, state, time) {
  const turnColor = state.turn ? COLORS[state.turn === 'p2' ? 1 : 0].hex : ACCENT;

  for (let i = 0; i < RING; i++) {
    const [col, row] = RING_PATH[i];
    const hex = activeColor(quadrantOfRing(i));
    const live = quadrantOfRing(i) < state.players.length;
    const p = cellCenter(col, row);
    const isStart = COLORS.some((c) => c.start === i);

    roundRect(ctx, p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4, 6);
    ctx.fillStyle = rgba(hex, isStart ? 0.42 : live ? 0.24 : 0.13);
    ctx.fill();
    ctx.strokeStyle = SAFE.has(i) ? rgba(ACCENT, 0.55) : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = SAFE.has(i) ? 1.6 : 1;
    ctx.stroke();

    if (SAFE.has(i) && !isStart) drawSafeMark(ctx, p.x, p.y, ACCENT);
    if (isStart) {
      const { dx, dy } = ringDir(i);
      drawArrow(ctx, p.x, p.y, dx, dy, '#0b1120', 0.85);
    }
  }

  // 当前回合玩家的起点格外圈脉冲，提示“从这儿出发”
  if (state.turn && !state.winner) {
    const idx = COLORS[state.turn === 'p2' ? 1 : 0].start;
    const [col, row] = RING_PATH[idx];
    const p = cellCenter(col, row);
    ctx.save();
    ctx.strokeStyle = rgba(turnColor, 0.35 + 0.25 * Math.sin(time * 4 + idx));
    ctx.lineWidth = 2;
    roundRect(ctx, p.x - CELL / 2 + 1, p.y - CELL / 2 + 1, CELL - 2, CELL - 2, 7);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLanes(ctx, state) {
  for (let c = 0; c < COLORS.length; c++) {
    const hex = activeColor(c);
    const live = c < state.players.length;
    for (let i = 0; i < LANES[c].length; i++) {
      const [col, row] = LANES[c][i];
      const p = cellCenter(col, row);
      const last = i === LANES[c].length - 1;
      roundRect(ctx, p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4, 6);
      ctx.fillStyle = rgba(hex, last ? (live ? 0.4 : 0.16) : live ? 0.2 : 0.1);
      ctx.fill();
      ctx.strokeStyle = rgba(hex, live ? 0.4 : 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!last) {
        // 指向中心的小尖角
        const dir = laneDirForward(c);
        drawArrow(ctx, p.x, p.y, dir.dx, dir.dy, hex, live ? 0.55 : 0.25);
      }
    }
  }
}

function laneDirForward(c) {
  const [c1, r1] = LANES[c][0];
  const [c2, r2] = LANES[c][LANES[c].length - 1];
  return { dx: Math.sign(c2 - c1), dy: Math.sign(r2 - r1) };
}

/** 中心 3×3：4 个跑道终点格 + 中心四色罗盘 */
function drawCenter(ctx, state) {
  const x = BOARD_X + 6 * CELL;
  const y = BOARD_Y + 6 * CELL;
  roundRect(ctx, x, y, 3 * CELL, 3 * CELL, 12);
  ctx.fillStyle = 'rgba(8, 12, 22, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 四个跑道终点格再压一层，让中心像“家门”而不是空地
  for (let c = 0; c < COLORS.length; c++) {
    const p = laneCenter(c, LANES[c].length - 1);
    roundRect(ctx, p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4, 6);
    ctx.fillStyle = rgba(activeColor(c), c < state.players.length ? 0.5 : 0.16);
    ctx.fill();
  }

  const cx = x + 1.5 * CELL;
  const cy = y + 1.5 * CELL;
  const r = CELL * 0.52;
  // 扇面朝向各自的终点跑道：红左、蓝上、绿右、黄下
  const FACE = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];
  for (let c = 0; c < 4; c++) {
    const a0 = FACE[c] - Math.PI / 4;
    const a1 = a0 + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = rgba(activeColor(c), c < state.players.length ? 0.85 : 0.35);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 15, 28, 0.9)';
  ctx.fill();
}

/* ── 高亮 / 棋子 ────────────────────────────────────────── */

function drawTargets(ctx, state, time) {
  if (state.winner || !state.turn || state.phase !== 'move' || !state.moves.length) return;
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);
  const pi = state.turn === 'p2' ? 1 : 0;

  for (const mv of state.moves) {
    const pos = targetPos(pi, mv);
    const color = mv.capture.length ? ACCENT2 : ACCENT;
    ctx.save();
    ctx.strokeStyle = rgba(color, 0.35 + 0.4 * pulse);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3 + 1.4 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.75);
    ctx.fill();
    ctx.restore();
  }
}

function drawPiece(ctx, x, y, r, hex, highlight) {
  ctx.save();
  if (highlight) {
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 14;
  } else {
    ctx.shadowColor = rgba(hex, 0.75);
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 1;
  }
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r * 1.02);
  g.addColorStop(0, tint(hex, 0.55));
  g.addColorStop(0.55, hex);
  g.addColorStop(1, shade(hex, 0.45));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.34, r * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fill();

  if (highlight) {
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(ACCENT, 0.9);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

function drawPieces(ctx, state) {
  const movable = new Set();
  if (state.phase === 'move' && !state.winner) {
    for (const mv of state.moves) movable.add(mv.piece);
  }
  const currentIndex = state.turn === 'p2' ? 1 : 0;

  // 先画非当前方，当前方压在上层，方便看清自己的子
  for (const pi of [1, 0]) {
    if (pi >= state.players.length) continue;
    const list = piecePositions(state, pi);
    for (const p of list) {
      const highlight = !state.winner && pi === currentIndex && movable.has(p.piece) && p.progress !== GOAL;
      drawPiece(ctx, p.x, p.y, p.r, state.players[pi].hex, highlight);
    }
  }
}

/* ── 顶部状态卡 / 骰子 / 状态行 ─────────────────────────── */

const CARD_LABEL = ['红方', '蓝方'];

function cardLabel(pi, mode) {
  if (pi === 0) return mode === 'ai' ? '你 · 红' : CARD_LABEL[0];
  if (mode === 'ai') return 'AI · 蓝';
  if (mode === 'solo') return '蓝 · 自动';
  return CARD_LABEL[1];
}

function drawCards(ctx, state, mode) {
  for (let pi = 0; pi < state.players.length; pi++) {
    ctx.save();
    const pl = state.players[pi];
    const x = pi === 0 ? 22 : 258;
    const y = 14;
    const w = 200;
    const h = 64;
    const active = state.turn === pl.id;
    const hex = pl.hex;

    ctx.save();
    if (active) {
      ctx.shadowColor = rgba(hex, 0.8);
      ctx.shadowBlur = 16;
    }
    roundRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = 'rgba(12, 18, 32, 0.92)';
    ctx.fill();
    ctx.restore();

    roundRect(ctx, x, y, w, h, 16);
    ctx.strokeStyle = active ? rgba(hex, 0.95) : 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + 24, y + 24, 9, 0, Math.PI * 2);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8edf7';
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(cardLabel(pi, mode), x + 40, y + 24);

    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = active ? rgba(ACCENT, 0.95) : 'rgba(147, 160, 184, 0.8)';
    ctx.fillText(active ? (state.phase === 'move' ? '走子' : '掷骰') : '等待', x + 150, y + 24);

    // 4 个已到终点的子
    for (let k = 0; k < PIECES; k++) {
      const px = x + 24 + k * 16;
      const py = y + 47;
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      if (k < pl.finished) {
        ctx.fillStyle = hex;
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    if (active && state.extraRoll) {
      roundRect(ctx, x + w - 48, y + 8, 40, 18, 9);
      ctx.fillStyle = rgba(ACCENT2, 0.9);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1a1020';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText('再掷', x + w - 28, y + 17.5);
    }
    ctx.restore();
  }
}

function drawStatus(ctx, state, mode) {
  let text;
  if (state.winner) {
    text = state.winner === 'p1' ? '红方 4 子全部到终点，获胜！' : '蓝方 4 子全部到终点，获胜';
  } else if (state.phase === 'roll') {
    const who = state.turn === 'p1' ? '红方' : mode === 'ai' ? '蓝方（AI）' : '蓝方';
    text = state.extraRoll ? `${who} 6 点奖励 · 再掷一次` : `${who}回合 · 掷骰（按钮 / 空格 / 点骰子）`;
  } else if (!state.moves.length) {
    text = '没有子能走 · 自动跳过';
  } else {
    const who = state.turn === 'p1' ? '红方' : '蓝方';
    text = `${who}掷出 ${state.dice} 点 · 点亮的棋子可走`;
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = state.winner ? rgba(ACCENT, 0.95) : 'rgba(200, 210, 230, 0.8)';
  ctx.fillText(text, 240, 96);
  ctx.restore();
}

function drawDice(ctx, state, time) {
  const { x, y, w, h } = DICE;
  const ready = state.phase === 'roll' && !state.winner;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);

  ctx.save();
  if (ready) {
    ctx.shadowColor = rgba(ACCENT, 0.55 * pulse + 0.3);
    ctx.shadowBlur = 18;
  }
  roundRect(ctx, x, y, w, h, 22);
  ctx.fillStyle = 'rgba(10, 16, 28, 0.92)';
  ctx.fill();
  ctx.restore();

  roundRect(ctx, x, y, w, h, 22);
  ctx.strokeStyle = ready ? rgba(ACCENT, 0.85) : 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = ready ? 2 : 1;
  ctx.stroke();

  const cx = x + w / 2;
  const cy = y + h / 2 - 4;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state.dice == null) {
    ctx.font = `700 44px ${FONT}`;
    ctx.fillStyle = ready ? rgba(ACCENT, 0.75) : 'rgba(147, 160, 184, 0.4)';
    ctx.fillText('?', cx, cy);
  } else {
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 18;
    ctx.font = `700 52px ${FONT}`;
    ctx.fillStyle = '#fde68a';
    ctx.fillText(String(state.dice), cx, cy + 2);
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = 'rgba(147, 160, 184, 0.85)';
  const sub = state.dice != null ? '点数' : state.lastDice ? `上一掷 ${state.lastDice}` : '点「掷骰」';
  ctx.fillText(sub, cx, y + h - 14);
  ctx.restore();
}

/* ── 入口 ───────────────────────────────────────────────── */

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);
  drawPlate(ctx);
  drawBases(ctx, state);
  drawTrack(ctx, state, view.time);
  drawLanes(ctx, state);
  drawCenter(ctx, state);
  drawTargets(ctx, state, view.time);
  drawPieces(ctx, state);
  drawCards(ctx, state, view.mode);
  drawStatus(ctx, state, view.mode);
  drawDice(ctx, state, view.time);
}
