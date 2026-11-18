/**
 * 爆破迷宫 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 事实与推导：
 * - 地图 13×11 字符串：# 钢墙（不可破、挡火）、+ 砖墙（可破、藏道具）、空格通道。
 *   底板由钢柱构成规整迷宫；每关按固定数量随机铺砖，密度随关卡上升（砖更多）。
 * - 移动：逻辑格 + 连续坐标。玩家在格中心之间按 speed 格/秒线性推进，
 *   出发前做格子碰撞（钢墙/砖墙/炸弹），因此坐标连续但永不穿墙；
 *   转弯只在格中心生效，撞墙立即停住（不需要惯性）。
 * - 炸弹：2 s 引信，十字射程 power（初始 3）；钢墙止火、砖墙被炸毁并止火，
 *   命中另一颗炸弹立即连锁引爆；爆炸后火焰存在 FLAME_TIME 秒。
 *   自己刚放的炸弹在 0.8 s 内可穿过（放置后立刻离开也不会被卡住）。
 * - 道具藏在砖后：砖被炸毁时按概率掉落，类型为炸弹数/射程/速度。
 * - 敌人 2～4 只：巡逻随机转向，玩家在警戒范围内按概率走 BFS 最短路追击；
 *   接触玩家扣命；炸弹对敌人是障碍；被火焰命中即消失。
 * - 生命 3 条；被火焰或敌人扣命，复活回出生点并获得短暂无敌，已放炸弹清空。
 *   全部敌人清空即过关，短暂结算后进入下一关（砖更多、敌人更多更快）。
 * - 所有随机来自 createRng(seed)，同种子同回放。
 */
import { createRng } from '../../shared/rng.js';

export const COLS = 13;
export const ROWS = 11;
export const TICK = 1 / 60;
export const BOMB_FUSE = 2;
export const FLAME_TIME = 0.45;
export const BOMB_PASS_TIME = 0.8;
export const INVULN_TIME = 2;
export const BASE_SPEED = 3.2;
export const MAX_SPEED = 4.6;
export const BASE_POWER = 3;
export const MAX_POWER = 6;
export const MAX_BOMBS = 3;
export const CLEAR_DELAY = 1.2;
export const ITEM_CHANCE = 0.3;
export const START = { x: 1, y: 1 };

/** 底板：外围钢墙 + 均匀钢柱（13×11） */
export const BASE_MAZE = [
  '#############',
  '#           #',
  '# # # # # # #',
  '#           #',
  '# # # # # # #',
  '#           #',
  '# # # # # # #',
  '#           #',
  '# # # # # # #',
  '#           #',
  '#############',
];

const DIRS = {
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
};
const DIR_NAMES = ['up', 'left', 'down', 'right'];
const DIR_LIST = DIR_NAMES.map((n) => DIRS[n]);

function dirName(d) {
  if (!d) return null;
  return DIR_NAMES.find((n) => DIRS[n].x === d.x && DIRS[n].y === d.y) || null;
}

function isOpposite(a, b) {
  return Boolean(a && b && a.x + b.x === 0 && a.y + b.y === 0);
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

export function createGame({ seed = 1, mode = 'solo', level = 1 } = {}) {
  const startLevel = Math.max(1, Math.floor(Number(level) || 1));

  let rng = createRng(seed);
  let grid; // char[ROWS][COLS]
  let player; // 玩家（格坐标 + 段内插值）
  let enemies; // 敌人
  let bombs;
  let flames;
  let items;
  let score;
  let lives;
  let levelNo;
  let bombUp; // 道具增加的炸弹上限
  let over;
  let solved;
  let solvedTimer;
  let started;
  let acc;
  let ticks;
  let enemySeq;

  /* ── 地图 ───────────────────────────────────────────── */

  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  function tileAt(x, y) {
    if (!inBounds(x, y)) return '#';
    return grid[y][x];
  }

  /** 可通行（只看地形） */
  function floorAt(x, y) {
    const ch = tileAt(x, y);
    return ch !== '#' && ch !== '+';
  }

  function bombAt(x, y) {
    return bombs.find((b) => b.x === x && b.y === y) || null;
  }

  /** 出发进入 (x,y) 是否允许；who = 'player' | 'enemy' */
  function canWalk(x, y, who) {
    if (!floorAt(x, y)) return false;
    const b = bombAt(x, y);
    if (!b) return true;
    if (who === 'player' && b.owner === 'p1' && b.passTimer > 0) return true;
    return false;
  }

  /** 从起点按地形 BFS 距离（砖/钢都不可走） */
  function bfsDist(sx, sy) {
    const dist = Array.from({ length: ROWS }, () => new Array(COLS).fill(Infinity));
    if (!floorAt(sx, sy)) return dist;
    dist[sy][sx] = 0;
    const queue = [[sx, sy]];
    for (let head = 0; head < queue.length; head++) {
      const [x, y] = queue[head];
      for (const d of DIR_LIST) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!floorAt(nx, ny) || dist[ny][nx] !== Infinity) continue;
        dist[ny][nx] = dist[y][x] + 1;
        queue.push([nx, ny]);
      }
    }
    return dist;
  }

  /* ── 关卡 ───────────────────────────────────────────── */

  function brickDensity() {
    return Math.min(0.55, 0.24 + 0.05 * (levelNo - 1));
  }

  /**
   * 所有空格是否仍从出生点连通。
   * 这张地图是玩家与敌人共同的活动范围，砖墙不能把任何一格封死：
   * 封死会让敌人刷在孤岛、道具永远吃不到，也会让“砖更多”变成“路更少”。
   */
  function allFloorConnected() {
    const seen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
    let floor = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] === ' ' || grid[y][x] === 'o') floor += 1;
      }
    }
    if (!floorAt(START.x, START.y)) return false;
    seen[START.y][START.x] = true;
    const queue = [[START.x, START.y]];
    let reached = 1;
    for (let head = 0; head < queue.length; head++) {
      const [x, y] = queue[head];
      for (const d of DIR_LIST) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny) || seen[ny][nx]) continue;
        if (!floorAt(nx, ny)) continue;
        seen[ny][nx] = true;
        reached += 1;
        queue.push([nx, ny]);
      }
    }
    return reached === floor;
  }

  function enemyInterval() {
    return Math.max(0.26, 0.62 - 0.045 * (levelNo - 1));
  }

  function enemyCount() {
    return Math.min(4, 1 + levelNo);
  }

  function buildLevel() {
    grid = BASE_MAZE.map((row) => row.split(''));

    // 固定数量铺砖（随机取格），保证密度随关卡严格上升
    const cells = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (grid[y][x] !== ' ') continue;
        if (Math.abs(x - START.x) + Math.abs(y - START.y) <= 2) continue; // 出生区留空
        cells.push({ x, y });
      }
    }
    const want = Math.min(cells.length, Math.round(cells.length * brickDensity()));
    let placed = 0;
    for (const c of rng.shuffle(cells)) {
      if (placed >= want) break;
      grid[c.y][c.x] = '+';
      // 逐格试放：会切断地图的砖不放，保证全图连通
      if (!allFloorConnected()) {
        grid[c.y][c.x] = ' ';
        continue;
      }
      placed += 1;
    }

    spawnPlayer();
    bombs = [];
    flames = [];
    items = [];
    syncBombCap();
    spawnEnemies();
  }

  function spawnPlayer() {
    player = {
      cx: START.x,
      cy: START.y,
      tx: START.x,
      ty: START.y,
      moving: false,
      t: 0,
      dir: { ...DIRS.down },
      power: player ? player.power : BASE_POWER,
      speed: player ? player.speed : BASE_SPEED,
      invuln: 0,
    };
  }

  function spawnEnemies() {
    const dist = bfsDist(START.x, START.y);
    const far = [];
    const near = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (!floorAt(x, y)) continue;
        if (x === START.x && y === START.y) continue;
        if (dist[y][x] === Infinity) continue;
        if (dist[y][x] >= 7) far.push({ x, y });
        near.push({ x, y });
      }
    }
    let pool = rng.shuffle(far);
    if (pool.length < enemyCount()) pool = pool.concat(rng.shuffle(near));
    const interval = enemyInterval();
    enemies = [];
    for (let i = 0; i < enemyCount() && i < pool.length; i++) {
      const cell = pool[i];
      enemies.push({
        id: `e${++enemySeq}`,
        cx: cell.x,
        cy: cell.y,
        tx: cell.x,
        ty: cell.y,
        moving: false,
        dir: rng.pick(DIR_LIST),
        interval,
        timer: interval * (0.3 + 0.7 * rng.next()),
      });
    }
  }

  function advanceLevel() {
    levelNo += 1;
    solved = false;
    solvedTimer = 0;
    buildLevel();
    player.invuln = 1.5;
    started = true;
  }

  /* ── 位置 ───────────────────────────────────────────── */

  function playerPos() {
    if (!player.moving) return { x: player.cx + 0.5, y: player.cy + 0.5 };
    return {
      x: player.cx + 0.5 + (player.tx - player.cx) * player.t,
      y: player.cy + 0.5 + (player.ty - player.cy) * player.t,
    };
  }

  function nearestPlayerCell() {
    const p = playerPos();
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  function playerCells() {
    const cells = [{ x: player.cx, y: player.cy }];
    if (player.moving) cells.push({ x: player.tx, y: player.ty });
    return cells;
  }

  function enemyPos(e) {
    if (!e.moving) return { x: e.cx + 0.5, y: e.cy + 0.5 };
    const frac = Math.min(1, Math.max(0, 1 - e.timer / e.interval));
    return {
      x: e.cx + 0.5 + (e.tx - e.cx) * frac,
      y: e.cy + 0.5 + (e.ty - e.cy) * frac,
    };
  }

  function enemyCells(e) {
    const cells = [{ x: e.cx, y: e.cy }];
    if (e.moving) cells.push({ x: e.tx, y: e.ty });
    return cells;
  }

  /* ── 炸弹与火焰 ─────────────────────────────────────── */

  function countOwnBombs() {
    let n = 0;
    for (const b of bombs) if (b.owner === 'p1') n += 1;
    return n;
  }

  function syncBombCap() {
    if (!player) return;
    const byScore = score >= 1500 ? 3 : score >= 500 ? 2 : 1;
    player.maxBombs = Math.max(byScore, Math.min(MAX_BOMBS, 1 + bombUp));
  }

  function placeBomb() {
    if (over) return { ok: false, error: '本局已结束' };
    if (solved) return { ok: false, error: '本关已通过' };
    started = true;
    const cell = nearestPlayerCell();
    if (bombAt(cell.x, cell.y)) return { ok: false, error: '这里已经有炸弹' };
    if (countOwnBombs() >= player.maxBombs) return { ok: false, error: '炸弹用完了' };
    bombs.push({
      x: cell.x,
      y: cell.y,
      timer: BOMB_FUSE,
      power: player.power,
      owner: 'p1',
      passTimer: BOMB_PASS_TIME,
    });
    return { ok: true };
  }

  function addFlame(x, y, dir, tip) {
    const old = flames.find((f) => f.x === x && f.y === y);
    if (old) {
      old.timer = Math.max(old.timer, FLAME_TIME);
      old.dir = old.dir === 'center' ? dir : old.dir;
      old.tip = old.tip || Boolean(tip);
      return;
    }
    flames.push({ x, y, dir, tip: Boolean(tip), timer: FLAME_TIME });
  }

  function pickItemType() {
    const r = rng.next();
    if (r < 0.36) return 'bomb';
    if (r < 0.72) return 'power';
    return 'speed';
  }

  function destroyBrick(x, y) {
    grid[y][x] = ' ';
    score += 10;
    if (rng.chance(ITEM_CHANCE)) items.push({ x, y, type: pickItemType() });
    syncBombCap();
  }

  function detonate(bomb) {
    const idx = bombs.indexOf(bomb);
    if (idx < 0) return;
    bombs.splice(idx, 1);

    const cells = [{ x: bomb.x, y: bomb.y, dir: 'center', tip: true }];
    for (const name of DIR_NAMES) {
      const d = DIRS[name];
      for (let i = 1; i <= bomb.power; i++) {
        const nx = bomb.x + d.x * i;
        const ny = bomb.y + d.y * i;
        if (!inBounds(nx, ny)) break;
        const ch = grid[ny][nx];
        if (ch === '#') break;
        if (ch === '+') {
          destroyBrick(nx, ny);
          cells.push({ x: nx, y: ny, dir: name, tip: true });
          break;
        }
        cells.push({ x: nx, y: ny, dir: name, tip: i === bomb.power });
      }
    }
    for (const c of cells) addFlame(c.x, c.y, c.dir, c.tip);

    // 连锁：被本次十字覆盖的其它炸弹立即引爆
    const chained = bombs.filter((o) => cells.some((c) => c.x === o.x && c.y === o.y));
    for (const o of chained) detonate(o);
  }

  function flameAt(x, y) {
    return flames.some((f) => f.x === x && f.y === y);
  }

  /* ── 玩家 ───────────────────────────────────────────── */

  function readDir(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return null;
    const current = dirName(player.dir);
    if (current && actions.includes(current)) return player.dir;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (DIRS[actions[i]]) return DIRS[actions[i]];
    }
    return null;
  }

  function updatePlayer(dt, actions) {
    let budget = dt;
    let guard = 0;
    while (budget > 1e-9 && guard < 400) {
      guard += 1;
      const req = readDir(actions);
      if (player.moving) {
        // 段内反向：立即调头（回到原格），不必等走完当前格。
        // 调头目标就是刚离开的格子，因此还要按 0.8s 规则重新判定能否进入。
        const sx = player.tx - player.cx;
        const sy = player.ty - player.cy;
        if (req && req.x === -sx && req.y === -sy && canWalk(player.cx, player.cy, 'player')) {
          const ox = player.cx;
          const oy = player.cy;
          player.cx = player.tx;
          player.cy = player.ty;
          player.tx = ox;
          player.ty = oy;
          player.t = 1 - player.t;
          player.dir = { ...req };
        }
      } else {
        if (!req) return;
        player.dir = { ...req };
        const nx = player.cx + req.x;
        const ny = player.cy + req.y;
        if (!canWalk(nx, ny, 'player')) return;
        player.tx = nx;
        player.ty = ny;
        player.moving = true;
        player.t = 0;
      }
      const dur = 1 / player.speed;
      const need = (1 - player.t) * dur;
      if (budget + 1e-9 >= need) {
        budget -= need;
        player.cx = player.tx;
        player.cy = player.ty;
        player.moving = false;
        player.t = 0;
        checkPickup();
      } else {
        player.t += budget / dur;
        budget = 0;
      }
    }
  }

  /* ── 敌人 AI ────────────────────────────────────────── */

  function bfsFirstStep(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return null;
    const prev = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    const seen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
    seen[sy][sx] = true;
    const queue = [[sx, sy]];
    for (let head = 0; head < queue.length; head++) {
      const [x, y] = queue[head];
      for (const d of DIR_LIST) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny) || seen[ny][nx]) continue;
        if (!canWalk(nx, ny, 'enemy')) continue;
        seen[ny][nx] = true;
        prev[ny][nx] = x === sx && y === sy ? d : prev[y][x];
        if (nx === tx && ny === ty) return prev[ny][nx];
        queue.push([nx, ny]);
      }
    }
    return null;
  }

  function chooseEnemyDir(e) {
    const options = DIR_LIST.filter((d) => canWalk(e.cx + d.x, e.cy + d.y, 'enemy'));
    if (!options.length) return e.dir;

    const target = nearestPlayerCell();
    const manhattan = Math.abs(e.cx - target.x) + Math.abs(e.cy - target.y);
    const chaseProb = Math.min(0.9, 0.6 + 0.06 * levelNo);
    if (manhattan <= 8 && rng.chance(chaseProb)) {
      const step = bfsFirstStep(e.cx, e.cy, target.x, target.y);
      if (step) return step;
      // BFS 走不通（玩家被炸弹围住）时按曼哈顿距离贪心
      let best = options[0];
      let bestD = Infinity;
      for (const d of options) {
        const dist = Math.abs(e.cx + d.x - target.x) + Math.abs(e.cy + d.y - target.y);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    }

    // 巡逻：尽量不回头，死路才允许反向
    const forward = options.filter((d) => !isOpposite(d, e.dir));
    return rng.pick(forward.length ? forward : options);
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      e.timer -= dt;
      if (e.timer > 0) continue;
      if (e.moving) {
        e.cx = e.tx;
        e.cy = e.ty;
        e.moving = false;
      }
      const d = chooseEnemyDir(e);
      e.dir = { ...d };
      const nx = e.cx + d.x;
      const ny = e.cy + d.y;
      if (canWalk(nx, ny, 'enemy')) {
        e.tx = nx;
        e.ty = ny;
        e.moving = true;
      }
      e.timer += e.interval;
      if (e.timer <= 0) e.timer = e.interval;
    }
  }

  /* ── 伤害 / 拾取 / 过关 ─────────────────────────────── */

  function loseLife() {
    lives -= 1;
    bombs = [];
    player.moving = false;
    player.t = 0;
    player.tx = player.cx;
    player.ty = player.cy;
    if (lives <= 0) {
      lives = 0;
      over = true;
      solved = false;
      return;
    }
    player.cx = START.x;
    player.cy = START.y;
    player.tx = START.x;
    player.ty = START.y;
    player.dir = { ...DIRS.down };
    player.invuln = INVULN_TIME;
  }

  function applyFlameDamage() {
    if (over || solved) return;
    // 先结算敌人，避免同帧玩家死亡清空火圈导致敌人漏杀
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (enemyCells(e).some((c) => flameAt(c.x, c.y))) {
        enemies.splice(i, 1);
        score += 100;
        syncBombCap();
      }
    }
    if (player.invuln > 0) return;
    if (playerCells().some((c) => flameAt(c.x, c.y))) loseLife();
  }

  function checkContact() {
    if (over || solved || player.invuln > 0) return;
    const p = playerPos();
    for (const e of enemies) {
      const ep = enemyPos(e);
      if (Math.abs(p.x - ep.x) < 0.7 && Math.abs(p.y - ep.y) < 0.7) {
        loseLife();
        return;
      }
    }
  }

  function checkPickup() {
    if (over || solved) return;
    const cell = nearestPlayerCell();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.x !== cell.x || it.y !== cell.y) continue;
      items.splice(i, 1);
      score += 20;
      if (it.type === 'bomb') bombUp += 1;
      else if (it.type === 'power') player.power = Math.min(MAX_POWER, player.power + 1);
      else if (it.type === 'speed') player.speed = Math.min(MAX_SPEED, round3(player.speed + 0.45));
      syncBombCap();
    }
  }

  function checkClear() {
    if (over || solved || enemies.length > 0) return;
    solved = true;
    solvedTimer = CLEAR_DELAY;
    score += 200 * levelNo;
    syncBombCap();
  }

  /* ── 固定步长 ───────────────────────────────────────── */

  function tick(dt, actions) {
    ticks += 1;
    if (solved) {
      solvedTimer -= dt;
      if (solvedTimer <= 0) advanceLevel();
      return;
    }
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);

    // 旧的火焰先老化，再让新炸弹产生满时长火焰
    for (let i = flames.length - 1; i >= 0; i--) {
      flames[i].timer -= dt;
      if (flames[i].timer <= 0) flames.splice(i, 1);
    }

    updatePlayer(dt, actions);
    updateEnemies(dt);

    for (const b of bombs.slice()) {
      if (b.passTimer > 0) b.passTimer = Math.max(0, b.passTimer - dt);
      b.timer -= dt;
      if (b.timer <= 0) detonate(b);
    }

    applyFlameDamage();
    checkContact();
    checkPickup();
    checkClear();
  }

  function step(dt, actions) {
    if (over) return;
    if (!started) {
      const wantsStart = Array.isArray(actions) && actions.some((a) => DIRS[a]);
      if (!wantsStart) return;
      started = true;
    }
    acc += Math.min(Math.max(0, Number(dt) || 0), 5);
    let guard = 0;
    while (acc + 1e-9 >= TICK && !over && guard < 600) {
      acc -= TICK;
      if (acc < 0) acc = 0;
      tick(TICK, actions);
      guard += 1;
    }
  }

  function submit(playerId, action) {
    if (action === 'start') {
      if (over) return { ok: false, error: '本局已结束' };
      started = true;
      return { ok: true };
    }
    if (action === 'bomb') return placeBomb();
    return { ok: false, error: `未知操作: ${action}` };
  }

  function state() {
    const p = playerPos();
    return {
      turn: 'p1',
      maze: grid.map((row) => row.join('')),
      player: {
        x: round3(p.x),
        y: round3(p.y),
        cx: player.cx,
        cy: player.cy,
        dir: { ...player.dir },
        moving: player.moving,
        t: round3(player.t),
        power: player.power,
        bombs: countOwnBombs(),
        maxBombs: player.maxBombs,
        speed: player.speed,
        invuln: round3(player.invuln),
      },
      enemies: enemies.map((e) => {
        const ep = enemyPos(e);
        return {
          id: e.id,
          x: round3(ep.x),
          y: round3(ep.y),
          cx: e.cx,
          cy: e.cy,
          dir: { ...e.dir },
          timer: round3(e.timer),
          interval: e.interval,
          moving: e.moving,
        };
      }),
      bombs: bombs.map((b) => ({
        x: b.x,
        y: b.y,
        timer: round3(b.timer),
        power: b.power,
        owner: b.owner,
        passTimer: round3(b.passTimer),
      })),
      flames: flames.map((f) => ({ x: f.x, y: f.y, timer: round3(f.timer), dir: f.dir, tip: f.tip })),
      items: items.map((i) => ({ x: i.x, y: i.y, type: i.type })),
      score,
      lives,
      level: levelNo,
      over,
      solved,
      started,
      clearTimer: round3(solvedTimer),
      cols: COLS,
      rows: ROWS,
      ticks,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: null,
      title: '游戏结束',
      score,
      scores: { p1: score },
      text: `到达第 ${levelNo} 关 · 得分 ${score}`,
    };
  }

  function reset() {
    rng = createRng(seed);
    score = 0;
    lives = 3;
    levelNo = startLevel;
    bombUp = 0;
    over = false;
    solved = false;
    solvedTimer = 0;
    started = false;
    acc = 0;
    ticks = 0;
    enemySeq = 0;
    player = null;
    bombs = [];
    flames = [];
    items = [];
    enemies = [];
    buildLevel();
  }

  /* ── 仅测试用 ───────────────────────────────────────── */

  /** 改一格地形，便于构造爆炸/道具场景 */
  function debugSetCell(x, y, ch) {
    if (!inBounds(x, y)) return false;
    grid[y][x] = ch;
    return true;
  }

  /** 直接把玩家摆到某格（会清掉进行中的移动段） */
  function debugSetPlayer(p = {}) {
    const x = p.x ?? player.cx;
    const y = p.y ?? player.cy;
    if (!inBounds(x, y)) return false;
    player.cx = x;
    player.cy = y;
    player.tx = x;
    player.ty = y;
    player.moving = false;
    player.t = 0;
    if (p.dir) player.dir = { ...p.dir };
    if (p.power != null) player.power = p.power;
    if (p.speed != null) player.speed = p.speed;
    if (p.invuln != null) player.invuln = p.invuln;
    if (p.bombs != null) bombUp = Math.max(0, p.bombs - 1);
    if (p.lives != null) lives = p.lives;
    if (p.score != null) score = p.score;
    syncBombCap();
    started = true;
    return true;
  }

  /** 绕过容量/占位限制放炸弹，便于构造射程/连锁场景 */
  function debugPlaceBomb({ x, y, timer = BOMB_FUSE, power = BASE_POWER, passTimer = 0 } = {}) {
    if (!inBounds(x, y) || !floorAt(x, y)) return false;
    bombs = bombs.filter((b) => b.x !== x || b.y !== y);
    bombs.push({ x, y, timer, power, owner: 'p1', passTimer });
    started = true;
    return true;
  }

  /** 直接生成一颗已揭示的道具 */
  function debugSpawnItem(x, y, type = 'power') {
    if (!inBounds(x, y) || !floorAt(x, y)) return false;
    items.push({ x, y, type });
    started = true;
    return true;
  }

  /**
   * 直接设置敌人列表（构造受击/接触场景）。
   * 每项 {x,y,interval,timer,moving,dir}；moving 为 false 时停在原地。
   */
  function debugSetEnemies(list = []) {
    enemies = list.map((e, i) => ({
      id: `d${i + 1}`,
      cx: e.x,
      cy: e.y,
      tx: e.x,
      ty: e.y,
      moving: Boolean(e.moving),
      dir: e.dir ? { ...e.dir } : { ...DIRS.left },
      interval: e.interval ?? 99,
      timer: e.timer ?? 99,
    }));
    started = true;
    return true;
  }

  /** 让玩家立刻失去一条命（跳过等待爆炸），用于生命/结束判定测试 */
  function debugHurt() {
    if (over || solved) return false;
    loseLife();
    return true;
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
    debugPlaceBomb,
    debugSpawnItem,
    debugSetEnemies,
    debugHurt,
  };
}
