/**
 * 蛇梯棋 · 纯逻辑（无 DOM、无真随机、无真时钟）。
 *
 * 规则事实与推导：
 * - 棋盘 10×10 = 100 格，编号 1～100 走「牛耕式」蛇形：1 在左下、10 在右下，
 *   11 在 10 的正上方，20 在最左，21 在其正上方……直到 100 在左上。
 *   这个方向只由编号决定（cellOf/numberOf 互为逆），渲染层不再自己算一遍。
 * - 掷骰 1～6 由 createRng(seed) 注入：同种子必得同一串点数，联机/回放可复现。
 * - 落点只结算一次升降：先按骰点移动，若落点是蛇头或梯底就整体换位，
 *   换位后不判第二次。表本身也让所有端点两两互不重合（见 §蛇梯表），
 *   所以「蛇尾正好是梯底」这种连环在数据上就不可能出现。
 * - 必须恰好停在 100：骰点会越过 100 时原地不动（也不结算升降），回合照常交出。
 *   否则一旦允许溢出，100 就只是「路过」，胜负判定失去意义。
 * - 2～4 人轮流：turn 始终是某个玩家 id，分出胜负后置 null（契约允许 null），
 *   这样外壳的 AI 驱动与联机鉴权都能靠 turn 一个字段判归属。
 *
 * 联机兼容：服务端 import 本模块跑权威逻辑，submit 的 playerId 用 'p1'…'p4'，
 * 同时兼容外壳传来的数字下标 0…3。
 */
import { createRng } from '../../shared/rng.js';

/** 棋盘边长（格） */
export const SIZE = 10;
/** 总格数 */
export const CELL_COUNT = SIZE * SIZE;
/** 终点格号：必须恰好停在这里才算赢 */
export const LAST = CELL_COUNT;
/** 最多人数（同屏 4 人） */
export const MAX_PLAYERS = 4;
/** 合法玩家 id；下标即默认先后手顺序 */
export const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'];

/**
 * 固定蛇梯表（可复现，不随 seed 变化）：键为落点格号，值为被送到哪一格。
 * 蛇头 > 蛇尾（下降），梯底 < 梯顶（上升）。
 * 不变量（tests 里有断言）：端点都在 2～99、四组端点两两不重合、
 * 任何跳转终点本身都不是蛇头/梯底，因此单次落点最多触发一次升降。
 */
export const SNAKES = Object.freeze({
  98: 79,
  87: 24,
  64: 41,
  45: 17,
  29: 7,
});

export const LADDERS = Object.freeze({
  6: 31,
  21: 46,
  38: 59,
  52: 74,
  71: 92,
});

/**
 * 格号 → 行列。row 0 是最底一行（球盘上 y 最大的那行），由渲染层翻转成屏幕坐标。
 * 偶数行走左→右，奇数行走右→左，形成蛇形。
 * @param {number} n 1～100
 * @returns {{col:number,row:number}|null}
 */
export function cellOf(n) {
  if (!Number.isInteger(n) || n < 1 || n > CELL_COUNT) return null;
  const row = Math.floor((n - 1) / SIZE);
  const step = (n - 1) % SIZE;
  const col = row % 2 === 1 ? SIZE - 1 - step : step;
  return { col, row };
}

/**
 * 行列 → 格号，cellOf 的逆运算。
 * @param {number} col 0～9（0 为最左）
 * @param {number} row 0～9（0 为最底）
 * @returns {number|null}
 */
export function numberOf(col, row) {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return null;
  const step = row % 2 === 1 ? SIZE - 1 - col : col;
  return row * SIZE + step + 1;
}

/**
 * 单次移动结算（纯函数，测试与 AI 共用）：骰点 → 落点 → 一次升降。
 * @param {number} pos 当前格号（0 = 还没上盘）
 * @param {number} dice 骰点 1～6
 * @param {Record<string,number>} [snakes]
 * @param {Record<string,number>} [ladders]
 * @returns {{pos:number,dice:number,from:number,target:number,event:string,stuck:boolean,jumpFrom:number|null,jumpTo:number|null,win:boolean}}
 */
export function resolveMove(pos, dice, snakes = SNAKES, ladders = LADDERS) {
  const from = pos;
  const target = pos + dice;

  // 每次掷骰只有一个「落点」，越过 100 就连落点都不存在，只能留在原地。
  if (target > LAST) {
    return {
      pos: from,
      dice,
      from,
      target,
      event: 'stuck',
      stuck: true,
      jumpFrom: null,
      jumpTo: null,
      win: from === LAST,
    };
  }

  let to = target;
  let event = 'move';
  let jumpFrom = null;
  let jumpTo = null;

  if (snakes[target] != null) {
    to = snakes[target];
    event = 'snake';
    jumpFrom = target;
    jumpTo = to;
  } else if (ladders[target] != null) {
    to = ladders[target];
    event = 'ladder';
    jumpFrom = target;
    jumpTo = to;
  }

  return { pos: to, dice, from, target, event, stuck: false, jumpFrom, jumpTo, win: to === LAST };
}

const DEFAULT_NAMES = {
  p1: '玩家1',
  p2: '玩家2',
  p3: '玩家3',
  p4: '玩家4',
};

/** 把外壳的数字下标 / 联机字符串 id 统一成玩家 id；非法返回 null */
function normalizePlayers(players, mode) {
  const fallback = mode === 'ai' || mode === 'local2p' ? ['p1', 'p2'] : ['p1'];
  const raw = Array.isArray(players) && players.length ? players : fallback;
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_PLAYERS; i++) {
    const id = PLAYER_IDS.includes(raw[i]) ? raw[i] : `p${i + 1}`;
    if (!out.includes(id)) out.push(id);
  }
  return out.length ? out : ['p1'];
}

/**
 * @param {{seed?:number, mode?:string, players?:string[], level?:number, rolls?:number[]}} [opts]
 *   rolls 是给单测/回放用的固定骰子序列（省略时走 createRng(seed)）；
 *   序列用完后仍由同一个 rng 继续出点。
 */
export function createGame({ seed = 1, mode = 'solo', players, level = 1, rolls } = {}) {
  const ids = normalizePlayers(players, mode);
  const fixedRolls = Array.isArray(rolls) ? rolls.slice() : null;

  let rng;
  let diceIndex;
  let roster;
  let turn;
  let dice;
  let winner;
  let moves;
  let lastMove;

  function nameOf(id) {
    if (mode === 'ai' && id === 'p2') return '电脑';
    return DEFAULT_NAMES[id] || id;
  }

  function reset() {
    rng = createRng(seed);
    diceIndex = 0;
    roster = ids.map((id) => ({ id, name: nameOf(id), pos: 0, rollCount: 0 }));
    turn = roster[0].id;
    dice = null;
    winner = null;
    moves = [];
    lastMove = null;
  }

  /** 骰子入口：有固定序列先用它，否则用种子 rng；两条路径都只产出 1～6 */
  function rollDice() {
    if (fixedRolls && diceIndex < fixedRolls.length) {
      const v = Math.round(Number(fixedRolls[diceIndex++]));
      if (Number.isFinite(v) && v >= 1 && v <= 6) return v;
    }
    return rng.int(6) + 1;
  }

  function nextTurn(id) {
    const i = roster.findIndex((p) => p.id === id);
    return roster[(i + 1) % roster.length].id;
  }

  function findPlayer(id) {
    return roster.find((p) => p.id === id) || null;
  }

  /** 数字下标 → id（外壳 submit(action, playerIndex) 传的就是下标） */
  function normalizeId(pid) {
    if (typeof pid === 'number') {
      const hit = roster[Math.trunc(pid)];
      return hit ? hit.id : null;
    }
    if (typeof pid !== 'string') return null;
    if (PLAYER_IDS.includes(pid)) return findPlayer(pid) ? pid : null;
    if (/^\d+$/.test(pid)) {
      const hit = roster[Number(pid)];
      return hit ? hit.id : null;
    }
    return null;
  }

  function record(entry) {
    moves.push(entry);
    lastMove = entry;
    return entry;
  }

  function doRoll(id) {
    const p = findPlayer(id);
    const value = rollDice();
    const r = resolveMove(p.pos, value);

    p.pos = r.pos;
    p.rollCount += 1;
    dice = value;

    const entry = record({
      seq: moves.length + 1,
      player: id,
      action: 'roll',
      dice: value,
      from: r.from,
      target: r.target,
      to: r.pos,
      event: r.event,
      jumpFrom: r.jumpFrom,
      jumpTo: r.jumpTo,
    });

    if (r.pos === LAST) {
      winner = id;
      turn = null;
    } else {
      turn = nextTurn(id);
    }

    return {
      ok: true,
      dice: value,
      from: entry.from,
      to: entry.to,
      event: entry.event,
      jumpFrom: entry.jumpFrom,
      jumpTo: entry.jumpTo,
      winner,
    };
  }

  /** 放弃本回合（不掷骰、不动棋）。入口给「让过」留的合法动作，UI 不暴露。 */
  function doSkip(id) {
    const p = findPlayer(id);
    record({
      seq: moves.length + 1,
      player: id,
      action: 'skip',
      dice: null,
      from: p.pos,
      target: null,
      to: p.pos,
      event: 'skip',
      jumpFrom: null,
      jumpTo: null,
    });
    turn = nextTurn(id);
    return { ok: true, skipped: true };
  }

  function submit(playerId, action) {
    const id = normalizeId(playerId);
    if (!id) return { ok: false, error: '无效玩家' };
    if (winner) return { ok: false, error: '本局已结束' };
    if (id !== turn) return { ok: false, error: '还没轮到你掷骰' };
    if (action === 'roll') return doRoll(id);
    if (action === 'skip') return doSkip(id);
    return { ok: false, error: '未知动作' };
  }

  function step() {
    /* 回合制：submit 直接推进，不按帧推进 */
  }

  function state() {
    return {
      mode,
      seed,
      level,
      turn,
      dice,
      players: roster.map((p) => ({
        id: p.id,
        name: p.name,
        pos: p.pos,
        rollCount: p.rollCount,
      })),
      snakes: { ...SNAKES },
      ladders: { ...LADDERS },
      winner,
      over: Boolean(winner),
      moves: moves.map((m) => ({ ...m })),
      moveCount: moves.length,
      lastMove: lastMove ? { ...lastMove } : null,
      playerCount: roster.length,
      size: SIZE,
      last: LAST,
    };
  }

  function result() {
    if (!winner) return null;
    const w = findPlayer(winner);
    const scores = {};
    for (const p of roster) scores[p.id] = p.id === winner ? 1 : 0;

    let text;
    if (mode === 'ai') {
      text = winner === 'p1'
        ? `你先到 100，共掷 ${w.rollCount} 次`
        : `电脑先到 100，你掷了 ${(findPlayer('p1') || w).rollCount} 次`;
    } else if (mode === 'solo') {
      text = `抵达 100，共掷 ${w.rollCount} 次`;
    } else {
      text = `${w.name} 先到 100，共掷 ${w.rollCount} 次`;
    }

    return { over: true, winner, scores, text };
  }

  reset();

  return { submit, step, state, result, reset };
}
