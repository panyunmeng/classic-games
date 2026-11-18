/**
 * 2048 · 纯逻辑。
 *
 * 规则事实：
 * - 4×4 棋盘，开局两个随机块（90% 是 2，10% 是 4）；
 * - 一次滑动里每块最多合并一次（4 4 4 4 → 8 8，不是 16）；
 * - 每次有效移动后生成一个新块；无法移动且无空格时结束；
 * - 合成 2048 记为通关，但可以继续玩；
 * - 撤销只保留一步（再撤销回到更早状态需要整局快照，收益不值）。
 */
import { createRng } from '../../shared/rng.js';

export const SIZE = 4;

const DIRS = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
};

function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

export function createGame({ seed = 1 } = {}) {
  const rng = createRng(seed);
  let grid;
  let score;
  let over;
  let won;
  let moves;
  let undoStack;

  function cloneGrid(g = grid) {
    return g.map((row) => row.slice());
  }

  function emptyCells() {
    const out = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (grid[y][x] === 0) out.push({ x, y });
      }
    }
    return out;
  }

  function addRandom() {
    const cells = emptyCells();
    if (!cells.length) return null;
    const cell = rng.pick(cells);
    grid[cell.y][cell.x] = rng.chance(0.9) ? 2 : 4;
    return cell;
  }

  function reset() {
    grid = emptyGrid();
    score = 0;
    over = false;
    won = false;
    moves = 0;
    undoStack = [];
    addRandom();
    addRandom();
  }

  /** 把一行压缩 + 合并，返回新行与得分 */
  function collapse(line) {
    const nums = line.filter((n) => n !== 0);
    const out = [];
    let gained = 0;
    let merged = false;
    for (let i = 0; i < nums.length; i++) {
      if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
        const v = nums[i] * 2;
        out.push(v);
        gained += v;
        merged = true;
        i++;
      } else {
        out.push(nums[i]);
      }
    }
    while (out.length < SIZE) out.push(0);
    return { out, gained, merged };
  }

  function readLine(dir, index) {
    const line = [];
    for (let i = 0; i < SIZE; i++) {
      if (dir === 'left' || dir === 'right') {
        const x = dir === 'left' ? i : SIZE - 1 - i;
        line.push(grid[index][x]);
      } else {
        const y = dir === 'up' ? i : SIZE - 1 - i;
        line.push(grid[y][index]);
      }
    }
    return line;
  }

  function writeLine(dir, index, line) {
    for (let i = 0; i < SIZE; i++) {
      if (dir === 'left' || dir === 'right') {
        const x = dir === 'left' ? i : SIZE - 1 - i;
        grid[index][x] = line[i];
      } else {
        const y = dir === 'up' ? i : SIZE - 1 - i;
        grid[y][index] = line[i];
      }
    }
  }

  function hasMoves() {
    if (emptyCells().length) return true;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = grid[y][x];
        if (x + 1 < SIZE && grid[y][x + 1] === v) return true;
        if (y + 1 < SIZE && grid[y + 1][x] === v) return true;
      }
    }
    return false;
  }

  function move(dir) {
    if (!DIRS[dir]) return { ok: false, error: '无效方向' };
    if (over) return { ok: false, error: '本局已结束' };

    const before = JSON.stringify(grid);
    const beforeScore = score;
    const beforeMoves = moves;
    const snapshot = { grid: cloneGrid(), score, moves };

    let gainedTotal = 0;
    let mergedAny = false;

    for (let index = 0; index < SIZE; index++) {
      const line = readLine(dir, index);
      const { out, gained, merged } = collapse(line);
      writeLine(dir, index, out);
      gainedTotal += gained;
      mergedAny = mergedAny || merged;
    }

    if (JSON.stringify(grid) === before) {
      return { ok: false, error: '这个方向没有可移动的块' };
    }

    score += gainedTotal;
    moves += 1;
    undoStack = [{ grid: snapshot.grid, score: snapshot.score, moves: snapshot.moves }];

    const cell = addRandom();
    if (grid.flat().some((v) => v >= 2048)) won = true;
    if (!hasMoves()) over = true;

    return { ok: true, gained: gainedTotal, merged: mergedAny, cell, before, beforeScore, beforeMoves };
  }

  function undo() {
    if (!undoStack.length) return { ok: false, error: '没有可撤销的步' };
    const snap = undoStack.pop();
    grid = snap.grid;
    score = snap.score;
    moves = snap.moves;
    over = false;
    won = grid.flat().some((v) => v >= 2048);
    return { ok: true };
  }

  function submit(playerId, action) {
    if (action === 'undo') return undo();
    return move(action);
  }

  function step() {
    /* 回合驱动，无需按帧推进 */
  }

  function state() {
    return {
      grid: cloneGrid(),
      score,
      over,
      won,
      moves,
      canUndo: undoStack.length > 0,
      size: SIZE,
    };
  }

  function result() {
    if (!over) return null;
    return {
      over: true,
      winner: 'p1',
      scores: { p1: score },
      score,
      text: won ? `已合成 2048，最终 ${score} 分` : `棋盘已满，得分 ${score}`,
    };
  }

  reset();

  return { submit, step, state, result, reset, move, undo };
}
