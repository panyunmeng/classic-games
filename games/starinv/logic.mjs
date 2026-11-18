/**
 * 星际入侵 · 纯逻辑（无 DOM / 无 Math.random / 无 Date.now）。
 *
 * 规则事实与推导：
 * - 敌机 5 行 × 10 列，作为整体左右平移；碰到边线反向并下压一格。
 * - 玩家底部左右移动；射击受「冷却 + 同时最多 2 发」双重闸门约束。
 *   两个入口（step 的 actions / submit 的 shoot）共用 tryShoot，避免互相绕过。
 * - 敌机随机投弹：只在每列最前排（row 最大）的存活敌机中挑选，用注入的 rng。
 * - 掩体 4 组，逐格布尔网格；子弹命中格子即销毁该格并消耗子弹。
 * - 清空一波 → wave+1、敌机满编复位、速度按 wave 提升；敌机触底 → 减命并复位阵型。
 * - 被敌弹击中或敌机触底都减命，3 命归零 over=true。
 */
import { createRng } from '../../shared/rng.js';

export const FIELD = { left: 24, right: 456, top: 40, bottom: 600 };
export const ENEMY_COLS = 10;
export const ENEMY_ROWS = 5;

const CELL_W = 40;
const CELL_H = 34;
const ENEMY_W = 26;
const ENEMY_H = 20;
const FORM_START_X = 48;
const FORM_START_Y = 96;
const FORM_DROP = 14;

const PLAYER_W = 44;
const PLAYER_H = 18;
const PLAYER_Y = 588;
const PLAYER_SPEED = 280;

const PB_SPEED = 440;
const EB_SPEED = 210;
const MAX_PLAYER_BULLETS = 2;
const SHOOT_COOLDOWN = 0.22;
const START_LIVES = 3;
const INVULN = 1.2;

const BUNKER_COLS = 9;
const BUNKER_ROWS = 5;
const BUNKER_CELL = 6;
const BUNKER_Y = 500;
const BUNKER_CENTERS = [90, 190, 290, 390];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function rectsHit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function makeBunkers() {
  return BUNKER_CENTERS.map((cx) => {
    const x = cx - (BUNKER_COLS * BUNKER_CELL) / 2;
    const grid = [];
    for (let r = 0; r < BUNKER_ROWS; r++) {
      const row = [];
      for (let c = 0; c < BUNKER_COLS; c++) {
        // 底部中央留出缺口：经典掩体造型，也让玩家子弹有射击通道
        const notch = r >= BUNKER_ROWS - 2 && c >= 3 && c <= 5;
        row.push(!notch);
      }
      grid.push(row);
    }
    return {
      x,
      y: BUNKER_Y,
      w: BUNKER_COLS * BUNKER_CELL,
      h: BUNKER_ROWS * BUNKER_CELL,
      cell: BUNKER_CELL,
      grid,
    };
  });
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  let rng;
  let form;
  let enemies;
  let player;
  let playerBullets;
  let enemyBullets;
  let bunkers;
  let explosions;
  let score;
  let lives;
  let wave;
  let over;
  let clock;
  let shootCd;
  let invuln;
  let frozen; // 测试钩子：冻结编队横移，便于确定性命中

  function enemyRect(e) {
    return {
      x: form.x + e.col * CELL_W,
      y: form.y + e.row * CELL_H,
      w: ENEMY_W,
      h: ENEMY_H,
    };
  }

  function playerRect() {
    return { x: player.x, y: player.y, w: player.w, h: player.h };
  }

  function addExplosion(x, y) {
    explosions.push({ x, y, age: 0, ttl: 0.45 });
  }

  function reset() {
    const wasFrozen = frozen;
    rng = createRng(seed);
    form = { x: FORM_START_X, y: FORM_START_Y, dir: 1 };
    enemies = [];
    for (let r = 0; r < ENEMY_ROWS; r++) {
      for (let c = 0; c < ENEMY_COLS; c++) {
        enemies.push({ col: c, row: r, alive: true });
      }
    }
    player = {
      x: (FIELD.left + FIELD.right - PLAYER_W) / 2,
      y: PLAYER_Y,
      w: PLAYER_W,
      h: PLAYER_H,
    };
    playerBullets = [];
    enemyBullets = [];
    bunkers = makeBunkers();
    explosions = [];
    score = 0;
    lives = START_LIVES;
    wave = 1;
    over = false;
    clock = 0;
    shootCd = 0;
    invuln = 0;
    frozen = wasFrozen;
  }

  // 唯一的开火闸门：冷却未到或已有 2 发在场上都拒绝
  function tryShoot() {
    if (over || shootCd > 0) return false;
    if (playerBullets.length >= MAX_PLAYER_BULLETS) return false;
    playerBullets.push({
      x: player.x + player.w / 2 - 1.5,
      y: player.y - 4,
      w: 3,
      h: 12,
    });
    shootCd = SHOOT_COOLDOWN;
    return true;
  }

  function resetFormation() {
    form.x = FORM_START_X;
    // 逐波下压：每过一波起始高度更低，但留足上方空间（封顶 y=220）
    form.y = Math.min(220, FORM_START_Y + (wave - 1) * 24);
    form.dir = 1;
    playerBullets.length = 0;
    enemyBullets.length = 0;
  }

  function loseLife() {
    lives -= 1;
    invuln = INVULN;
    playerBullets.length = 0;
    enemyBullets.length = 0;
    player.x = (FIELD.left + FIELD.right - player.w) / 2;
    if (lives <= 0) {
      lives = 0;
      over = true;
    }
  }

  function nextWave() {
    wave += 1;
    score += 100; // 清波奖励
    resetFormation();
    for (const e of enemies) e.alive = true;
  }

  function moveFormation(dt) {
    const alive = enemies.filter((e) => e.alive);
    if (!alive.length || frozen) return; // 全灭交给 updateBullets 末尾的 nextWave 处理
    const speed = 38 * (1 + 0.28 * (wave - 1));
    form.x += form.dir * speed * dt;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const e of alive) {
      const r = enemyRect(e);
      if (r.x < minX) minX = r.x;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
    }
    if (maxX >= FIELD.right && form.dir > 0) {
      form.dir = -1;
      form.x -= maxX - FIELD.right; // 夹回边界，避免漂移
      form.y += FORM_DROP;
    } else if (minX <= FIELD.left && form.dir < 0) {
      form.dir = 1;
      form.x += FIELD.left - minX;
      form.y += FORM_DROP;
    }
  }

  // 逐格破坏掩体：命中一个存活格 → 该格置空并消耗这颗子弹
  function hitBunker(b) {
    for (const bu of bunkers) {
      if (
        b.x + b.w < bu.x ||
        b.x > bu.x + bu.w ||
        b.y + b.h < bu.y ||
        b.y > bu.y + bu.h
      ) {
        continue;
      }
      for (let r = 0; r < BUNKER_ROWS; r++) {
        for (let c = 0; c < BUNKER_COLS; c++) {
          if (!bu.grid[r][c]) continue;
          const cellRect = {
            x: bu.x + c * bu.cell,
            y: bu.y + r * bu.cell,
            w: bu.cell,
            h: bu.cell,
          };
          if (rectsHit(b, cellRect)) {
            bu.grid[r][c] = false;
            return true;
          }
        }
      }
    }
    return false;
  }

  function updateBullets(dt) {
    // 玩家子弹：上飞 → 命中敌机 → 命中掩体 → 出界
    for (let i = playerBullets.length - 1; i >= 0; i--) {
      const b = playerBullets[i];
      b.y -= PB_SPEED * dt;
      if (b.y + b.h < FIELD.top) {
        playerBullets.splice(i, 1);
        continue;
      }
      let consumed = false;
      for (const e of enemies) {
        if (!e.alive) continue;
        const r = enemyRect(e);
        if (rectsHit(b, r)) {
          e.alive = false;
          score += (ENEMY_ROWS - e.row) * 10;
          addExplosion(r.x + r.w / 2, r.y + r.h / 2);
          playerBullets.splice(i, 1);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      if (hitBunker(b)) playerBullets.splice(i, 1);
    }

    // 敌弹：下飞 → 命中掩体 → 命中玩家 → 出界
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.y += EB_SPEED * dt;
      if (b.y > FIELD.bottom) {
        enemyBullets.splice(i, 1);
        continue;
      }
      if (hitBunker(b)) {
        enemyBullets.splice(i, 1);
        continue;
      }
      if (invuln <= 0 && rectsHit(b, playerRect())) {
        enemyBullets.splice(i, 1);
        loseLife();
        if (over) return;
      }
    }

    if (enemies.every((e) => !e.alive)) nextWave();
  }

  function maybeEnemyFire(dt) {
    const rate = 1.4 + 0.3 * wave; // 每秒期望开火数，随波次增加
    if (!rng.chance(Math.min(0.95, rate * dt))) return;
    if (enemyBullets.length >= 8) return;

    // 每列最前排（row 最大）的存活敌机才有资格开火
    const front = [];
    for (let c = 0; c < ENEMY_COLS; c++) {
      let cand = null;
      for (let r = ENEMY_ROWS - 1; r >= 0; r--) {
        const e = enemies[r * ENEMY_COLS + c];
        if (e && e.alive) {
          cand = e;
          break;
        }
      }
      if (cand) front.push(cand);
    }
    if (!front.length) return;
    const r = enemyRect(rng.pick(front));
    enemyBullets.push({
      x: r.x + r.w / 2 - 1.5,
      y: r.y + r.h,
      w: 3,
      h: 10,
    });
  }

  function checkBottom() {
    for (const e of enemies) {
      if (!e.alive) continue;
      const r = enemyRect(e);
      if (r.y + r.h >= PLAYER_Y - 6) {
        loseLife();
        if (!over) resetFormation();
        return;
      }
    }
  }

  function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
      explosions[i].age += dt;
      if (explosions[i].age >= explosions[i].ttl) explosions.splice(i, 1);
    }
  }

  function step(dt, actions = []) {
    if (over) return;
    dt = clamp(dt, 0, 0.05);
    clock += dt;
    if (shootCd > 0) shootCd -= dt;
    if (invuln > 0) invuln -= dt;

    let move = 0;
    for (const a of actions) {
      if (a === 'left') move -= 1;
      else if (a === 'right') move += 1;
      else if (a === 'shoot') tryShoot();
    }
    if (move !== 0) {
      player.x = clamp(player.x + move * PLAYER_SPEED * dt, FIELD.left, FIELD.right - player.w);
    }

    moveFormation(dt);
    updateBullets(dt);
    if (over) return;
    updateExplosions(dt);
    maybeEnemyFire(dt);
    checkBottom();
  }

  function submit(playerId, action) {
    if (action === 'start') {
      reset();
      return { ok: true };
    }
    if (action === 'shoot') {
      if (over) return { ok: false, error: '本局已结束' };
      return tryShoot() ? { ok: true } : { ok: false, error: '开火冷却中' };
    }
    return { ok: false, error: '无效操作' };
  }

  function state() {
    return {
      turn: 'p1',
      enemies: enemies.map((e) => {
        const r = enemyRect(e);
        return {
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          row: e.row,
          col: e.col,
          alive: e.alive,
        };
      }),
      bullets: playerBullets.map((b) => ({ ...b })),
      enemyBullets: enemyBullets.map((b) => ({ ...b })),
      bunkers: bunkers.map((bu) => ({
        x: bu.x,
        y: bu.y,
        w: bu.w,
        h: bu.h,
        cell: bu.cell,
        grid: bu.grid.map((row) => row.slice()),
      })),
      player: { ...player },
      score,
      lives,
      wave,
      over,
      explosions: explosions.map((e) => ({ ...e })),
      invuln,
      clock,
      field: { ...FIELD },
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      score,
      scores: { p1: score },
      text: `坚守至第 ${wave} 波 · 得分 ${score}`,
    };
  }

  // 单测用的确定性钩子（不引入随机/时间）：锁阵型、注入子弹、模拟受击/清波
  const dbg = {
    freeze(v = true) {
      frozen = Boolean(v);
    },
    spawnEnemyBullet(x, y) {
      enemyBullets.push({ x, y, w: 3, h: 10 });
    },
    playerX(x) {
      player.x = clamp(x, FIELD.left, FIELD.right - player.w);
    },
    hurt() {
      loseLife();
    },
    killWave() {
      for (const e of enemies) e.alive = false;
      if (!over) nextWave();
    },
  };

  reset();

  return { submit, step, state, result, reset, dbg };
}
