/**
 * 敲地鼠 · 纯逻辑（无 DOM、无系统随机源、无墙钟）。
 *
 * 规则事实：
 * - 3×3 九宫格，同一时刻最多一只地鼠；空格由 rng 选，timer 到 0 自动缩回；
 * - 30 秒限时：敲空 / 漏鼠只断连击并计 misses，不扣命（限时分支不设生命）；
 * - 敲中基础 10 分，连击第 n 次额外 min(n-1,5)×2 分（最高 +10 加成）；
 * - 随时间推进，出现间隔 1.2s→0.45s、停留时长 1.0s→0.55s，难度递增；
 * - shell 开局不发 'start'，因此 createGame 返回即处于对局中，'start' 幂等。
 */
import { createRng } from '../../shared/rng.js';

export const HOLES = 9;
export const DURATION = 30;

const BASE = 10;
const COMBO_STEP = 2;
const COMBO_CAP = 5;

/** 出现间隔：开局 1.2s，30 秒末 0.45s */
function gapFor(elapsed) {
  return Math.max(0.45, 1.2 - elapsed * 0.025);
}

/** 地鼠停留时长：开局 1.0s，30 秒末 0.55s */
function lifeFor(elapsed) {
  return Math.max(0.55, 1.0 - elapsed * 0.015);
}

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  const rng = createRng(seed);
  let holes;
  let score;
  let combo;
  let maxCombo;
  let timeLeft;
  let elapsed;
  let over;
  let spawnAcc;
  let hits;
  let misses;
  let lastHitIndex;
  let lastHitAt;
  let lastHitGain;

  function reset() {
    holes = Array.from({ length: HOLES }, () => ({ active: false, type: null, timer: 0 }));
    score = 0;
    combo = 0;
    maxCombo = 0;
    timeLeft = DURATION;
    elapsed = 0;
    over = false;
    spawnAcc = 0;
    hits = 0;
    misses = 0;
    lastHitIndex = -1;
    lastHitAt = -1;
    lastHitGain = 0;
  }

  function spawn() {
    const free = [];
    for (let i = 0; i < HOLES; i++) if (!holes[i].active) free.push(i);
    if (!free.length) return;
    const idx = free[rng.int(free.length)];
    const h = holes[idx];
    h.active = true;
    h.type = 'mole';
    h.timer = lifeFor(elapsed);
  }

  function submit(playerId, action) {
    // shell 自动开局，'start' 只做幂等确认，不改变任何状态
    if (action === 'start') return { ok: true };
    if (typeof action !== 'string') return { ok: false, error: '无效操作' };
    const m = /^hit:(\d+)$/.exec(action);
    if (!m) return { ok: false, error: '无效操作' };
    const i = Number(m[1]);
    if (!Number.isInteger(i) || i < 0 || i >= HOLES) return { ok: false, error: '无效格位' };
    if (over) return { ok: false, error: '本局已结束' };

    const h = holes[i];
    if (!h.active) {
      misses++;
      combo = 0;
      return { ok: true, miss: true };
    }
    h.active = false;
    h.type = null;
    h.timer = 0;
    hits++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    const gain = BASE + Math.min(combo - 1, COMBO_CAP) * COMBO_STEP;
    score += gain;
    lastHitIndex = i;
    lastHitAt = elapsed;
    lastHitGain = gain;
    return { ok: true, hit: true, gain };
  }

  function step(dt, actions = []) {
    if (over) return;
    const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (d === 0) return;

    timeLeft = Math.max(0, timeLeft - d);
    elapsed += d;

    // 生成 / 消失：先结算现存地鼠，再决定是否冒新鼠
    for (const h of holes) {
      if (!h.active) continue;
      h.timer -= d;
      if (h.timer <= 0) {
        h.active = false;
        h.type = null;
        h.timer = 0;
        misses++;
        combo = 0;
      }
    }

    spawnAcc += d;
    const gap = gapFor(elapsed);
    if (spawnAcc >= gap) {
      spawnAcc %= gap;
      spawn();
    }

    if (timeLeft <= 0) over = true;
  }

  function state() {
    return {
      turn: 'p1',
      holes: holes.map((h) => ({ ...h })),
      score,
      combo,
      maxCombo,
      timeLeft,
      over,
      elapsed,
      hits,
      misses,
      spawnGap: gapFor(elapsed),
      lastHitIndex,
      lastHitAt,
      lastHitGain,
      cols: 3,
      rows: 3,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `命中 ${hits} · 漏掉 ${misses} · 最高连击 ${maxCombo}`,
    };
  }

  reset();
  return { submit, step, state, result, reset };
}
