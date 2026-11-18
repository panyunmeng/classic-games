/**
 * 单键飞行 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 飞行器 x 固定，重力持续下拉；flap 给固定向上冲量（不是累加），vx 恒为 0。
 * - 管道对以固定间距 SPACING 生成，缺口高度 GAP 固定；缺口中心由种子 RNG 决定，
 *   生成顺序固定 ⇒ 同种子同序列可复现。
 * - 屏幕 x 由累计滚动距离 scroll 推出（x = FIRST_X + k·SPACING - scroll），
 *   与 dt 如何切分无关，回放稳定。
 * - 速度随分数略增：speed = min(MAX_SPEED, BASE + score·SPEED_STEP)。
 * - 碰撞一律 AABB：飞行器方框 vs 管道上/下矩形，另加天花板与地面边界。
 * - step 内再细分 ≤1/120 s 微步，避免大 dt 穿越管道。
 */
import { createRng } from '../../shared/rng.js';

export const W = 480;
export const H = 640;
export const R = 14;
export const PLAYER_X = 130;
export const GAP = 180;
export const PW = 70;
export const SPACING = 210;
export const FIRST_X = W + 40;
export const GRAVITY = 1500;
export const FLAP_VY = -430;
export const MAX_FALL = 720;
export const BASE_SPEED = 150;
export const SPEED_STEP = 8;
export const MAX_SPEED = 280;

const MIN_GAP_Y = GAP / 2 + 40;
const MAX_GAP_Y = H - GAP / 2 - 40;
const MAX_H = 1 / 120;

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function createGame({ seed = 1, mode = 'solo' } = {}) {
  const initialSeed = seed >>> 0;
  let rng;
  let y;
  let vy;
  let score;
  let over;
  let ready;
  let scroll;
  let spawned;
  let pipes;
  let steps;

  function speedNow() {
    return Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_STEP);
  }

  function gapFor() {
    return MIN_GAP_Y + rng.next() * (MAX_GAP_Y - MIN_GAP_Y);
  }

  function spawnPipes() {
    // 生成所有已进入“右边界 + 一个间距”范围的管道，顺序固定。
    for (;;) {
      const x = FIRST_X + spawned * SPACING - scroll;
      if (x > W + SPACING) break;
      pipes.push({ x, gapY: gapFor(), scored: false });
      spawned += 1;
    }
  }

  function reset() {
    rng = createRng(initialSeed);
    y = H * 0.45;
    vy = 0;
    score = 0;
    over = false;
    ready = true;
    scroll = 0;
    spawned = 0;
    pipes = [];
    steps = 0;
    spawnPipes();
  }

  function applyFlap() {
    vy = FLAP_VY;
  }

  function submit(playerId, action) {
    if (action === 'start') {
      if (ready) ready = false;
      return { ok: true };
    }
    if (action === 'flap') {
      if (over) return { ok: false, error: '本局已结束' };
      if (ready) ready = false; // 单键：首次点击直接起飞
      applyFlap();
      return { ok: true };
    }
    return { ok: false, error: '无效操作' };
  }

  function integrate(h) {
    const speed = speedNow();
    const move = speed * h;

    // 飞行器竖直运动
    vy = Math.min(MAX_FALL, vy + GRAVITY * h);
    y += vy * h;

    // 世界滚动与管道生成 / 回收
    scroll += move;
    for (const p of pipes) p.x -= move;
    spawnPipes();
    if (pipes.length && pipes[0].x + PW < 0) {
      pipes = pipes.filter((p) => p.x + PW >= 0);
    }

    const px = PLAYER_X - R;
    const py = y - R;
    const pw = R * 2;
    const ph = R * 2;

    // 天花板 / 地面
    if (py <= 0 || py + ph >= H) {
      over = true;
      return;
    }

    // 管道 AABB
    for (const p of pipes) {
      const topH = p.gapY - GAP / 2;
      const bottomY = p.gapY + GAP / 2;
      if (
        overlap(px, py, pw, ph, p.x, 0, PW, topH) ||
        overlap(px, py, pw, ph, p.x, bottomY, PW, H - bottomY)
      ) {
        over = true;
        return;
      }
    }

    // 穿过管道：整只飞行器越过管道右缘即 +1
    for (const p of pipes) {
      if (!p.scored && p.x + PW < PLAYER_X) {
        p.scored = true;
        score += 1;
      }
    }
  }

  function step(dt, actions) {
    if (over) return;
    if (Array.isArray(actions) && actions.includes('flap')) {
      if (ready) ready = false;
      applyFlap();
    }
    if (ready) return; // 未起飞时物理冻结
    let remaining = Math.max(0, Math.min(dt || 0, 2.5));
    let guard = 0;
    while (remaining > 0 && !over && guard < 300) {
      const h = Math.min(remaining, MAX_H);
      integrate(h);
      remaining -= h;
      guard += 1;
      steps += 1;
    }
  }

  function state() {
    return {
      turn: 'p1',
      player: { x: PLAYER_X, y, vy },
      pipes: pipes.map((p) => ({ x: p.x, gapY: p.gapY, scored: p.scored })),
      score,
      over,
      ready,
      scroll,
      speed: speedNow(),
      steps,
      w: W,
      h: H,
      gap: GAP,
      pw: PW,
      r: R,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `得分 ${score}`,
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
