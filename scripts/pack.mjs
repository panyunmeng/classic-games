/**
 * 组装 fnapp 目录树并打 tar.gz，上传到 NAS 后由 fnpack 打成 .fpk。
 *
 * 产物布局（fnpack 只认这个形状）：
 *   classic-games/{manifest,ICON*.PNG,config,cmd,wizard,app/{ui,www,server}}
 *   app/www   ← build/www（静态产物）
 *   app/server ← platform/server（服务端 + ws 依赖）
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN = path.join(ROOT, 'packaging', 'fnapp');
const WWW = path.join(ROOT, 'build', 'www');
const STAGE = path.join(ROOT, 'build', 'fnapp');
const TAR = path.join(ROOT, 'build', 'classic-games.tar.gz');

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copyDir(src, dst, exclude = []) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (exclude.includes(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d, exclude);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

async function main() {
  if (!existsSync(WWW)) die('缺少 build/www，先跑 node scripts/build.mjs');

  await rmrf(STAGE);
  await fs.mkdir(STAGE, { recursive: true });

  // 骨架文件（manifest / config / wizard / ui / cmd / 图标）
  for (const name of ['manifest', 'ICON.PNG', 'ICON_256.PNG', 'config', 'wizard', 'cmd']) {
    const src = path.join(FN, name);
    if (!existsSync(src)) die(`缺少骨架 ${name}`);
    const st = await fs.stat(src);
    if (st.isDirectory()) await copyDir(src, path.join(STAGE, name));
    else await fs.copyFile(src, path.join(STAGE, name));
  }
  await copyDir(path.join(FN, 'app', 'ui'), path.join(STAGE, 'app', 'ui'));

  // 静态产物 → app/www
  await copyDir(WWW, path.join(STAGE, 'app', 'www'));

  // 服务端 → app/server（含 ws 依赖，Node 从被 import 文件位置向上找 node_modules）
  await copyDir(path.join(ROOT, 'platform', 'server'), path.join(STAGE, 'app', 'server'));
  await copyDir(path.join(ROOT, 'node_modules', 'ws'), path.join(STAGE, 'app', 'server', 'node_modules', 'ws'));

  // 关键自检：Web 资源必须在 app/www，否则 fnpack 静默忽略
  const wwwCheck = path.join(STAGE, 'app', 'www', 'index.html');
  if (!existsSync(wwwCheck)) die('打包自检失败：app/www/index.html 不存在');

  // wizard switch 的 initValue 必须是字符串
  for (const w of ['wizard/install', 'wizard/config']) {
    const p = path.join(STAGE, w);
    const obj = JSON.parse(await fs.readFile(p, 'utf8'));
    let fixed = false;
    for (const step of obj) {
      for (const item of step.items || []) {
        if (item.type === 'switch' && typeof item.initValue === 'boolean') {
          item.initValue = String(item.initValue);
          fixed = true;
        }
      }
    }
    if (fixed) await fs.writeFile(p, JSON.stringify(obj, null, 2));
  }

  // 用 Python tarfile 写权限位（cmd/ 755）
  const py = spawnSync('python', [path.join(ROOT, 'packaging', 'pack-tar.py'), STAGE, TAR], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (py.status !== 0) die(`打包失败：${py.stderr || py.stdout}`);
  console.log(py.stdout.trim());
  console.log(`fnapp 目录：${STAGE}`);
}

main().catch((err) => die(err.message));
