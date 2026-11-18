/**
 * 构建：收拢 games/ + shared/ + portal/ → build/www，并做交付前自检。
 *
 * 自检项都是真实出过故障的类型（3D 合集的历史）：
 * 绝对路径引用（子路径部署 404）、manifest 与目录不一致、缺入口、体积失控。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES } from '../platform/manifest.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES_DIR = path.join(ROOT, 'games');
const OUT = path.join(ROOT, 'build', 'www');
const VERSION = process.env.APP_VERSION || '0.1.0';

const errors = [];
const warnings = [];

function log(...args) {
  console.log(...args);
}

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function copyDir(src, dst, { exclude = [] } = {}) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (exclude.includes(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d, { exclude });
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

async function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    const st = await fsp.stat(cur);
    if (st.isDirectory()) {
      for (const name of await fsp.readdir(cur)) stack.push(path.join(cur, name));
    } else {
      total += st.size;
    }
  }
  return total;
}

function scanText(file, text) {
  const rel = path.relative(ROOT, file);
  if (/<(?:script|link|img|source)[^>]+(?:src|href)\s*=\s*["']\//i.test(text)) {
    errors.push(`${rel}: 存在根绝对路径引用（子路径部署会 404）`);
  }
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(text)) {
    errors.push(`${rel}: 引用了外部资源（要求零外部依赖）`);
  }
}

async function scanTree(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await scanTree(full);
    else if (/\.(html|css|js|mjs)$/.test(e.name)) {
      scanText(full, await fsp.readFile(full, 'utf8'));
    }
  }
}

async function main() {
  await rmrf(path.join(ROOT, 'build'));
  await fsp.mkdir(OUT, { recursive: true });

  // shared
  await copyDir(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));

  // portal
  await fsp.copyFile(path.join(ROOT, 'platform', 'portal', 'index.html'), path.join(OUT, 'index.html'));
  await fsp.copyFile(path.join(ROOT, 'platform', 'portal', 'portal.css'), path.join(OUT, 'portal.css'));
  await fsp.copyFile(path.join(ROOT, 'platform', 'portal', 'portal.js'), path.join(OUT, 'portal.js'));

  // games
  const merged = [];
  for (const entry of GAMES) {
    const src = path.join(GAMES_DIR, entry.id);
    const dst = path.join(OUT, 'games', entry.id);
    if (!fs.existsSync(src)) {
      // 清单是完整规划（36 款），未落盘的跳过并警告，不阻塞构建
      warnings.push(`manifest: games/${entry.id} 未落盘，本次构建跳过`);
      continue;
    }
    await copyDir(src, dst, { exclude: ['tests', '.agents', 'node_modules', '.git'] });

    let meta;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(src, 'game.json'), 'utf8'));
    } catch (err) {
      errors.push(`games/${entry.id}: game.json 无法解析（${err.message}）`);
      continue;
    }
    if (meta.id !== entry.id) {
      errors.push(`games/${entry.id}: game.json id=${meta.id} 与目录名不一致`);
    }
    if (!fs.existsSync(path.join(dst, 'index.html'))) {
      errors.push(`games/${entry.id}: 缺少 index.html`);
    }
    if (meta.modes?.includes('online') && !meta.online) {
      warnings.push(`games/${entry.id}: modes 含 online 但未声明 online 能力`);
    }

    // 纯逻辑门禁：logic.mjs 不得调用 DOM / 真随机 / 真时钟。
    // 逐行剥掉注释再匹配，避免注释里写「无 Math.random」被误判。
    const logicPath = path.join(src, 'logic.mjs');
    if (fs.existsSync(logicPath)) {
      const logicSrc = await fsp.readFile(logicPath, 'utf8');
      const codeOnly = logicSrc
        .split('\n')
        .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))
        .join('\n');
      for (const [re, label] of [
        [/\bdocument\./, 'document'],
        [/\bwindow\./, 'window'],
        [/\bMath\.random\s*\(/, 'Math.random'],
        [/\bDate\.now\s*\(/, 'Date.now'],
        [/\bnew\s+Date\s*\(/, 'new Date'],
      ]) {
        if (re.test(codeOnly)) {
          errors.push(`games/${entry.id}/logic.mjs: 纯逻辑中出现 ${label}（联机不可复现）`);
        }
      }
    } else {
      errors.push(`games/${entry.id}: 缺少 logic.mjs`);
    }

    // 单测门禁：每款游戏必须有 tests 下的测试文件（契约要求 ≥8 条）
    const testsDir = path.join(src, 'tests');
    if (!fs.existsSync(testsDir) || !(await fsp.readdir(testsDir)).some((f) => f.endsWith('.test.mjs'))) {
      errors.push(`games/${entry.id}: 缺少 tests/*.test.mjs（契约要求 ≥8 条单测）`);
    }

    const jsSize = (await listFiles(dst))
      .filter((f) => /\.(js|mjs)$/.test(f))
      .reduce((sum, f) => sum + fs.statSync(f).size, 0);
    if (jsSize > 160 * 1024) {
      warnings.push(`games/${entry.id}: JS 体积 ${(jsSize / 1024).toFixed(0)} KB 超过 160 KB 预算`);
    }
    merged.push({
      ...meta,
      order: entry.order ?? meta.order ?? 99,
      path: `games/${entry.id}/`,
    });
  }

  merged.sort((a, b) => (a.order || 99) - (b.order || 99));
  await fsp.writeFile(
    path.join(OUT, 'manifest.json'),
    JSON.stringify({ version: VERSION, games: merged }, null, 2)
  );
  await fsp.writeFile(path.join(OUT, 'version.json'), JSON.stringify({ version: VERSION }));

  await scanTree(OUT);

  const total = await dirSize(OUT);
  if (total > 8 * 1024 * 1024) {
    warnings.push(`产物总体积 ${(total / 1024 / 1024).toFixed(1)} MB 超过 8 MB 预算`);
  }

  log('');
  log(`构建完成：${merged.length} 款游戏，产物 ${(total / 1024).toFixed(0)} KB → build/www`);
  for (const g of merged) log(`  · ${g.title.padEnd(10)} ${g.path}`);
  if (warnings.length) {
    log('');
    log('警告：');
    for (const w of warnings) log(`  ! ${w}`);
  }
  if (errors.length) {
    log('');
    log('错误：');
    for (const e of errors) log(`  ✗ ${e}`);
    process.exit(1);
  }
}

async function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of await fsp.readdir(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
