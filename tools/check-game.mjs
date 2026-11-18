/**
 * 单页检查：打开 URL，可执行「进入对局」脚本，输出布局数值、控制台错误并截图。
 *
 * 用法：
 *   node tools/check-game.mjs --url=http://127.0.0.1:8101/games/snake/ --width=375 --height=812 \
 *     --enter="document.querySelector('.cg-mode').click()" --out=.agents/work/screens/snake-375.png
 */
import { launchBrowser } from './cdp.mjs';

function arg(name, def = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const url = arg('url');
const width = Number(arg('width', '375'));
const height = Number(arg('height', '812'));
const dpr = Number(arg('dpr', '2'));
const mobile = arg('mobile', '1') !== '0';
const wait = Number(arg('wait', '1200'));
const enter = arg('enter');
const out = arg('out');
const settle = Number(arg('settle', '800'));

if (!url) {
  console.error('用法：node tools/check-game.mjs --url=<url> [--width=375] [--height=812] [--enter=<js>] [--out=<png>]');
  process.exit(2);
}

const browser = await launchBrowser();
let exitCode = 0;
try {
  const page = await browser.newPage({ width, height, dpr, mobile });
  await page.goto(url, { waitMs: wait });

  let entered = false;
  if (enter) {
    try {
      await page.evaluate(enter);
      entered = true;
    } catch (err) {
      console.error('进入对局脚本失败：', err.message);
    }
    await new Promise((r) => setTimeout(r, settle));
  }

  const metrics = await page.metrics();
  const errors = page.errors.slice();

  if (out) {
    await page.screenshot(out);
    console.log(`截图：${out}`);
  }

  const overflowX = metrics.scrollWidth - metrics.innerWidth;
  console.log(JSON.stringify({ url, viewport: `${width}x${height}`, entered, overflowX, errors, metrics }, null, 2));

  if (errors.length || overflowX > 1) exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
