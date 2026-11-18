import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, bounceVelocity, W, H, WIN_SCORE, P1_Y, P2_Y, PADDLE_W } from '../logic.mjs';
import { render } from '../render.mjs';
import { createInput } from '../input.mjs';

const STEP = 1 / 60;
const LEFT_MAX = 16;
const RIGHT_MAX = W - 16 - PADDLE_W;

function fresh(opts = {}) {
  return createGame({ seed: 7, mode: 'local2p', ...opts });
}

/** 把一个纯逻辑源码剥掉注释，用于纯逻辑门禁自检（与 scripts/build.mjs 同规则） */
function codeOnly(url) {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('01 初始状态：turn=null、0:0、p1 发球待发、拍位与画布尺寸', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.turn, null);
  assert.deepEqual(s.score, { p1: 0, p2: 0 });
  assert.equal(s.over, false);
  assert.equal(s.winner, null);
  assert.equal(s.serverSide, 'p1');
  assert.equal(s.serving, true);
  assert.equal(s.paddles.p1.y, P1_Y);
  assert.equal(s.paddles.p2.y, P2_Y);
  assert.equal(s.paddles.p1.x + s.paddles.p1.w / 2, W / 2);
  assert.equal(s.paddles.p2.x + s.paddles.p2.w / 2, W / 2);
  assert.equal(s.ball.vx, 0);
  assert.equal(s.ball.vy, 0);
  assert.equal(s.w, W);
  assert.equal(s.h, H);
  assert.equal(s.winScore, WIN_SCORE);
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('02 发球：submit start 后球朝对手推进，重复发球被拒', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'start').ok, true);
  const s = g.state();
  assert.equal(s.serving, false);
  assert.ok(s.ball.vy > 0, 'p1 发球 → 球飞向下方 p2');
  const y0 = s.ball.y;
  g.step(STEP);
  assert.ok(g.state().ball.y > y0, '球向下推进');
  assert.equal(g.submit('p1', 'start').ok, false, '球已在运行');
});

test('03 下拍挡回：球撞 p2 拍后向上反弹且略微加速', () => {
  const g = fresh();
  g.debugSet({
    serving: false,
    ball: { x: 240, y: P2_Y - 9, vx: 0, vy: 300, r: 7, trail: [] },
  });
  const before = g.state().speed;
  g.step(STEP);
  const s = g.state();
  assert.ok(s.ball.vy < 0, '出射向上');
  assert.ok(s.ball.y < P2_Y, '球被放到拍面之上');
  assert.ok(s.speed > before, '速度按 1.035 递增');
  assert.ok(s.speed <= 720);
});

test('04 上拍挡回：球撞 p1 拍后向下反弹', () => {
  const g = fresh();
  g.debugSet({
    serving: false,
    ball: { x: 240, y: P1_Y + 21, vx: 0, vy: -300, r: 7, trail: [] },
  });
  g.step(STEP);
  const s = g.state();
  assert.ok(s.ball.vy > 0, '出射向下');
  assert.ok(s.ball.y > P1_Y + 12, '球被放到拍面之下');
});

test('05 落点偏移改角：越靠边 |vx| 越大，左右成镜像', () => {
  const left = bounceVelocity(-1, 300, 1);
  const mid = bounceVelocity(0, 300, 1);
  const right = bounceVelocity(1, 300, 1);
  assert.ok(left.vx < 0 && right.vx > 0, '左右落点出射方向相反');
  assert.ok(Math.abs(mid.vx) < 1e-9, '正中出射近似垂直');
  assert.ok(Math.abs(left.vx) > Math.abs(bounceVelocity(-0.5, 300, 1).vx));
  assert.ok(Math.abs(right.vx) > Math.abs(bounceVelocity(0.5, 300, 1).vx));
  assert.ok(left.vy > 0 && mid.vy > 0 && right.vy > 0, '上拍出射向下');
  const up = bounceVelocity(0, 300, -1);
  assert.ok(up.vy < 0, '下拍出射向上');
  // 游戏内实测：边缘落点产生明显横向速度
  const g = fresh();
  g.debugSet({
    serving: false,
    ball: { x: 280, y: P2_Y - 9, vx: 0, vy: 300, r: 7, trail: [] },
  });
  g.step(STEP);
  assert.ok(g.state().ball.vx > 40, '靠右落点向右出射');
});

test('06 得分：球越过下边线 → p1 得分并改由 p2 发球', () => {
  const g = fresh();
  g.debugSet({
    serving: false,
    ball: { x: 40, y: H + 10, vx: 0, vy: 100, r: 7, trail: [] },
  });
  g.step(STEP);
  const s = g.state();
  assert.deepEqual(s.score, { p1: 1, p2: 0 });
  assert.equal(s.serverSide, 'p2', '失分方 p2 获得发球权');
  assert.equal(s.serving, true);
  assert.equal(s.ball.vy, 0);
  assert.ok(s.ball.y < P2_Y, '球落在 p2 拍前');
  assert.ok(s.ball.y > H / 2);
});

test('07 发球轮转：连续失分后 serverSide 始终是失分方', () => {
  const g = fresh();
  g.debugSet({ serving: false, ball: { x: 40, y: H + 10, vx: 0, vy: 100, r: 7 } });
  g.step(STEP);
  assert.equal(g.state().serverSide, 'p2');
  g.debugSet({ serving: false, ball: { x: 40, y: -10, vx: 0, vy: -100, r: 7 } });
  g.step(STEP);
  assert.equal(g.state().serverSide, 'p1');
  assert.deepEqual(g.state().score, { p1: 1, p2: 1 });
  // 发球方确实是上一个失分方：p2 失分的这球之后由 p2 发球
  g.debugSet({ serving: false, ball: { x: 40, y: H + 10, vx: 0, vy: 100, r: 7 } });
  g.step(STEP);
  assert.equal(g.state().serverSide, 'p2');
});

test('08 11 分制：先到 11 分结束，result 给出胜者与比分', () => {
  const g = fresh();
  g.debugSet({
    serving: false,
    score: { p1: 10, p2: 3 },
    ball: { x: 40, y: H + 10, vx: 0, vy: 100, r: 7 },
  });
  g.step(STEP);
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.winner, 'p1');
  assert.deepEqual(s.score, { p1: 11, p2: 3 });
  assert.equal(s.serving, false);
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.winner, 'p1');
  assert.deepEqual(r.scores, { p1: 11, p2: 3 });
  assert.equal(r.title, '上方获胜');
  assert.match(r.text, /11 : 3/);
  // 结束后 step 不再改状态
  const frozen = JSON.stringify(g.state());
  g.step(STEP, ['p1up', 'p2down']);
  assert.equal(JSON.stringify(g.state()), frozen);
  assert.equal(g.submit('p1', 'start').ok, false);
});

test('09 AI 确定性追踪且不越界：右侧来球追右、左侧来球追左', () => {
  const g = fresh({ mode: 'ai' });
  g.debugSet({
    serving: false,
    ball: { x: 400, y: 500, vx: 0, vy: -40, r: 7, trail: [] },
  });
  for (let i = 0; i < 90; i++) g.step(STEP);
  const right = g.state().paddles.p1.x;
  assert.ok(right > 300, `AI 向右追踪（实际 ${right}）`);
  assert.ok(right <= RIGHT_MAX + 1e-9, '不越右边界');
  assert.ok(Number.isFinite(right));

  g.debugSet({ ball: { x: 40, y: 500, vx: 0, vy: -40, r: 7, trail: [] } });
  for (let i = 0; i < 120; i++) g.step(STEP);
  const left = g.state().paddles.p1.x;
  assert.ok(left < 60, `AI 向左追踪（实际 ${left}）`);
  assert.ok(left >= LEFT_MAX - 1e-9, '不越左边界');

  // 球远离时不追：p1 回中线等待
  g.debugSet({ ball: { x: 420, y: 200, vx: 0, vy: 120, r: 7, trail: [] } });
  for (let i = 0; i < 60; i++) g.step(STEP);
  const after = g.state().paddles.p1.x;
  assert.ok(Math.abs(after - (W / 2 - PADDLE_W / 2)) < 6, `球远离时回中（实际 ${after}）`);
});

test('10 状态序列化：每次都是新对象，改快照不影响内部', () => {
  const g = fresh();
  const a = g.state();
  const b = g.state();
  assert.notEqual(a, b);
  assert.notEqual(a.ball, b.ball);
  assert.notEqual(a.paddles, b.paddles);
  assert.notEqual(a.score, b.score);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(a)));
  a.score.p1 = 99;
  a.ball.x = -1000;
  a.paddles.p1.y = -1;
  const c = g.state();
  assert.deepEqual(c.score, { p1: 0, p2: 0 });
  assert.ok(c.ball.x > 0 && c.ball.x < W);
  assert.equal(c.paddles.p1.y, P1_Y);
  // 联机关键字段：turn 必须是 null 而非缺失
  assert.ok('turn' in c);
});

test('11 连续 3000 步不崩：分数有界、数值有限、状态可序列化', () => {
  const g = fresh();
  for (let i = 0; i < 3000; i++) {
    const actions = i % 240 < 120 ? ['p1up', 'p2down'] : ['p1down', 'p2up'];
    g.step(STEP, actions);
    const s = g.state();
    assert.ok(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y), `第 ${i} 步球坐标有限`);
    assert.ok(s.score.p1 <= WIN_SCORE && s.score.p2 <= WIN_SCORE);
  }
  const s = g.state();
  // 只要求不崩、数值有限；是否在 50 s 内打完取决于球路，不强行断言
  assert.ok(Number.isFinite(s.speed) && s.speed <= 720);
  assert.ok(s.score.p1 <= WIN_SCORE && s.score.p2 <= WIN_SCORE);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
  if (s.over) {
    assert.ok(g.result() && ['p1', 'p2'].includes(g.result().winner));
  }
});

test('12 左右墙反弹', () => {
  const g = fresh();
  g.debugSet({ serving: false, ball: { x: 18, y: 300, vx: -200, vy: 0, r: 7 } });
  g.step(STEP);
  let s = g.state();
  assert.ok(s.ball.vx > 0, '左墙反弹后向右');
  assert.ok(s.ball.x >= LEFT_MAX + 7 - 1e-9);

  g.debugSet({ ball: { x: 462, y: 300, vx: 200, vy: 0, r: 7 } });
  g.step(STEP);
  s = g.state();
  assert.ok(s.ball.vx < 0, '右墙反弹后向左');
  assert.ok(s.ball.x <= RIGHT_MAX + PADDLE_W - 7 + 1e-9);
});

test('13 拖拍：pointer 坐标把拍子中心移到该 x，并夹在墙内', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'pointer:p2:100').ok, true);
  let s = g.state();
  assert.ok(Math.abs(s.paddles.p2.x + PADDLE_W / 2 - 100) < 1e-6);

  g.submit('p1', 'pointer:p1:1000');
  s = g.state();
  assert.equal(s.paddles.p1.x, RIGHT_MAX);

  g.submit('p1', 'pointer:p1:-50');
  s = g.state();
  assert.equal(s.paddles.p1.x, LEFT_MAX);

  // 发球准备时拖拍，球跟着发球方拍心走
  g.debugSet({ serving: true, serverSide: 'p2', serveTimer: 0.9 });
  g.submit('p1', 'pointer:p2:160');
  s = g.state();
  assert.ok(Math.abs(s.ball.x - 160) < 1e-6);
});

test('14 发球计时：0.9 s 后自动发球，submit start 可提前', () => {
  const g = fresh();
  for (let i = 0; i < 30; i++) g.step(STEP);
  assert.equal(g.state().serving, true, '0.5 s 时仍在准备');
  for (let i = 0; i < 40; i++) g.step(STEP);
  assert.equal(g.state().serving, false, '1.2 s 后自动发球');
  assert.ok(g.state().ball.vy > 0);

  const g2 = fresh();
  assert.equal(g2.state().serving, true);
  assert.equal(g2.submit('p1', 'start').ok, true);
  assert.equal(g2.state().serving, false);
});

test('15 纯逻辑门禁：logic/ai 无 DOM、无真随机、无时钟；动作词表可解析', () => {
  for (const rel of ['../logic.mjs', '../ai.mjs']) {
    const src = codeOnly(new URL(rel, import.meta.url));
    for (const [re, label] of [
      [/\bdocument\./, 'document'],
      [/\bwindow\./, 'window'],
      [/\bMath\.random\s*\(/, 'Math.random'],
      [/\bDate\.now\s*\(/, 'Date.now'],
      [/\bnew\s+Date\s*\(/, 'new Date'],
    ]) {
      assert.ok(!re.test(src), `${rel} 不得出现 ${label}`);
    }
  }
  // step 的两种输入形态都接受：字符串 / {seat, action}
  const g = fresh({ mode: 'online' });
  g.debugSet({ serving: false, ball: { x: 240, y: 300, vx: 0, vy: 0, r: 7 } });
  const x0 = g.state().paddles.p1.x;
  g.step(STEP, [{ seat: 'p1', action: 'up' }]);
  assert.ok(g.state().paddles.p1.x < x0, '带 seat 的裸方向词动对应拍');
  const xUp = g.state().paddles.p1.x;
  const x1 = g.state().paddles.p2.x;
  g.step(STEP, [{ seat: 'p1', action: 'right' }]);
  assert.ok(g.state().paddles.p1.x > xUp, '联机 up/right 词表可用');
  assert.equal(g.state().paddles.p2.x, x1);
});

test('16 渲染冒烟：四种模式 + 结算态都不抛异常，且不改 state', () => {
  const gradient = { addColorStop() {} };
  const base = {
    createLinearGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  const drawn = [];
  const ctx = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {
        drawn.push(String(k));
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  const view = { w: W, h: H, dt: STEP, time: 1.5, meta: {}, mode: 'ai' };

  for (const mode of ['solo', 'ai', 'local2p', 'online']) {
    const g = createGame({ seed: 4, mode });
    for (const st of [g.state(), (g.submit('p1', 'start'), g.state())]) {
      const before = JSON.stringify(st);
      assert.doesNotThrow(() => render(ctx, st, { ...view, mode }), `${mode} 渲染不得抛错`);
      assert.equal(JSON.stringify(st), before, 'render 不得改 state');
    }
  }

  // 结算态（含获胜横幅）
  const g = createGame({ seed: 5, mode: 'local2p' });
  const over = g.state();
  over.over = true;
  over.winner = 'p1';
  over.serving = false;
  over.score = { p1: 11, p2: 4 };
  assert.doesNotThrow(() => render(ctx, over, view));
  assert.ok(drawn.includes('fillText'), '比分/提示文字被绘制');
  assert.ok(drawn.includes('arc'), '球与光晕被绘制');
  assert.ok(drawn.includes('setLineDash'), '中线虚线被绘制');
});

test('17 输入映射：单人 W/S 与 ↑↓ 都控 p2，双人分控，拖拽按 pointer 写拍心', () => {
  const prevWindow = globalThis.window;
  const listeners = {};
  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
  const fire = (type, code) => {
    for (const fn of listeners[type] || []) fn({ code, target: null, repeat: false });
  };
  try {
    const makeShell = (game) => ({
      game,
      online: null,
      state: () => game.state(),
      submitted: [],
      submit(action) {
        this.submitted.push(action);
      },
    });
    const makeRaw = () => ({
      vbtn: {},
      pointer: { x: 0, y: 0, down: false, justDown: false },
      justPressed: () => false,
      consumeTap: () => null,
    });

    // 单人：W 和 ↑ 都控下拍 p2
    const g1 = createGame({ seed: 1, mode: 'solo' });
    const shell1 = makeShell(g1);
    const raw1 = makeRaw();
    const in1 = createInput({ raw: raw1, shell: shell1, mode: 'solo' });
    fire('keydown', 'KeyW');
    in1.update(STEP);
    assert.deepEqual(in1.actions, ['p2up']);
    fire('keyup', 'KeyW');
    in1.update(STEP);
    assert.deepEqual(in1.actions, []);
    fire('keydown', 'ArrowDown');
    in1.update(STEP);
    assert.deepEqual(in1.actions, ['p2down']);
    fire('keyup', 'ArrowDown');

    // 双人：W/S → p1，↑/↓ → p2
    const g2 = createGame({ seed: 1, mode: 'local2p' });
    const shell2 = makeShell(g2);
    const in2 = createInput({ raw: makeRaw(), shell: shell2, mode: 'local2p' });
    fire('keydown', 'KeyW');
    in2.update(STEP);
    assert.deepEqual(in2.actions, ['p1up']);
    fire('keydown', 'ArrowUp');
    in2.update(STEP);
    assert.deepEqual(in2.actions, ['p1up', 'p2up']);
    fire('keyup', 'KeyW');
    fire('keyup', 'ArrowUp');
    in2.update(STEP);
    assert.deepEqual(in2.actions, []);

    // 拖拽：pointer.x 写成拍心坐标（单人固定 p2）
    const raw3 = makeRaw();
    const shell3 = makeShell(createGame({ seed: 1, mode: 'solo' }));
    const in3 = createInput({ raw: raw3, shell: shell3, mode: 'solo' });
    raw3.pointer = { x: 120, y: 600, down: true, justDown: true };
    in3.update(STEP);
    assert.ok(shell3.submitted.includes('pointer:p2:120.0'), JSON.stringify(shell3.submitted));

    // dispose 摘掉监听
    const before = (listeners.keydown || []).length;
    in3.dispose();
    assert.equal((listeners.keydown || []).length, before - 1);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
