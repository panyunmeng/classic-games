/**
 * 管道连接 · 纯逻辑（无 DOM、无 Math.random、无 Date.now）。
 *
 * 规则事实与推导：
 * - 网格 N×N（默认 6，可 5 / 7）；每格是一段管道：端点(1 口)/直管(2 口相对)/弯管(2 口相邻)/三通(3 口)/四通(4 口)。
 * - 方向用 4 位掩码表示：上=1 / 右=2 / 下=4 / 左=8；顺时针旋转 90° = 掩码循环左移一位，rot 记旋转次数(0~3)。
 * - 生成保证有解：先用可播种 rng 随机 DFS 生成一棵覆盖全格的生成树，每格开口=树上的邻居方向 → 解状态必然连通；
 *   再把每格 rot 随机打乱，使初始一般未连通（旋转每段管道即可复原解）。
 * - 生成树的叶子(度 1)作端点：挑 1 个水源，其余至多 3 个作终点，端点用固定 'endpoint' 形状(口不随旋转变化，旋转不耗时)。
 * - 胜利判定：从水源沿"双方都有开口"的双向连接 BFS(种子水从水源单向灌入)，水源自己的开口是注入口，
 *   到达的每格必须由双向链接进入；所有终点都被灌到即胜。
 * - time 是墙钟概念，逻辑层禁止 Date.now：state().time 恒为 0 作为占位，真实计时由 render 用 view.time 处理。
 */
import { createRng } from '../../shared/rng.js';

const UP = 1;
const RIGHT = 2;
const DOWN = 4;
const LEFT = 8;
const DIRS = [
  { bit: UP, dx: 0, dy: -1, opp: DOWN },
  { bit: RIGHT, dx: 1, dy: 0, opp: LEFT },
  { bit: DOWN, dx: 0, dy: 1, opp: UP },
  { bit: LEFT, dx: -1, dy: 0, opp: RIGHT },
];

export const DEFAULT_SIZE = 6;
export const ALLOWED_SIZES = [5, 6, 7];
const MAX_PIPE_MASK = 15;

function popcount(mask) {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}

/** 顺时针旋转 n 次：4 位循环左移 */
function rotateMask(mask, n) {
  const k = ((n % 4) + 4) % 4;
  return ((mask << k) | (mask >> (4 - k))) & 15;
}

/**  canonical 基础形状：0 口=0；度 2 中"相对"用 5(上下)、"相邻"用 3(上右)；三通=7；四通=15；端点=1(单上口) */
function baseMask(shape) {
  switch (shape) {
    case 'straight': return 5;
    case 'bend': return 3;
    case 'tee': return 7;
    case 'cross': return 15;
    case 'endpoint': return 1;
    default: return 0;
  }
}

export function createGame({ seed = 1, mode = 'solo', level = 1, size = DEFAULT_SIZE } = {}) {
  let n = ALLOWED_SIZES.includes(size) ? size : DEFAULT_SIZE;
  let rng = createRng(seed);
  let grid = [];          // 扁平 n*n，每格 {type, rot, base, solRot}
  let endpoints = [];     // [{x,y,role:'source'|'sink'}]
  let solution = [];      // 解状态每格开口掩码
  let solved = false;
  let steps = 0;
  let hintCell = null;
  let seedUsed = seed;

  const idx = (x, y) => y * n + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < n && y < n;

  /** 每格"当前"开口掩码；端点固定不随 rot 变 */
  function maskOf(cell) {
    if (cell.type === 'endpoint') return cell.base;
    return rotateMask(cell.base, cell.rot);
  }

  function build() {
    rng = createRng(seedUsed);
    solved = false;
    steps = 0;
    hintCell = null;

    // 1) 随机 DFS 生成覆盖全格的生成树。edges[i] 为格 i 连向邻居的方向位掩码。
    const total = n * n;
    const visited = new Uint8Array(total);
    const edges = new Uint8Array(total);
    const sx = rng.int(n);
    const sy = rng.int(n);
    const stack = [{ x: sx, y: sy }];
    visited[idx(sx, sy)] = 1;

    while (stack.length) {
      const cur = stack[stack.length - 1];
      const options = [];
      for (const d of DIRS) {
        const nx = cur.x + d.dx;
        const ny = cur.y + d.dy;
        if (inBounds(nx, ny) && !visited[idx(nx, ny)]) options.push(d);
      }
      if (!options.length) {
        stack.pop();
        continue;
      }
      const d = rng.pick(options);
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      edges[idx(cur.x, cur.y)] |= d.bit;
      edges[idx(nx, ny)] |= d.opp;
      visited[idx(nx, ny)] = 1;
      stack.push({ x: nx, y: ny });
    }

    // 2) 由生成树确定每格形状与解状态开口；挖出度 1 的叶子作为端点候选。
    solution = new Array(total);
    const leaves = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        const mask = edges[i];
        solution[i] = mask;
        if (popcount(mask) === 1) leaves.push({ x, y, mask });
      }
    }

    // 3) 选端点：随机洗牌叶子，第 1 个作水源，其余全部作终点。
    //    生成树所有叶子都是 1 口，必须做成端点形状（否则普通管道无法表达单口）。
    //    端点开口固定为其在生成树里的方向，旋转无意义。
    const shuffled = rng.shuffle(leaves);
    const endpointSet = new Map();
    endpoints = shuffled.map((leaf, k) => {
      const role = k === 0 ? 'source' : 'sink';
      endpointSet.set(idx(leaf.x, leaf.y), { role, bit: leaf.mask });
      return { x: leaf.x, y: leaf.y, role };
    });

    grid = new Array(total);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        const mask = solution[i];
        const degree = popcount(mask);
        const ep = endpointSet.get(i);
        if (ep) {
          grid[i] = { type: 'endpoint', rot: 0, base: ep.bit, solRot: 0 };
          continue;
        }
        // 依据开口形态定基础形状，解旋转量 solRot 满足 rotateMask(base, solRot) === mask。
        let type;
        let base;
        if (degree === 1) {
          // 未选为端点的生成树叶子：用端点形状但 role=null（封口死胡同），旋转无意义。
          type = 'endpoint';
          base = mask;
        } else if (degree === 2) {
          const opposite = mask === (UP | DOWN) || mask === (LEFT | RIGHT);
          type = opposite ? 'straight' : 'bend';
          base = baseMask(type);
        } else if (degree === 3) {
          type = 'tee';
          base = baseMask(type); // 7 = 上右下，缺左
        } else {
          type = 'cross';
          base = baseMask(type); // 15
        }
        let solRot = 0;
        while (solRot < 4 && rotateMask(base, solRot) !== mask) solRot++;
        grid[i] = { type, rot: 0, base, solRot: solRot % 4 };
      }
    }

    // 4) 打乱每段非端点管道的 rot；端点 rot 恒 0，不受影响。
    for (const cell of grid) {
      if (cell.type !== 'endpoint') cell.rot = rng.int(4);
    }
    // 极小概率打乱后恰巧全连通(6×6 约 2^-30)，迭代找到第一个可打破连通的非端点格多转一格。
    let guard = 0;
    while (isSolved() && guard < total) {
      const cell = grid[guard];
      if (cell.type !== 'endpoint') cell.rot = (cell.rot + 1) % 4;
      guard++;
    }
  }

  /** 从水源灌水，返回被灌到的格子布尔数组；进入邻格要求邻格与当前格双向开口。 */
  function flood() {
    const reached = new Uint8Array(grid.length);
    const source = endpoints.find((e) => e.role === 'source');
    if (!source) return reached;
    const qi = [idx(source.x, source.y)];
    reached[qi[0]] = 1;
    let head = 0;
    while (head < qi.length) {
      const i = qi[head++];
      const x = i % n;
      const y = (i / n) | 0;
      const mask = maskOf(grid[i]);
      for (const d of DIRS) {
        if (!(mask & d.bit)) continue;
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (reached[j]) continue;
        if (!(maskOf(grid[j]) & d.opp)) continue; // 邻格必须有朝向我的开口
        reached[j] = 1;
        qi.push(j);
      }
    }
    return reached;
  }

  function isSolved() {
    const reached = flood();
    return endpoints
      .filter((e) => e.role === 'sink')
      .every((e) => reached[idx(e.x, e.y)] === 1);
  }

  function submit(playerId, action) {
    if (action === 'reset') {
      build();
      return { ok: true };
    }
    if (action === 'hint') {
      const reached = flood();
      let target = null;
      // 优先提示"当前未灌到、且解法需要旋转"的格子，帮助玩家推进连通。
      for (let i = 0; i < grid.length && !target; i++) {
        if (grid[i].type !== 'endpoint' && grid[i].rot !== grid[i].solRot && !reached[i]) target = i;
      }
      for (let i = 0; i < grid.length && !target; i++) {
        if (grid[i].type !== 'endpoint' && grid[i].rot !== grid[i].solRot) target = i;
      }
      hintCell = target == null ? null : { x: target % n, y: (target / n) | 0 };
      return { ok: true, hint: hintCell };
    }
    const m = /^rot:(\d+),(\d+)$/.exec(action);
    if (!m) return { ok: false, error: '非法操作' };
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (!inBounds(x, y)) return { ok: false, error: '坐标越界' };
    const cell = grid[idx(x, y)];
    if (!cell) return { ok: false, error: '坐标越界' };
    if (cell.type === 'endpoint') return { ok: false, error: '端点不可旋转' };
    cell.rot = (cell.rot + 1) % 4;
    steps++;
    hintCell = null;
    solved = isSolved();
    return { ok: true, solved };
  }

  function step(_dt, _actions) {
    // 纯回合制：不推进任何状态；计时由 render 用 view.time 处理。
  }

  function state() {
    const wet = flood();
    return {
      turn: 'p1',
      grid: grid.map((c) => ({ type: c.type, rot: c.rot, base: c.base, solRot: c.solRot })),
      endpoints: endpoints.map((e) => ({ ...e })),
      wet: Array.from(wet),
      solved,
      steps,
      time: 0,
      hint: hintCell ? { ...hintCell } : null,
      n,
      seed: seedUsed,
    };
  }

  function result() {
    // 胜利不弹结算遮罩；由 render 依据 state().solved 显示完成提示，避免挡住 reset/hint 按钮。
    return null;
  }

  function setSize(next) {
    if (!ALLOWED_SIZES.includes(next) || next === n) return n;
    n = next;
    build();
    return n;
  }

  // 仅为单测提供的确定性辅助（仿 games/snake 的 setWrap）：把管道旋到解状态 / 强制打乱 / 查当前掩码。
  function applySolution() {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].type !== 'endpoint') grid[i].rot = grid[i].solRot;
    }
    solved = isSolved();
    return solved;
  }

  function scramble() {
    for (const cell of grid) {
      if (cell.type !== 'endpoint') cell.rot = rng.int(4);
    }
    solved = isSolved();
    return solved;
  }

  function maskAt(x, y) {
    return inBounds(x, y) ? maskOf(grid[idx(x, y)]) : -1;
  }

  build();

  return {
    submit, step, state, result, reset: () => submit('p1', 'reset'), setSize,
    applySolution, scramble, maskAt, solution: () => solution.slice(),
  };
}
