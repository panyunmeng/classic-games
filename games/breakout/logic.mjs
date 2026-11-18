/**
 * 打砖块 · 霓虹打砖块（Neon Breakout）· 纯逻辑。
 *
 * 设计事实与推导（第一性原则）：
 * - 逻辑坐标固定 480×640：宽 480、高 640，与 game.json.canvas 一致；渲染层照此坐标画。
 * - 物理用固定步长：step(dt,actions) 累加 dt，按 1/60 s 子步推进；dt 异常大时限子步数，避免一帧穿砖。
 * - 球的"发射"与"运行"分离：开局球粘在挡板上（stuck），submit('launch') 才给初速度；落底减命后重新粘板。
 * - 反弹角由落点决定（核心玩法）：球心相对挡板中心的偏移 off∈[-1,1]，
 *   出射方向 angle = off×MAX_BOUNCE(60°)，vx=sin(angle)×speed，vy=-cos(angle)×speed（恒向上）。
 *   这不是按入射角镜像，玩家用挡板"接球位置"控制出射方向。
 * - 砖块：多行多色；armor>1 的装甲砖要击中 armor 次才碎；碎砖按分数计分并给连击倍率。
 * - 连击：连续击碎砖块 combo 累加，得分=砖块分×combo；球落底（丢命）或发射新回合时 combo 归 1。
 * - 道具：碎砖按概率掉落 multiball / widen / slow 三种，用程序化方块表示（id 即种类）；
 *   落到底部被挡板接到才生效：多球复制当前球、加宽挡板、减速所有球。
 * - 关卡：清空砖块→level+1，按关卡重新生成砖块（更多行/装甲），球重新粘板，挡板还原。
 * - 3 命：lives 从 3 起，落底减 1，到 0 时 over=true，result() 结束。
 * - 纯逻辑：无 DOM / window / canvas / Math.random / Date.now；随机全部走 createRng(seed)。
 */
import { createRng } from '../../shared/rng.js';

export const W = 480;
export const H = 640;

const STEP = 1 / 60;
const MAX_SUBSTEPS = 8;

// 场地边界：球在左右墙/顶墙反弹，越过底线判丢球
const WALL_L = 8;
const WALL_R = W - 8;
const CEIL = 56;
const FLOOR = H - 8;

// 挡板
const PADDLE_Y = H - 46;
const PADDLE_W = 88;
const PADDLE_H = 12;
const PADDLE_SPEED = 360; // px/s，键盘持续动作
const PADDLE_MAX_W = 148;

// 球
const BALL_R = 6;
const BALL_SPEED = 250;
const MAX_BOUNCE = (60 * Math.PI) / 180;
const MIN_VX_COS = Math.cos(MAX_BOUNCE); // 保证出射仰角不过于水平

// 砖块布局
const BRICK_COLS = 9;
const BRICK_TOP = 84;
const BRICK_H = 22;
const BRICK_GAP = 4;
const BRICK_LEFT = 24;
const BRICK_RIGHT = W - 24;
const BRICK_W = (BRICK_RIGHT - BRICK_LEFT - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS;
const ROW_COLORS = ['#ff5d8f', '#ff9f43', '#ffe14f', '#63f2b6', '#4fc7ff', '#a97bff'];
const BASE_BRICK_SCORE = 10;

// 道具
const DROP_CHANCE = 0.18;
const POWERUP_KINDS = ['multiball', 'widen', 'slow'];
const POWERUP_SIZE = 18;
const POWERUP_FALL = 130;
const WIDEN_DURATION = 12; // 秒
const SLOW_DURATION = 10;
const SLOW_FACTOR = 0.65;
const MULTIBALL_EXTRA = 2;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * 挡板反弹速度：由落点偏移决定出射角（不是按入射角镜像）。
 * offset ∈ [-1,1]：-1 最左 → -60°，0 正中 → 垂直向上，+1 最右 → +60°。
 * 这是公开纯函数，逻辑内部与单测共用同一实现。
 */
export function bounceVelocity(offset, speed) {
  const off = clamp(offset, -1, 1);
  const angle = off * MAX_BOUNCE;
  return {
    vx: Math.sin(angle) * speed,
    vy: -Math.max(Math.cos(angle), MIN_VX_COS) * speed,
  };
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const rng = createRng(seed);
  const startLevel = Math.max(1, level | 0);

  let bricks;
  let balls;
  let paddle;
  let powerups;
  let score;
  let lives;
  let levelNo;
  let combo;
  let maxCombo;
  let over;
  let stuck;
  let acc;
  let widenTimer;
  let slowTimer;
  let brickSerial;

  function makeBricks(lv) {
    const rows = Math.min(6, 3 + Math.floor((lv - 1) / 1)); // 关数越高行越多，封顶 6
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        // 装甲：从第 2 关起逐渐出现，越靠上越硬（armor 2 表示需两次）
        const armored = lv >= 2 && r < Math.min(2, Math.floor((lv + 1) / 2)) && rng.chance(0.35);
        out.push({
          id: `b${brickSerial++}`,
          x: BRICK_LEFT + c * (BRICK_W + BRICK_GAP),
          y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
          w: BRICK_W,
          h: BRICK_H,
          color: ROW_COLORS[r % ROW_COLORS.length],
          hp: armored ? 2 : 1,
          armor: armored ? 2 : 1,
          score: BASE_BRICK_SCORE * (r + 1),
        });
      }
    }
    return out;
  }

  function freshBall() {
    return {
      x: paddle.x + paddle.w / 2,
      y: PADDLE_Y - BALL_R - 1,
      vx: 0,
      vy: 0,
      r: BALL_R,
      trail: [],
    };
  }

  function loadLevel(lv) {
    levelNo = lv;
    bricks = makeBricks(lv);
    paddle = { x: W / 2 - PADDLE_W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H };
    powerups = [];
    balls = [freshBall()];
    stuck = true;
    combo = 1;
    widenTimer = 0;
    slowTimer = 0;
    acc = 0;
  }

  function reset() {
    score = 0;
    lives = 3;
    over = false;
    maxCombo = 1;
    brickSerial = 0;
    loadLevel(startLevel);
  }

  /** 圆 vs AABB：圆心到矩形最近点距离 ≤ 半径即相交 */
  function circleHitsRect(ball, rect) {
    const cx = clamp(ball.x, rect.x, rect.x + rect.w);
    const cy = clamp(ball.y, rect.y, rect.y + rect.h);
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    return dx * dx + dy * dy <= ball.r * ball.r;
  }

  function currentSpeed() {
    return BALL_SPEED * (slowTimer > 0 ? SLOW_FACTOR : 1) * (1 + (levelNo - 1) * 0.06);
  }

  function launch() {
    if (!stuck || over) return false;
    const b = balls[0];
    // 初始出射：略带水平分量，主要向上；角度固定，与种子无关（可复现）
    const angle = -Math.PI / 2 + 0.35;
    const speed = currentSpeed();
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    stuck = false;
    combo = 1;
    return true;
  }

  function bounceOffPaddle(ball) {
    // 落在挡板上的横向偏移 → 出射角（不按入射角镜像）
    const off = clamp((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1);
    const speed = Math.hypot(ball.vx, ball.vy) || currentSpeed();
    const v = bounceVelocity(off, speed);
    ball.vx = v.vx;
    ball.vy = v.vy;
    ball.y = paddle.y - ball.r - 0.5;
  }

  function dropPowerup(brick) {
    if (!rng.chance(DROP_CHANCE)) return;
    const kind = POWERUP_KINDS[rng.int(POWERUP_KINDS.length)];
    powerups.push({
      id: `p${brick.id}`,
      kind,
      x: brick.x + brick.w / 2 - POWERUP_SIZE / 2,
      y: brick.y + brick.h / 2 - POWERUP_SIZE / 2,
      w: POWERUP_SIZE,
      h: POWERUP_SIZE,
    });
  }

  function hitBrick(ball, brick) {
    brick.hp -= 1;
    if (brick.hp > 0) return; // 装甲砖：只掉一层，不碎
    score += brick.score * combo;
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
    bricks = bricks.filter((b) => b !== brick);
    dropPowerup(brick);
    // 简单的水平折射：从左右侧命中改 x 方向，否则改 y 方向
    const overlapX = Math.min(ball.x - brick.x, brick.x + brick.w - ball.x);
    const overlapY = Math.min(ball.y - brick.y, brick.y + brick.h - ball.y);
    if (overlapY <= overlapX) ball.vy = -ball.vy;
    else ball.vx = -ball.vx;
  }

  function applyPowerup(kind) {
    if (kind === 'multiball') {
      const src = balls[0];
      for (let i = 0; i < MULTIBALL_EXTRA; i++) {
        const a = (i - 0.5) * 0.5;
        const speed = Math.hypot(src.vx, src.vy) || currentSpeed();
        balls.push({
          x: src.x,
          y: src.y,
          vx: src.vx * Math.cos(a) - Math.abs(src.vy) * Math.sin(a),
          vy: -Math.abs(src.vy) * Math.cos(a) + src.vx * Math.sin(a),
          r: BALL_R,
          trail: [],
        });
      }
    } else if (kind === 'widen') {
      widenTimer = WIDEN_DURATION;
      paddle.w = PADDLE_MAX_W;
      paddle.x = clamp(paddle.x, WALL_L, WALL_R - paddle.w);
    } else if (kind === 'slow') {
      slowTimer = SLOW_DURATION;
      rescaleBalls(SLOW_FACTOR);
    }
  }

  function rescaleBalls(factor) {
    for (const b of balls) {
      b.vx *= factor;
      b.vy *= factor;
    }
  }

  function moveBall(ball) {
    ball.x += ball.vx * STEP;
    ball.y += ball.vy * STEP;

    // 墙反弹
    if (ball.x - ball.r < WALL_L) {
      ball.x = WALL_L + ball.r;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.r > WALL_R) {
      ball.x = WALL_R - ball.r;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - ball.r < CEIL) {
      ball.y = CEIL + ball.r;
      ball.vy = Math.abs(ball.vy);
    }

    // 挡板反弹：只在球向下且圆与挡板相交时
    if (
      ball.vy > 0 &&
      ball.y + ball.r >= paddle.y &&
      ball.y - ball.r <= paddle.y + paddle.h &&
      ball.x + ball.r >= paddle.x &&
      ball.x - ball.r <= paddle.x + paddle.w
    ) {
      bounceOffPaddle(ball);
    }

    // 砖块碰撞：一子步最多处理一块，避免同一帧多次折射乱向
    for (const brick of bricks) {
      if (circleHitsRect(ball, brick)) {
        hitBrick(ball, brick);
        break;
      }
    }

    // 拖尾（逻辑里也留一份，便于 state 序列化与回放）
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 8) ball.trail.shift();

    return ball.y - ball.r > FLOOR;
  }

  function movePowerups() {
    powerups = powerups.filter((p) => {
      p.y += POWERUP_FALL * STEP;
      // 落到底部被挡板接住 → 生效
      if (p.y + p.h >= paddle.y && p.x + p.w >= paddle.x && p.x <= paddle.x + paddle.w) {
        applyPowerup(p.kind);
        return false;
      }
      return p.y - p.h < H;
    });
  }

  function loseBall() {
    lives -= 1;
    combo = 1;
    if (lives <= 0) {
      lives = 0;
      over = true;
      return;
    }
    // 剩余球继续；没有球则重新粘板
    if (balls.length === 0) {
      balls = [freshBall()];
      stuck = true;
    }
  }

  function advance(actions) {
    if (over) return;

    // 挡板持续动作：left / right
    let dir = 0;
    for (const a of actions) {
      if (a === 'left') dir -= 1;
      else if (a === 'right') dir += 1;
    }
    if (dir !== 0) paddle.x = clamp(paddle.x + dir * PADDLE_SPEED * STEP, WALL_L, WALL_R - paddle.w);

    // 计时器（减速到期要恢复速度，否则道具永久生效）
    if (widenTimer > 0) {
      widenTimer -= STEP;
      if (widenTimer <= 0) {
        widenTimer = 0;
        paddle.w = PADDLE_W;
        paddle.x = clamp(paddle.x, WALL_L, WALL_R - paddle.w);
      }
    }
    if (slowTimer > 0) {
      slowTimer -= STEP;
      if (slowTimer <= 0) {
        slowTimer = 0;
        rescaleBalls(1 / SLOW_FACTOR);
      }
    }

    // 拖拽：直接把挡板中心设到 targetX（由 submit('pointer:..') 设置）
    if (dragTarget != null) {
      paddle.x = clamp(dragTarget - paddle.w / 2, WALL_L, WALL_R - paddle.w);
    }

    if (stuck) {
      const b = balls[0];
      if (b) {
        b.x = paddle.x + paddle.w / 2;
        b.y = PADDLE_Y - b.r - 1;
      }
      return;
    }

    const fallen = [];
    for (const b of balls) {
      if (moveBall(b)) fallen.push(b);
    }
    if (fallen.length) {
      balls = balls.filter((b) => !fallen.includes(b));
      loseBall();
    }

    movePowerups();

    // 清屏进下一关
    if (!over && bricks.length === 0) {
      loadLevel(levelNo + 1);
    }
  }

  let dragTarget = null;

  function step(dt, actions = []) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    acc += Math.min(dt, 0.25);
    let n = 0;
    while (acc >= STEP && n < MAX_SUBSTEPS && !over) {
      acc -= STEP;
      advance(actions);
      n += 1;
    }
  }

  function submit(playerId, action) {
    if (over) return { ok: false, error: '本局已结束' };
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (action === 'launch' || action === 'start') {
      return launch() ? { ok: true } : { ok: false, error: '球已在运行' };
    }
    if (action.startsWith('pointer:')) {
      const x = Number(action.slice(8));
      if (Number.isFinite(x)) {
        dragTarget = clamp(x, WALL_L, WALL_R);
        return { ok: true };
      }
      return { ok: false, error: '无效坐标' };
    }
    if (action === 'pointer:end') {
      dragTarget = null;
      return { ok: true };
    }
    return { ok: false, error: '未知动作' };
  }

  function state() {
    return {
      turn: 'p1',
      ball: balls.length ? { ...balls[0], trail: balls[0].trail.map((t) => ({ ...t })) } : null,
      balls: balls.map((b) => ({ ...b, trail: b.trail.map((t) => ({ ...t })) })),
      paddle: { ...paddle },
      bricks: bricks.map((b) => ({ ...b })),
      powerups: powerups.map((p) => ({ ...p })),
      score,
      lives,
      over,
      level: levelNo,
      combo,
      maxCombo,
      stuck,
      widenTimer,
      slowTimer,
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
      text: `第 ${levelNo} 关 · 得分 ${score} · 最高连击 ${maxCombo}`,
    };
  }

  /**
   * 测试专用钩子：仅在单测里摆放确定局面，正常游戏流程不调用。
   * 全部是纯数据写入，不引入 DOM / 随机 / 时间源。
   */
  function debugSet({ ball, paddle: p, bricks: bs, powerups: ps, lives: lv, score: sc, stuck: st, level: vl } = {}) {
    if (ball) {
      const b = balls[0];
      Object.assign(b, { vx: 0, vy: 0, trail: [], ...ball });
      if (ball.x !== undefined) b.x = ball.x;
      if (ball.y !== undefined) b.y = ball.y;
      b.r = ball.r ?? BALL_R;
    }
    if (p) Object.assign(paddle, p);
    if (bs !== undefined) bricks = bs.map((b) => ({ ...b }));
    if (ps !== undefined) powerups = ps.map((x) => ({ ...x }));
    if (lv !== undefined) lives = lv;
    if (sc !== undefined) score = sc;
    if (st !== undefined) stuck = st;
    if (vl !== undefined) levelNo = vl;
  }

  reset();

  return { submit, step, state, result, reset, debugSet };
}
