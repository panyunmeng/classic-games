import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, DEFAULT_SIZE, ALLOWED_SIZES } from '../logic.mjs';

test('01 生成保证有解：200 个种子旋回解状态后全部连通', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = createGame({ seed });
    assert.equal(g.applySolution(), true, `seed ${seed} 应可解`);
    assert.equal(g.state().solved, true, `seed ${seed} state 应标记已解`);
  }
});

test('02 初始打乱未必连通：200 个种子初始都未解', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = createGame({ seed });
    assert.equal(g.state().solved, false, `seed ${seed} 初始不应已解`);
  }
});

test('03 旋转到连通即胜：旋回解后 solved=true 且 result 为空', () => {
  const g = createGame({ seed: 7 });
  assert.equal(g.state().solved, false);
  g.applySolution();
  assert.equal(g.state().solved, true);
  assert.equal(g.result(), null, '胜利不弹结算遮罩');
});

test('04 非法坐标与非法动作被拒绝', () => {
  const g = createGame({ seed: 3 });
  assert.equal(g.submit('p1', 'rot:-1,0').ok, false);
  assert.equal(g.submit('p1', 'rot:99,99').ok, false);
  assert.equal(g.submit('p1', 'rot:abc').ok, false);
  assert.equal(g.submit('p1', 'left').ok, false);
  const ep = g.state().endpoints[0];
  assert.equal(g.submit('p1', `rot:${ep.x},${ep.y}`).ok, false, '端点不可旋转');
});

test('05 合法旋转增加步数并改变掩码', () => {
  const g = createGame({ seed: 9 });
  const s0 = g.state();
  const before = s0.grid.map((c) => c.rot);
  let picked = -1;
  for (let i = 0; i < before.length; i++) {
    if (s0.grid[i].type !== 'endpoint') { picked = i; break; }
  }
  assert.ok(picked >= 0);
  const x = picked % s0.n;
  const y = (picked / s0.n) | 0;
  const r = g.submit('p1', `rot:${x},${y}`);
  assert.equal(r.ok, true);
  assert.equal(g.state().steps, s0.steps + 1);
  assert.equal(g.state().grid[picked].rot, (before[picked] + 1) % 4);
});

test('06 重置恢复干净状态且同种子可复现', () => {
  const g = createGame({ seed: 11 });
  const s0 = g.state();
  g.applySolution();
  g.submit('p1', 'rot:0,0');
  g.submit('p1', 'rot:1,1');
  g.reset();
  const s1 = g.state();
  assert.deepEqual(s1.grid, s0.grid, '重置后网格应与初始一致');
  assert.equal(s1.solved, false);
  assert.equal(s1.steps, 0);
  assert.equal(s1.hint, null);
  const g2 = createGame({ seed: 11 });
  assert.deepEqual(g2.state().grid, s0.grid, '同种子应完全复现');
});

test('07 提示选中一个待旋转的非端点格', () => {
  const g = createGame({ seed: 13 });
  const r = g.submit('p1', 'hint');
  assert.equal(r.ok, true);
  const h = g.state().hint;
  assert.ok(h, '应给出提示格');
  const cell = g.state().grid[h.y * g.state().n + h.x];
  assert.notEqual(cell.type, 'endpoint', '提示应是管道而非端点');
});

test('08 端点数量与角色合法：至少 2 个端点，恰好 1 个水源', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = createGame({ seed });
    const eps = g.state().endpoints;
    assert.ok(eps.length >= 2, `seed ${seed} 至少 2 端点`);
    assert.equal(eps.filter((e) => e.role === 'source').length, 1, '恰好 1 水源');
    assert.ok(eps.every((e) => e.role === 'source' || e.role === 'sink'));
  }
});

test('09 状态可 JSON 序列化且每次返回新对象', () => {
  const g = createGame({ seed: 17 });
  const s = g.state();
  const json = JSON.stringify(s);
  assert.ok(json.includes('"turn":"p1"'));
  assert.deepEqual(JSON.parse(json), s);
  const s2 = g.state();
  assert.notStrictEqual(s, s2);
  s2.grid[0].rot = 99;
  assert.notEqual(g.state().grid[0].rot, 99, '外部改快照不应影响内部');
  assert.equal(typeof s.time, 'number', 'time 占位字段存在');
});

test('10 连走 N 步不崩且步数单调', () => {
  const g = createGame({ seed: 19 });
  const n = g.state().n;
  let last = g.state().steps;
  for (let k = 0; k < 200; k++) {
    const x = k % n;
    const y = (k * 2) % n;
    g.submit('p1', `rot:${x},${y}`);
    assert.ok(g.state().steps >= last, '步数不减');
    last = g.state().steps;
  }
  assert.ok(last <= 200);
});

test('11 尺寸档位：默认 6，可设 5/7，非法尺寸回退 6', () => {
  assert.equal(DEFAULT_SIZE, 6);
  assert.deepEqual(ALLOWED_SIZES, [5, 6, 7]);
  assert.equal(createGame({ seed: 1 }).state().n, 6);
  assert.equal(createGame({ seed: 1, size: 5 }).state().n, 5);
  assert.equal(createGame({ seed: 1, size: 7 }).state().grid.length, 49);
  assert.equal(createGame({ seed: 1, size: 99 }).state().n, 6, '非法尺寸回退默认');
  const g = createGame({ seed: 1 });
  assert.equal(g.setSize(7), 7);
  assert.equal(g.state().grid.length, 49);
  assert.equal(g.setSize(7), 7, '相同尺寸不重建');
});

test('12 逻辑无墙钟：step 不改变状态，time 恒为 0', () => {
  const g = createGame({ seed: 23 });
  const before = JSON.stringify(g.state());
  g.step(1000, []);
  assert.equal(JSON.stringify(g.state()), before, '纯回合制 step 是空操作');
  assert.equal(g.state().time, 0, '时间由 render 处理');
});
