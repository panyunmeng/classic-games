/**
 * 豆豆迷宫 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 事实与推导：
 * - 网格 19×21，字符串地图：# 墙、. 豆、o 能量豆、- 隧道口、空格为出生格；
 *   BFS 自检 229 个可走格全连通，218 豆 + 4 能量豆，豆吃光即过关。
 * - 玩家每 MOVE_INTERVAL 走一格，方向先缓冲（nextDir），撞墙则沿用可走方向；
 *   隧道行第 10 行左右边界环绕。
 * - 4 只鬼各有状态机：chase 追击 / scatter 散开 / frightened 受惊 / returning 回巢；
 *   追击策略分别为直追、预判、包夹、随机，全局在 scatter↔chase 间按计时切换。
 * - 能量豆：powerTimer 倒计时；受惊期间反吃鬼，连吃 200/400/800/1600 分；
 *   被吃鬼变 eyes 回巢，抵巢后恢复。
 * - 玩家碰鬼（非受惊/回巢）减命；3 命耗尽结束；复活回出生点并短暂无敌。
 * - 随机全部来自 createRng(seed)，同种子同回放。
 */
import { createRng } from '../../shared/rng.js';

export const COLS = 19;
export const ROWS = 21;
export const MOVE_INTERVAL = 0.14; // 每格秒数（固定步长）
export const POWER_TIME = 7;       // 能量豆持续时间（秒）
export const TUNNEL_ROW = 10;
export const NEST = { x: 9, y: 10 };

/** 初始地图（#墙 .豆 o能量豆 -隧道 空格出生点） */
export const MAZE = [
  '###################',
  '#.###.###.###.###.#',
  '#.###.###.###.###.#',
  '#o...............o#',
  '#.#.###.#.#.###.#.#',
  '#.................#',
  '#...#.........#...#',
  '####.###...###.####',
  '#.................#',
  '#.................#',
  '-......  .  ......-',
  '####.###...###.####',
  '#...#.........#...#',
  '#.................#',
  '#.#.###.#.#.###.#.#',
  '#........ ........#',
  '#.................#',
  '#o###.###.###.###o#',
  '#.###.###.###.###.#',
  '#.................#',
  '###################',
];

const DIRS = {
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
};
const DIR_LIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
const DIR_NAME = new Map([[DIRS.up, 'up'], [DIRS.left, 'left'], [DIRS.down, 'down'], [DIRS.right, 'right']]);

const PLAYER_START = { x: 9, y: 15 };
const GHOST_STARTS = [
  { x: 7, y: 10 }, // 直追
  { x: 8, y: 10 }, // 预判
  { x: 10, y: 10 }, // 包夹
  { x: 11, y: 10 }, // 随机
];
const GHOST_META = [
  { name: '追追', strategy: 'direct', color: '#f87171' },
  { name: '预判', strategy: 'predict', color: '#60a5fa' },
  { name: '包夹', strategy: 'flank', color: '#f0abfc' },
  { name: '随机', strategy: 'random', color: '#4ade80' },
];
const SCATTER_CORNERS = [
  { x: 1, y: 1 },
  { x: 17, y: 1 },
  { x: 1, y: 19 },
  { x: 17, y: 19 },
];

function isOpposite(a, b) {
  return a && b && a.x + b.x === 0 && a.y + b.y === 0;
}

function wrapX(x) {
  if (x < 0) return COLS - 1;
  if (x >= COLS) return 0;
  return x;
}

export function createGame({ seed = 1, mode = 'solo', level = 1 } = {}) {
  let rng;
  let grid;      // 当前地图（字符二维数组）
  let player;
  let ghosts;
  let score;
  let lives;
  let powerTimer;
  let beansLeft;
  let over;
  let started;
  let chain;
  let globalMode;
  let phaseTimer;
  let acc;
  let ticks;
  let win;

  function reset() {
    rng = createRng(seed);
    grid = MAZE.map((row) => row.split(''));
    beansLeft = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] === '.' || grid[y][x] === 'o') beansLeft++;
      }
    }
    player = {
      x: PLAYER_START.x,
      y: PLAYER_START.y,
      dir: { ...DIRS.left },
      nextDir: { ...DIRS.left },
      invuln: 0,
    };
    ghosts = GHOST_META.map((meta, i) => ({
      id: `g${i + 1}`,
      name: meta.name,
      strategy: meta.strategy,
      color: meta.color,
      x: GHOST_STARTS[i].x,
      y: GHOST_STARTS[i].y,
      dir: i % 2 === 0 ? { ...DIRS.right } : { ...DIRS.left },
      mode: 'scatter',
      allowReverse: false,
      home: { ...SCATTER_CORNERS[i] },
    }));
    score = 0;
    lives = 3;
    powerTimer = 0;
    over = false;
    started = false;
    chain = 0;
    globalMode = 'scatter';
    phaseTimer = 7;
    acc = 0;
    ticks = 0;
    win = false;
  }

  function passable(x, y) {
    if (y < 0 || y >= ROWS) return false;
    if (x < 0 || x >= COLS) return false;
    return grid[y][x] !== '#';
  }

  function stepPos(x, y, d) {
    return { x: wrapX(x + d.x), y: y + d.y };
  }

  function setDirection(raw) {
    const name = typeof raw === 'string' && raw.startsWith('dir:') ? raw.slice(4) : raw;
    const d = DIRS[name];
    if (!d) return { ok: false, error: `无效方向: ${raw}` };
    if (over) return { ok: false, error: '本局已结束' };
    player.nextDir = { ...d };
    started = true; // 首个方向输入即开局，'start' 也可显式开局
    return { ok: true };
  }

  function submit(playerId, action) {
    if (action === 'start') {
      if (over) return { ok: false, error: '本局已结束' };
      started = true;
      return { ok: true };
    }
    return setDirection(action);
  }

  function globalPhaseTick(dt) {
    phaseTimer -= dt;
    if (phaseTimer > 0) return;
    globalMode = globalMode === 'scatter' ? 'chase' : 'scatter';
    phaseTimer = globalMode === 'scatter' ? 7 : 20;
    // 模式切换允许鬼反向（经典规则），受惊/回巢鬼除外
    for (const g of ghosts) {
      if (g.mode === 'frightened' || g.mode === 'returning') continue;
      g.mode = globalMode;
      g.allowReverse = true;
    }
  }

  function activatePower() {
    powerTimer = POWER_TIME;
    chain = 0;
    for (const g of ghosts) {
      if (g.mode === 'returning') continue;
      g.mode = 'frightened';
      g.allowReverse = true;
    }
  }

  function endPower() {
    powerTimer = 0;
    chain = 0;
    for (const g of ghosts) {
      if (g.mode === 'returning') continue;
      g.mode = globalMode;
      g.allowReverse = true;
    }
  }

  function chaseTarget(g) {
    const p = player;
    switch (g.strategy) {
      case 'direct':
        return { x: p.x, y: p.y };
      case 'predict':
        return { x: p.x + 2 * p.dir.x, y: p.y + 2 * p.dir.y };
      case 'flank': {
        const fx = p.dir.x !== 0 ? 2 * p.dir.x : (g.x < p.x ? -2 : 2);
        const fy = p.dir.y !== 0 ? 2 * p.dir.y : (g.y < p.y ? -2 : 2);
        return { x: p.x + fx, y: p.y + fy };
      }
      case 'random':
        return rng.chance(0.5)
          ? { x: p.x, y: p.y }
          : { x: rng.int(COLS), y: rng.int(ROWS) };
      default:
        return { x: p.x, y: p.y };
    }
  }

  function chooseGhostDir(g) {
    const options = DIR_LIST.filter((d) => {
      if (isOpposite(d, g.dir) && !g.allowReverse) return false;
      const t = stepPos(g.x, g.y, d);
      return passable(t.x, t.y);
    });
    if (!options.length) {
      // 完全无路（如出生盒）允许反向兜底
      g.allowReverse = true;
      return DIR_LIST.find((d) => passable(stepPos(g.x, g.y, d).x, stepPos(g.x, g.y, d).y)) || g.dir;
    }

    let target;
    let maximize = false;
    if (g.mode === 'frightened') {
      target = { x: player.x, y: player.y };
      maximize = true;
    } else if (g.mode === 'returning') {
      target = NEST;
    } else if (g.mode === 'scatter') {
      target = g.home;
    } else {
      target = chaseTarget(g);
    }

    const dist = (d) => {
      const t = stepPos(g.x, g.y, d);
      return (t.x - target.x) ** 2 + (t.y - target.y) ** 2;
    };
    const scored = options.map((d) => ({ d, v: dist(d) }));
    const best = maximize
      ? Math.max(...scored.map((s) => s.v))
      : Math.min(...scored.map((s) => s.v));
    const tied = scored.filter((s) => s.v === best).map((s) => s.d);
    return { ...rng.pick(tied) };
  }

  function movePlayer() {
    // 缓冲转向：nextDir 可走则采信，否则沿用当前可走方向
    if (passable(stepPos(player.x, player.y, player.nextDir).x, stepPos(player.x, player.y, player.nextDir).y)) {
      player.dir = { ...player.nextDir };
    }
    const t = stepPos(player.x, player.y, player.dir);
    if (!passable(t.x, t.y)) return;
    player.x = t.x;
    player.y = t.y;

    const cell = grid[player.y][player.x];
    if (cell === '.' || cell === 'o') {
      score += cell === 'o' ? 50 : 10;
      grid[player.y][player.x] = ' ';
      beansLeft--;
      if (cell === 'o') activatePower();
      if (beansLeft <= 0) {
        beansLeft = 0;
        over = true;
        win = true;
      }
    }
  }

  function moveGhosts() {
    for (const g of ghosts) {
      const d = chooseGhostDir(g);
      g.dir = d;
      const t = stepPos(g.x, g.y, d);
      if (passable(t.x, t.y)) {
        g.x = t.x;
        g.y = t.y;
      }
      g.allowReverse = false;
      // 回巢鬼抵达巢格即恢复
      if (g.mode === 'returning' && g.x === NEST.x && g.y === NEST.y) {
        g.mode = globalMode;
      }
    }
  }

  function loseLife() {
    lives--;
    chain = 0;
    powerTimer = 0;
    if (lives <= 0) {
      lives = 0;
      over = true;
      win = false;
      return;
    }
    // 复活：回出生点，鬼回巢，短暂无敌
    player.x = PLAYER_START.x;
    player.y = PLAYER_START.y;
    player.dir = { ...DIRS.left };
    player.nextDir = { ...DIRS.left };
    player.invuln = 2;
    ghosts.forEach((g, i) => {
      g.x = GHOST_STARTS[i].x;
      g.y = GHOST_STARTS[i].y;
      g.dir = i % 2 === 0 ? { ...DIRS.right } : { ...DIRS.left };
      g.mode = globalMode;
      g.allowReverse = false;
    });
  }

  /** @returns {boolean} 本帧是否扣命（扣命后本 tick 立即结束） */
  function checkCollisions() {
    for (const g of ghosts) {
      if (g.x !== player.x || g.y !== player.y) continue;
      if (g.mode === 'frightened') {
        score += 200 * (2 ** chain);
        chain++;
        g.mode = 'returning';
        g.allowReverse = true;
      } else if (g.mode === 'returning') {
        continue; // 眼睛穿身而过
      } else if (player.invuln <= 0) {
        loseLife();
        return true; // 一次 tick 只扣一命
      }
    }
    return false;
  }

  function advance() {
    ticks++;
    if (powerTimer > 0) {
      powerTimer -= MOVE_INTERVAL;
      if (powerTimer <= 0) endPower();
    }
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - MOVE_INTERVAL);
    globalPhaseTick(MOVE_INTERVAL);
    // 先判起始格碰撞（鬼已在玩家格），再各自移动，最后判移动后碰撞
    if (checkCollisions()) return;
    if (over) return;
    movePlayer();
    if (over) return;
    if (checkCollisions()) return;
    if (over) return;
    moveGhosts();
    checkCollisions();
  }

  function step(dt, actions) {
    if (over || !started) return;
    if (Array.isArray(actions)) {
      for (const a of actions) {
        if (a === 'start') { started = true; continue; }
        if (typeof a === 'string') setDirection(a);
      }
    }
    acc += Math.max(0, dt || 0);
    let guard = 0;
    // EPS 修正浮点累积：保证 step(MOVE_INTERVAL) 恰好推进一格
    const EPS = 1e-9;
    while (acc + EPS >= MOVE_INTERVAL && !over && guard < 8) {
      acc -= MOVE_INTERVAL;
      if (acc < 0) acc = 0;
      advance();
      guard++;
    }
  }

  function state() {
    return {
      turn: 'p1',
      maze: grid.map((row) => row.join('')),
      player: {
        x: player.x,
        y: player.y,
        dir: { ...player.dir },
        lives,
        invuln: player.invuln,
      },
      ghosts: ghosts.map((g) => ({
        id: g.id,
        name: g.name,
        strategy: g.strategy,
        color: g.color,
        x: g.x,
        y: g.y,
        dir: { ...g.dir },
        mode: g.mode,
      })),
      score,
      lives,
      powerTimer,
      beansLeft,
      over,
      started,
      chain,
      globalMode,
      win,
      level,
      cols: COLS,
      rows: ROWS,
      ticks,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: win ? 'p1' : null,
      title: win ? '过关！' : '游戏结束',
      score,
      text: win ? `豆子清空 · 得分 ${score}` : `3 命耗尽 · 得分 ${score}`,
      scores: { p1: score },
    };
  }

  /** 仅测试用：强制把某格设为指定字符，便于摆出能量豆/碰撞场景 */
  function debugSetCell(x, y, ch) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    grid[y][x] = ch;
    return true;
  }

  /** 仅测试用：直接放置实体，便于构造反吃/减命场景 */
  function debugSetActors(p, gs) {
    if (p) {
      player.x = p.x;
      player.y = p.y;
      if (p.dir) player.dir = { ...p.dir };
      if (p.nextDir) player.nextDir = { ...p.nextDir };
      if (p.invuln != null) player.invuln = p.invuln;
    }
    if (Array.isArray(gs)) {
      gs.forEach((g, i) => {
        if (!ghosts[i]) return;
        if (g.x != null) ghosts[i].x = g.x;
        if (g.y != null) ghosts[i].y = g.y;
        if (g.mode) ghosts[i].mode = g.mode;
        if (g.dir) ghosts[i].dir = { ...g.dir };
      });
    }
    started = true;
  }

  /** 仅测试用：设置剩余豆数，便于构造过关场景 */
  function debugSetBeansLeft(n) {
    beansLeft = Math.max(0, n);
    return beansLeft;
  }

  reset();
  return { submit, step, state, result, reset, debugSetCell, debugSetActors, debugSetBeansLeft };
}
