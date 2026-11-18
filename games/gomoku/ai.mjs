/**
 * 五子棋 · AI（纯函数，禁用 Math.random）。
 *
 * 设计（第一性原则）：
 * - 棋型价值来自“五连窗口”：活四含 2 个获胜窗口、冲四含 1 个，
 *   活三含多个三窗口，因此用窗口计数天然区分活/冲，无需手写模式表；
 * - 候选点只取“与已有棋子相邻 ≤2 格”的空格，空盘取天元，避免全盘盲搜；
 * - 每个候选点打分 = 己方进攻分 + 防守权重 × 对手在此的进攻分 + 中心偏好；
 * - level 1/2/3 = 深度 1/2/3 的 alpha-beta 搜索，节点内只改工作副本，
 *   不改传入 state；不用随机数，同局面恒定出招。
 *
 * 复杂度上界：候选 ≤10、深度 ≤3、叶子用五连窗口评估，远小于 3 秒预算。
 */

import { SIZE } from './logic.mjs';

const WIN = 5;
const SCORE = [0, 1, 12, 120, 1500, 100000]; // 索引=窗口内同色子数(1..5)
const BIG = 10000000;
const DEF_WEIGHT = 1.15; // 防守略重于进攻，避免只顾自己连子
const INF = 1e15;

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function normalizeColor(pid) {
  if (pid === 'p1' || pid === '0' || pid === 0) return 1;
  if (pid === 'p2' || pid === '1' || pid === 1) return 2;
  return 0;
}

/** 检测 (x,y) 落 color 后是否形成五连（搜索中快速判终局） */
function isWin(b, x, y, color) {
  for (const [dx, dy] of DIRS) {
    let n = 1;
    for (let s = 1; s < SIZE; s++) {
      const nx = x + dx * s;
      const ny = y + dy * s;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || b[ny][nx] !== color) break;
      n++;
    }
    for (let s = 1; s < SIZE; s++) {
      const nx = x - dx * s;
      const ny = y - dy * s;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || b[ny][nx] !== color) break;
      n++;
    }
    if (n >= WIN) return true;
  }
  return false;
}

/**
 * 某点落 color 的局部价值：把该点视作 color，累加所有包含该点的五连窗口分数。
 * 这样活四/冲四/活三自然分级，同时兼顾两个方向交叉点。
 */
function pointScore(b, x, y, color) {
  let total = 0;
  const c = Math.floor((SIZE - 1) / 2);
  for (const [dx, dy] of DIRS) {
    for (let off = -4; off <= 0; off++) {
      let cnt = 0;
      let ok = true;
      for (let k = 0; k < WIN; k++) {
        const px = x + dx * (off + k);
        const py = y + dy * (off + k);
        if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) { ok = false; break; }
        if (px === x && py === y) { cnt++; continue; }
        const v = b[py][px];
        if (v !== 0 && v !== color) { ok = false; break; }
        if (v === color) cnt++;
      }
      if (ok) total += SCORE[cnt];
    }
  }
  // 中心偏好：越靠近天元越优先（早期避免角落开局）
  total += (SIZE - (Math.abs(x - c) + Math.abs(y - c))) * 2;
  return total;
}

/** 生成候选点（带静态打分排序），只扫描已有棋子附近的空格 */
function genMoves(b, who, other, limit) {
  const list = [];
  const touched = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (b[y][x] !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          if (b[ny][nx] !== 0) { near = true; break; }
        }
      }
      if (near) touched.push({ x, y });
    }
  }

  const cells = touched.length ? touched : [{ x: Math.floor(SIZE / 2), y: Math.floor(SIZE / 2) }];
  for (const { x, y } of cells) {
    const atk = pointScore(b, x, y, who);
    const def = pointScore(b, x, y, other);
    list.push({ x, y, score: atk + DEF_WEIGHT * def });
  }
  list.sort((a, b2) => b2.score - a.score);
  return list.slice(0, limit);
}

/**
 * 整盘静态评估：从 me 视角，五连窗口汇总（一次扫描同时算双方）。
 * 对每个方向，从“棋盘边缘起点”出发枚举所有长度 5 的窗口，保证每个窗口恰好计一次。
 */
function evaluate(b, me, opp) {
  let mine = 0;
  let theirs = 0;

  // 统计单个窗口；窗口若同时含双方棋子则无价值（被封堵）
  const scoreWindow = (x, y, dx, dy) => {
    let cm = 0;
    let co = 0;
    for (let k = 0; k < WIN; k++) {
      const v = b[y + dy * k][x + dx * k];
      if (v === me) cm++;
      else if (v === opp) co++;
      else if (v !== 0) return; // 不会因两边都有棋子而误判：下面显式检查
    }
    if (cm && co) return;
    if (cm) mine += SCORE[cm];
    else if (co) theirs += SCORE[co];
  };

  // 横：每行起点 (0,y)，方向 (1,0)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x + WIN <= SIZE; x++) scoreWindow(x, y, 1, 0);
  }
  // 竖：每列起点 (x,0)，方向 (0,1)
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y + WIN <= SIZE; y++) scoreWindow(x, y, 0, 1);
  }
  // 主对角 (\)：上边缘 x=0..SIZE-WIN 与左边缘 y=1..SIZE-WIN
  for (let y = 0; y + WIN <= SIZE; y++) scoreWindow(0, y, 1, 1);
  for (let x = 1; x + WIN <= SIZE; x++) scoreWindow(x, 0, 1, 1);
  // 副对角 (/)：下边缘 y=SIZE-1 起点与右边缘 x=SIZE-1 起点，方向 (1,-1)
  for (let x = 0; x + WIN <= SIZE; x++) scoreWindow(x, SIZE - 1, 1, -1);
  for (let y = SIZE - 2; y >= WIN - 1; y--) scoreWindow(0, y, 1, -1);

  return mine - DEF_WEIGHT * theirs;
}

/**
 * 极小极大 + alpha-beta。turn 为当前行棋方颜色。
 * last = {x,y,color} 表示刚落的子，用于终局判定。
 */
function search(b, turn, me, opp, depth, alpha, beta, last, limit) {
  if (last && isWin(b, last.x, last.y, last.color)) {
    return last.color === me ? BIG + depth : -(BIG + depth);
  }
  if (depth <= 0) return evaluate(b, me, opp);

  const moves = genMoves(b, turn, turn === me ? opp : me, limit);
  if (!moves.length) return evaluate(b, me, opp);

  if (turn === me) {
    let best = -INF;
    for (const m of moves) {
      b[m.y][m.x] = me;
      const v = search(b, opp, me, opp, depth - 1, alpha, beta, { x: m.x, y: m.y, color: me }, limit);
      b[m.y][m.x] = 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = INF;
  for (const m of moves) {
    b[m.y][m.x] = opp;
    const v = search(b, me, me, opp, depth - 1, alpha, beta, { x: m.x, y: m.y, color: opp }, limit);
    b[m.y][m.x] = 0;
    if (v < best) best = v;
    if (v < beta) beta = v;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * @param {{board:number[][], turn:string}} state
 * @param {'p1'|'p2'} playerId
 * @param {1|2|3} level
 * @returns {string|null} 'place:x,y' 或无可落点时 null
 */
export function chooseMove(state, playerId, level = 1) {
  const lv = Math.max(1, Math.min(3, Number(level) || 1));
  const depth = lv; // 1/2/3 层
  const limit = lv === 1 ? 16 : (lv === 2 ? 12 : 9);
  const me = normalizeColor(playerId);
  if (!me) return null;

  const opp = me === 1 ? 2 : 1;
  const b = state.board.map((row) => row.slice()); // 工作副本，绝不改 state

  // 必须先确认当前回合确实属于我，否则不替对手走（联机/异常保护）
  if (state.turn) {
    const t = normalizeColor(state.turn);
    if (t && t !== me) return null;
  }

  const rootMoves = genMoves(b, me, opp, limit);
  if (!rootMoves.length) return null;

  let bestMove = rootMoves[0];
  let bestVal = -INF;
  let alpha = -INF;
  const beta = INF;

  for (const m of rootMoves) {
    b[m.y][m.x] = me;
    const v = search(b, opp, me, opp, depth - 1, alpha, beta, { x: m.x, y: m.y, color: me }, limit);
    b[m.y][m.x] = 0;
    if (v > bestVal) {
      bestVal = v;
      bestMove = m;
    }
    if (v > alpha) alpha = v;
  }

  return `place:${bestMove.x},${bestMove.y}`;
}
