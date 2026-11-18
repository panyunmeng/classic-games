/**
 * 批量三视口验收：一个 Chrome 实例跑完所有游戏 × {竖屏/横屏/桌面}。
 *
 * 资源纪律（用户明确）：绝不每个游戏重开浏览器；脚本内 spawn 一次、结束 kill 一次。
 * 判据（任一不过 → 该行 FAIL）：
 *   1. console error / 未捕获异常 = 0
 *   2. 无横向滚动（scrollWidth ≤ innerWidth + 1）
 *   3. canvas 可见面积 > 20%
 *   4. 最小可点元素 ≥ 40px（44 理想，40 是横屏下限）
 *   5. --enter 脚本能进入对局（若声明）
 */
import { launchBrowser } from './cdp.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8101';
const OUT = path.resolve('.agents/work/screens');
const MIN_TARGET = 40;

// 从构建产物 manifest.json 自动读取游戏列表，新增游戏无需改验收脚本。
// 「怎么进对局」优先用游戏(private)的 enter 钩子表；缺省点第一个 .cg-mode。
let GAMES = [];
try {
  const data = JSON.parse(await fs.readFile('build/www/manifest.json', 'utf8'));
  GAMES = (data.games || []).map((g) => ({
    id: g.id,
    enter: "document.querySelector('.cg-mode').click()",
  }));
} catch {
  console.error('读不到 build/www/manifest.json，先跑 node scripts/build.mjs');
  process.exit(2);
}

const VIEWPORTS = [
  { id: 'portrait', width: 375, height: 812, dpr: 2, mobile: true },
  { id: 'landscape', width: 844, height: 390, dpr: 2, mobile: true },
  { id: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length ? GAMES.filter((g) => only.includes(g.id)) : GAMES;

const browser = await launchBrowser();
const rows = [];

try {
  for (const game of targets) {
    for (const vp of VIEWPORTS) {
      const label = `${game.id}/${vp.id}`;
      const errors = [];
      let entered = false;
      let m = null;

      try {
        const page = await browser.newPage(vp);
        await page.goto(`${BASE}/games/${game.id}/`, { waitMs: 900 });

        if (game.enter) {
          try {
            await page.evaluate(game.enter);
            entered = true;
          } catch (err) {
            errors.push({ kind: 'enter', text: err.message });
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        m = await page.metrics();
        errors.push(...page.errors.slice());

        const shot = path.join(OUT, `${game.id}-${vp.id}.png`);
        await page.screenshot(shot);
        await page.close?.();
      } catch (err) {
        errors.push({ kind: 'exception', text: err.message });
      }

      const overflowX = m ? m.scrollWidth - m.innerWidth : -1;
      const canvasOK = m ? m.canvasVisibleRatio > 0.2 : false;
      const targetOK = m ? m.minTarget == null || m.minTarget >= MIN_TARGET : false;
      const pass =
        errors.length === 0 && overflowX <= 1 && canvasOK && targetOK && (!game.enter || entered);

      rows.push({ label, pass, errors: errors.length, overflowX, canvas: m?.canvasVisibleRatio, minTarget: m?.minTarget, entered });
      console.log(
        `${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(22)} errors=${errors.length} overflowX=${overflowX} canvas=${m?.canvasVisibleRatio} minTarget=${m?.minTarget} entered=${entered}`
      );
      if (errors.length) {
        for (const e of errors.slice(0, 3)) console.log(`       ${e.kind}: ${String(e.text).slice(0, 120)}`);
      }
    }
  }
} finally {
  await browser.close();
}

const failed = rows.filter((r) => !r.pass);
console.log(`\n===== 汇总：${rows.length - failed.length}/${rows.length} 通过 =====`);
if (failed.length) {
  for (const r of failed) console.log(`  FAIL ${r.label}`);
  process.exit(1);
}
