/**
 * 坦克战场 · 纯逻辑（无 DOM / 无真随机 / 无系统时钟）。
 *
 * 第一性原则（先定事实，再定实现）：
 * 1) 阵地是 13×13 的离散格：坦克占整格，只能整格移动；格子尺寸 36 px 是渲染与
 *    子弹坐标的统一尺度（13×36 = 468，正好放进 480 宽的画布）。
 * 2) 「转向」与「前进」是两种不同的意图：转向只改车头方向、本子步不位移；
 *    前进（当前方向 != 输入方向时先转）只有目标格可通行才落格。因此格子级碰撞
 *    就足以表达 AABB 语义：坦克的 AABB 恰是格矩形，查目标格即可，不需要滑动求解。
 * 3) 子弹是连续量（px/s），用 1/60 固定子步 + 逐子步推进，5 px/步 < 36 px 格宽，
 *    不会穿墙；用「弹头前缘」所在格判地形，子弹挨到墙就死，视觉上才不穿模。
 * 4) 唯一随机源 createRng(seed)：敌军出生点、兵种、AI 转向节奏、开火间隔抖动。
 *    同种子 + 同输入 = 同结果，联机服务端与单机回放共用这一条。
 * 5) 玩家与敌军的差别只在「意图来源」：玩家意图来自 step(dt, actions)/submit，
 *    敌军意图来自确定性 AI 计时器；弹道、伤害、计分完全同一套代码。
 *
 * 规则常量见下方导出：0.4 s 冷却、钢墙挡弹、砖墙逐格炸毁、水挡车不挡弹、
 * 出生 2 s 无敌、3 条命、每辆敌车 +100、敌我子弹相撞互消。
 */
import { createRng } from '../../shared/rng.js';

export const COLS = 13;
export const ROWS = 13;
export const CELL = 36;
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;

export const STEP = 1 / 60;        // 固定子步（逻辑不依赖真实帧率）
export const MOVE_INTERVAL = 0.11; // 每格推进所需时间
export const BULLET_COOLDOWN = 0.4;
export const BULLET_SPEED = 300;   // px/s
export const BULLET_R = 3;
export const INVULN_TIME = 2;      // 出生/复活无敌
export const PULSE_TIME = 0.22;    // 点按/滑动一次的持续推进窗口
export const SPAWN_GAP = 1.2;      // 敌军补位间隔
export const MAX_ACTIVE = 3;       // 同屏最多 3 辆敌军
export const MAX_BULLETS = 48;
export const MAX_LIVES = 3;
export const MAX_SUBSTEPS = 16;    // 单次 step 最多补 16 个子步（覆盖 0.25 s 上限）

/** 初始阵地：#钢墙、%砖墙、~水、空格可通行。上下对称，出生点均为空格。 */
export const MAZE = [
  '#############',
  '#           #',
  '# %% % %% % #',
  '# %       % #',
  '#   %%%%%   #',
  '# %  ~~   % #',
  '# %  ~~   % #',
  '#   %%%%%   #',
  '# %       % #',
  '# %% % %% % #',
  '#           #',
  '#           #',
  '#############',
];

const DIRS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const DIR_NAMES = ['up', 'right', 'down', 'left'];
const PLAYER_SPAWNS = {
  p1: { x: 6, y: 11 },
  p2: { x: 4, y: 11 },
};
const ENEMY_SPAWNS = [
  { x: 1, y: 1 },
  { x: 6, y: 1 },
  { x: 11, y: 1 },
];
/** 敌军兵种：移动/开火节奏不同，行为仍是「随机转向 + 前进 + 定时开火」。 */
const TYPE_META = {
  grunt: { moveInterval: 0.26, fireInterval: 1.9 },
  swift: { moveInterval: 0.16, fireInterval: 2.4 },
  gunner: { moveInterval: 0.3, fireInterval: 1.25 },
};
const TYPE_NAMES = Object.keys(TYPE_META);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * 行动词归一化：字符串或联机服务端下发的 {seat, action} 都接受。
 * - p1left / p2shoot 这类带座位前缀的词只在本机双人使用（服务端白名单不放行，
 *   所以前缀永远代表本地意图，不存在伪造对手座位的通道）；
 * - 带 seat 的裸词以 seat 为准（联机鉴权），无 seat 时归 p1（单/人机/本地双人默认）。
 */
function readAction(a) {
  let seat = null;
  let token = a;
  if (a && typeof a === 'object') {
    seat = a.seat === 'p1' || a.seat === 'p2' ? a.seat : null;
    token = a.action;
  }
  if (typeof token !== 'string') return null;

  const prefixed = /^(p[12])(left|right|up|down|shoot)$/.exec(token);
  if (prefixed) {
    return {
      owner: prefixed[1],
      dir: prefixed[2] === 'shoot' ? null : prefixed[2],
      fire: prefixed[2] === 'shoot',
    };
  }
  if (DIRS[token]) return { owner: seat, dir: token, fire: false };
  if (token === 'shoot' || token === 'action' || token === 'action2') {
    return { owner: seat, dir: null, fire: true };
  }
  return null;
}

export function createGame({ seed = 1, mode = 'solo', level = 1 } = {}) {
  const safeMode = ['solo', 'ai', 'local2p', 'online'].includes(mode) ? mode : 'solo';
  const dual = safeMode === 'local2p' || safeMode === 'online';
  const hardMode = safeMode === 'ai';
  const lv = clamp(Math.floor(Number(level) || 1), 1, 9);
  // 「3～6 辆」：第 1 关 3 辆，逐关 +1，封顶 6 辆
  const totalEnemies = clamp(3 + (lv - 1), 3, 6);

  let rng = createRng(seed);
  let maze = [];
  let tanks = [];
  let enemies = [];
  let bullets = [];
  let effects = [];
  let enemyQueue = 0;
  let enemyId = 1;
  let score = 0;
  let lives = MAX_LIVES;
  let over = false;
  let solved = false;
  let acc = 0;
  let ticks = 0;
  let spawnTimer = 0;
  let spawnPaused = false;

  /* ── 构造与重置 ───────────────────────────────────────── */

  function makePlayer(id) {
    const s = PLAYER_SPAWNS[id];
    return {
      id,
      kind: 'player',
      x: s.x,
      y: s.y,
      dir: 'up',
      cooldown: 0,
      invuln: INVULN_TIME,
      moveTimer: 0,
      pulse: 0,
      pulseDir: null,
      wantFire: false,
    };
  }

  function makeEnemy(data, i) {
    const type = TYPE_META[data.type] ? data.type : 'grunt';
    const meta = TYPE_META[type];
    return {
      id: data.id || `e${i + 1}`,
      kind: 'enemy',
      type,
      x: data.x | 0,
      y: data.y | 0,
      dir: DIRS[data.dir] ? data.dir : 'down',
      cooldown: Number(data.cooldown) || 0,
      invuln: 0,
      moveTimer: 0,
      pulse: 0,
      pulseDir: null,
      wantFire: false,
      aiTimer: Number.isFinite(data.aiTimer) ? data.aiTimer : rng.range(0.3, 0.9),
      fireTimer: Number.isFinite(data.fireTimer) ? data.fireTimer : rng.range(0.6, 1.8),
      moveInterval: meta.moveInterval * (hardMode ? 0.85 : 1),
      fireInterval: meta.fireInterval * (hardMode ? 0.75 : 1),
    };
  }

  function reset() {
    rng = createRng(seed);
    maze = MAZE.map((row) => row.split(''));
    tanks = dual ? [makePlayer('p1'), makePlayer('p2')] : [makePlayer('p1')];
    enemies = [];
    bullets = [];
    effects = [];
    enemyQueue = totalEnemies;
    enemyId = 1;
    score = 0;
    lives = MAX_LIVES;
    over = false;
    solved = false;
    acc = 0;
    ticks = 0;
    spawnTimer = 0;
    spawnPaused = false;
    // 开局就把同屏上限内的敌军放出来；超出的排队补位
    while (enemies.length < MAX_ACTIVE && enemyQueue > 0) {
      if (!spawnEnemy()) break;
    }
  }

  /* ── 查询 ─────────────────────────────────────────────── */

  function tankById(id) {
    return tanks.find((t) => t.id === id) || null;
  }

  function tankAt(x, y, except) {
    for (const t of tanks) {
      if (t !== except && t.x === x && t.y === y) return t;
    }
    for (const e of enemies) {
      if (e !== except && e.x === x && e.y === y) return e;
    }
    return null;
  }

  function terrainBlocked(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
    const ch = maze[y][x];
    return ch === '#' || ch === '%' || ch === '~';
  }

  function canStep(t, dirName) {
    const d = DIRS[dirName];
    if (!d) return false;
    const nx = t.x + d.x;
    const ny = t.y + d.y;
    return !terrainBlocked(nx, ny) && !tankAt(nx, ny, t);
  }

  function tryMove(t) {
    const d = DIRS[t.dir];
    const nx = t.x + d.x;
    const ny = t.y + d.y;
    if (terrainBlocked(nx, ny) || tankAt(nx, ny, t)) {
      t.moveTimer = 0;
      return false;
    }
    t.x = nx;
    t.y = ny;
    return true;
  }

  /* ── 效果与发射 ───────────────────────────────────────── */

  function pushEffect(kind, x, y, life = 0.6) {
    effects.push({ kind, x, y, age: 0, life });
    if (effects.length > 60) effects.shift();
  }

  function fire(t) {
    if (t.cooldown > 0) return false;
    if (bullets.length >= MAX_BULLETS) return false;
    const d = DIRS[t.dir];
    bullets.push({
      // 起点放到本格边缘外 4 px，避免出生瞬间和自身 AABB 重叠
      x: (t.x + 0.5) * CELL + d.x * (CELL / 2 + 4),
      y: (t.y + 0.5) * CELL + d.y * (CELL / 2 + 4),
      vx: d.x * BULLET_SPEED,
      vy: d.y * BULLET_SPEED,
      owner: t.id,
      side: t.kind === 'enemy' ? 'enemy' : 'player',
      age: 0,
      dead: false,
    });
    t.cooldown = BULLET_COOLDOWN;
    return true;
  }

  /* ── 敌军 AI（确定性） ───────────────────────────────── */

  function spawnEnemy() {
    if (enemyQueue <= 0 || enemies.length >= MAX_ACTIVE) return false;
    const free = ENEMY_SPAWNS.filter((s) => !tankAt(s.x, s.y, null));
    if (!free.length) return false;
    // 测试摆场景可能占用 eN 编号，出生时跳过已用 id，保证 owner 唯一
    while (enemies.some((e) => e.id === `e${enemyId}`)) enemyId += 1;
    const spot = rng.pick(free);
    const type = rng.pick(TYPE_NAMES);
    enemies.push(makeEnemy({ x: spot.x, y: spot.y, dir: 'down', type }, enemyId - 1));
    enemyId += 1;
    enemyQueue -= 1;
    return true;
  }

  function chooseEnemyDir(e) {
    const open = DIR_NAMES.filter((n) => canStep(e, n));
    e.aiTimer = rng.range(0.45, 1.35);
    if (!open.length) return;
    if (open.includes(e.dir) && rng.chance(0.45)) return; // 继续前进
    if (open.includes(e.dir) && rng.chance(0.2)) return;  // 原地停一拍
    const next = rng.pick(open);
    if (next !== e.dir) {
      e.dir = next;
      e.moveTimer = 0;
    }
  }

  function updateEnemy(e, dt) {
    e.cooldown = Math.max(0, e.cooldown - dt);
    e.aiTimer -= dt;
    e.fireTimer -= dt;
    e.moveTimer += dt;

    if (e.aiTimer <= 0) chooseEnemyDir(e);

    if (e.moveTimer + 1e-9 >= e.moveInterval) {
      e.moveTimer -= e.moveInterval;
      if (!tryMove(e)) e.moveTimer = 0;
    }

    if (e.fireTimer <= 0) {
      fire(e);
      e.fireTimer = e.fireInterval * rng.range(0.8, 1.25);
    }
  }

  /* ── 玩家坦克 ─────────────────────────────────────────── */

  function updatePlayer(t, dt, wantDir, wantFire) {
    t.cooldown = Math.max(0, t.cooldown - dt);
    t.invuln = Math.max(0, t.invuln - dt);
    if (wantFire) t.wantFire = true;

    let dir = wantDir;
    if (wantDir) {
      t.pulse = 0;
      t.pulseDir = null;
    } else if (t.pulse > 0) {
      t.pulse -= dt;
      if (t.pulse <= 0) {
        t.pulse = 0;
        t.pulseDir = null;
      } else {
        dir = t.pulseDir;
      }
    }

    if (dir) {
      if (t.dir !== dir) {
        // 转向只改车头，本子步不位移
        t.dir = dir;
        t.moveTimer = 0;
        t.pulse = 0;
        t.pulseDir = null;
      } else {
        t.moveTimer += dt;
        if (t.moveTimer + 1e-9 >= MOVE_INTERVAL) {
          t.moveTimer -= MOVE_INTERVAL;
          if (!tryMove(t)) t.moveTimer = 0;
        }
      }
    } else {
      t.moveTimer = 0;
    }

    if (t.wantFire) {
      t.wantFire = false;
      fire(t);
    }
  }

  /* ── 子弹 ─────────────────────────────────────────────── */

  function hitTank(b, t) {
    const x0 = t.x * CELL;
    const y0 = t.y * CELL;
    return (
      b.x + BULLET_R > x0 &&
      b.x - BULLET_R < x0 + CELL &&
      b.y + BULLET_R > y0 &&
      b.y - BULLET_R < y0 + CELL
    );
  }

  function killEnemy(e) {
    const i = enemies.indexOf(e);
    if (i < 0) return;
    enemies.splice(i, 1);
    score += 100;
    pushEffect('boom', (e.x + 0.5) * CELL, (e.y + 0.5) * CELL, 0.65);
    if (enemyQueue > 0 && spawnTimer <= 0) spawnTimer = 0.6;
  }

  function respawn(t) {
    const s = PLAYER_SPAWNS[t.id] || PLAYER_SPAWNS.p1;
    t.x = s.x;
    t.y = s.y;
    t.dir = 'up';
    t.cooldown = 0;
    t.invuln = INVULN_TIME;
    t.moveTimer = 0;
    t.pulse = 0;
    t.pulseDir = null;
    t.wantFire = false;
  }

  function hitPlayer(t, b) {
    if (t.invuln > 0) {
      pushEffect('spark', b.x, b.y, 0.35);
      return;
    }
    pushEffect('boom', (t.x + 0.5) * CELL, (t.y + 0.5) * CELL, 0.65);
    lives -= 1;
    if (lives <= 0) {
      lives = 0;
      over = true;
      solved = false;
      return;
    }
    respawn(t);
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.age += dt;
    }

    // 敌我子弹相撞：同边不消，异边同时消失
    for (let i = 0; i < bullets.length; i++) {
      const a = bullets[i];
      if (a.dead) continue;
      for (let j = i + 1; j < bullets.length; j++) {
        const c = bullets[j];
        if (c.dead || a.side === c.side) continue;
        if (Math.abs(a.x - c.x) <= BULLET_R * 2 && Math.abs(a.y - c.y) <= BULLET_R * 2) {
          a.dead = true;
          c.dead = true;
          pushEffect('spark', (a.x + c.x) / 2, (a.y + c.y) / 2, 0.4);
          break;
        }
      }
    }

    for (const b of bullets) {
      if (b.dead) continue;
      if (b.age > 4) {
        b.dead = true;
        continue;
      }

      // 弹头前缘所在格：挨到格子边界就算命中，避免视觉穿墙
      const ex = b.x + (b.vx > 0 ? BULLET_R : b.vx < 0 ? -BULLET_R : 0);
      const ey = b.y + (b.vy > 0 ? BULLET_R : b.vy < 0 ? -BULLET_R : 0);
      const cx = Math.floor(ex / CELL);
      const cy = Math.floor(ey / CELL);

      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) {
        b.dead = true;
        continue;
      }

      const ch = maze[cy][cx];
      if (ch === '#') {
        // 钢墙挡弹：子弹消失，墙不动
        b.dead = true;
        pushEffect('spark', ex, ey, 0.35);
        continue;
      }
      if (ch === '%') {
        // 砖墙逐格炸毁：一格一弹
        maze[cy][cx] = ' ';
        b.dead = true;
        pushEffect('boom', (cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.5);
        continue;
      }
      if (ch === '~') continue; // 子弹掠水而过

      if (b.side === 'player') {
        const target = enemies.find((e) => e.id !== b.owner && hitTank(b, e));
        if (target) {
          b.dead = true;
          killEnemy(target);
        }
      } else {
        const target = tanks.find((t) => t.id !== b.owner && hitTank(b, t));
        if (target) {
          b.dead = true;
          hitPlayer(target, b);
        }
      }
    }

    bullets = bullets.filter((b) => !b.dead);
  }

  function ageEffects(dt) {
    for (const e of effects) e.age += dt;
    effects = effects.filter((e) => e.age < e.life);
  }

  /* ── 一步 ─────────────────────────────────────────────── */

  function collectInputs(actions) {
    const wantDir = new Map();
    const wantFire = new Set();
    const list = Array.isArray(actions) ? actions : [];
    for (const a of list) {
      const p = readAction(a);
      if (!p) continue;
      const id = p.owner || 'p1';
      if (!tankById(id)) continue;
      if (p.dir) wantDir.set(id, p.dir);
      if (p.fire) wantFire.add(id);
    }
    return { wantDir, wantFire };
  }

  function substep(dt, actions) {
    ticks += 1;

    spawnTimer = Math.max(0, spawnTimer - dt);
    if (!spawnPaused && spawnTimer <= 0 && enemyQueue > 0 && enemies.length < MAX_ACTIVE) {
      if (spawnEnemy()) spawnTimer = SPAWN_GAP;
    }

    const { wantDir, wantFire } = collectInputs(actions);
    for (const t of tanks) {
      updatePlayer(t, dt, wantDir.get(t.id) || null, wantFire.has(t.id));
    }
    for (const e of enemies) updateEnemy(e, dt);

    updateBullets(dt);
    ageEffects(dt);

    if (!over && enemyQueue <= 0 && enemies.length === 0) {
      over = true;
      solved = true;
    }
  }

  function step(dt, actions = []) {
    if (over) return;
    const delta = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    if (!delta) return;
    acc += delta;
    let guard = 0;
    while (acc + 1e-9 >= STEP && guard < MAX_SUBSTEPS && !over) {
      acc -= STEP;
      if (acc < 0) acc = 0;
      substep(STEP, actions);
      guard += 1;
    }
  }

  /* ── 意图提交（离线 / 联机服务端共用） ───────────────── */

  function submit(playerId, action) {
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };
    if (action === 'start') return { ok: true }; // 实时制：step 一开始就在推进

    const seat = playerId === 'p2' ? 'p2' : 'p1';
    const parsed = readAction({ seat, action });
    if (!parsed) return { ok: false, error: `无效动作: ${action}` };
    if (over) return { ok: false, error: '本局已结束' };

    const t = tankById(parsed.owner || seat);
    if (!t) return { ok: false, error: '该座位没有坦克' };

    if (parsed.dir) {
      // 立刻转向（手感），位移交给 step 的计时器
      t.dir = parsed.dir;
      t.moveTimer = 0;
      t.pulse = PULSE_TIME;
      t.pulseDir = parsed.dir;
    }
    if (parsed.fire) t.wantFire = true;
    return { ok: true };
  }

  /* ── 快照 / 结算 ──────────────────────────────────────── */

  function snapTank(t) {
    return {
      x: t.x,
      y: t.y,
      dir: t.dir,
      cooldown: t.cooldown,
      invuln: t.invuln,
    };
  }

  function state() {
    return {
      turn: 'p1',
      maze: maze.map((row) => row.join('')),
      player: snapTank(tanks[0]),
      player2: tanks[1] ? snapTank(tanks[1]) : null,
      enemies: enemies.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        dir: e.dir,
        cooldown: e.cooldown,
        invuln: e.invuln,
        type: e.type,
      })),
      bullets: bullets.map((b) => ({
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        owner: b.owner,
        side: b.side,
      })),
      effects: effects.map((e) => ({
        x: e.x,
        y: e.y,
        kind: e.kind,
        age: e.age,
        life: e.life,
      })),
      score,
      lives,
      level: lv,
      over,
      solved,
      remaining: enemies.length + enemyQueue,
      total: totalEnemies,
      ticks,
      cols: COLS,
      rows: ROWS,
      cell: CELL,
      mode: safeMode,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: solved ? 'p1' : null,
      title: solved ? '过关！' : '游戏结束',
      score,
      scores: { p1: score },
      text: solved
        ? `击毁全部敌军 · 得分 ${score}`
        : `生命耗尽 · 击毁 ${score / 100} 辆 · 得分 ${score}`,
    };
  }

  /* ── 仅测试用：摆场景（不参与正常玩法路径） ───────────── */

  function debugSetCell(x, y, ch) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    maze[y][x] = ch;
    return true;
  }

  function debugSetPlayer(id, patch = {}) {
    const t = tankById(id || 'p1');
    if (!t) return false;
    if (Number.isFinite(patch.x)) t.x = patch.x | 0;
    if (Number.isFinite(patch.y)) t.y = patch.y | 0;
    if (DIRS[patch.dir]) t.dir = patch.dir;
    if (Number.isFinite(patch.cooldown)) t.cooldown = patch.cooldown;
    if (Number.isFinite(patch.invuln)) t.invuln = patch.invuln;
    t.moveTimer = 0;
    t.pulse = 0;
    t.pulseDir = null;
    return true;
  }

  function debugSetEnemies(list, queue = 0) {
    enemies = (Array.isArray(list) ? list : []).map((e, i) => makeEnemy(
      { ...e, aiTimer: Number.isFinite(e.aiTimer) ? e.aiTimer : 999, fireTimer: Number.isFinite(e.fireTimer) ? e.fireTimer : 999 },
      i
    ));
    enemyQueue = Math.max(0, queue | 0);
    spawnTimer = enemyQueue > 0 ? SPAWN_GAP : 0;
    return enemies.length;
  }

  function debugAddBullet(b = {}) {
    const owner = typeof b.owner === 'string' ? b.owner : 'e1';
    bullets.push({
      x: Number(b.x) || 0,
      y: Number(b.y) || 0,
      vx: Number(b.vx) || 0,
      vy: Number(b.vy) || 0,
      owner,
      side: b.side || (owner === 'p1' || owner === 'p2' ? 'player' : 'enemy'),
      age: 0,
      dead: false,
    });
    return bullets.length;
  }

  function debugClearBullets() {
    bullets = [];
  }

  function debugSetLives(n) {
    lives = Math.max(0, n | 0);
    return lives;
  }

  function debugClearEnemies() {
    enemies = [];
    enemyQueue = 0;
    spawnTimer = 0;
  }

  function debugPauseSpawn(v = true) {
    spawnPaused = Boolean(v);
    return spawnPaused;
  }

  reset();

  return {
    submit,
    step,
    state,
    result,
    reset,
    debugSetCell,
    debugSetPlayer,
    debugSetEnemies,
    debugAddBullet,
    debugClearBullets,
    debugSetLives,
    debugClearEnemies,
    debugPauseSpawn,
  };
}
