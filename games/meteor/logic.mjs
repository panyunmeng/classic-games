/**
 * 陨石带（Meteor Field）· 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 事实与推导（第一性原则）：
 * - 场地 480×640，环面拓扑（toroidal）：x 越过 W 从 0 出现，y 同理。
 *   因此判定距离必须用环形最短距离 wrapDist，否则跨接缝的碰撞会整块漏判。
 * - 牛顿式惯性：无阻力，速度只在推进时改变；限速 320 px/s 只为防止无限加速导致一帧穿模。
 *   朝角 angle=-π/2 指向屏幕上方，右转为正。
 * - 子弹速度是世界坐标速度，不继承飞船速度：瞄准方向与飞船当前速度解耦，玩家可控。
 *   同时最多 4 发、冷却 0.25 s（= 15 个 1/60 s 子步）。触发来源有两路：
 *   step 的持续动作 'shoot'（按住=连发）与 submit('shoot')（点按缓冲一发）。
 * - 陨石三级 size 3/2/1：大石裂 2 中石、中石裂 2 小石、小石消失；分值 20/40/80，
 *   一颗大石彻底清完 = 20 + 2×40 + 4×80 = 420 分。
 * - 飞船撞石：减 1 命 + 2 s 无敌 + 回到场地中心；被撞的陨石同时碎裂（不给分）——
 *   否则残石会停在中心，无敌一结束就二次命中，玩家没有生路。
 * - 清空全部陨石 → wave+1：数量 +1（封顶 9）、基准速度 +8 px/s、半径 +5%（封顶 1.35×）。
 *   波次速度不叠随机倍率，保证"下一波更快"是规则而不是运气。
 */
import { createRng } from '../../shared/rng.js';

export const W = 480;
export const H = 640;

/** 三级陨石的碰撞半径（基准，实际按波次半径系数缩放） */
export const ROCK_RADIUS = { 3: 34, 2: 20, 1: 12 };
/** 三级陨石分值：越大越便宜，小碎块最好吃 */
export const ROCK_SCORE = { 3: 20, 2: 40, 1: 80 };

const STEP = 1 / 60;
const MAX_SUBSTEPS = 5;
/** 冷却判定容差：15 次 1/60 累减后可能残留 1e-17 量级的浮点尾巴 */
const READY_EPS = 1e-6;

const SHIP_R = 9;
const SHIP_TURN = 3.2; // rad/s
const SHIP_THRUST = 230; // px/s²
const SHIP_MAX_SPEED = 320; // px/s
const SHIP_INVULN = 2; // s

const BULLET_SPEED = 520;
const BULLET_LIFE = 0.95; // s，射程 ≈ 494 px（会穿边环绕，所以活得比场地宽也正常）
const BULLET_R = 2.2;
const MAX_BULLETS = 4;
const FIRE_COOLDOWN = 0.25; // s

const ROCK_SPLIT = { 3: 2, 2: 2, 1: 0 };
const WAVE_BASE_ROCKS = 4;
const WAVE_MAX_ROCKS = 9;
const ROCK_BASE_SPEED = 24;
const ROCK_SPEED_STEP = 8;
/** 新陨石与飞船的环形最短距离下限，避免开局/过波即撞 */
const SPAWN_CLEAR = 160;

const TAU = Math.PI * 2;

function wrapX(x) {
  return ((x % W) + W) % W;
}

function wrapY(y) {
  return ((y % H) + H) % H;
}

/** 把差值折回 [-span/2, span/2]，得到环面上的最短位移 */
function wrapDelta(d, span) {
  return d - span * Math.round(d / span);
}

/** 环形最短距离（圆-圆碰撞的唯一正确距离） */
export function wrapDistance(ax, ay, bx, by) {
  return Math.hypot(wrapDelta(bx - ax, W), wrapDelta(by - ay, H));
}

function normAngle(a) {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const baseSeed = (seed >>> 0) || 1;
  let rng = createRng(baseSeed);

  let ship;
  let bullets;
  let rocks;
  let score;
  let lives;
  let wave;
  let over;
  let fireCooldown;
  let shootQueued;
  let acc;
  let waveTimer;
  let radiusScale;
  let rockSerial;

  /* ── 陨石构造 ─────────────────────────────────────────── */

  function makeRock(size, x, y, dir, speed) {
    return {
      id: `r${rockSerial++}`,
      x: wrapX(x),
      y: wrapY(y),
      size,
      r: ROCK_RADIUS[size] * radiusScale,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      angle: rng.range(0, TAU),
      spin: rng.range(-1.4, 1.4),
      // 形状种子：渲染层据此生成固定的不规则顶点，避免每帧抖动
      seed: rng.int(1000000),
    };
  }

  function normalizeRock(r) {
    const size = r.size === 2 || r.size === 1 ? r.size : 3;
    return {
      id: r.id || `r${rockSerial++}`,
      x: wrapX(r.x ?? W / 2),
      y: wrapY(r.y ?? H / 2),
      size,
      r: r.r ?? ROCK_RADIUS[size] * radiusScale,
      vx: r.vx ?? 0,
      vy: r.vy ?? 0,
      angle: r.angle ?? 0,
      spin: r.spin ?? 0,
      seed: r.seed ?? 1,
    };
  }

  function startWave(n) {
    wave = n;
    waveTimer = 0;
    radiusScale = Math.min(1.35, 1 + (n - 1) * 0.05);
    const count = Math.min(WAVE_MAX_ROCKS, WAVE_BASE_ROCKS + (n - 1));
    const speed = ROCK_BASE_SPEED + (n - 1) * ROCK_SPEED_STEP;
    const spawned = [];
    for (let i = 0; i < count; i++) {
      let x = W / 2;
      let y = H / 2;
      for (let tries = 0; tries < 40; tries++) {
        x = rng.range(0, W);
        y = rng.range(0, H);
        if (wrapDistance(x, y, ship.x, ship.y) >= SPAWN_CLEAR) break;
      }
      spawned.push(makeRock(3, x, y, rng.range(0, TAU), speed));
    }
    rocks = spawned;
    bullets = [];
  }

  /* ── 开局 ─────────────────────────────────────────────── */

  function reset() {
    rng = createRng(baseSeed);
    rockSerial = 0;
    radiusScale = 1;
    score = 0;
    lives = 3;
    over = false;
    fireCooldown = 0;
    shootQueued = false;
    acc = 0;
    ship = {
      x: W / 2,
      y: H / 2,
      angle: -Math.PI / 2,
      vx: 0,
      vy: 0,
      invuln: SHIP_INVULN,
      thrust: false,
    };
    bullets = [];
    rocks = [];
    startWave(1);
  }

  /* ── 射击与碎裂 ───────────────────────────────────────── */

  function tryFire() {
    if (over) return false;
    if (bullets.length >= MAX_BULLETS) return false;
    if (fireCooldown > READY_EPS) return false;
    const dx = Math.cos(ship.angle);
    const dy = Math.sin(ship.angle);
    bullets.push({
      x: wrapX(ship.x + dx * 12),
      y: wrapY(ship.y + dy * 12),
      vx: dx * BULLET_SPEED,
      vy: dy * BULLET_SPEED,
      life: BULLET_LIFE,
    });
    fireCooldown = FIRE_COOLDOWN;
    return true;
  }

  /**
   * 击碎/撞碎一块陨石。scored=true 时按 size 计分。
   * 碎裂速度取父石速度的 1.25 倍，并不低于波次基准速度 +12，保证小石不会越碎越"懒"。
   */
  function splitRock(index, scored) {
    const rock = rocks[index];
    if (!rock) return;
    const parentSpeed = Math.hypot(rock.vx, rock.vy);
    const parentDir = Math.atan2(rock.vy, rock.vx);
    if (scored) score += ROCK_SCORE[rock.size] || 0;
    rocks.splice(index, 1);
    const pieces = ROCK_SPLIT[rock.size] || 0;
    if (!pieces) return;
    const childSize = rock.size - 1;
    const childSpeed = Math.max(
      parentSpeed * 1.25,
      ROCK_BASE_SPEED + (wave - 1) * ROCK_SPEED_STEP + 12
    );
    for (let k = 0; k < pieces; k++) {
      const dir = parentDir + (k === 0 ? 0.6 : -0.6) + rng.range(-0.15, 0.15);
      const off = (k === 0 ? 1 : -1) * ROCK_RADIUS[childSize] * 0.5;
      rocks.push(makeRock(childSize, rock.x + Math.cos(dir) * off, rock.y + Math.sin(dir) * off, dir, childSpeed));
    }
  }

  function hitShip(rockIndex) {
    lives -= 1;
    // 被撞陨石同时碎裂（不计分），否则残石会守在重生点
    splitRock(rockIndex, false);
    if (lives <= 0) {
      lives = 0;
      over = true;
      ship.vx = 0;
      ship.vy = 0;
      ship.thrust = false;
      return;
    }
    ship.x = W / 2;
    ship.y = H / 2;
    ship.angle = -Math.PI / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.invuln = SHIP_INVULN;
    ship.thrust = false;
  }

  /* ── 固定子步推进 ─────────────────────────────────────── */

  function advance(actions) {
    if (over) return;
    const acts = actions || [];
    const left = acts.includes('left');
    const right = acts.includes('right');
    const up = acts.includes('up');
    const shoot = acts.includes('shoot');

    // 1. 旋转（先转向，本步推进就沿新朝向）
    if (left) ship.angle = normAngle(ship.angle - SHIP_TURN * STEP);
    if (right) ship.angle = normAngle(ship.angle + SHIP_TURN * STEP);

    // 2. 推进：加速度积分，无阻力；限速只在超限时归一化
    ship.thrust = up;
    if (up) {
      ship.vx += Math.cos(ship.angle) * SHIP_THRUST * STEP;
      ship.vy += Math.sin(ship.angle) * SHIP_THRUST * STEP;
      const sp = Math.hypot(ship.vx, ship.vy);
      if (sp > SHIP_MAX_SPEED) {
        ship.vx *= SHIP_MAX_SPEED / sp;
        ship.vy *= SHIP_MAX_SPEED / sp;
      }
    }

    // 3. 冷却先减再判，保证 0.25 s 后立即可射
    if (fireCooldown > 0) fireCooldown = Math.max(0, fireCooldown - STEP);
    if (shoot) tryFire();
    if (shootQueued) {
      shootQueued = false;
      tryFire();
    }

    // 4. 位移 + 环形 wrap
    ship.x = wrapX(ship.x + ship.vx * STEP);
    ship.y = wrapY(ship.y + ship.vy * STEP);
    if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - STEP);

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x = wrapX(b.x + b.vx * STEP);
      b.y = wrapY(b.y + b.vy * STEP);
      b.life -= STEP;
      if (b.life <= 0) bullets.splice(i, 1);
    }

    for (const r of rocks) {
      r.x = wrapX(r.x + r.vx * STEP);
      r.y = wrapY(r.y + r.vy * STEP);
      r.angle += r.spin * STEP;
    }

    // 5. 子弹-陨石（圆-圆，跨接缝也成立）；一子步一颗子弹最多吃一块石头
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      for (let j = 0; j < rocks.length; j++) {
        const r = rocks[j];
        if (wrapDistance(b.x, b.y, r.x, r.y) <= r.r + BULLET_R) {
          bullets.splice(i, 1);
          splitRock(j, true);
          break;
        }
      }
    }

    // 6. 飞船-陨石（无敌期内不判定）
    if (!over && ship.invuln <= 0) {
      for (let j = 0; j < rocks.length; j++) {
        if (wrapDistance(ship.x, ship.y, rocks[j].x, rocks[j].y) <= SHIP_R + rocks[j].r) {
          hitShip(j);
          break;
        }
      }
    }

    waveTimer += STEP;

    // 7. 清空进下一波
    if (!over && rocks.length === 0) startWave(wave + 1);
  }

  function step(dt, actions = []) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    const acts = Array.isArray(actions) ? actions : [];
    acc += Math.min(dt, 0.25);
    let n = 0;
    while (acc >= STEP && n < MAX_SUBSTEPS && !over) {
      acc -= STEP;
      advance(acts);
      n += 1;
    }
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (action === 'start') {
      if (over) {
        reset();
        return { ok: true };
      }
      return { ok: true };
    }
    if (over) return { ok: false, error: '本局已结束' };
    if (action === 'shoot') {
      // 缓冲一发：真正出膛在下一个子步，这样点按（只按一帧）也不会丢
      shootQueued = true;
      return { ok: true };
    }
    return { ok: false, error: '未知动作' };
  }

  function state() {
    return {
      turn: 'p1',
      ship: { ...ship },
      bullets: bullets.map((b) => ({ ...b })),
      rocks: rocks.map((r) => ({ ...r })),
      score,
      lives,
      wave,
      over,
      fireCooldown: Math.round(fireCooldown * 1e6) / 1e6,
      maxBullets: MAX_BULLETS,
      waveTimer,
      w: W,
      h: H,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `第 ${wave} 波 · 得分 ${score}`,
    };
  }

  /**
   * 测试专用钩子：只做纯数据写入，不引入随机/时间源。正常游戏流程不调用。
   */
  function debugSet({
    ship: sp,
    rocks: rs,
    bullets: bs,
    lives: lv,
    score: sc,
    wave: wv,
    over: ov,
    fireCooldown: fc,
    invuln: inv,
    waveTimer: wt,
  } = {}) {
    if (sp) Object.assign(ship, sp);
    if (inv !== undefined) ship.invuln = inv;
    if (rs !== undefined) rocks = rs.map(normalizeRock);
    if (bs !== undefined) bullets = bs.map((b) => ({ x: 0, y: 0, vx: 0, vy: 0, life: BULLET_LIFE, ...b }));
    if (lv !== undefined) lives = lv;
    if (sc !== undefined) score = sc;
    if (wv !== undefined) wave = wv;
    if (ov !== undefined) over = ov;
    if (fc !== undefined) fireCooldown = fc;
    if (wt !== undefined) waveTimer = wt;
    shootQueued = false;
    acc = 0;
  }

  reset();

  return { submit, step, state, result, reset, debugSet };
}
