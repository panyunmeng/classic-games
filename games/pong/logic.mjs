/**
 * 乒乓对决 · 纯逻辑（无 DOM / 无时钟 / 无真随机）。
 *
 * 场地事实：竖屏 480×640，p1 守上方、p2 守下方，两边都是水平横拍，沿 x 轴滑动。
 *   → 只有横拍能横跨球道，所以“落点偏移”落在 x 轴上：球心相对拍心的偏移。
 *   → 动作词表沿用需求里的 up / down：up = 向屏幕左移，down = 向屏幕右移；
 *     同时接受 left / right 别名（同一方向，联机实时制协议只放行 left/right/up/down）。
 *
 * 物理与规则：
 * - 固定步长 1/60 s 子步推进；step(dt) 累加，单次最多 8 子步，防止一帧穿过球拍。
 * - 球撞左右墙反弹；越过上/下边线即失分。
 * - 反弹角由落点偏移 off∈[-1,1] 决定：angle = off × 60°，越靠边角度越大；
 *   上拍出射向下（vy>0），下拍出射向上（vy<0）。每次击拍速度 ×1.035，封顶 720 px/s。
 * - 得分后发球权归失分方（serverSide = 失分方）：球从失分方拍前发出，飞向得分方；
 *   发球前有 0.9 s 准备时间，submit('start') 可立即发球；step 到时会自动发球。
 * - 11 分制：先到 11 分者胜（不设净胜两分，规则简单、局面不拖长）。
 * - AI（mode = solo / ai）只控制 p1：确定性追踪，见 ai.mjs，无随机、无时钟。
 *
 * 联机事实：
 * - 服务端实时制把输入攒成 [{seat, action}] 再调 step，因此 step 的 actions
 *   既接受字符串，也接受 {seat, action} 对象；带 seat 的裸方向词归属该座位。
 * - submit(playerId, action) 只处理 'start' / 拖拍坐标 / 单步微调，实时移动走 step。
 */
import { createRng } from '../../shared/rng.js';
import { aiDirection } from './ai.mjs';

export const W = 480;
export const H = 640;
export const WIN_SCORE = 11;

export const PADDLE_W = 88;
export const PADDLE_H = 12;
export const P1_Y = 72;
export const P2_Y = H - 72 - PADDLE_H;
export const BALL_R = 7;
export const MAX_BOUNCE = (60 * Math.PI) / 180;

const STEP = 1 / 60;
const MAX_SUBSTEPS = 8;
const WALL_L = 16;
const WALL_R = W - 16;
const PADDLE_SPEED = 460;
const SERVE_SPEED = 310;
const SPEED_UP = 1.035;
const SPEED_MAX = 720;
const SERVE_DELAY = 0.9;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * 落点偏移 → 出射速度（公开纯函数，逻辑与单测共用）。
 * offset ∈ [-1,1]：-1 最左、0 正中、+1 最右。
 * dir = +1 向下（上拍击球后），dir = -1 向上（下拍击球后）。
 */
export function bounceVelocity(offset, speed, dir = 1) {
  const off = clamp(offset, -1, 1);
  const angle = off * MAX_BOUNCE;
  const s = Math.max(0, Number.isFinite(speed) ? speed : SERVE_SPEED);
  return {
    vx: Math.sin(angle) * s,
    vy: (dir < 0 ? -1 : 1) * Math.cos(angle) * s,
  };
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const safeMode = ['solo', 'ai', 'local2p', 'online'].includes(mode) ? mode : 'solo';
  const aiEnabled = safeMode === 'solo' || safeMode === 'ai';
  const lv = Number.isFinite(level) ? level : 1;
  // AI 拍速刻意低于玩家（460），等级越高越接近，保证可赢
  const aiSpeed = 320 + 30 * clamp((lv | 0) - 1, 0, 2);

  let rng = createRng(seed);
  let paddles;
  let ball;
  let score;
  let serverSide;
  let serving;
  let serveTimer;
  let over;
  let winner;
  let rally;
  let acc;

  function reset() {
    rng = createRng(seed);
    paddles = {
      p1: { x: W / 2 - PADDLE_W / 2, y: P1_Y, w: PADDLE_W, h: PADDLE_H },
      p2: { x: W / 2 - PADDLE_W / 2, y: P2_Y, w: PADDLE_W, h: PADDLE_H },
    };
    ball = { x: W / 2, y: P1_Y + PADDLE_H + BALL_R + 10, vx: 0, vy: 0, r: BALL_R, trail: [] };
    score = { p1: 0, p2: 0 };
    serverSide = 'p1';
    over = false;
    winner = null;
    rally = 0;
    acc = 0;
    placeServe();
  }

  /** 发球准备：球贴在发球方拍前，等计时或 submit('start') */
  function placeServe() {
    serving = true;
    serveTimer = SERVE_DELAY;
    rally = 0;
    const p = paddles[serverSide];
    ball.x = p.x + p.w / 2;
    ball.y = serverSide === 'p1' ? P1_Y + PADDLE_H + BALL_R + 10 : P2_Y - BALL_R - 10;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail = [];
  }

  function launchServe() {
    if (!serving || over) return false;
    serving = false;
    serveTimer = 0;
    rally = 0;
    const dir = serverSide === 'p1' ? 1 : -1; // 从发球方飞向对手
    const angle = rng.range(-0.44, 0.44); // 小幅横向偏角，方向和幅度固定种子可复现
    ball.vx = Math.sin(angle) * SERVE_SPEED;
    ball.vy = dir * Math.cos(angle) * SERVE_SPEED;
    ball.trail = [];
    return true;
  }

  function movePaddle(p, dir, speed) {
    if (!dir) return;
    p.x = clamp(p.x + dir * speed * STEP, WALL_L, WALL_R - p.w);
  }

  /**
   * 动作归一化：字符串或 {seat, action} 都接受。
   * 返回 { owner: 'p1'|'p2', dir: -1|1 } 或 null。
   */
  function readAction(a) {
    let seat = null;
    let token = a;
    if (a && typeof a === 'object') {
      seat = a.seat === 'p1' || a.seat === 'p2' ? a.seat : null;
      token = a.action;
    }
    if (typeof token !== 'string') return null;

    const prefixed = /^(p[12])(up|down|left|right)$/.exec(token);
    if (prefixed) {
      // 联机时以服务端认定的座位为准，客户端不能借词前缀动别人的拍
      const owner = safeMode === 'online' && seat ? seat : prefixed[1];
      return { owner, dir: prefixed[2] === 'up' || prefixed[2] === 'left' ? -1 : 1 };
    }
    const bare = /^(up|down|left|right)$/.exec(token);
    if (bare) {
      const owner = seat || 'p2'; // 无座位信息时归本机玩家（下拍）
      return { owner, dir: bare[1] === 'up' || bare[1] === 'left' ? -1 : 1 };
    }
    return null;
  }

  function movePaddles(actions) {
    let d1 = 0;
    let d2 = 0;
    for (const a of actions || []) {
      const m = readAction(a);
      if (!m) continue;
      if (m.owner === 'p1') d1 += m.dir;
      else d2 += m.dir;
    }
    movePaddle(paddles.p1, clamp(d1, -1, 1), PADDLE_SPEED);
    movePaddle(paddles.p2, clamp(d2, -1, 1), PADDLE_SPEED);
  }

  function aiState() {
    return {
      w: W,
      ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy },
      paddles: {
        p1: { x: paddles.p1.x, w: paddles.p1.w },
        p2: { x: paddles.p2.x, w: paddles.p2.w },
      },
      serving,
      serverSide,
    };
  }

  function bounce(p, dir) {
    const center = p.x + p.w / 2;
    const off = clamp((ball.x - center) / (p.w / 2), -1, 1);
    const speed = Math.min(SPEED_MAX, Math.hypot(ball.vx, ball.vy) * SPEED_UP);
    const v = bounceVelocity(off, speed, dir);
    ball.vx = v.vx;
    ball.vy = v.vy;
    rally += 1;
  }

  /** 球撞拍：上拍要求球向上且从下方接触，下拍要求球向下且从上方接触 */
  function hitPaddles() {
    if (ball.vy < 0) {
      const p = paddles.p1;
      if (
        ball.y >= P1_Y &&
        ball.y - ball.r <= P1_Y + PADDLE_H + 1 &&
        ball.x + ball.r >= p.x &&
        ball.x - ball.r <= p.x + p.w
      ) {
        ball.y = P1_Y + PADDLE_H + ball.r + 0.5;
        bounce(p, 1);
        return true;
      }
    }
    if (ball.vy > 0) {
      const p = paddles.p2;
      if (
        ball.y <= P2_Y + PADDLE_H &&
        ball.y + ball.r >= P2_Y - 1 &&
        ball.x + ball.r >= p.x &&
        ball.x - ball.r <= p.x + p.w
      ) {
        ball.y = P2_Y - ball.r - 0.5;
        bounce(p, -1);
        return true;
      }
    }
    return false;
  }

  /** 推进一个子步；返回得分方（'p1' | 'p2' | null） */
  function moveBall() {
    ball.x += ball.vx * STEP;
    ball.y += ball.vy * STEP;

    if (ball.x - ball.r < WALL_L) {
      ball.x = WALL_L + ball.r;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.r > WALL_R) {
      ball.x = WALL_R - ball.r;
      ball.vx = -Math.abs(ball.vx);
    }

    hitPaddles();

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 14) ball.trail.shift();

    if (ball.y - ball.r > H) return 'p1'; // 下边线失守 → p1 得分
    if (ball.y + ball.r < 0) return 'p2'; // 上边线失守 → p2 得分
    return null;
  }

  function award(scorer) {
    score[scorer] += 1;
    serverSide = scorer === 'p1' ? 'p2' : 'p1'; // 失分方获得发球权
    if (score[scorer] >= WIN_SCORE) {
      over = true;
      winner = scorer;
      serving = false;
      serveTimer = 0;
      ball.vx = 0;
      ball.vy = 0;
      ball.trail = [];
      return;
    }
    placeServe();
  }

  function advance(actions) {
    if (over) return;

    movePaddles(actions);

    if (aiEnabled) {
      movePaddle(paddles.p1, aiDirection(aiState(), 'p1'), aiSpeed);
    }

    if (serving) {
      // 发球准备时球跟着发球方的拍子走，方便调整发球点
      ball.x = paddles[serverSide].x + paddles[serverSide].w / 2;
      ball.trail = [];
      serveTimer -= STEP;
      if (serveTimer <= 0) launchServe();
      return;
    }

    const scorer = moveBall();
    if (scorer) award(scorer);
  }

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
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (over) return { ok: false, error: '本局已结束' };

    if (action === 'start' || action === 'serve') {
      if (!serving) return { ok: false, error: '球已在运行' };
      launchServe();
      return { ok: true };
    }

    if (action.startsWith('pointer:')) {
      const body = action.slice(8);
      const m = /^(p[12]):(-?\d+(?:\.\d+)?)$/.exec(body);
      let side = 'p2';
      let v;
      if (m) {
        side = m[1];
        v = Number(m[2]);
      } else {
        v = Number(body);
      }
      if (!Number.isFinite(v)) return { ok: false, error: '无效坐标' };
      const p = paddles[side];
      p.x = clamp(v - p.w / 2, WALL_L, WALL_R - p.w);
      if (serving && serverSide === side) ball.x = p.x + p.w / 2;
      return { ok: true };
    }

    const mv = readAction(action);
    if (!mv) return { ok: false, error: '未知动作' };
    movePaddle(paddles[mv.owner], mv.dir, PADDLE_SPEED);
    if (serving && serverSide === mv.owner) {
      ball.x = paddles[mv.owner].x + paddles[mv.owner].w / 2;
    }
    return { ok: true };
  }

  function state() {
    return {
      turn: null, // 实时制：没有回合归属，但契约要求字段存在
      mode: safeMode,
      ball: {
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy,
        r: ball.r,
        trail: ball.trail.map((t) => ({ x: t.x, y: t.y })),
      },
      paddles: {
        p1: { x: paddles.p1.x, y: paddles.p1.y, w: paddles.p1.w, h: paddles.p1.h },
        p2: { x: paddles.p2.x, y: paddles.p2.y, w: paddles.p2.w, h: paddles.p2.h },
      },
      score: { p1: score.p1, p2: score.p2 },
      serverSide,
      serving,
      serveTimer,
      over,
      winner,
      rally,
      speed: Math.hypot(ball.vx, ball.vy),
      winScore: WIN_SCORE,
      w: W,
      h: H,
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
      // 单人/人机展示本机玩家得分；双人没有“本机”，取较高分
      score: safeMode === 'local2p' ? Math.max(score.p1, score.p2) : score.p2,
      scores: { p1: score.p1, p2: score.p2 },
      title,
      text: `${score.p1} : ${score.p2} · ${winner === 'p1' ? '上方' : '下方'}获胜`,
      loser,
    };
  }

  /**
   * 测试专用钩子：只写纯数据，不引入 DOM / 随机 / 时钟，正常流程不调用。
   */
  function debugSet({ ball: b, paddles: ps, score: sc, serverSide: ss, serving: sv, serveTimer: st, over: ov, winner: wn, rally: rl, acc: ac } = {}) {
    if (b) {
      if (b.x !== undefined) ball.x = b.x;
      if (b.y !== undefined) ball.y = b.y;
      if (b.vx !== undefined) ball.vx = b.vx;
      if (b.vy !== undefined) ball.vy = b.vy;
      if (b.r !== undefined) ball.r = b.r;
      if (b.trail !== undefined) ball.trail = b.trail.map((t) => ({ x: t.x, y: t.y }));
    }
    if (ps) {
      for (const side of ['p1', 'p2']) {
        if (ps[side]) Object.assign(paddles[side], ps[side]);
      }
    }
    if (sc) {
      if (sc.p1 !== undefined) score.p1 = sc.p1;
      if (sc.p2 !== undefined) score.p2 = sc.p2;
    }
    if (ss !== undefined) serverSide = ss;
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
