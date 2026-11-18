/**
 * 空气曲棍球 · 纯逻辑（无 DOM、无真随机、无真时钟，随机只走 createRng(seed)）。
 *
 * ── 场地事实（竖屏 480×640） ───────────────────────────────────────────
 * 桌面内框 TABLE = {x0:26, y0:44, x1:454, y1:596}，中线 CENTER_Y = 320；
 *   p1 守上方球门（y0），p2 守下方球门（y1），球门口居中、半宽 GOAL_HALF。
 *   → 球门只在球门宽内开口，其余部分是实体墙：球心在门口内越线＝进球，
 *     否则按墙全反射。这样「球门」与「墙」是同一套判定，不会出现两个判据打架。
 *
 * ── 拍为什么是圆盘（不是 pong 的方拍） ─────────────────────────────────
 * 圆-圆碰撞的接触法向 = 两圆心连线，出射方向天然由「撞击点偏离圆心多少」决定：
 *   正心命中法向正对来球 → 直线击回；擦边命中法向几乎切向 → 出射被压得非常偏。
 *   所以「击中拍边缘给出更偏的出射方向」不需要额外造角，几何本身就给出来，
 *   这正是圆的物理，代码里不再叠加人为偏转（避免不可预测的观感）。
 *
 * ── 冲量模型 ──────────────────────────────────────────────────────────
 * 相对法向速度 vn = (球速 - 拍速)·n（n 由拍心指向球心）：
 *   vn < 0 表示正在接近 → 施加 j = -(1+e)·vn 的冲量，e = 1（近似弹性）；
 *   拍速参与相对速度，因此「用拍子挥过去」能加速球，静止的拍只能把球弹开。
 *   出射法向速度不足 MIN_EXIT 时补到 MIN_EXIT，防止球贴着拍蠕动。
 * 拍速由 logic 自己算：(本子步位移)/SUBSTEP，拖拽造成的瞬移也计入并夹到 PADDLE_VMAX。
 *
 * ── 规则 ──────────────────────────────────────────────────────────────
 * - 固定子步 1/120 s，step(dt) 用累加器推进，单次最多 12 子步（0.1 s），防一帧穿模；
 * - 摩擦轻微：只在速度高于 DISC_ROLL 时按 FRICTION 比例衰减，避免球在桌面停死；
 * - 7 分制，先到 7 分胜；得分后球回中心，发球权归失分方（serveSide = 失分方），
 *   发球把球从中心推向对手，SERVE_DELAY 后自动发出，submit('start') 可提前；
 * - 拍只能在自己半场：p1 的拍心 y ≤ CENTER_Y - PADDLE_R - 2，p2 对称，永不越线；
 * - AI（mode = solo / ai）只控 p1，确定性追踪，见 ai.mjs。
 *
 * ── 动作词表 ──────────────────────────────────────────────────────────
 * step(dt, actions) 接受两种形态：
 *   1) 本地：'p1left' / 'p1right' / 'p1up' / 'p1down'（p2 同理）；
 *   2) 联机：{seat:'p1'|'p2', action:'left'|'right'|'up'|'down'} ——
 *      服务端把每个玩家的输入按 seat 归属，裸方向词只作用于自己的拍；
 *      'shoot' / 'action2' / 'action' 为发球词（白名单内，不属于任何一拍）。
 *   读不到的词直接忽略，非法输入不会让 step 抛异常。
 */
import { createRng } from '../../shared/rng.js';
import { aiTarget } from './ai.mjs';

export const W = 480;
export const H = 640;
export const WIN_SCORE = 7;

/** 桌面内框：球心在这四条线上反弹 */
export const TABLE = { x0: 26, y0: 44, x1: 454, y1: 596 };
export const CENTER_Y = (TABLE.y0 + TABLE.y1) / 2;
/** 球门半宽（球门口宽度 = 2 × GOAL_HALF） */
export const GOAL_HALF = 64;
export const GOAL_X0 = W / 2 - GOAL_HALF;
export const GOAL_X1 = W / 2 + GOAL_HALF;
export const DISC_R = 13;
export const PADDLE_R = 30;
export const HOME = { p1: { x: W / 2, y: 150 }, p2: { x: W / 2, y: 490 } };

const PAD_GAP = 2;
/** 拍心可达范围（半场限制在这里体现：p1 上界 < CENTER_Y，p2 下界 > CENTER_Y） */
export const PADDLE_BOUNDS = {
  p1: { xMin: TABLE.x0 + PADDLE_R, xMax: TABLE.x1 - PADDLE_R, yMin: TABLE.y0 + PADDLE_R + PAD_GAP, yMax: CENTER_Y - PADDLE_R - PAD_GAP },
  p2: { xMin: TABLE.x0 + PADDLE_R, xMax: TABLE.x1 - PADDLE_R, yMin: CENTER_Y + PADDLE_R + PAD_GAP, yMax: TABLE.y1 - PADDLE_R - PAD_GAP },
};

const SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 12;
const ACC_MAX = 0.1;

const PADDLE_SPEED = 470;
const PADDLE_VMAX = 1000;
const AI_SPEED = 330;

const SERVE_SPEED = 430;
const SERVE_DELAY = 0.9;
const SERVE_ANGLE = 0.34;

const DISC_ROLL = 190;
const FRICTION = 0.22;
const SPEED_MAX = 1150;
const MIN_EXIT = 260;
const RESTITUTION = 1;
const TRAIL_MAX = 16;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function finite(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const safeMode = ['solo', 'ai', 'local2p', 'online'].includes(mode) ? mode : 'solo';
  const aiEnabled = safeMode === 'solo' || safeMode === 'ai';
  const lv = clamp(Math.round(finite(level, 1)), 1, 3);
  const aiSpeed = AI_SPEED + (lv - 1) * 40;

  let rng = createRng(seed);
  let disc;
  let paddles;
  let score;
  let serveSide;
  let serving;
  let serveTimer;
  let over;
  let winner;
  let rally;
  let acc;

  /* ── 位置工具 ─────────────────────────────────────────── */

  function makePaddle(side) {
    const b = PADDLE_BOUNDS[side];
    return {
      x: HOME[side].x,
      y: HOME[side].y,
      r: PADDLE_R,
      px: HOME[side].x,
      py: HOME[side].y,
      bounds: b,
    };
  }

  function placePaddlesHome() {
    for (const side of ['p1', 'p2']) {
      const p = paddles[side];
      p.x = HOME[side].x;
      p.y = HOME[side].y;
      p.px = p.x;
      p.py = p.y;
    }
  }

  function clampPaddle(side) {
    const p = paddles[side];
    const b = p.bounds;
    p.x = clamp(p.x, b.xMin, b.xMax);
    p.y = clamp(p.y, b.yMin, b.yMax);
  }

  function reset() {
    rng = createRng(seed);
    paddles = { p1: makePaddle('p1'), p2: makePaddle('p2') };
    disc = { x: W / 2, y: CENTER_Y, vx: 0, vy: 0, r: DISC_R, trail: [] };
    score = { p1: 0, p2: 0 };
    serveSide = 'p1';
    over = false;
    winner = null;
    rally = 0;
    acc = 0;
    placeServe();
  }

  /* ── 发球 ─────────────────────────────────────────────── */

  /** 得分后球回中心、发球给失分方（serveSide 就是失分方） */
  function placeServe() {
    serving = true;
    serveTimer = SERVE_DELAY;
    rally = 0;
    disc.x = W / 2;
    disc.y = CENTER_Y;
    disc.vx = 0;
    disc.vy = 0;
    disc.trail = [];
    placePaddlesHome();
  }

  function launchServe() {
    if (!serving || over) return false;
    serving = false;
    serveTimer = 0;
    rally = 0;
    // 发球方把球推向对手：p1 发球 → 向下（+y），p2 发球 → 向上（-y）
    const dir = serveSide === 'p1' ? 1 : -1;
    const angle = rng.range(-SERVE_ANGLE, SERVE_ANGLE);
    disc.x = W / 2;
    disc.y = CENTER_Y;
    disc.vx = Math.sin(angle) * SERVE_SPEED;
    disc.vy = dir * Math.cos(angle) * SERVE_SPEED;
    disc.trail = [];
    return true;
  }

  /* ── 动作解析 ─────────────────────────────────────────── */

  /**
   * 归一化一条动作。返回
   *   { owner:'p1'|'p2', dir:'left'|'right'|'up'|'down' } 或
   *   { owner, serve:true } 或 null。
   */
  function readAction(a) {
    let seat = null;
    let token = a;
    if (a && typeof a === 'object') {
      seat = a.seat === 'p1' || a.seat === 'p2' ? a.seat : null;
      token = a.action;
    }
    if (typeof token !== 'string') return null;

    const pref = /^(p[12])(left|right|up|down)$/.exec(token);
    if (pref) {
      // 联机以服务端认定的座位为准，客户端不能靠词前缀去动别人的拍
      const owner = safeMode === 'online' && seat ? seat : pref[1];
      return { owner, dir: pref[2] };
    }
    const bare = /^(left|right|up|down)$/.exec(token);
    if (bare) {
      // 裸方向词归属 seat；本地无 seat 时归本机玩家（下拍 p2）
      return { owner: seat || 'p2', dir: bare[1] };
    }
    const serve = /^(shoot|action2|action)$/.exec(token);
    if (serve) return { owner: seat || serveSide, serve: true };
    return null;
  }

  function movePaddleBy(side, dx, dy) {
    const p = paddles[side];
    const step = PADDLE_SPEED * SUBSTEP;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      p.x += (dx / len) * step;
      p.y += (dy / len) * step;
      clampPaddle(side);
    }
  }

  /** 消费动作：返回是否有人要求立即发球 */
  function applyActions(actions) {
    const dir = { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };
    let serveReq = false;
    for (const a of actions || []) {
      const m = readAction(a);
      if (!m) continue;
      if (m.serve) {
        if (m.owner === serveSide) serveReq = true;
        continue;
      }
      const d = dir[m.owner];
      if (m.dir === 'left') d.x -= 1;
      else if (m.dir === 'right') d.x += 1;
      else if (m.dir === 'up') d.y -= 1;
      else if (m.dir === 'down') d.y += 1;
    }
    for (const side of ['p1', 'p2']) {
      movePaddleBy(side, clamp(dir[side].x, -1, 1), clamp(dir[side].y, -1, 1));
    }
    return serveReq;
  }

  /* ── AI ───────────────────────────────────────────────── */

  function aiState() {
    return {
      disc: { x: disc.x, y: disc.y, vx: disc.vx, vy: disc.vy, r: disc.r },
      paddles: {
        p1: { x: paddles.p1.x, y: paddles.p1.y, r: paddles.p1.r },
        p2: { x: paddles.p2.x, y: paddles.p2.y, r: paddles.p2.r },
      },
      serving,
      serveSide,
      centerY: CENTER_Y,
      paddleBounds: {
        p1: { ...PADDLE_BOUNDS.p1 },
        p2: { ...PADDLE_BOUNDS.p2 },
      },
    };
  }

  /** 确定性驱动 p1 拍朝目标点移动（方向归一化，斜向不超速） */
  function driveAi() {
    const target = aiTarget(aiState());
    const p = paddles.p1;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const move = Math.min(len, aiSpeed * SUBSTEP);
    p.x += (dx / len) * move;
    p.y += (dy / len) * move;
    clampPaddle('p1');
  }

  /* ── 碰撞 ─────────────────────────────────────────────── */

  function paddleVelocity(p) {
    return {
      vx: clamp((p.x - p.px) / SUBSTEP, -PADDLE_VMAX, PADDLE_VMAX),
      vy: clamp((p.y - p.py) / SUBSTEP, -PADDLE_VMAX, PADDLE_VMAX),
    };
  }

  function capDiscSpeed() {
    const sp = Math.hypot(disc.vx, disc.vy);
    if (sp > SPEED_MAX) {
      const k = SPEED_MAX / sp;
      disc.vx *= k;
      disc.vy *= k;
    }
  }

  /**
   * 圆-圆碰撞：法向 = 拍心→球心。位置先分离，再按相对法向速度施加冲量，
   * 最后兜一个最小出射速度。返回是否发生碰撞。
   */
  function collidePaddle(side, pvx, pvy) {
    const p = paddles[side];
    const minD = DISC_R + PADDLE_R;
    let dx = disc.x - p.x;
    let dy = disc.y - p.y;
    let d = Math.hypot(dx, dy);
    if (d >= minD) return false;
    if (d < 1e-6) {
      // 完全重合：沿各自球门反方向推开，保证法向有定义
      dx = 0;
      dy = side === 'p1' ? 1 : -1;
      d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    disc.x = p.x + nx * minD;
    disc.y = p.y + ny * minD;

    const vn = (disc.vx - pvx) * nx + (disc.vy - pvy) * ny;
    if (vn < 0) {
      const j = -(1 + RESTITUTION) * vn;
      disc.vx += j * nx;
      disc.vy += j * ny;
    }
    const out = disc.vx * nx + disc.vy * ny;
    if (out < MIN_EXIT) {
      const add = MIN_EXIT - out;
      disc.vx += nx * add;
      disc.vy += ny * add;
    }
    capDiscSpeed();
    rally += 1;
    return true;
  }

  /* ── 球与墙 / 球门 ────────────────────────────────────── */

  /** 位置夹取 + 墙面反射 + 进球判定；返回得分方或 null */
  function resolveWalls() {
    if (disc.x - DISC_R < TABLE.x0) {
      disc.x = TABLE.x0 + DISC_R;
      disc.vx = Math.abs(disc.vx);
    } else if (disc.x + DISC_R > TABLE.x1) {
      disc.x = TABLE.x1 - DISC_R;
      disc.vx = -Math.abs(disc.vx);
    }

    const inMouth = disc.x > GOAL_X0 && disc.x < GOAL_X1;
    if (disc.y - DISC_R < TABLE.y0) {
      if (inMouth) return 'p2'; // 从上方球门漏出 → 下方 p2 得分
      disc.y = TABLE.y0 + DISC_R;
      disc.vy = Math.abs(disc.vy);
    } else if (disc.y + DISC_R > TABLE.y1) {
      if (inMouth) return 'p1'; // 从下方球门漏出 → 上方 p1 得分
      disc.y = TABLE.y1 - DISC_R;
      disc.vy = -Math.abs(disc.vy);
    }
    return null;
  }

  function applyFriction() {
    const sp = Math.hypot(disc.vx, disc.vy);
    if (sp <= DISC_ROLL) return;
    const k = Math.max(0, 1 - FRICTION * SUBSTEP);
    disc.vx *= k;
    disc.vy *= k;
  }

  function pushTrail() {
    disc.trail.push({ x: disc.x, y: disc.y });
    if (disc.trail.length > TRAIL_MAX) disc.trail.shift();
  }

  /* ── 计分 ─────────────────────────────────────────────── */

  function award(scorer) {
    score[scorer] += 1;
    rally = 0;
    if (score[scorer] >= WIN_SCORE) {
      over = true;
      winner = scorer;
      serving = false;
      serveTimer = 0;
      disc.x = W / 2;
      disc.y = CENTER_Y;
      disc.vx = 0;
      disc.vy = 0;
      disc.trail = [];
      return;
    }
    serveSide = scorer === 'p1' ? 'p2' : 'p1'; // 失分方拿发球权
    placeServe();
  }

  /* ── 单个子步 ─────────────────────────────────────────── */

  function advance(actions) {
    if (over) return;

    const serveReq = applyActions(actions);
    if (aiEnabled) driveAi();

    // 拍速：本子步位移 / SUBSTEP（拖拽瞬移也计入，夹到 PADDLE_VMAX）
    const v1 = paddleVelocity(paddles.p1);
    const v2 = paddleVelocity(paddles.p2);

    if (serving) {
      disc.x = W / 2;
      disc.y = CENTER_Y;
      disc.vx = 0;
      disc.vy = 0;
      disc.trail = [];
      serveTimer -= SUBSTEP;
      if (serveReq || serveTimer <= 0) launchServe();
      paddles.p1.px = paddles.p1.x;
      paddles.p1.py = paddles.p1.y;
      paddles.p2.px = paddles.p2.x;
      paddles.p2.py = paddles.p2.y;
      return;
    }

    disc.x += disc.vx * SUBSTEP;
    disc.y += disc.vy * SUBSTEP;

    let scorer = resolveWalls();
    if (!scorer) {
      collidePaddle('p1', v1.vx, v1.vy);
      collidePaddle('p2', v2.vx, v2.vy);
      scorer = resolveWalls(); // 拍可能把球压进墙或球门
    }

    paddles.p1.px = paddles.p1.x;
    paddles.p1.py = paddles.p1.y;
    paddles.p2.px = paddles.p2.x;
    paddles.p2.py = paddles.p2.y;

    if (scorer) {
      award(scorer);
      return;
    }

    applyFriction();
    capDiscSpeed();
    pushTrail();
  }

  function step(dt, actions = []) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    acc += Math.min(dt, ACC_MAX);
    let n = 0;
    while (acc >= SUBSTEP && n < MAX_SUBSTEPS && !over) {
      acc -= SUBSTEP;
      advance(actions);
      n += 1;
    }
  }

  /* ── 交互 ─────────────────────────────────────────────── */

  function pointerTo(playerId, body) {
    const m = /^(p[12]):(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(body);
    let side;
    let x;
    let y;
    if (m) {
      side = m[1];
      x = Number(m[2]);
      y = Number(m[3]);
    } else {
      const m2 = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(body);
      if (!m2) return { ok: false, error: '无效坐标' };
      // 无座位前缀：本地模式归本机玩家（下拍 p2）
      side = playerId === 'p1' && safeMode === 'local2p' ? 'p1' : 'p2';
      x = Number(m2[1]);
      y = Number(m2[2]);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: '无效坐标' };
    const p = paddles[side];
    p.x = x;
    p.y = y;
    clampPaddle(side); // 拖到半场外也只会停在边界，越不过中线
    return { ok: true };
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (over) return { ok: false, error: '本局已结束' };

    if (action === 'start' || action === 'serve') {
      if (!serving) return { ok: false, error: '球已在运行' };
      launchServe();
      return { ok: true };
    }

    if (action.startsWith('pointer:')) {
      return pointerTo(playerId, action.slice(8));
    }

    const m = readAction(action);
    if (!m) return { ok: false, error: '未知动作' };
    if (m.serve) {
      if (!serving) return { ok: false, error: '球已在运行' };
      launchServe();
      return { ok: true };
    }
    const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[m.dir];
    movePaddleBy(m.owner, dir[0], dir[1]);
    return { ok: true };
  }

  /* ── 快照 ─────────────────────────────────────────────── */

  function state() {
    return {
      turn: null, // 实时制没有回合归属，但契约要求字段存在
      mode: safeMode,
      w: W,
      h: H,
      disc: {
        x: disc.x,
        y: disc.y,
        vx: disc.vx,
        vy: disc.vy,
        r: disc.r,
        speed: Math.hypot(disc.vx, disc.vy),
        trail: disc.trail.map((t) => ({ x: t.x, y: t.y })),
      },
      paddles: {
        p1: { x: paddles.p1.x, y: paddles.p1.y, r: paddles.p1.r },
        p2: { x: paddles.p2.x, y: paddles.p2.y, r: paddles.p2.r },
      },
      score: { p1: score.p1, p2: score.p2 },
      serveSide,
      serving,
      serveTimer,
      over,
      winner,
      rally,
      winScore: WIN_SCORE,
      centerY: CENTER_Y,
      hud: `${score.p1} : ${score.p2}`,
    };
  }

  function result() {
    if (!over) return null;
    const loser = winner === 'p1' ? 'p2' : 'p1';
    let title;
    if (safeMode === 'online') title = '对局结束';
    else if (safeMode === 'local2p') title = winner === 'p1' ? '上方获胜' : '下方获胜';
    else title = winner === 'p2' ? '胜利' : '惜败'; // 单人/人机：本机玩家固定是 p2
    return {
      over: true,
      winner,
      score: safeMode === 'local2p' ? Math.max(score.p1, score.p2) : score.p2,
      scores: { p1: score.p1, p2: score.p2 },
      title,
      text: `${score.p1} : ${score.p2} · ${winner === 'p1' ? '上方' : '下方'}获胜`,
      loser,
    };
  }

  /**
   * 测试专用钩子：只写纯数据，不引入 DOM / 随机 / 时钟；正常流程不调用。
   * 写入后会把 px/py 同步到新位置，避免测试造状态时产生虚假拍速。
   */
  function debugSet({ disc: d, paddles: ps, score: sc, serveSide: ss, serving: sv, serveTimer: st, over: ov, winner: wn, rally: rl, acc: ac } = {}) {
    if (d) {
      if (d.x !== undefined) disc.x = d.x;
      if (d.y !== undefined) disc.y = d.y;
      if (d.vx !== undefined) disc.vx = d.vx;
      if (d.vy !== undefined) disc.vy = d.vy;
      if (d.trail !== undefined) disc.trail = d.trail.map((t) => ({ x: t.x, y: t.y }));
    }
    if (ps) {
      for (const side of ['p1', 'p2']) {
        if (!ps[side]) continue;
        const p = paddles[side];
        if (ps[side].x !== undefined) p.x = ps[side].x;
        if (ps[side].y !== undefined) p.y = ps[side].y;
        clampPaddle(side);
        p.px = p.x;
        p.py = p.y;
      }
    }
    if (sc) {
      if (sc.p1 !== undefined) score.p1 = sc.p1;
      if (sc.p2 !== undefined) score.p2 = sc.p2;
    }
    if (ss !== undefined) serveSide = ss;
    if (sv !== undefined) serving = Boolean(sv);
    if (st !== undefined) serveTimer = st;
    if (ov !== undefined) over = Boolean(ov);
    if (wn !== undefined) winner = wn;
    if (rl !== undefined) rally = rl;
    if (ac !== undefined) acc = ac;
  }

  reset();

  return { submit, step, state, result, reset, debugSet };
}
