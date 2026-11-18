import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGame,
  W,
  H,
  WIN_SCORE,
  TABLE,
  CENTER_Y,
  GOAL_X0,
  GOAL_X1,
  DISC_R,
  PADDLE_R,
  PADDLE_BOUNDS,
  HOME,
} from '../logic.mjs';
import { render } from '../render.mjs';
import { createInput } from '../input.mjs';

const STEP = 1 / 60;

function fresh(opts = {}) {
  return createGame({ seed: 7, mode: 'local2p', ...opts });
}

/** 剥掉注释，用于纯逻辑门禁自检（与 scripts/build.mjs 同规则） */
function codeOnly(url) {
  return readFileSync(url, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

test('01 初始状态：turn=null、0:0、p1 发球待发、球在中心、拍在半场守位', () => {
  const g = fresh();
  const s = g.state();
  assert.equal(s.turn, null);
  assert.deepEqual(s.score, { p1: 0, p2: 0 });
  assert.equal(s.over, false);
  assert.equal(s.winner, null);
  assert.equal(s.serveSide, 'p1');
  assert.equal(s.serving, true);
  assert.equal(s.winScore, WIN_SCORE);
  assert.equal(s.w, W);
  assert.equal(s.h, H);
  // 球回中心
  assert.equal(s.disc.x, W / 2);
  assert.equal(s.disc.y, CENTER_Y);
  assert.equal(s.disc.vx, 0);
  assert.equal(s.disc.vy, 0);
  assert.equal(s.disc.r, DISC_R);
  // 拍在各自半场
  assert.equal(s.paddles.p1.x, HOME.p1.x);
  assert.equal(s.paddles.p1.y, HOME.p1.y);
  assert.equal(s.paddles.p2.x, HOME.p2.x);
  assert.equal(s.paddles.p2.y, HOME.p2.y);
  assert.ok(s.paddles.p1.y + PADDLE_R < CENTER_Y, 'p1 拍整体在中线上方');
  assert.ok(s.paddles.p2.y - PADDLE_R > CENTER_Y, 'p2 拍整体在中线下方');
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('02 发球：submit start 后球从中心飞向对手，重复发球被拒', () => {
  const g = fresh();
  assert.equal(g.submit('p1', 'start').ok, true);
  const s = g.state();
  assert.equal(s.serving, false);
  assert.ok(s.ball === undefined, '状态字段用 disc，不是 ball');
  assert.ok(s.disc.vy > 0, 'p1 发球 → 球向下方 p2 推进');
  assert.equal(s.disc.x, W / 2);
  assert.equal(s.disc.y, CENTER_Y);
  const y0 = s.disc.y;
  g.step(STEP);
  assert.ok(g.state().disc.y > y0, '球向下推进');
  assert.equal(g.submit('p1', 'start').ok, false, '球已在运行');
  assert.equal(g.submit('p1', 'start').error, '球已在运行');
});

test('03 球推进与轻微摩擦：横向滑行 2 s 后速度下降但不停死', () => {
  const g = fresh();
  g.debugSet({ serving: false, disc: { x: 60, y: CENTER_Y, vx: -300, vy: 0, trail: [] } });
  const s0 = g.state();
  assert.equal(s0.disc.speed, 300);
  g.step(STEP);
  assert.ok(g.state().disc.x < s0.disc.x, '球按 vx 推进');
  for (let i = 0; i < 120; i++) g.step(STEP);
  const s = g.state();
  assert.ok(Number.isFinite(s.disc.x) && Number.isFinite(s.disc.y));
  assert.ok(s.disc.speed < 300, `摩擦让速度下降（实际 ${s.disc.speed}）`);
  assert.ok(s.disc.speed > 150, '摩擦轻微，不把球刹停在桌上');
  assert.ok(s.disc.trail.length > 0 && s.disc.trail.length <= 16, '拖尾有上限');
});

test('04 壁面全反射：左右墙、上下墙（球门口外）都按镜像反射', () => {
  const g = fresh();
  // 左墙
  g.debugSet({ serving: false, disc: { x: TABLE.x0 + DISC_R + 2, y: 300, vx: -220, vy: 0 } });
  g.step(STEP);
  let s = g.state();
  assert.ok(s.disc.vx > 0, '左墙反弹后向右');
  assert.ok(s.disc.x >= TABLE.x0 + DISC_R - 1e-9);
  // 右墙
  g.debugSet({ disc: { x: TABLE.x1 - DISC_R - 2, y: 300, vx: 220, vy: 0 } });
  g.step(STEP);
  s = g.state();
  assert.ok(s.disc.vx < 0, '右墙反弹后向左');
  assert.ok(s.disc.x <= TABLE.x1 - DISC_R + 1e-9);
  // 上墙（球门口外）
  g.debugSet({ disc: { x: GOAL_X0 - 30, y: TABLE.y0 + DISC_R + 2, vx: 0, vy: -220 } });
  g.step(STEP);
  s = g.state();
  assert.ok(s.disc.vy > 0, '上墙反弹后向下');
  assert.deepEqual(s.score, { p1: 0, p2: 0 }, '门口外撞墙不算进球');
  // 下墙（球门口外）
  g.debugSet({ disc: { x: GOAL_X1 + 30, y: TABLE.y1 - DISC_R - 2, vx: 0, vy: 220 } });
  g.step(STEP);
  s = g.state();
  assert.ok(s.disc.vy < 0, '下墙反弹后向上');
  assert.deepEqual(s.score, { p1: 0, p2: 0 });
});

test('05 拍碰撞击出：球撞下拍后向上离开，且出射速度不低于最小出射速度', () => {
  const g = fresh();
  const contactY = HOME.p2.y - (DISC_R + PADDLE_R) + 2; // 已进入接触距离
  g.debugSet({ serving: false, disc: { x: HOME.p2.x, y: contactY, vx: 0, vy: 300 } });
  g.step(STEP);
  const s = g.state();
  assert.ok(s.disc.vy < 0, `撞下拍后向上出射（vy=${s.disc.vy}）`);
  assert.ok(s.disc.y < HOME.p2.y, '球被分离到拍面之外');
  assert.ok(s.disc.speed >= 260 - 1e-6, `出射速度不低于最小击出速度（${s.disc.speed}）`);
  assert.ok(s.disc.speed <= 1150);

  // 上拍同理：球向上撞 p1 拍后向下离开
  const g2 = fresh();
  g2.debugSet({
    serving: false,
    disc: { x: HOME.p1.x, y: HOME.p1.y + (DISC_R + PADDLE_R) - 2, vx: 0, vy: -300 },
  });
  g2.step(STEP);
  const s2 = g2.state();
  assert.ok(s2.disc.vy > 0, '撞上拍后向下出射');
});

test('06 拍边缘命中：正心近直线、擦边出射明显更偏（法向＝两圆心连线）', () => {
  // 正心
  const mid = fresh();
  mid.debugSet({
    serving: false,
    disc: { x: HOME.p2.x, y: HOME.p2.y - (DISC_R + PADDLE_R) + 2, vx: 0, vy: 400 },
  });
  mid.step(STEP);
  const m = mid.state();
  const midAngle = Math.abs(m.disc.vx) / Math.max(1, m.disc.speed);
  assert.ok(midAngle < 0.05, `正心出射接近垂直（偏斜比 ${midAngle}）`);

  // 擦边：横向让开 38 px，仍在接触距离内
  const edge = fresh();
  edge.debugSet({
    serving: false,
    disc: { x: HOME.p2.x + 38, y: HOME.p2.y - 20, vx: 0, vy: 400 },
  });
  edge.step(STEP);
  const e = edge.state();
  const edgeAngle = Math.abs(e.disc.vx) / Math.max(1, e.disc.speed);
  assert.ok(edgeAngle > 0.5, `边缘命中出射更偏（偏斜比 ${edgeAngle}）`);
  assert.ok(edgeAngle > midAngle + 0.3, '擦边比正心偏得多');
});

test('07 入球门得分：下方球门漏球 → p1 得分，球回中心并改由 p2 发球', () => {
  const g = fresh();
  g.debugSet({
    serving: false,
    disc: { x: W / 2, y: TABLE.y1 - DISC_R - 1, vx: 0, vy: 320, trail: [] },
  });
  g.step(STEP);
  const s = g.state();
  assert.deepEqual(s.score, { p1: 1, p2: 0 });
  assert.equal(s.serveSide, 'p2', '失分方 p2 拿到发球权');
  assert.equal(s.serving, true);
  assert.equal(s.disc.x, W / 2, '球回中心');
  assert.equal(s.disc.y, CENTER_Y);
  assert.equal(s.disc.vx, 0);
  assert.equal(s.disc.vy, 0);
  assert.equal(s.over, false);

  // 上方球门漏球 → p2 得分
  const g2 = fresh();
  g2.debugSet({
    serving: false,
    disc: { x: W / 2, y: TABLE.y0 + DISC_R + 1, vx: 0, vy: -320, trail: [] },
  });
  g2.step(STEP);
  const s2 = g2.state();
  assert.deepEqual(s2.score, { p1: 0, p2: 1 });
  assert.equal(s2.serveSide, 'p1');
});

test('08 发球轮转：连续失分时 serveSide 始终是失分方，且发球方向指向对手', () => {
  const g = fresh();
  // p2 先失分 → p2 发球
  g.debugSet({ serving: false, disc: { x: W / 2, y: TABLE.y1 - DISC_R - 1, vx: 0, vy: 320 } });
  g.step(STEP);
  assert.equal(g.state().serveSide, 'p2');
  assert.equal(g.submit('p2', 'start').ok, true);
  assert.ok(g.state().disc.vy < 0, 'p2 发球 → 向上飞向 p1');

  // p1 失分 → p1 发球
  g.debugSet({ serving: false, disc: { x: W / 2, y: TABLE.y0 + DISC_R + 1, vx: 0, vy: -320 } });
  g.step(STEP);
  assert.equal(g.state().serveSide, 'p1');
  assert.deepEqual(g.state().score, { p1: 1, p2: 1 });
  assert.equal(g.submit('p1', 'start').ok, true);
  assert.ok(g.state().disc.vy > 0, 'p1 发球 → 向下飞向 p2');

  // p2 再失分 → 又轮到 p2 发球
  g.debugSet({ serving: false, disc: { x: W / 2, y: TABLE.y1 - DISC_R - 1, vx: 0, vy: 320 } });
  g.step(STEP);
  assert.equal(g.state().serveSide, 'p2');
  assert.deepEqual(g.state().score, { p1: 2, p2: 1 });
});

test('09 7 分制：先到 7 分结束，result 给胜者与比分，结束后冻结', () => {
  const g = fresh();
  g.debugSet({
    serving: false,
    score: { p1: 6, p2: 3 },
    disc: { x: W / 2, y: TABLE.y1 - DISC_R - 1, vx: 0, vy: 320, trail: [] },
  });
  g.step(STEP);
  const s = g.state();
  assert.equal(s.over, true);
  assert.equal(s.winner, 'p1');
  assert.deepEqual(s.score, { p1: 7, p2: 3 });
  assert.equal(s.serving, false);
  assert.equal(s.disc.vx, 0);
  assert.equal(s.disc.vy, 0);

  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.winner, 'p1');
  assert.deepEqual(r.scores, { p1: 7, p2: 3 });
  assert.match(r.text, /7 : 3/);

  const frozen = JSON.stringify(g.state());
  g.step(STEP, ['p1down', 'p2up']);
  assert.equal(JSON.stringify(g.state()), frozen, '结束后 step 不改状态');
  assert.equal(g.submit('p1', 'start').ok, false);

  // 胜者可以是 p2（单人模式本机玩家）
  const g2 = createGame({ seed: 2, mode: 'solo' });
  g2.debugSet({
    serving: false,
    score: { p1: 0, p2: 6 },
    disc: { x: W / 2, y: TABLE.y0 + DISC_R + 1, vx: 0, vy: -320 },
  });
  g2.step(STEP);
  assert.equal(g2.state().winner, 'p2');
  const r2 = g2.result();
  assert.equal(r2.winner, 'p2');
  assert.equal(r2.title, '胜利', '单人模式本机（p2）获胜');
  assert.equal(r2.score, 7);
});

test('10 拍半场限制：动作与拖拽都推不过中线，边界即停', () => {
  const g = fresh();
  g.debugSet({ serving: true, serveTimer: 99 }); // 停在发球态，球不动，只测拍
  const b1 = PADDLE_BOUNDS.p1;
  const b2 = PADDLE_BOUNDS.p2;

  for (let i = 0; i < 200; i++) g.step(STEP, ['p1down']);
  let s = g.state();
  assert.equal(s.paddles.p1.y, b1.yMax);
  assert.ok(s.paddles.p1.y + PADDLE_R < CENTER_Y, 'p1 拍没有越过中线');
  assert.ok(s.paddles.p1.y >= b1.yMin && s.paddles.p1.y <= b1.yMax);

  for (let i = 0; i < 200; i++) g.step(STEP, ['p2up']);
  s = g.state();
  assert.equal(s.paddles.p2.y, b2.yMin);
  assert.ok(s.paddles.p2.y - PADDLE_R > CENTER_Y, 'p2 拍没有越过中线');

  for (let i = 0; i < 200; i++) g.step(STEP, ['p1left', 'p2right']);
  s = g.state();
  assert.equal(s.paddles.p1.x, b1.xMin);
  assert.equal(s.paddles.p2.x, b2.xMax);

  // 拖拽写到半场外：只夹到边界，不会越线
  assert.equal(g.submit('p1', 'pointer:p1:240,900').ok, true);
  s = g.state();
  assert.equal(s.paddles.p1.y, b1.yMax);
  assert.equal(g.submit('p1', 'pointer:p2:240,0').ok, true);
  s = g.state();
  assert.equal(s.paddles.p2.y, b2.yMin);
  assert.equal(g.submit('p1', 'pointer:p1:-500,320').ok, true);
  s = g.state();
  assert.equal(s.paddles.p1.x, b1.xMin);
  assert.equal(g.submit('p1', 'pointer:p1:10,10').ok, true);
  s = g.state();
  assert.equal(s.paddles.p1.x, b1.xMin);
  assert.equal(s.paddles.p1.y, b1.yMin);
});

test('11 AI 确定性追踪球 x/y 且不越界（solo/ai 下 AI 控 p1）', () => {
  const g = createGame({ seed: 3, mode: 'ai' });
  // 球在自己半场靠右：AI 应向右、向上贴到球下方（从上方压球）
  g.debugSet({ serving: false, disc: { x: 400, y: 260, vx: 0, vy: 0, trail: [] } });
  for (let i = 0; i < 18; i++) g.step(STEP);
  let s = g.state();
  assert.ok(s.paddles.p1.x > 320, `AI 向右追踪球的 x（${s.paddles.p1.x}）`);
  assert.ok(s.paddles.p1.y > 180, `AI 同时向下贴球（y=${s.paddles.p1.y}）`);
  assert.ok(s.paddles.p1.y >= PADDLE_BOUNDS.p1.yMin && s.paddles.p1.y <= PADDLE_BOUNDS.p1.yMax);

  // 球换到左侧：AI 也跟到左侧
  const g2 = createGame({ seed: 3, mode: 'ai' });
  g2.debugSet({ serving: false, disc: { x: 90, y: 250, vx: 0, vy: 0, trail: [] } });
  for (let i = 0; i < 30; i++) g2.step(STEP);
  s = g2.state();
  assert.ok(s.paddles.p1.x < 220, `AI 向左追踪球的 x（${s.paddles.p1.x}）`);
  assert.ok(s.paddles.p1.y <= PADDLE_BOUNDS.p1.yMax);

  // 长时间乱走：始终不越界、数值有限
  const g3 = createGame({ seed: 5, mode: 'solo' });
  for (let i = 0; i < 600; i++) {
    g3.step(STEP, [i % 90 < 45 ? 'p2left' : 'p2right']);
    const q = g3.state().paddles.p1;
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
    assert.ok(q.x >= PADDLE_BOUNDS.p1.xMin && q.x <= PADDLE_BOUNDS.p1.xMax);
    assert.ok(q.y >= PADDLE_BOUNDS.p1.yMin && q.y <= PADDLE_BOUNDS.p1.yMax);
    assert.ok(q.y + PADDLE_R <= CENTER_Y, 'AI 拍不越中线');
  }

  // 确定性：同种子同输入 → 状态逐字一致
  const run = () => {
    const gg = createGame({ seed: 11, mode: 'ai' });
    for (let i = 0; i < 200; i++) gg.step(STEP);
    return JSON.stringify(gg.state());
  };
  assert.equal(run(), run());
});

test('12 状态序列化：每次 new 对象，改快照不影响内部，联机字段齐全', () => {
  const g = fresh();
  const a = g.state();
  const b = g.state();
  assert.notEqual(a, b);
  assert.notEqual(a.disc, b.disc);
  assert.notEqual(a.paddles, b.paddles);
  assert.notEqual(a.score, b.score);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(a)));

  a.score.p1 = 99;
  a.disc.x = -1000;
  a.paddles.p1.y = -1;
  a.disc.trail.push({ x: 1, y: 1 });
  const c = g.state();
  assert.deepEqual(c.score, { p1: 0, p2: 0 });
  assert.ok(c.disc.x > 0 && c.disc.x < W);
  assert.equal(c.paddles.p1.y, HOME.p1.y);
  // 契约要求的联机字段
  assert.ok('turn' in c);
  assert.equal(c.turn, null);
  for (const k of ['disc', 'paddles', 'score', 'serveSide', 'over', 'winner']) {
    assert.ok(k in c, `state 必须含 ${k}`);
  }
  assert.deepEqual(Object.keys(c.paddles).sort(), ['p1', 'p2']);
});

test('13 连续 3000 步不崩：分数有界、数值有限、无 NaN、可序列化', () => {
  const g = fresh({ mode: 'local2p' });
  for (let i = 0; i < 3000; i++) {
    const ph = i % 300;
    const actions =
      ph < 100 ? ['p1down', 'p2up'] : ph < 200 ? ['p1right', 'p2left'] : ['p1left', 'p2right'];
    assert.doesNotThrow(() => g.step(STEP, actions), `第 ${i} 步不得抛错`);
    const s = g.state();
    assert.ok(Number.isFinite(s.disc.x) && Number.isFinite(s.disc.y), `第 ${i} 步球坐标有限`);
    assert.ok(Number.isFinite(s.disc.vx) && Number.isFinite(s.disc.vy));
    assert.ok(s.score.p1 <= WIN_SCORE && s.score.p2 <= WIN_SCORE);
    if (i % 500 === 0) assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
  }
  const s = g.state();
  assert.ok(s.disc.x >= TABLE.x0 - 1 && s.disc.x <= TABLE.x1 + 1, '球始终在桌内');
  assert.ok(s.disc.y >= TABLE.y0 - 1 && s.disc.y <= TABLE.y1 + 1);
  assert.ok(s.disc.speed <= 1150 + 1e-6);
  if (s.over) assert.ok(['p1', 'p2'].includes(g.result().winner));

  // 乱动作不崩
  assert.doesNotThrow(() => {
    const h = fresh();
    h.step(STEP, [null, 42, 'foo', {}, { seat: 'p9', action: 'left' }, { action: 'shoot' }]);
  });
  assert.equal(fresh().submit('p1', 123).ok, false);
  assert.equal(fresh().submit('p1', 'nope').ok, false);
});

test('14 联机实时：{seat, action} 把移动归属到该座位的拍，白名单词表可用', () => {
  const g = createGame({ seed: 9, mode: 'online', players: ['p1', 'p2'] });
  g.debugSet({ serving: true, serveTimer: 99 });
  const x1 = g.state().paddles.p1.x;
  const x2 = g.state().paddles.p2.x;

  g.step(STEP, [{ seat: 'p1', action: 'left' }]);
  let s = g.state();
  assert.ok(s.paddles.p1.x < x1, 'seat=p1 的 left 动上方拍');
  assert.equal(s.paddles.p2.x, x2, '不动对手的拍');

  g.step(STEP, [{ seat: 'p2', action: 'right' }, { seat: 'p2', action: 'up' }]);
  s = g.state();
  assert.ok(s.paddles.p2.x > x2, 'seat=p2 的 right 动下方拍');
  assert.ok(s.paddles.p2.y < HOME.p2.y, 'seat=p2 的 up 动下方拍 y');

  // 客户端用 p1 前缀也动不了别人的拍：座位由服务端认定
  const before2 = g.state().paddles.p2.x;
  const before1 = g.state().paddles.p1.x;
  g.step(STEP, [{ seat: 'p2', action: 'p1right' }]);
  s = g.state();
  assert.equal(s.paddles.p1.x, before1, '前缀不能越权动 p1');
  assert.ok(s.paddles.p2.x > before2, '前缀被服务端座位覆盖');

  // 白名单里的发球词：shoot → 立刻发球
  assert.equal(g.state().serving, true);
  g.step(STEP, [{ seat: 'p1', action: 'shoot' }]);
  s = g.state();
  assert.equal(s.serving, false, 'shoot 立刻发球');
  assert.ok(s.disc.vy > 0, 'p1 发球向下');

  // 非发球方 shoot 不生效
  const h = createGame({ seed: 9, mode: 'online' });
  h.debugSet({ serving: true, serveTimer: 99, serveSide: 'p1' });
  h.step(STEP, [{ seat: 'p2', action: 'action2' }]);
  assert.equal(h.state().serving, true, '只有发球方能立即发球');

  // 裸方向词无 seat → 归本机 p2
  const k = fresh();
  k.debugSet({ serving: true, serveTimer: 99 });
  const kx = k.state().paddles.p2.x;
  k.step(STEP, ['left']);
  assert.ok(k.state().paddles.p2.x < kx);
  assert.equal(k.state().paddles.p1.x, HOME.p1.x);
});

test('15 纯逻辑门禁：logic/ai 无 DOM、无真随机、无真时钟', () => {
  for (const rel of ['../logic.mjs', '../ai.mjs']) {
    const src = codeOnly(new URL(rel, import.meta.url));
    for (const [re, label] of [
      [/\bdocument\./, 'document'],
      [/\bwindow\./, 'window'],
      [/\bMath\.random\s*\(/, 'Math.random'],
      [/\bDate\.now\s*\(/, 'Date.now'],
      [/\bnew\s+Date\s*\(/, 'new Date'],
      [/\bperformance\.now\s*\(/, 'performance.now'],
    ]) {
      assert.ok(!re.test(src), `${rel} 不得出现 ${label}`);
    }
  }
});

test('16 渲染冒烟：四种模式 + 发球态 + 结算态都不抛异常，且不改 state', () => {
  const gradient = { addColorStop() {} };
  const base = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
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

  // 结算态
  const g = createGame({ seed: 5, mode: 'local2p' });
  const over = g.state();
  over.over = true;
  over.winner = 'p1';
  over.serving = false;
  over.score = { p1: 7, p2: 4 };
  assert.doesNotThrow(() => render(ctx, over, view));

  // 关键绘制调用确实发生
  for (const op of ['fillText', 'arc', 'setLineDash', 'fill', 'stroke', 'fillRect']) {
    assert.ok(drawn.includes(op), `应绘制 ${op}`);
  }
  // 球门凹口（圆角矩形）用了 quadraticCurveTo，说明球门有画出来
  assert.ok(drawn.includes('quadraticCurveTo'), '球门凹口/圆角桌面被绘制');
});

test('17 输入映射：双人分控、单人合并、拖拽分半屏、联机只发白名单裸方向词', () => {
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
    const makeShell = (game, online = null) => ({
      game,
      online,
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

    // 单人：WASD 与 ↑↓←→ 都控下拍 p2
    const g1 = createGame({ seed: 1, mode: 'solo' });
    const shell1 = makeShell(g1);
    const raw1 = makeRaw();
    const in1 = createInput({ raw: raw1, shell: shell1, mode: 'solo' });
    fire('keydown', 'KeyW');
    in1.update(STEP);
    assert.deepEqual(in1.actions, ['p2up']);
    fire('keydown', 'ArrowRight');
    in1.update(STEP);
    assert.deepEqual(in1.actions.sort(), ['p2right', 'p2up'].sort());
    fire('keyup', 'KeyW');
    fire('keyup', 'ArrowRight');
    in1.update(STEP);
    assert.deepEqual(in1.actions, []);

    // 双人：W/A → p1，↑/→ → p2
    const g2 = createGame({ seed: 1, mode: 'local2p' });
    const in2 = createInput({ raw: makeRaw(), shell: makeShell(g2), mode: 'local2p' });
    fire('keydown', 'KeyW');
    fire('keydown', 'ArrowDown');
    in2.update(STEP);
    assert.deepEqual(in2.actions.sort(), ['p1up', 'p2down'].sort());
    fire('keyup', 'KeyW');
    fire('keyup', 'ArrowDown');
    fire('keydown', 'KeyA');
    fire('keydown', 'ArrowRight');
    in2.update(STEP);
    assert.deepEqual(in2.actions.sort(), ['p1left', 'p2right'].sort());
    fire('keyup', 'KeyA');
    fire('keyup', 'ArrowRight');

    // 拖拽：单人固定 p2
    const raw3 = makeRaw();
    const shell3 = makeShell(createGame({ seed: 1, mode: 'solo' }));
    const in3 = createInput({ raw: raw3, shell: shell3, mode: 'solo' });
    raw3.pointer = { x: 120, y: 600, down: true, justDown: true };
    in3.update(STEP);
    assert.ok(shell3.submitted.includes('pointer:p2:120.0,600.0'), JSON.stringify(shell3.submitted));

    // 拖拽：双人按半屏归属
    const raw4 = makeRaw();
    const shell4 = makeShell(createGame({ seed: 1, mode: 'local2p' }));
    const in4 = createInput({ raw: raw4, shell: shell4, mode: 'local2p' });
    raw4.pointer = { x: 200, y: 100, down: true, justDown: true };
    in4.update(STEP);
    assert.ok(shell4.submitted.includes('pointer:p1:200.0,100.0'), JSON.stringify(shell4.submitted));
    raw4.pointer = { x: 300, y: 560, down: false, justDown: false };
    in4.update(STEP);
    raw4.pointer = { x: 300, y: 560, down: true, justDown: true };
    in4.update(STEP);
    assert.ok(shell4.submitted.includes('pointer:p2:300.0,560.0'), JSON.stringify(shell4.submitted));

    // 发球：空格提交 start
    const raw5 = makeRaw();
    raw5.justPressed = (a) => a === 'action';
    const g5 = createGame({ seed: 1, mode: 'local2p' });
    const shell5 = makeShell(g5);
    const in5 = createInput({ raw: raw5, shell: shell5, mode: 'local2p' });
    in5.update(STEP);
    assert.ok(shell5.submitted.includes('start'), JSON.stringify(shell5.submitted));

    // 联机：只发裸方向词，不发坐标、不带 p1/p2 前缀
    const g6 = createGame({ seed: 1, mode: 'online' });
    const shell6 = makeShell(g6, { seat: 'p2' });
    const in6 = createInput({ raw: makeRaw(), shell: shell6, mode: 'online' });
    fire('keydown', 'KeyA');
    in6.update(STEP);
    assert.deepEqual(shell6.submitted, ['left']);
    fire('keyup', 'KeyA');
    fire('keydown', 'ArrowUp');
    in6.update(STEP);
    assert.deepEqual(shell6.submitted, ['left', 'up']);
    for (const a of shell6.submitted) {
      assert.ok(['left', 'right', 'up', 'down', 'shoot'].includes(a), `联机词表越界：${a}`);
    }

    // dispose 摘掉键盘监听
    const before = (listeners.keydown || []).length;
    in1.dispose();
    assert.equal((listeners.keydown || []).length, before - 1);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
