/**
 * 泡泡消消 · 纯逻辑（蜂窝网格 + 弹道吸附 + 同色连通消除 + 悬空坠落）。
 *
 * 设计事实与推导（第一性原则，先讲清为什么这么定，再谈实现）：
 *
 * 1) 网格是「错位六边形（odd-r 偏移）」，不是方阵。
 *    每行固定 COLS 格，奇数行整体右移半格 D/2，于是
 *      x(r,c) = X0 + c*D + (((r + phase) & 1) ? D/2 : 0)
 *      y(r)   = FIELD_TOP + R + r*ROW_STEP
 *    ROW_STEP 必须取 D*√3/2 ≈ 0.866D —— 这是正六边形密排的行距常数，
 *    取别的值相邻两行就不再相切（留缝或重叠）。场地宽度 = COLS*D + D/2，
 *    奇数相位行贴右墙、偶数相位行贴左墙，两种行都恰好装下 COLS 个泡泡。
 *
 *    为什么需要 phase：顶行落一行时，所有行号 +1，于是每行的奇偶都翻转。
 *    若只让行号变化，「偶数行错位 0、奇数行错位 D/2」的规则会把相邻两行
 *    朝相反方向各推半格 —— 整盘被剪切，原本相切的邻居（如 (10,11) 与 (9,10)，
 *    相距正好 36px）会散开到 54px，连通性判定随之出错（实测复现）。
 *    真正的蜂窝在落行时是整体平移：每个泡泡 x 不变、y 增加一个行距。
 *    所以落行时同步翻转 phase：x(r+1,c,phase^1) ≡ x(r,c,phase)，邻接关系守恒。
 *    视觉上整盘只往下走，不会左右跳半格，比「整盘横移」更干净。
 *
 * 2) 邻接关系由几何推出：同行 c±1；相邻行因为错位半格，邻居是
 *    偶数相位行 (r±1, c-1) 与 (r±1, c)，奇数相位行 (r±1, c) 与 (r±1, c+1)。
 *    neighbors() 是唯一出处，BFS 与吸附共用同一份，避免两处各写一套。
 *
 * 3) 弹道：angle 用「度」，0 = 正上，正数偏右，范围 ±MAX_ANGLE。
 *    vx = sin(a)、vy = -cos(a) 恒定向上，左右墙镜像反射，顶棚吸附。
 *    飞行按固定步长推进并切成 ≤5px 的子步：速度 620px/s 在 60Hz 下每帧 10.3px，
 *    若整帧移动会从 36px 直径的泡泡缝隙里穿过去（隧穿），子步是必需的。
 *
 * 4) 吸附：撞到某泡泡后，在「被撞泡泡本身 + 它的 6 个邻居 + 落点所在格」里
 *    选离落点最近的空格，并强制要求该空格贴着已有泡泡（或位于顶行）——
 *    否则会出现凭空悬空的泡泡，破坏「悬空坠落」规则。
 *
 * 5) 消除：从吸附点做同色 BFS，≥3 才消（Puzzle Bobble 类玩法的核心阈值：
 *    2 连不给分，玩家必须主动做 3 连，射击才有意义）。
 *    消完再对「从第 0 行可达」做一次任意色连通性检查，不可达 = 悬空，整片坠落。
 *    combo = 连续「有消除」的发射次数，本发得分 =（消除数×10 + 坠落数×20）× combo。
 *
 * 6) 落行与加速：每发处理完顶行插入一「整行」泡泡。为什么必须是整行？
 *    若新行留空隙，上一行（被顶到下一位）里正对空隙的泡泡就会失去所有上方邻居 ——
 *    一次落两行时更明显：第 1 行落下的留空行被第 2 行盖住后，那一行泡泡会集体悬空，
 *    而「悬空」在本作里是要坠落的语义，凭空悬空等于破坏不变式（实测复现过）。
 *    整行插入保证「每个非顶行泡泡都有上方邻居」，与经典玩法一致。
 *    分数 ≥ DROP_FAST_SCORE 后每发落两行，这就是「随分数加快」。
 *
 * 7) 失败：任何泡泡落到 DANGER_ROW 行（中心 y + R 越过玩家线 PLAYER_LINE_Y）即 over。
 *    用行号判定而不是像素判定，因为行号与几何一一对应，边界不会因浮点误差抖动。
 *
 * 8) 清台：泡泡全消 → solved 置位、+CLEAR_BONUS、重发新盘，本局继续（不是结束）。
 *
 * 9) 随机只走 createRng(seed)：本文件不出现 DOM / window / canvas / Math.random / Date.now。
 */
import { createRng } from '../../shared/rng.js';

export const W = 480;
export const H = 640;

/* ── 网格几何（渲染层从这里 import，保证只有一份真值） ─────────── */
export const COLS = 12;
export const D = 36; // 泡泡直径
export const R = D / 2;
export const ROW_STEP = (D * Math.sqrt(3)) / 2; // 蜂窝密排行距
export const FIELD_L = 15;
export const FIELD_TOP = 64;
export const FIELD_W = COLS * D + D / 2;
export const FIELD_R = FIELD_L + FIELD_W;
export const X0 = FIELD_L + R;

/* ── 发射口 / 判定线 ─────────────────────────────────────────── */
export const SHOOTER_X = W / 2;
export const SHOOTER_Y = H - 52;
export const PLAYER_LINE_Y = 528;
export const DANGER_ROW = 14; // 该行及以下 = 触底失败
export const MAX_ROWS = 20;
export const INIT_ROWS = 4;

/* ── 手感参数 ───────────────────────────────────────────────── */
export const MAX_ANGLE = 78;
export const ANGLE_SPEED = 100; // 度/秒
export const BUBBLE_SPEED = 620; // px/秒
export const COLLIDE_DIST = D - 2;
export const STEP = 1 / 60;
export const MAX_SUBSTEPS = 8;

/* ── 难度曲线 ───────────────────────────────────────────────── */
export const COLOR_START = 3;
export const COLOR_MAX = 6;
export const COLOR_STEP_SCORE = 300; // 每 300 分多一种颜色
export const DROP_FAST_SCORE = 1200; // 到这里每发落两行（终局压力）

/* 六色霓虹调色板：色相拉开，深色背景下互不混淆 */
export const PALETTE = ['#22d3ee', '#f472b6', '#fbbf24', '#4ade80', '#a78bfa', '#f87171'];

const CLEAR_BONUS = 500;
const POP_SCORE = 10;
const DROP_SCORE = 20;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * 格子中心 x。
 * phase 是整盘的错位相位：奇数行右移半格只在某一种「相位」下成立。
 * 顶部落行时所有行号 +1，行奇偶全部翻转；若不补偿，相邻两行会朝相反方向各移半格，
 * 整盘被剪切，原本相邻的泡泡会散开（实测 (10,11)-(9,10) 从相距 36px 变成 54px）。
 * 因此落行时同步翻转 phase，让每个泡泡的 x 保持不变、只下移一行，邻接关系才真的守恒。
 */
export function cellX(r, c, phase = 0) {
  return X0 + c * D + ((r + phase) & 1 ? D / 2 : 0);
}

/** 格子中心 y */
export function cellY(r) {
  return FIELD_TOP + R + r * ROW_STEP;
}

/** 该行 x 坐标落到哪一列（夹在 0..COLS-1） */
export function colAt(r, x, phase = 0) {
  const off = (r + phase) & 1 ? D / 2 : 0;
  return clamp(Math.round((x - X0 - off) / D), 0, COLS - 1);
}

/** 六边形邻接（odd-r 偏移坐标系 + 相位），只返回场内的格子 */
export function neighbors(r, c, phase = 0) {
  const odd = ((r + phase) & 1) === 1;
  const raw = [
    [r, c - 1],
    [r, c + 1],
    [r - 1, odd ? c : c - 1],
    [r - 1, odd ? c + 1 : c],
    [r + 1, odd ? c : c - 1],
    [r + 1, odd ? c + 1 : c],
  ];
  return raw.filter(([rr, cc]) => rr >= 0 && rr < MAX_ROWS && cc >= 0 && cc < COLS);
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const rng = createRng(seed);

  let grid; // 二维数组：grid[r][c] = {id,r,c,color} | null
  let shooter; // {angle,color,nextColor}
  let flying; // {active,x,y,vx,vy,color,trail}
  let score;
  let combo;
  let maxCombo;
  let dropRows;
  let over;
  let solved;
  let pops;
  let dropped;
  let clears;
  let shots;
  let autoDrop;
  let acc;
  let serial;
  let phase; // 整盘错位相位（落行时翻转，见 cellX 注释）

  /* ── 网格读写 ─────────────────────────────────────────────── */

  function makeCell(r, c, color) {
    return { id: `b${serial++}`, r, c, color };
  }

  function cellAt(r, c) {
    const row = grid[r];
    return row ? row[c] ?? null : null;
  }

  function ensureRow(r) {
    while (grid.length <= r && grid.length < MAX_ROWS) {
      grid.push(new Array(COLS).fill(null));
    }
  }

  /** 调试/单测用：把「颜色索引二维数组」铺成网格（null = 空） */
  function setGrid(rows) {
    grid = [];
    for (let r = 0; r < rows.length && r < MAX_ROWS; r++) {
      const row = new Array(COLS).fill(null);
      const src = rows[r] || [];
      for (let c = 0; c < COLS; c++) {
        const v = src[c];
        if (v === null || v === undefined) continue;
        const color = typeof v === 'object' ? v.color : v;
        if (!Number.isInteger(color) || color < 0) continue;
        row[c] = makeCell(r, c, color);
      }
      grid.push(row);
    }
    if (!grid.length) grid.push(new Array(COLS).fill(null));
  }

  function colorCount() {
    return Math.min(COLOR_MAX, COLOR_START + Math.floor(score / COLOR_STEP_SCORE));
  }

  function colorsInPlay() {
    const set = new Set();
    for (const row of grid) for (const cell of row) if (cell) set.add(cell.color);
    return [...set];
  }

  /** 发射色优先从场上已有的颜色里抽：保证每一发都有用，不做无效射击 */
  function pickShotColor() {
    const list = colorsInPlay();
    if (!list.length) return rng.int(colorCount());
    return list[rng.int(list.length)];
  }

  function countBubbles() {
    let n = 0;
    for (const row of grid) for (const cell of row) if (cell) n += 1;
    return n;
  }

  function bottomRow() {
    for (let r = grid.length - 1; r >= 0; r--) {
      const row = grid[r];
      if (row && row.some(Boolean)) return r;
    }
    return -1;
  }

  /** 触底判定：底行达到 DANGER_ROW 即失败 */
  function danger() {
    if (bottomRow() >= DANGER_ROW) {
      over = true;
      return true;
    }
    return false;
  }

  /* ── 局面生成 ─────────────────────────────────────────────── */

  function dealBoard() {
    const n = colorCount();
    const rows = [];
    for (let r = 0; r < INIT_ROWS; r++) {
      const row = new Array(COLS).fill(null);
      for (let c = 0; c < COLS; c++) row[c] = rng.int(n);
      rows.push(row);
    }
    setGrid(rows);
  }

  function reset() {
    score = 0;
    combo = 0;
    maxCombo = 0;
    dropRows = 0;
    over = false;
    solved = false;
    pops = 0;
    dropped = 0;
    clears = 0;
    shots = 0;
    autoDrop = true;
    acc = 0;
    serial = 0;
    phase = 0;
    shooter = { angle: 0, color: 0, nextColor: 0 };
    flying = { active: false, x: SHOOTER_X, y: SHOOTER_Y, vx: 0, vy: 0, color: 0, trail: [] };
    dealBoard();
    shooter.color = pickShotColor();
    shooter.nextColor = pickShotColor();
  }

  /* ── 连通性 ───────────────────────────────────────────────── */

  /** 从 (r,c) 出发的同色连通簇 */
  function sameColor(r, c) {
    const start = cellAt(r, c);
    if (!start) return [];
    const color = start.color;
    const seen = new Set([`${r},${c}`]);
    const out = [start];
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      for (const [nr, nc] of neighbors(cr, cc, phase)) {
        const key = `${nr},${nc}`;
        if (seen.has(key)) continue;
        const cell = cellAt(nr, nc);
        if (!cell || cell.color !== color) continue;
        seen.add(key);
        out.push(cell);
        stack.push([nr, nc]);
      }
    }
    return out;
  }

  /** 与顶行（第 0 行）不连通的泡泡 = 悬空 */
  function floating() {
    const reach = new Set();
    const stack = [];
    const top = grid[0];
    if (top) {
      for (let c = 0; c < COLS; c++) {
        if (!top[c]) continue;
        reach.add(`0,${c}`);
        stack.push([0, c]);
      }
    }
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of neighbors(r, c, phase)) {
        const key = `${nr},${nc}`;
        if (reach.has(key)) continue;
        if (!cellAt(nr, nc)) continue;
        reach.add(key);
        stack.push([nr, nc]);
      }
    }
    const out = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (cell && !reach.has(`${r},${c}`)) out.push(cell);
      }
    }
    return out;
  }

  /* ── 吸附 ─────────────────────────────────────────────────── */

  function pickSnap(x, y, hit) {
    const guessRow = clamp(Math.round((y - FIELD_TOP - R) / ROW_STEP), 0, MAX_ROWS - 1);
    const cand = [];
    if (hit) {
      cand.push([hit.r, hit.c]);
      for (const n of neighbors(hit.r, hit.c, phase)) cand.push(n);
    }
    cand.push([guessRow, colAt(guessRow, x, phase)]);

    let best = null;
    let bestD = Infinity;
    for (const [r, c] of cand) {
      if (r < 0 || r >= MAX_ROWS || !Number.isInteger(r)) continue;
      if (cellAt(r, c)) continue;
      if (r !== 0 && !neighbors(r, c, phase).some(([nr, nc]) => cellAt(nr, nc))) continue;
      const dx = cellX(r, c, phase) - x;
      const dy = cellY(r) - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = [r, c];
      }
    }
    if (best) return best;

    // 兜底：全场扫一遍最近的可吸附空格（理论上只在极端拥挤时用到）
    for (let r = 0; r < MAX_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cellAt(r, c)) continue;
        if (r !== 0 && !neighbors(r, c, phase).some(([nr, nc]) => cellAt(nr, nc))) continue;
        const dx = cellX(r, c, phase) - x;
        const dy = cellY(r) - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = [r, c];
        }
      }
    }
    return best;
  }

  /* ── 落行 ─────────────────────────────────────────────────── */

  function dropsForShot() {
    return score >= DROP_FAST_SCORE ? 2 : 1;
  }

  function dropNewRow() {
    const n = colorCount();
    const row = new Array(COLS).fill(null);
    // 整行填满：留空隙会让被顶到下一行的泡泡集体失去上方邻居（见文件头第 6 条）
    for (let c = 0; c < COLS; c++) row[c] = makeCell(0, c, rng.int(n));
    // 所有行号 +1（奇偶翻转），同步翻转相位才能保持每个泡泡的 x 与邻接关系不变
    phase = (phase + 1) & 1;
    grid.unshift(row);
    if (grid.length > MAX_ROWS) grid.length = MAX_ROWS;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (cell) {
          cell.r = r;
          cell.c = c;
        }
      }
    }
    dropRows += 1;
  }

  /* ── 发射与结算 ───────────────────────────────────────────── */

  function shoot() {
    if (over) return { ok: false, error: '本局已结束' };
    if (flying.active) return { ok: false, error: '泡泡还在飞' };
    const a = (shooter.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    flying = {
      active: true,
      x: SHOOTER_X + dx * (R + 8),
      y: SHOOTER_Y + dy * (R + 8),
      vx: dx * BUBBLE_SPEED,
      vy: dy * BUBBLE_SPEED,
      color: shooter.color,
      trail: [],
    };
    shots += 1;
    return { ok: true };
  }

  function nearestHit(x, y) {
    let best = null;
    let bestD = COLLIDE_DIST;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (!cell) continue;
        const dx = cellX(r, c, phase) - x;
        const dy = cellY(r) - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) {
          bestD = d;
          best = cell;
        }
      }
    }
    return best;
  }

  /** 泡泡停下：吸附 → 消同色 → 坠悬空 → 清台/落行 → 判负 → 补充发射色 */
  function settleShot(x, y, hit) {
    const color = flying.color;
    flying.active = false;

    const target = pickSnap(x, y, hit);
    if (target) {
      const [r, c] = target;
      ensureRow(r);
      grid[r][c] = makeCell(r, c, color);

      const cluster = sameColor(r, c);
      if (cluster.length >= 3) {
        combo += 1;
        if (combo > maxCombo) maxCombo = combo;
        for (const cell of cluster) grid[cell.r][cell.c] = null;
        const falls = floating();
        for (const cell of falls) grid[cell.r][cell.c] = null;
        pops += cluster.length;
        dropped += falls.length;
        score += (cluster.length * POP_SCORE + falls.length * DROP_SCORE) * combo;
      } else {
        combo = 0;
      }
    } else {
      // 极端拥挤下没有可吸附的格子：这一发空放，连消中断
      combo = 0;
    }

    if (countBubbles() === 0) {
      // 清台：奖励 + 重发新盘，本局继续
      solved = true;
      clears += 1;
      score += CLEAR_BONUS;
      dealBoard();
    } else if (autoDrop && !danger()) {
      const rows = dropsForShot();
      for (let i = 0; i < rows; i++) {
        dropNewRow();
        if (danger()) break;
      }
    }

    danger();
    shooter.color = shooter.nextColor;
    shooter.nextColor = pickShotColor();
  }

  function moveFlying(dt) {
    const speed = Math.hypot(flying.vx, flying.vy) || BUBBLE_SPEED;
    const dist = speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 5));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (!flying.active) return;
      flying.x += flying.vx * h;
      flying.y += flying.vy * h;

      // 左右墙镜像反射
      if (flying.x - R < FIELD_L) {
        flying.x = FIELD_L + R;
        flying.vx = Math.abs(flying.vx);
      } else if (flying.x + R > FIELD_R) {
        flying.x = FIELD_R - R;
        flying.vx = -Math.abs(flying.vx);
      }

      // 顶棚
      if (flying.y - R <= FIELD_TOP) {
        flying.y = FIELD_TOP + R;
        settleShot(flying.x, flying.y, null);
        return;
      }

      const hit = nearestHit(flying.x, flying.y);
      if (hit) {
        settleShot(flying.x, flying.y, hit);
        return;
      }
    }

    flying.trail.push({ x: flying.x, y: flying.y });
    if (flying.trail.length > 10) flying.trail.shift();
  }

  function advance(actions) {
    let dir = 0;
    for (const a of actions) {
      if (a === 'left') dir -= 1;
      else if (a === 'right') dir += 1;
    }
    if (dir !== 0) {
      shooter.angle = clamp(shooter.angle + dir * ANGLE_SPEED * STEP, -MAX_ANGLE, MAX_ANGLE);
    }
    if (flying.active) moveFlying(STEP);
  }

  function step(dt, actions = []) {
    if (over) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    acc += Math.min(dt, 0.25);
    let n = 0;
    while (acc >= STEP && n < MAX_SUBSTEPS && !over) {
      acc -= STEP;
      advance(Array.isArray(actions) ? actions : []);
      n += 1;
    }
  }

  function submit(playerId, action) {
    if (typeof action !== 'string' || !action) return { ok: false, error: '无效动作' };
    if (over) return { ok: false, error: '本局已结束' };
    if (action === 'shoot') return shoot();
    if (action === 'start') {
      // 首次触碰/重新对中：把炮口转回正上方（不动局面）
      shooter.angle = 0;
      return { ok: true };
    }
    if (action.startsWith('aim:')) {
      const raw = action.slice(4);
      if (!raw) return { ok: false, error: '无效角度' };
      const deg = Number(raw);
      if (!Number.isFinite(deg)) return { ok: false, error: '无效角度' };
      shooter.angle = clamp(deg, -MAX_ANGLE, MAX_ANGLE);
      return { ok: true };
    }
    return { ok: false, error: '未知动作' };
  }

  function state() {
    return {
      turn: 'p1',
      w: W,
      h: H,
      cols: COLS,
      rows: grid.length,
      grid: grid.map((row) =>
        row.map((cell) => (cell ? { id: cell.id, r: cell.r, c: cell.c, color: cell.color } : null))
      ),
      phase,
      shooter: { angle: shooter.angle, color: shooter.color, nextColor: shooter.nextColor },
      flying: {
        active: flying.active,
        x: flying.x,
        y: flying.y,
        vx: flying.vx,
        vy: flying.vy,
        color: flying.color,
        trail: flying.trail.map((p) => ({ x: p.x, y: p.y })),
      },
      score,
      combo,
      maxCombo,
      dropRows,
      colors: colorCount(),
      pops,
      dropped,
      clears,
      shots,
      solved,
      over,
      dangerRow: DANGER_ROW,
      playerLineY: PLAYER_LINE_Y,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `得分 ${score} · 最高连消 ×${maxCombo} · 落行 ${dropRows} 行`,
    };
  }

  /**
   * 单测专用钩子：摆确定局面。全部是纯数据写入，不引入 DOM / 随机 / 时间源。
   * autoDrop=false 可关掉落行，便于断言「只发生消除」的干净场景。
   */
  function debugSet({ grid: rows, shooter: sh, flying: f, score: sc, combo: cb, over: ov, solved: sv, autoDrop: ad } = {}) {
    if (rows !== undefined) setGrid(rows);
    if (sh) Object.assign(shooter, sh);
    if (f) {
      flying.active = f.active === undefined ? true : Boolean(f.active);
      if (f.x !== undefined) flying.x = f.x;
      if (f.y !== undefined) flying.y = f.y;
      if (f.vx !== undefined) flying.vx = f.vx;
      if (f.vy !== undefined) flying.vy = f.vy;
      flying.color = f.color === undefined ? shooter.color : f.color;
      flying.trail = [];
    }
    if (sc !== undefined) score = sc;
    if (cb !== undefined) combo = cb;
    if (ov !== undefined) over = Boolean(ov);
    if (sv !== undefined) solved = Boolean(sv);
    if (ad !== undefined) autoDrop = Boolean(ad);
  }

  reset();

  return { submit, step, state, result, reset, debugSet };
}
