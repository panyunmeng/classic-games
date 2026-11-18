/**
 * 飞行棋 · 纯逻辑（无 DOM、无真随机、无真实时钟；骰子全部由注入的 rng 产生）。
 *
 * 先把规则拆成不可再分的事实，再定数据结构：
 *
 * 1. 棋盘：52 格环形跑道 + 每色 6 格终点跑道。
 *    每色起点在环上相隔 13 格（52 / 4）：红 12、蓝 25、绿 38、黄 51。
 *    于是「某色第 p 格」就是环上 (start + p) % 52 —— progress 0..51 走环，
 *    progress 52..57 走自己的 6 格终点跑道，57 即终点。基地里的子记 progress = -1。
 *
 * 2. 安全格：每色起点格，以及起点 + 8 格（8 格间距）——
 *    8 格是标准飞行棋的“星格”间距，环上正好落出 8 个安全格：7/12/20/25/33/38/46/51。
 *    安全格上不撞子；又因为异色不可叠同一格，安全格被异色占住时该走法直接非法
 *    （既撞不掉也站不上去），这会带来短暂封路，但对手一走就解开，不会死锁。
 *
 * 3. 掷骰：1..6 均匀分布，随机源只能是注入的 rng（联机/回放要同种子同结果）。
 *    任意点数都能出子：基地 → 起点格（-1 → 0）。6 点走完额外再掷一次，
 *    连续 6 不设上限（需求允许简化；骰子由 rng 决定，实际不会死循环）。
 *
 * 4. 走子步数 = 骰点。progress + dice > 57 的走法非法：终点跑道只有 6 格，
 *    越过终点不是“多走几步”，而是没有落点，必须先精确踩到 57。
 *
 * 5. 撞子：落点在环上、且不是安全格、且有异色子 → 那些子全部回基地（多子被叠时一起回）。
 *    同色可叠同一格；异色永远不共格。
 *
 * 6. 胜负：4 子全部到 progress 57 即胜，无平局。
 *
 * 对局只用红(p1)/蓝(p2)两色；绿/黄两色的起点、基地、终点跑道只在棋盘上作装饰，
 * 逻辑里不持有它们的棋子（pieces 只有两行）。
 */
import { createRng } from '../../shared/rng.js';
import { pickMove } from './ai.mjs';

export const PIECES = 4; // 每色 4 子
export const RING = 52; // 环形跑道格数
export const LANE = 6; // 每色终点跑道格数
export const GOAL = RING + LANE - 1; // 57：终点（终点跑道最后一格）
export const HOME = -1; // 基地

/** 四色几何：起点在环上相差 13 格，红为 p1、蓝为 p2 */
export const COLORS = [
  { key: 'red', hex: '#f2445c', start: 12 },
  { key: 'blue', hex: '#3d8bfd', start: 25 },
  { key: 'green', hex: '#2fbf71', start: 38 },
  { key: 'yellow', hex: '#f5b301', start: 51 },
];

/** 安全格 = 每色起点格 + 起点 + 8 格；去重后 8 个 */
export const SAFE_CELLS = COLORS.flatMap((c) => [c.start, (c.start + 8) % RING]).sort((a, b) => a - b);
const SAFE_SET = new Set(SAFE_CELLS);

export function isSafeCell(cell) {
  return SAFE_SET.has(cell);
}

/** 某色第 progress 格（0..51）落在环上的格号 */
export function ringIndexAt(playerIndex, progress) {
  return (COLORS[playerIndex].start + progress) % RING;
}

/** 开局棋子：两色各 4 子全在基地 */
export function initialPieces() {
  return [0, 1].map(() => Array.from({ length: PIECES }, () => ({ home: true, progress: HOME })));
}

function clonePieces(pieces) {
  return pieces.map((row) => row.map((p) => ({ home: p.home, progress: p.progress })));
}

/** 环上某格的所有棋子（含自己与异色） */
function occupantsAt(pieces, cell) {
  const out = [];
  for (let pi = 0; pi < pieces.length; pi++) {
    for (let k = 0; k < PIECES; k++) {
      const p = pieces[pi][k];
      if (p.home || p.progress > RING - 1) continue;
      if ((COLORS[pi].start + p.progress) % RING === cell) out.push({ player: pi, piece: k });
    }
  }
  return out;
}

/**
 * 当前骰点下的全部合法着法（纯函数，只读 pieces）。
 * 着法对象：{ action, piece, from, to, deploy, goal, capture[], ringIndex, safe }
 */
export function legalMoves(pieces, playerIndex, dice) {
  const out = [];
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) return out;
  const me = pieces[playerIndex];
  if (!me) return out;
  const start = COLORS[playerIndex].start;

  for (let k = 0; k < PIECES; k++) {
    const p = me[k];
    if (p.progress === GOAL) continue; // 已到终点，退出棋盘

    if (p.home) {
      // 出子：任意点数可出，落到自己的起点格；起点是安全格，被异色占住时既撞不掉也叠不了
      const opp = occupantsAt(pieces, start).filter((o) => o.player !== playerIndex);
      if (opp.length) continue;
      out.push({
        action: `move:${k}`,
        piece: k,
        from: HOME,
        to: 0,
        deploy: true,
        goal: false,
        capture: [],
        ringIndex: start,
        safe: true,
      });
      continue;
    }

    const to = p.progress + dice;
    if (to > GOAL) continue; // 不能越过终点

    const mv = {
      action: `move:${k}`,
      piece: k,
      from: p.progress,
      to,
      deploy: false,
      goal: to === GOAL,
      capture: [],
      ringIndex: null,
      safe: false,
    };

    if (to <= RING - 1) {
      const cell = (start + to) % RING;
      mv.ringIndex = cell;
      mv.safe = isSafeCell(cell);
      const opp = occupantsAt(pieces, cell).filter((o) => o.player !== playerIndex);
      if (opp.length) {
        if (mv.safe) continue; // 安全格不撞，也不能异色叠格
        mv.capture = opp; // 踩到非安全格上的异色子：全部回基地
      }
    }

    out.push(mv);
  }

  return out;
}

/** 执行一步着法，返回新的棋子模型（不修改入参） */
export function applyMoveTo(pieces, playerIndex, move) {
  const next = clonePieces(pieces);
  for (const c of move.capture || []) {
    next[c.player][c.piece] = { home: true, progress: HOME };
  }
  next[playerIndex][move.piece] = { home: false, progress: move.to };
  return next;
}

/**
 * @param {{seed?:number, mode?:string, players?:string[], level?:number,
 *          setup?:{p1?:number[], p2?:number[]}}} opts
 * setup 注入开局棋子位置（-1 基地 / 0..57 进度），仅用于单测与回放复现。
 */
export function createGame({ seed = 1, mode = 'solo', players, level = 1, setup = null } = {}) {
  let rng = createRng(seed);
  const IDS = ['p1', 'p2'];

  let pieces;
  let turn;
  let phase; // 'roll' 待掷骰 | 'move' 待走子 | 'over' 已结束
  let dice;
  let lastDice;
  let extraRoll;
  let moves;
  let lastMove;
  let winner;
  let moveCount;

  function normalizePlayer(pid) {
    if (pid === 'p1' || pid === 0 || pid === '0') return 0;
    if (pid === 'p2' || pid === 1 || pid === '1') return 1;
    return -1;
  }

  const otherIndex = (i) => (i === 0 ? 1 : 0);

  function finishedCount(pi) {
    return pieces[pi].filter((p) => p.progress === GOAL).length;
  }

  /** 把 setup 写进新建的棋盘（-1 = 基地） */
  function applySetup() {
    if (!setup) return;
    for (let pi = 0; pi < 2; pi++) {
      const list = setup[IDS[pi]] || setup[pi];
      if (!Array.isArray(list)) continue;
      for (let k = 0; k < PIECES; k++) {
        const pr = list[k];
        if (!Number.isInteger(pr) || pr < HOME || pr > GOAL) continue;
        pieces[pi][k] = pr === HOME ? { home: true, progress: HOME } : { home: false, progress: pr };
      }
    }
  }

  function reset() {
    rng = createRng(seed); // 重置 = 同种子重开，骰子序列也从头来过
    pieces = initialPieces();
    applySetup();
    turn = 'p1';
    phase = 'roll';
    dice = null;
    lastDice = null;
    extraRoll = false;
    moves = [];
    lastMove = null;
    winner = null;
    moveCount = 0;
  }

  /** 一次走子/跳过后的收尾：6 点留回合再掷，否则换人 */
  function endTurn(d) {
    dice = null;
    lastDice = d;
    moves = [];
    phase = 'roll';
    if (d === 6) {
      extraRoll = true; // 6 点：本回合再掷一次，不换人
    } else {
      extraRoll = false;
      turn = IDS[otherIndex(normalizePlayer(turn))];
    }
  }

  function doRoll(pi) {
    const d = rng.int(6) + 1;
    dice = d;
    lastDice = d;
    extraRoll = d === 6;
    moves = legalMoves(pieces, pi, d);
    phase = 'move';
    moveCount += 1;
    return { ok: true, dice: d, moves: moves.map((m) => m.action) };
  }

  function doMove(pi, pieceIndex) {
    const mv = moves.find((m) => m.piece === pieceIndex);
    if (!mv) return { ok: false, error: '这颗棋子这步走不了' };

    const d = dice;
    pieces = applyMoveTo(pieces, pi, mv);
    lastMove = { ...mv, capture: mv.capture.map((c) => ({ ...c })) };
    moveCount += 1;
    const captured = mv.capture.length;

    if (finishedCount(pi) === PIECES) {
      winner = IDS[pi];
      phase = 'over';
      turn = null;
      dice = null;
      lastDice = d;
      extraRoll = false;
      moves = [];
      return { ok: true, win: true, capture: captured, goal: mv.goal };
    }

    endTurn(d);
    return { ok: true, capture: captured, goal: mv.goal };
  }

  function doSkip(pi) {
    if (moves.length > 0) return { ok: false, error: '还有子可走，不能跳过' };
    const d = dice;
    moveCount += 1;
    endTurn(d);
    return { ok: true, skipped: true };
  }

  /**
   * 单机（solo）模式的蓝方由逻辑内自动走：确定性贪心，和 ai.mjs 同一套评分，
   * 所以单人模式也能完整结束一局（否则只有红方在动，蓝方的回合会卡住）。
   */
  function autoPlayOpponent() {
    let guard = 0;
    while (!winner && turn === 'p2' && guard < 600) {
      guard += 1;
      if (phase === 'roll') {
        doRoll(1);
      } else if (phase === 'move') {
        const best = pickMove(moves, level >= 2 ? level : 2);
        if (best) doMove(1, best.piece);
        else doSkip(1);
      } else {
        break;
      }
    }
  }

  function submit(playerId, action) {
    const pi = normalizePlayer(playerId);
    if (pi < 0) return { ok: false, error: '无效玩家' };
    if (winner) return { ok: false, error: '本局已结束' };
    if (!turn || IDS[pi] !== turn) return { ok: false, error: '还没轮到你' };
    if (typeof action !== 'string') return { ok: false, error: '无效动作' };

    let res;
    if (action === 'roll') {
      if (phase !== 'roll') return { ok: false, error: '请先走完这步棋' };
      res = doRoll(pi);
    } else if (action === 'skip') {
      if (phase !== 'move') return { ok: false, error: '还没掷骰' };
      res = doSkip(pi);
    } else {
      const m = /^move:(\d+)$/.exec(action);
      if (!m) return { ok: false, error: `无效动作：${action}` };
      if (phase !== 'move') return { ok: false, error: '请先掷骰' };
      const idx = Number(m[1]);
      if (idx < 0 || idx >= PIECES) return { ok: false, error: '没有这颗棋子' };
      res = doMove(pi, idx);
    }

    if (res.ok && mode === 'solo') autoPlayOpponent();
    return res;
  }

  function step() {
    /* 回合制：由 submit 直接驱动，不需要按帧推进 */
  }

  function state() {
    return {
      turn,
      phase,
      dice,
      lastDice,
      extraRoll,
      winner,
      over: Boolean(winner),
      moves: moves.map((m) => ({ ...m, capture: m.capture.map((c) => ({ ...c })) })),
      lastMove: lastMove ? { ...lastMove, capture: lastMove.capture.map((c) => ({ ...c })) } : null,
      players: IDS.map((id, pi) => ({
        id,
        color: COLORS[pi].key,
        hex: COLORS[pi].hex,
        start: COLORS[pi].start,
        finished: finishedCount(pi),
        pieces: pieces[pi].map((p) => ({ home: p.home, progress: p.progress })),
      })),
      moveCount,
      canRoll: phase === 'roll' && !winner,
      hud: `红 ${finishedCount(0)}/4 · 蓝 ${finishedCount(1)}/4`,
      mode,
      seed,
      level,
      playersRequested: Array.isArray(players) ? players.slice() : ['p1', 'p2'],
    };
  }

  function result() {
    if (!winner) return null;
    const f = [finishedCount(0), finishedCount(1)];
    const name = winner === 'p1' ? '红方' : '蓝方';
    return {
      over: true,
      winner,
      scores: { p1: f[0], p2: f[1] },
      score: f[0] * 25 + (winner === 'p1' ? 100 : 0),
      text: `${name} 4 子全部到达终点 · 红 ${f[0]}/4 · 蓝 ${f[1]}/4`,
    };
  }

  reset();

  return { submit, step, state, result, reset };
}
