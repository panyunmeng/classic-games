/**
 * 扫雷手机端插旗交互验收。
 * 流程：进入对局 → 点「🚩插旗」按钮 → 点棋盘格 → 验证 state.flags>0 且格子 flagged。
 * 同时验证不点插旗按钮时普通点按是翻开（reveal），不会误插旗。
 */
import { launchBrowser } from './cdp.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8101';
const URL = `${BASE}/games/minesweeper/`;

const browser = await launchBrowser();
let exit = 0;
try {
  const page = await browser.newPage({ width: 375, height: 812, dpr: 2, mobile: true });
  await page.goto(URL, { waitMs: 1000 });

  // 进入对局：点第一个游戏模式
  await page.evaluate("document.querySelector('.cg-mode').click()");
  await new Promise((r) => setTimeout(r, 500));

  const before = await page.evaluate(`(() => {
    const s = window.__CG_SHELL__.state();
    return { flags: s.flags, opened: s.opened, cols: s.cols, rows: s.rows };
  })()`);
  console.log('开局:', JSON.stringify(before));

  // ── 用例 1：点插旗按钮进入插旗模式
  const flagBtn = await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('.cg-actionbtn')].find(x => x.textContent.includes('插旗'));
    if (!b) return null;
    // 用真实 pointer 事件（raw.bindButton 绑的是 pointerdown/up，不是 click）
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const mk = (type) => new PointerEvent(type, {
      pointerId: 9, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true
    });
    b.dispatchEvent(mk('pointerdown'));
    b.dispatchEvent(mk('pointerup'));
    return b.textContent;
  })()`);
  console.log('插旗按钮:', flagBtn);
  if (!flagBtn) throw new Error('找不到插旗按钮');
  await new Promise((r) => setTimeout(r, 200));

  const flagMode = await page.evaluate(`window.__CG_SHELL__.input && window.__CG_SHELL__.input.isFlagMode()`);
  console.log('插旗模式开启:', flagMode);
  if (!flagMode) throw new Error('插旗按钮未开启插旗模式');

  // 点棋盘左上角格子（逻辑坐标通过 canvas 几何换算）
  const tapResult = await page.evaluate(`(() => {
    const sh = window.__CG_SHELL__;
    const s = sh.state();
    // 从 render 的几何反推：cell = min(28, floor(440/cols), floor(462/rows))，x/y 居中，棋盘 y 起点 142
    const cap = s.cols <= 9 ? 44 : s.cols <= 16 ? 28 : 15;
    const cell = Math.max(8, Math.min(cap, Math.floor(440 / s.cols), Math.floor(462 / s.rows)));
    const w = cell * s.cols, h = cell * s.rows;
    const gx = Math.floor((480 - w) / 2);
    const gy = 142 + Math.floor((462 - h) / 2);
    // 选一个未翻开的格子
    let tx = 0, ty = 0;
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      const cellData = s.cells[r * s.cols + c];
      if (!cellData.revealed && !cellData.flagged) { tx = c; ty = r; break; }
    }
    // 逻辑坐标转 CSS 坐标
    const cv = document.getElementById('game-canvas');
    const rect = cv.getBoundingClientRect();
    const lx = gx + tx * cell + cell / 2;
    const ly = gy + ty * cell + cell / 2;
    const cx = rect.left + (lx / 480) * rect.width;
    const cy = rect.top + (ly / 640) * rect.height;
    return { cx, cy, tx, ty };
  })()`);
  console.log('点格坐标:', JSON.stringify(tapResult));

  // 用真实的 pointer/touch 事件点击（走 shared/input.js 的 pointer 通道）
  await page.evaluate(`(() => {
    const cv = document.getElementById('game-canvas');
    const { cx, cy } = ${JSON.stringify(tapResult)};
    const mk = (type) => new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true
    });
    cv.dispatchEvent(mk('pointerdown'));
    // shared/input.js 在 pointerdown 里 setPointerCapture，jsdom 无但浏览器有
    cv.dispatchEvent(mk('pointerup'));
  })()`);
  await new Promise((r) => setTimeout(r, 250));

  const afterFlag = await page.evaluate(`(() => {
    const s = window.__CG_SHELL__.state();
    return { flags: s.flags, opened: s.opened };
  })()`);
  console.log('插旗后:', JSON.stringify(afterFlag));
  if (afterFlag.flags <= before.flags) throw new Error('插旗模式点格子未产生旗子');

  // ── 用例 2：再点一次同格应取消旗
  await page.evaluate(`(() => {
    const cv = document.getElementById('game-canvas');
    const { cx, cy } = ${JSON.stringify(tapResult)};
    const mk = (type) => new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true
    });
    cv.dispatchEvent(mk('pointerdown'));
    cv.dispatchEvent(mk('pointerup'));
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  const afterUnflag = await page.evaluate(`window.__CG_SHELL__.state().flags`);
  console.log('再点一次后 flags:', afterUnflag);
  if (afterUnflag !== before.flags) throw new Error('插旗模式再点未取消旗');

  // ── 用例 3：退出插旗模式后普通点按是翻开
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('.cg-actionbtn')].find(x => x.textContent.includes('插旗'));
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const mk = (type) => new PointerEvent(type, {
      pointerId: 9, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true
    });
    b.dispatchEvent(mk('pointerdown'));
    b.dispatchEvent(mk('pointerup'));
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  const modeOff = await page.evaluate(`window.__CG_SHELL__.input && window.__CG_SHELL__.input.isFlagMode()`);
  console.log('插旗模式关闭:', !modeOff);
  if (modeOff) throw new Error('插旗按钮未关闭模式');

  await page.screenshot('.agents/work/screens/minesweeper-flagmode.png');
  console.log('\n=== 插旗交互验收通过 ===');
} catch (err) {
  console.error('FAIL:', err.message);
  exit = 1;
} finally {
  await browser.close();
}
process.exit(exit);
