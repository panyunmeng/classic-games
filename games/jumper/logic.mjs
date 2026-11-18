/**
 * 蓄力跳 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 规则事实与推导（先定物理，再定参数）：
 *
 * 1) 起跳只有一次冲量：vy 固定 = JUMP_VY，重力 GRAVITY 恒定。
 *    竖直高度 h = vy²/(2g) ≈ 105 px；落回同高耗时 T0 = 2|vy|/g ≈ 0.747 s。
 *    水平速度 vx = power/100 · MAX_VX · dir ⇒ 落回同高的射程 = MAX_VX·T0·power/100，
 *    对 power 是线性关系；满力度射程 560×0.747 ≈ 418 px，最大平台间距需求
 *    （半宽 65 + 间距 190 + 半宽 61 ≈ 316 px）留有余量，且「蓄力越多飞越远」单调可预期。
 *
 * 2) 蓄力 0→100 用 1.2 s，到顶/到底反射成往返循环（回弹），
 *    所以按住越久力度越大，但有节奏；即使一直按住也不会卡在 100 上不回来。
 *
 * 3) 平台是单向平台：只有「下落且脚底本步跨过台面」才判定落点；
 *    上升穿过、从侧面撞上都不判死。缺省平台不掉命，落空才掉出屏幕。
 *    这保证判定只依赖一次穿越，不会因为速度大小或 dt 切分产生二义。
 *
 * 4) 平台由 rng 生成且随进度收窄：w = max(MIN_W, BASE_W − gen·W_STEP ± 3)，
 *    间距 = span(gen)·(0.55～1.0)。gen 递增 ⇒ 宽度单调不增（步长 8 > 抖动 3）。
 *
 * 5) 摄像机只向右推进 camX = max(camX, x − 0.34W)：
 *    玩家始终留在画面内，且回跳不会把已剔除的旧平台拉回视野。
 *
 * 6) 计分：落到「下一个」平台 +10；落点与平台中心距离 ≤ PERFECT_R 时再 +5，
 *    并累加 combo（连续完美数）；非完美的计分落地把 combo 归零。
 *    落回旧平台（同 id）不计分也不给 combo，允许小跳调整位置。
 */
import { createRng } from '../../shared/rng.js';

export const W = 480;
export const H = 640;

/** 角色半径（世界单位 px） */
export const PLAYER_R = 15;
export const GRAVITY = 1500;
export const MAX_FALL = 1400;
export const JUMP_VY = -560;
export const MAX_VX = 560;
/** 蓄满所需秒数；CHARGE_RATE = 100 / 1.2 ≈ 83.3 力度/秒 */
export const CHARGE_FULL = 1.2;
export const CHARGE_RATE = 100 / CHARGE_FULL;
/** 完美落点判定半径（与平台中心距离） */
export const PERFECT_R = 12;
export const SCORE_STEP = 10;
export const PERFECT_BONUS = 5;

export const PLATFORM_H = 16;
export const BASE_W = 130;
export const MIN_W = 46;
export const W_STEP = 8;
export const W_JITTER = 3;
export const GAP_BASE = 95;
export const GAP_STEP = 8;
export const GAP_MAX = 190;
export const Y_MIN = H * 0.42;
export const Y_MAX = H * 0.86;
export const Y_JITTER = 40;
/** 摄像机锚点：玩家保持在画面 34% 处 */
export const CAM_ANCHOR = 0.34;
export const START_Y = H * 0.78;

const MAX_DT = 0.25;
const MAX_H = 1 / 120;
const START_X = 150;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function createGame({ seed = 1, mode = 'solo' } = {}) {
  const initialSeed = seed >>> 0;

  let rng;
  let x;
  let y;
  let vx;
  let vy;
  let onGround;
  let charging;
  let power;
  let chargeDir;
  let dir;
  let score;
  let combo;
  let perfects;
  let jumps;
  let landings;
  let over;
  let ready;
  let camX;
  let platforms;
  let nextId;
  let seq;
  let lastLand;

  function reset() {
    rng = createRng(initialSeed);
    const w0 = BASE_W;
    platforms = [{ id: 0, x: START_X - w0 / 2, y: START_Y, w: w0 }];
    nextId = 1;
    seq = 1; // 已生成平台数（最后一个的 id + 1）
    addPlatform();
    addPlatform();
    addPlatform();

    x = START_X;
    y = platforms[0].y - PLAYER_R;
    vx = 0;
    vy = 0;
    onGround = true;
    charging = false;
    power = 0;
    chargeDir = 1;
    dir = 1;
    score = 0;
    combo = 0;
    perfects = 0;
    jumps = 0;
    landings = 0;
    over = false;
    ready = true;
    camX = 0;
    lastLand = null;
    // 起步朝向：朝下一个平台
    dir = nextCenterX() >= x ? 1 : -1;
  }

  function addPlatform() {
    const prev = platforms[platforms.length - 1];
    const gen = seq;
    const span = Math.min(GAP_MAX, GAP_BASE + gen * GAP_STEP);
    const gap = span * (0.55 + rng.next() * 0.45);
    const w = Math.max(MIN_W, BASE_W - gen * W_STEP + (rng.next() * 2 - 1) * W_JITTER);
    const yNext = clamp(prev.y + (rng.next() * 2 - 1) * Y_JITTER, Y_MIN, Y_MAX);
    const p = { id: gen, x: prev.x + prev.w + gap, y: yNext, w };
    platforms.push(p);
    seq += 1;
    return p;
  }

  function ensurePlatforms() {
    while (seq <= nextId + 2) addPlatform();
    // 剔除摄像机左后方已看不到的平台；判分只依赖 id，剔除是安全的
    const cut = camX - 320;
    if (platforms.length > 6 && platforms[0].x + platforms[0].w < cut) {
      platforms = platforms.filter((p) => p.id >= nextId - 1 || p.x + p.w >= cut);
    }
  }

  function nextPlatform() {
    for (const p of platforms) if (p.id === nextId) return p;
    return null;
  }

  function nextCenterX() {
    const p = nextPlatform();
    if (p) return p.x + p.w / 2;
    return x + 120;
  }

  function advanceCharge(dt) {
    let p = power + CHARGE_RATE * chargeDir * dt;
    let guard = 0;
    // 反射到 [0,100]：越界部分按往返折回，保持“回弹”手感
    while ((p > 100 || p < 0) && guard < 64) {
      if (p > 100) {
        p = 200 - p;
        chargeDir = -1;
      } else if (p < 0) {
        p = -p;
        chargeDir = 1;
      }
      guard += 1;
    }
    power = clamp(p, 0, 100);
  }

  function landOn(p, prevFeet) {
    y = p.y - PLAYER_R;
    vy = 0;
    vx = 0;
    onGround = true;
    charging = false;
    power = 0;
    chargeDir = 1;
    landings += 1;

    const center = p.x + p.w / 2;
    const dx = x - center;
    const perfect = Math.abs(dx) <= PERFECT_R;
    const scored = p.id >= nextId;
    if (scored) {
      score += SCORE_STEP + (perfect ? PERFECT_BONUS : 0);
      if (perfect) {
        combo += 1;
        perfects += 1;
      } else {
        combo = 0;
      }
      nextId = p.id + 1;
      ensurePlatforms();
    }
    lastLand = { seq: landings, id: p.id, x: x + 0, y: p.y, dx: dx + 0, perfect, scored, prevFeet };
    // 落定后自动朝向下一平台；玩家可用 ←→ 改
    dir = nextCenterX() >= x ? 1 : -1;
  }

  function integrate(h) {
    const prevFeet = y + PLAYER_R;
    vy = Math.min(MAX_FALL, vy + GRAVITY * h);
    y += vy * h;
    x += vx * h;
    const feet = y + PLAYER_R;

    if (vy > 0) {
      for (const p of platforms) {
        if (prevFeet <= p.y + 0.5 && feet >= p.y) {
          const hw = PLAYER_R * 0.55;
          if (x + hw > p.x && x - hw < p.x + p.w) {
            landOn(p, prevFeet);
            return;
          }
        }
      }
    }

    if (y - PLAYER_R > H) {
      over = true;
    }
  }

  function release() {
    if (!onGround) return { ok: false, error: '空中不能起跳' };
    vx = (power / 100) * MAX_VX * dir;
    vy = JUMP_VY;
    onGround = false;
    charging = false;
    power = 0;
    chargeDir = 1;
    jumps += 1;
    return { ok: true };
  }

  function submit(playerId, action) {
    if (over) return { ok: false, error: '本局已结束' };
    if (typeof action !== 'string') return { ok: false, error: '无效操作' };
    switch (action) {
      case 'start':
        ready = false;
        return { ok: true };
      case 'charge':
        ready = false;
        if (onGround) charging = true;
        return { ok: true };
      case 'release':
        ready = false;
        return release();
      case 'direction:left':
      case 'left':
        dir = -1;
        return { ok: true };
      case 'direction:right':
      case 'right':
        dir = 1;
        return { ok: true };
      default:
        return { ok: false, error: '无效操作' };
    }
  }

  function step(dt, actions) {
    if (over) return;
    const acts = Array.isArray(actions) ? actions : [];
    if (acts.includes('left') || acts.includes('direction:left')) dir = -1;
    if (acts.includes('right') || acts.includes('direction:right')) dir = 1;

    const held = acts.includes('charge');
    if (held) {
      ready = false;
      if (onGround) charging = true;
    }

    let remaining = Math.max(0, Math.min(Number(dt) || 0, MAX_DT));
    if (remaining <= 0) return;

    if (!onGround) {
      let guard = 0;
      while (remaining > 0 && !over && guard < 400) {
        const h = Math.min(remaining, MAX_H);
        integrate(h);
        remaining -= h;
        guard += 1;
      }
    } else if (charging) {
      advanceCharge(remaining);
      remaining = 0;
    }

    if (x - W * CAM_ANCHOR > camX) camX = x - W * CAM_ANCHOR;
    if (!over) ensurePlatforms();
  }

  function state() {
    const next = nextPlatform();
    return {
      turn: 'p1',
      player: {
        x,
        y,
        // +0 把 -0 归一成 +0：-0 经 JSON 往返会变成 0，序列化测试要能严格相等
        vx: vx + 0,
        vy: vy + 0,
        onGround,
        charging,
        power,
      },
      platforms: platforms.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        w: p.w,
        next: p.id === nextId,
      })),
      score,
      combo,
      over,
      ready,
      dir,
      chargeDir,
      camX,
      aimVx: (power / 100) * MAX_VX * dir + 0,
      nextId,
      nextX: next ? next.x + next.w / 2 : null,
      perfects,
      jumps,
      landings,
      lastLand: lastLand ? { ...lastLand } : null,
      w: W,
      h: H,
      r: PLAYER_R,
      gravity: GRAVITY,
      jumpVy: JUMP_VY,
      platformH: PLATFORM_H,
      perfectR: PERFECT_R,
      maxVx: MAX_VX,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `跨过 ${Math.max(0, nextId - 1)} 个平台 · 完美 ${perfects} 次`,
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
