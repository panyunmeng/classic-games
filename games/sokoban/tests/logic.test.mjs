import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, LEVELS } from '../logic.mjs';

function fresh(level = 1) {
  const g = createGame();
  if (level !== 1) g.submit('p1', `level:${level}`);
  return g;
}

/** 对固定关卡做 BFS 求解，返回最短方向序列（或 null）。用于验证关卡数据本身可解。 */
function solve(raw) {
  const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const isWall = (c) => c === undefined || c === '#';
  const isBox = (c) => c === '$' || c === '*';
  const isGoal = (c) => c === '.' || c === '*' || c === '+';
  const setAt = (row, x, c) => row.slice(0, x) + c + row.slice(x + 1);
  const cell = (grid, x, y) =>
    y < 0 || y >= grid.length ? '#' : x < 0 || x >= grid[y].length ? '#' : grid[y][x];
  const findPlayer = (grid) => {
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === '@' || grid[y][x] === '+') return { x, y };
      }
    }
    return { x: -1, y: -1 };
  };
  const solved = (grid) => {
    let loose = false;
    let empty = false;
    for (const row of grid) {
      for (const c of row) {
        if (c === '$') loose = true;
        if (c === '.') empty = true;
      }
    }
    return !loose && !empty;
  };
  const key = (grid, p) => grid.join('/') + '|' + p.x + ',' + p.y;

  let grid = raw.slice();
  const player = findPlayer(grid);
  const queue = [{ grid, player, path: [] }];
  const seen = new Set([key(grid, player)]);
  let head = 0;
  while (head < queue.length && head < 200000) {
    const cur = queue[head++];
    if (solved(cur.grid)) return cur.path;
    for (const d of ['left', 'right', 'up', 'down']) {
      const [dx, dy] = DIRS[d];
      const nx = cur.player.x + dx;
      const ny = cur.player.y + dy;
      let ng = cur.grid;
      const t = cell(cur.grid, nx, ny);
      if (isWall(t)) continue;
      if (isBox(t)) {
        const bx = nx + dx;
        const by = ny + dy;
        const bc = cell(cur.grid, bx, by);
        if (isWall(bc) || isBox(bc)) continue;
        ng = ng.slice();
        ng[ny] = setAt(ng[ny], nx, isGoal(t) ? '.' : ' ');
        ng[by] = setAt(ng[by], bx, isGoal(bc) ? '*' : '$');
      }
      const from = cell(cur.grid, cur.player.x, cur.player.y);
      ng = ng.slice();
      ng[cur.player.y] = setAt(ng[cur.player.y], cur.player.x, isGoal(from) ? '.' : ' ');
      ng[ny] = setAt(ng[ny], nx, isGoal(t) ? '+' : '@');
      const np = { x: nx, y: ny };
      const k = key(ng, np);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ grid: ng, player: np, path: cur.path.concat(d) });
    }
  }
  return null;
}

test('01 初始状态：turn=p1、第1关、步数推动为0、未过关', () => {
  const s = fresh().state();
  assert.equal(s.turn, 'p1');
  assert.equal(s.level, 1);
  assert.equal(s.levelCount, 8);
  assert.equal(s.steps, 0);
  assert.equal(s.pushes, 0);
  assert.equal(s.solved, false);
  assert.equal(s.canUndo, false);
  assert.equal(s.canRedo, false);
});

test('02 合法移动：向下走一格，步数+1、推动数不变、位置更新', () => {
  const g = fresh();
  const before = g.state().player;
  const r = g.submit('p1', 'down');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.player.y, before.y + 1);
  assert.equal(s.steps, 1);
  assert.equal(s.pushes, 0);
  assert.equal(s.canUndo, true);
});

test('03 推箱：箱子进入目标变 *，玩家占箱子原位 @，推动+1', () => {
  const g = fresh();
  const r = g.submit('p1', 'up');
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.solved, true);
  assert.equal(s.steps, 1);
  assert.equal(s.pushes, 1);
  assert.equal(s.boxesOnGoal, 1);
  assert.ok(s.grid.some((row) => row.includes('*')), '存在箱子在目标上的格子');
  assert.ok(s.grid.some((row) => row.includes('@')), '玩家占据箱子原位');
});

test('04 墙阻挡：向上顶墙不算步、不入撤销栈', () => {
  const g = fresh(4); // 第4关玩家上方是箱子，改为向左走到墙边再测
  // 第4关第5行 '#  @   #'：连续左走两格到 x=1，再向左即撞 x=0 墙
  g.submit('p1', 'left');
  g.submit('p1', 'left');
  const before = g.state();
  const r = g.submit('p1', 'left');
  assert.equal(r.ok, false);
  const after = g.state();
  assert.equal(after.steps, before.steps);
  assert.deepEqual(after.player, before.player);
  assert.equal(after.canUndo, before.canUndo);
});

test('05 箱子不能拉：箱子在玩家上方，向下走离开箱子，箱子不动', () => {
  const g = fresh(); // 第1关玩家 @ 在箱子 $ 正下方
  const boxBefore = g.state().grid.findIndex((row) => row.includes('$'));
  const r = g.submit('p1', 'down'); // 远离箱子，不应把箱子带下来
  assert.equal(r.ok, true);
  const s = g.state();
  assert.equal(s.grid[boxBefore].includes('$'), true, '箱子仍在原行');
  assert.equal(s.pushes, 0, '拉箱子不计推动');
  assert.equal(s.solved, false);
});

test('06 撤销/重做栈：推箱后撤销回到初始，重做恢复', () => {
  const g = fresh();
  const init = g.state();
  g.submit('p1', 'up'); // 推箱过关
  assert.equal(g.state().solved, true);
  assert.equal(g.submit('p1', 'undo').ok, true);
  const undone = g.state();
  assert.equal(undone.steps, 0);
  assert.equal(undone.pushes, 0);
  assert.equal(undone.solved, false);
  assert.deepEqual(undone.grid, init.grid);
  assert.equal(undone.canRedo, true);
  assert.equal(g.submit('p1', 'redo').ok, true);
  const redone = g.state();
  assert.equal(redone.solved, true);
  assert.equal(redone.steps, 1);
  assert.equal(redone.pushes, 1);
  assert.deepEqual(redone.grid, g.state().grid);
});

test('07 空栈撤销/重做返回失败且不改状态', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'undo').ok, false);
  assert.equal(g.submit('p1', 'redo').ok, false);
  assert.equal(g.state().steps, 0);
  // 新分支清空重做栈
  g.submit('p1', 'down');
  g.submit('p1', 'undo');
  assert.equal(g.state().canRedo, true);
  g.submit('p1', 'up'); // 与撤销前的 down 不同的分支动作
  assert.equal(g.state().canRedo, false);
  assert.equal(g.submit('p1', 'redo').ok, false);
});

test('08 过关判定：1 步推入目标后 solved=true，result 保持 null', () => {
  const g = fresh();
  g.submit('p1', 'up');
  assert.equal(g.state().solved, true);
  assert.equal(g.result(), null, '不弹结算遮罩，保证下一关按钮可用');
  const r = g.submit('p1', 'down');
  assert.equal(r.ok, false, '过关后不再接受移动');
});

test('09 关卡切换：level:N 重置步数/撤销栈，越界被拒', () => {
  const g = fresh();
  g.submit('p1', 'down');
  assert.equal(g.state().steps, 1);
  assert.equal(g.submit('p1', 'level:3').ok, true);
  const s = g.state();
  assert.equal(s.level, 3);
  assert.equal(s.steps, 0);
  assert.equal(s.pushes, 0);
  assert.equal(s.canUndo, false);
  assert.equal(s.solved, false);
  assert.equal(g.submit('p1', 'level:9').ok, false);
  assert.equal(g.submit('p1', 'level:0').ok, false);
  assert.equal(g.state().level, 3);
});

test('10 非法动作：未知字符串、空串、非字符串均被拒且状态不变', () => {
  const g = fresh();
  const before = g.state();
  for (const bad of ['jump', '', null, undefined, 123]) {
    assert.equal(g.submit('p1', bad).ok, false);
  }
  const after = g.state();
  assert.equal(after.steps, before.steps);
  assert.deepEqual(after.player, before.player);
});

test('11 状态序列化：state() 每次新对象，JSON 往返一致', () => {
  const g = fresh();
  const a = g.state();
  const b = g.state();
  assert.notEqual(a, b);
  assert.notEqual(a.grid, b.grid);
  assert.notEqual(a.player, b.player);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  // 外部修改快照不影响内部
  a.grid[0] = 'XXXXXXXX';
  a.player.x = 99;
  assert.notEqual(g.state().grid[0], 'XXXXXXXX');
  assert.notEqual(g.state().player.x, 99);
});

test('12 reset：回到第1关初始局面', () => {
  const g = fresh();
  g.submit('p1', 'level:5');
  g.submit('p1', 'down');
  g.reset();
  const s = g.state();
  assert.equal(s.level, 1);
  assert.equal(s.steps, 0);
  assert.equal(s.pushes, 0);
  assert.equal(s.canUndo, false);
});

test('13 箱子推向墙被拒：步数/推动不变，撤销栈不变', () => {
  const g = fresh();
  // 绕到第1关箱子上方，连续向下推两次，把箱推到 (3,5) 紧贴底墙(y=6)
  const path = ['down', 'right', 'up', 'up', 'up', 'left', 'down', 'down'];
  for (const d of path) assert.equal(g.submit('p1', d).ok, true, `动作 ${d} 应合法`);
  const before = g.state();
  assert.equal(before.pushes, 2);
  const r = g.submit('p1', 'down'); // 箱前是墙，推不动
  assert.equal(r.ok, false);
  const after = g.state();
  assert.equal(after.steps, before.steps);
  assert.equal(after.pushes, before.pushes);
  assert.equal(after.canUndo, before.canUndo);
  assert.ok(after.grid.some((row) => row.includes('$')), '箱子仍在非目标格');
});

test('14 八关关卡数据自洽且全部可解（BFS 求解 + 引擎回放）', () => {
  assert.equal(LEVELS.length, 8);
  for (let i = 0; i < LEVELS.length; i++) {
    const raw = LEVELS[i];
    const widths = new Set(raw.map((r) => r.length));
    assert.equal(widths.size, 1, `第${i + 1}关行宽应一致`);
    const joined = raw.join('');
    const boxes = [...joined].filter((c) => c === '$' || c === '*').length;
    const goals = [...joined].filter((c) => ['.', '*', '+'].includes(c)).length;
    assert.ok(boxes > 0, `第${i + 1}关至少有一个箱子`);
    assert.equal(boxes, goals, `第${i + 1}关箱子数应等于目标数`);
    assert.equal([...joined].filter((c) => c === '@' || c === '+').length, 1, `第${i + 1}关恰好一个玩家`);

    const path = solve(raw);
    assert.ok(path, `第${i + 1}关必须可解`);
    const g = createGame();
    g.submit('p1', `level:${i + 1}`);
    for (const d of path) {
      const r = g.submit('p1', d);
      assert.equal(r.ok, true, `第${i + 1}关回放动作 ${d} 应合法`);
    }
    const s = g.state();
    assert.equal(s.solved, true, `第${i + 1}关回放后应过关`);
    assert.equal(s.boxesOnGoal, boxes);
    assert.equal(s.steps, path.length);
  }
});
