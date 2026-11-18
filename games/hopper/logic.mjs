/**
 * 过河青蛙 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 第一性原则与推导：
 * - 竖屏 480×640 分三区：底部起点区（安全）、中部 8 条车道（4 条公路 + 4 条河道）、
 *   顶部 5 个洞位（每洞占 2 列，即 96 px 宽的槽）。地图不滚动，青蛙一格一格跳。
 * - 玩家位置用「格坐标」表示：x 为浮点列号（0 起，站在原木上会被带走 ⇒ 必须能落小数），
 *   y 为整数行号（0 = 起点行，1..8 = 车道，9 = 洞位行）。跳格时 y 变化 1，横向只变 x。
 * - 车道用「环形轨道」推进：轨道长 TRACK（> 屏宽），障碍物位置 p ∈ [0, TRACK)，
 *   实际绘制/碰撞同时取 p 与 p−TRACK 两份拷贝；这样障碍从右侧出屏时，左侧拷贝正好接上，
 *   不会出现「瞬移」。速度/方向每道不同、逐道交替。
 * - 公路：车辆矩形与青蛙 AABB 相交 ⇒ 撞车减命。河道：只有原木能站；青蛙中心不在任何
 *   原木上 ⇒ 溺水减命。站在原木上时青蛙 x 随原木同速偏移（承载判定），被推出屏幕两侧
 *   两侧出界也判落水（原木开走了，青蛙落水）。
 * - 洞位：到达第 9 行即按 x 落入某个洞槽；空槽 +10 分并重置回起点；已占槽不可进入
 *   （move:up 被拒绝，青蛙留在第 8 行）。5 个槽全满 ⇒ solved 持续 1.2 s 后进入下一关：
 *   洞位清空、计时重置、公路车速 ×(1 + 0.18·(level−1))（封顶 2.2×，原木不变速）。
 * - 3 条命：撞车 / 溺水 / 被冲走 / 30 s 倒计时归零都扣 1 命；扣命后回起点并把倒计时
 *   重置为 30 s（否则一次失误会连锁超时），洞位进度保留。命数归零 ⇒ over=true。
 * - 固定步长：step 把 dt 切成 ≤1/120 s 的微步推进车辆、承载与倒计时，避免大 dt 穿透；
 *   按住方向键由 step(actions) 以「先 0.20 s 延迟、再每 0.12 s 一跳」连发。
 * - 所有随机（车道相位）只走 createRng(seed)，同种子同车流。
 */
import { createRng } from '../../shared/rng.js';

export const W = 480;
export const H = 640;

export const COLS = 10;
export const CELL = 48; // 480 / 10
export const ROWS = 10;

export const START_ROW = 0;
export const HOLE_ROW = 9;
export const ROAD_ROWS = [1, 2, 3, 4];
export const RIVER_ROWS = [5, 6, 7, 8];

export const TIME_LIMIT = 30;
export const START_LIVES = 3;
export const START_COL = 5;
export const HOLE_SCORE = 10;
export const HOLE_TOTAL = 5;
export const HOLE_COLS = [0.5, 2.5, 4.5, 6.5, 8.5]; // 洞心列号（每洞占 2 列）

export const HUD_H = 52;
export const HOLE_TOP = HUD_H; // 52
export const HOLE_H = 88; // 顶部安全区高
export const LANE_TOP = HOLE_TOP + HOLE_H; // 140
export const LANE_H = 52;
export const START_TOP = LANE_TOP + 8 * LANE_H; // 556
export const START_H = 52;
export const PLAYER_SIZE = 38;
export const VEHICLE_H = 36;
export const LOG_H = 42;
export const TRACK = 600; // 车道环形轨道长度（屏宽 480 + 120 隐藏带）
export const SOLVED_PAUSE = 1.2;
export const MAX_SPEED_SCALE = 2.2;
export const SPEED_STEP_PER_LEVEL = 0.18;

const REPEAT_DELAY = 0.2;
const REPEAT_INTERVAL = 0.12;
const MAX_H = 1 / 120;
const MAX_DT = 0.5;

/** 内置车道表：方向逐道交替、速度互不相同。宽度数组长度即车/木数量。 */
const LANE_DEFS = [
  { row: 1, kind: 'road', dir: 1, speed: 56, widths: [72, 60, 64] },
  { row: 2, kind: 'road', dir: -1, speed: 84, widths: [60, 72, 64] },
  { row: 3, kind: 'road', dir: 1, speed: 44, widths: [64, 60, 72] },
  { row: 4, kind: 'road', dir: -1, speed: 100, widths: [60, 64, 72] },
  { row: 5, kind: 'river', dir: 1, speed: 58, widths: [150, 150, 150] },
  { row: 6, kind: 'river', dir: -1, speed: 80, widths: [150, 150, 150] },
  { row: 7, kind: 'river', dir: 1, speed: 46, widths: [150, 150, 150] },
  { row: 8, kind: 'river', dir: -1, speed: 72, widths: [150, 150, 150] },
];

export const GEOM = Object.freeze({
  w: W,
  h: H,
  cols: COLS,
  cell: CELL,
  rows: ROWS,
  hudH: HUD_H,
  holeTop: HOLE_TOP,
  holeH: HOLE_H,
  laneTop: LANE_TOP,
  laneH: LANE_H,
  startTop: START_TOP,
  startH: START_H,
  playerSize: PLAYER_SIZE,
  vehicleH: VEHICLE_H,
  logH: LOG_H,
  track: TRACK,
});

/** 格列号 → 像素中心 x */
export function colToPx(col) {
  return (col + 0.5) * CELL;
}

/** 行号 → 像素中心 y */
export function rowToY(row) {
  if (row === START_ROW) return START_TOP + START_H / 2;
  if (row === HOLE_ROW) return HOLE_TOP + HOLE_H / 2;
  return LANE_TOP + (row - 1) * LANE_H + LANE_H / 2;
}

/** 某行车道顶部像素 y */
export function laneTop(row) {
  return LANE_TOP + (row - 1) * LANE_H;
}

function mod(v, m) {
  return ((v % m) + m) % m;
}

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

const DIRS = {
  left: { x: -1 },
  right: { x: 1 },
  up: { y: 1 },
  down: { y: -1 },
};

export function createGame({ seed = 1, mode = 'solo', level = 1 } = {}) {
  const initialSeed = seed >>> 0;
  const startLevel = Math.max(1, Math.floor(level) || 1);

  let rng;
  let lanes;
  let holes;
  let player;
  let score;
  let lives;
  let levelNo;
  let timeLeft;
  let over;
  let solved;
  let filled;
  let solvedTimer;
  let lastCause;
  let repeatDir;
  let repeatTimer;
  let submittedDir;
  let steps;

  function speedScale() {
    return Math.min(MAX_SPEED_SCALE, 1 + SPEED_STEP_PER_LEVEL * (levelNo - 1));
  }

  function laneSpeed(lane) {
    // 规则只要求「车辆加速」：过关后只提高公路车速，原木保持原速，河道难度恒定。
    return lane.baseSpeed * (lane.kind === 'road' ? speedScale() : 1);
  }

  function buildLanes() {
    return LANE_DEFS.map((def) => {
      const period = TRACK / def.widths.length;
      const phase = rng.next() * period;
      return {
        row: def.row,
        kind: def.kind,
        dir: def.dir,
        baseSpeed: def.speed,
        obstacles: def.widths.map((w, i) => ({
          x: mod(phase + i * period, TRACK),
          w,
          kind: def.kind === 'road' ? 'car' : 'log',
        })),
      };
    });
  }

  function buildHoles() {
    return HOLE_COLS.map((col) => ({ col, occupied: false }));
  }

  function respawn() {
    player.x = START_COL;
    player.y = START_ROW;
  }

  function reset() {
    rng = createRng(initialSeed);
    lanes = buildLanes();
    holes = buildHoles();
    player = { x: START_COL, y: START_ROW };
    score = 0;
    lives = START_LIVES;
    levelNo = startLevel;
    timeLeft = TIME_LIMIT;
    over = false;
    solved = false;
    filled = 0;
    solvedTimer = 0;
    lastCause = null;
    repeatDir = null;
    repeatTimer = 0;
    submittedDir = null;
    steps = 0;
  }

  function holeSlotAt(colX) {
    return Math.max(0, Math.min(HOLE_TOTAL - 1, Math.floor(colX / 2)));
  }

  /** 返回该像素位置所在的原木（含环形轨道左侧拷贝） */
  function logAtPx(lane, px) {
    for (const o of lane.obstacles) {
      for (const ox of [o.x, o.x - TRACK]) {
        if (px >= ox && px <= ox + o.w) return o;
      }
    }
    return null;
  }

  function onLog(row, colX) {
    const lane = lanes[row - 1];
    if (!lane || lane.kind !== 'river') return null;
    return logAtPx(lane, colToPx(colX));
  }

  function vehicleHit(row, colX) {
    const lane = lanes[row - 1];
    if (!lane || lane.kind !== 'road') return false;
    const px = colToPx(colX);
    const py = rowToY(row);
    const half = PLAYER_SIZE / 2;
    const cy = laneTop(row) + (LANE_H - VEHICLE_H) / 2;
    for (const o of lane.obstacles) {
      for (const ox of [o.x, o.x - TRACK]) {
        if (
          overlap(px - half, py - half, PLAYER_SIZE, PLAYER_SIZE, ox, cy, o.w, VEHICLE_H)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** 站到该格是否致命；返回死因字符串或 null。 */
  function hazardAt(colX, row) {
    if (row >= 5 && row <= 8) {
      return onLog(row, colX) ? null : '溺水';
    }
    if (row >= 1 && row <= 4) {
      return vehicleHit(row, colX) ? '撞车' : null;
    }
    return null;
  }

  function loseLife(cause) {
    if (over) return;
    lives -= 1;
    lastCause = cause;
    if (lives <= 0) {
      lives = 0;
      over = true;
      return;
    }
    respawn();
    timeLeft = TIME_LIMIT;
  }

  function fillHole(slot) {
    score += HOLE_SCORE;
    holes[slot].occupied = true;
    filled += 1;
    player.x = holes[slot].col;
    player.y = HOLE_ROW;
    if (filled >= HOLE_TOTAL) {
      solved = true;
      solvedTimer = SOLVED_PAUSE;
      lastCause = '过关';
    } else {
      respawn();
      lastCause = '入洞';
    }
  }

  function tryMove(dir) {
    if (over) return { ok: false, error: '本局已结束' };
    if (solved) return { ok: false, error: '本关已完成' };
    const d = DIRS[dir];
    if (!d) return { ok: false, error: '无效方向' };

    if (dir === 'up') {
      if (player.y >= HOLE_ROW) return { ok: false, error: '已在洞位区' };
      if (player.y === HOLE_ROW - 1) {
        const slot = holeSlotAt(player.x);
        if (holes[slot].occupied) return { ok: false, error: '洞位已关闭' };
        fillHole(slot);
        return { ok: true };
      }
      player.y += 1;
    } else if (dir === 'down') {
      if (player.y <= START_ROW) return { ok: false, error: '已在起点' };
      player.y -= 1;
    } else {
      const nx = player.x + d.x;
      if (nx < 0 || nx > COLS - 1) return { ok: false, error: '已到边界' };
      player.x = nx;
    }

    const cause = hazardAt(player.x, player.y);
    if (cause) loseLife(cause);
    return { ok: true };
  }

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效操作' };
    if (action === 'start') {
      if (over) return { ok: false, error: '本局已结束' };
      return { ok: true };
    }
    const m = /^move:(left|right|up|down)$/.exec(action);
    if (!m) return { ok: false, error: '无效操作' };
    const res = tryMove(m[1]);
    // 记下这次边沿移动，供紧接着的 step(actions) 去重，避免一次按键跳两格。
    if (res.ok) submittedDir = m[1];
    return res;
  }

  /** 单个微步：车辆/原木推进 → 承载 → 碰撞 → 倒计时 */
  function advance(h) {
    const row = player.y;
    const riverLane = row >= 5 && row <= 8 ? lanes[row - 1] : null;
    // 先记录「此刻脚下是否有原木」，再让原木与青蛙同速移动，保证相对位置不变。
    const carryingLog = riverLane ? logAtPx(riverLane, colToPx(player.x)) : null;

    for (const lane of lanes) {
      const delta = lane.dir * laneSpeed(lane) * h;
      for (const o of lane.obstacles) o.x = mod(o.x + delta, TRACK);
    }

    if (riverLane) {
      if (!carryingLog) {
        loseLife('溺水');
        return;
      }
      player.x += (riverLane.dir * laneSpeed(riverLane) * h) / CELL;
      if (player.x < 0 || player.x > COLS - 1) {
        loseLife('被冲走');
        return;
      }
    } else if (row >= 1 && row <= 4) {
      if (vehicleHit(row, player.x)) {
        loseLife('撞车');
        return;
      }
    }

    timeLeft -= h;
    if (timeLeft <= 0) {
      timeLeft = 0;
      loseLife('时间到');
    }
  }

  function nextLevel() {
    levelNo += 1;
    holes = buildHoles();
    filled = 0;
    solved = false;
    solvedTimer = 0;
    timeLeft = TIME_LIMIT;
    respawn();
  }

  function step(dt, actions) {
    if (over) return;
    const delta = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, MAX_DT));

    if (solved) {
      solvedTimer -= delta;
      if (solvedTimer <= 0) nextLevel();
      return;
    }

    const held = Array.isArray(actions) ? actions : [];
    const dirs = held.filter((a) => DIRS[a]);
    if (dirs.length) {
      const d = dirs[dirs.length - 1];
      if (d !== repeatDir) {
        // 新按下的方向：边沿立即跳一格；若同一帧 submit 已处理过这次按键则不重复。
        const alreadyMoved = submittedDir === d;
        submittedDir = null;
        repeatDir = d;
        repeatTimer = REPEAT_DELAY;
        if (!alreadyMoved) tryMove(d);
      } else {
        submittedDir = null;
        repeatTimer -= delta;
        if (repeatTimer <= 0) {
          repeatTimer = REPEAT_INTERVAL;
          tryMove(d);
        }
      }
    } else {
      submittedDir = null;
      repeatDir = null;
      repeatTimer = 0;
    }

    let remaining = delta;
    let guard = 0;
    while (remaining > 1e-9 && !over && !solved && guard < 64) {
      const h = Math.min(remaining, MAX_H);
      advance(h);
      remaining -= h;
      guard += 1;
      steps += 1;
    }
  }

  function state() {
    return {
      turn: 'p1',
      player: { x: player.x, y: player.y },
      lanes: lanes.map((lane) => ({
        row: lane.row,
        kind: lane.kind,
        dir: lane.dir,
        speed: laneSpeed(lane),
        obstacles: lane.obstacles.map((o) => ({ x: o.x, w: o.w, kind: o.kind })),
      })),
      holes: holes.map((h) => ({ col: h.col, occupied: h.occupied })),
      score,
      lives,
      level: levelNo,
      timeLeft,
      over,
      solved,
      filled,
      total: HOLE_TOTAL,
      lastCause,
      speedScale: speedScale(),
      steps,
      geom: GEOM,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `到达第 ${levelNo} 关 · 填满 ${filled}/${HOLE_TOTAL} 个洞`,
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
