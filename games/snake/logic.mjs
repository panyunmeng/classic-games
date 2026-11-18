/**
 * 贪吃蛇 · 纯逻辑（无 DOM、无真随机）。
 *
 * 规则事实：
 * - 网格 20×24，初始长度 3，向右移动；
 * - 每吃一个果实 +10 分，长度 +1，步进间隔从 0.13 s 逐渐降到 0.07 s；
 * - 撞墙 / 咬到自己结束；穿墙模式下越界从对侧回来；
 * - 反向输入被忽略（否则一步自撞，不是玩家意图）。
 */
import { createRng } from '../../shared/rng.js';

export const COLS = 20;
export const ROWS = 24;

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export function createGame({ seed = 1, mode = 'solo' } = {}) {
  const rng = createRng(seed);
  let snake;
  let dir;
  let nextDir;
  let food;
  let score;
  let over;
  let wrap = false;
  let acc;
  let interval;
  let grow;
  let eaten;
  let steps;

  function emptyCells() {
    const used = new Set(snake.map((s) => `${s.x},${s.y}`));
    const cells = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!used.has(`${x},${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }

  function spawnFood() {
    const cells = emptyCells();
    if (!cells.length) return { x: -1, y: -1 };
    return rng.pick(cells);
  }

  function reset() {
    const cy = Math.floor(ROWS / 2);
    snake = [
      { x: 8, y: cy },
      { x: 7, y: cy },
      { x: 6, y: cy },
    ];
    dir = { ...DIRS.right };
    nextDir = { ...dir };
    score = 0;
    over = false;
    wrap = false;
    acc = 0;
    interval = 0.13;
    grow = 0;
    eaten = 0;
    steps = 0;
    food = spawnFood();
  }

  function isOpposite(a, b) {
    return a.x + b.x === 0 && a.y + b.y === 0;
  }

  function submit(playerId, action) {
    const d = DIRS[action];
    if (!d) return { ok: false, error: '无效方向' };
    if (over) return { ok: false, error: '本局已结束' };
    if (isOpposite(d, dir)) return { ok: false, error: '不能直接反向' };
    nextDir = { ...d };
    return { ok: true };
  }

  function advance() {
    if (over) return;
    dir = { ...nextDir };
    let nx = snake[0].x + dir.x;
    let ny = snake[0].y + dir.y;

    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      if (wrap) {
        nx = (nx + COLS) % COLS;
        ny = (ny + ROWS) % ROWS;
      } else {
        over = true;
        return;
      }
    }

    // 咬到自己：尾巴本步会移走，除非正在成长
    const limit = grow > 0 ? snake.length : snake.length - 1;
    for (let i = 0; i < limit; i++) {
      if (snake[i].x === nx && snake[i].y === ny) {
        over = true;
        return;
      }
    }

    snake.unshift({ x: nx, y: ny });

    if (nx === food.x && ny === food.y) {
      score += 10;
      grow += 1;
      eaten += 1;
      interval = Math.max(0.07, interval * 0.96);
      food = spawnFood();
    }

    if (grow > 0) grow -= 1;
    else snake.pop();

    steps += 1;
  }

  function step(dt) {
    if (over) return;
    acc += dt;
    let guard = 0;
    while (acc >= interval && !over && guard < 8) {
      acc -= interval;
      advance();
      guard += 1;
    }
  }

  function setWrap(v) {
    wrap = Boolean(v);
    return wrap;
  }

  function isWrap() {
    return wrap;
  }

  function state() {
    return {
      snake: snake.map((s) => ({ ...s })),
      dir: { ...dir },
      food: { ...food },
      score,
      over,
      wrap,
      interval,
      eaten,
      steps,
      cols: COLS,
      rows: ROWS,
      turn: null,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: `长度 ${snake.length} · 吃掉 ${eaten} 个果实`,
    };
  }

  reset();

  return { submit, step, state, result, reset, setWrap, isWrap };
}
