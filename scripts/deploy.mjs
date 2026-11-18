/**
 * 部署到 NAS：上传 tar → fnpack build 成 .fpk（不自动安装）。
 *
 * 为什么打包在 NAS 上做：fnpack 只装在 fnOS 上，它负责 fpk 的校验与封装。
 * 凭据：口令只在既有载体 .sshpass_askpass.cmd，ssh-put.sh 读取；本脚本不持有口令。
 *
 * 用法：
 *   node scripts/deploy.mjs              # 上传 + 打包，产物留 NAS
 *   node scripts/deploy.mjs --install    # 额外：卸载旧的 + 安装（升级不覆盖，必须先卸载）
 */
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARBALL = path.join(ROOT, 'build', 'classic-games.tar.gz');
const SSH_RUN_DIR = 'D:/MyProjects/W.FNOS维护';
const SSH_RUN = `${SSH_RUN_DIR}/ssh-run.ps1`;
const REMOTE_STAGE = '/home/panyunmeng/classicgames-build';

const args = process.argv.slice(2);
const doInstall = args.includes('--install');
const port = args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '8082';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function die(msg) {
  console.error(c.err(`✗ ${msg}`));
  process.exit(1);
}

if (!existsSync(TARBALL)) die('缺少 build/classic-games.tar.gz，先跑 node scripts/pack.mjs');
if (!existsSync(SSH_RUN)) die(`找不到 SSH 包装器 ${SSH_RUN}`);

async function remote(script, label) {
  const tmp = path.join(ROOT, 'build', `.remote-${Date.now()}.sh`);
  await fs.writeFile(tmp, script.replace(/\r\n/g, '\n'), 'utf8');
  console.log(c.dim(`  → ${label}`));
  const cmd = `cd '/d/MyProjects/W.FNOS维护' && pwsh -NoProfile -File ./ssh-run.ps1 -Script '${tmp.split(path.sep).join('/')}'`;
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  await fs.rm(tmp, { force: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.status !== 0) die(`${label} 失败（退出码 ${r.status}）\n${out.slice(-1500)}`);
  return out;
}

function putFile(localPath, remotePath) {
  console.log(c.dim(`  → 上传 ${path.basename(localPath)}`));
  const helper = path.join(ROOT, 'scripts', 'ssh-put.sh');
  const r = spawnSync('bash', [helper.split(path.sep).join('/'), localPath.split(path.sep).join('/'), remotePath], {
    encoding: 'utf8',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.status !== 0) die(`上传失败（退出码 ${r.status}）\n${out.slice(-800)}`);
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  const sent = lines.length ? Number(lines[lines.length - 1]) : null;
  const local = statSync(localPath).size;
  if (sent !== local) die(`上传字节数不符：本地 ${local}，远端 ${sent ?? '未读到'}`);
  console.log(`  ${c.ok('✓')} ${(local / 1024 / 1024).toFixed(2)} MB 校验一致`);
  return sent;
}

console.log(c.bold('\n部署经典游戏合集到 NAS\n'));

// 1. 探活
const probe = await remote(
  `echo "HOST=$(hostname)"
   echo "FNOS=$(cat /usr/trim/etc/version 2>/dev/null || echo unknown)"
   command -v fnpack >/dev/null && echo "FNPACK=$(fnpack --help 2>&1 | head -1)" || echo "FNPACK=missing"
   test -x /var/apps/nodejs_v24/target/bin/node && echo "NODE=$(/var/apps/nodejs_v24/target/bin/node -v)" || echo "NODE=missing"`,
  '探测 NAS 环境'
);
console.log(probe.split('\n').map((l) => `    ${l}`).join('\n'));
if (probe.includes('FNPACK=missing')) die('NAS 上没有 fnpack');
if (probe.includes('NODE=missing')) die('NAS 上没有 nodejs_v24 运行时');

// 建暂存目录（首次部署时不存在，ssh-put 的重定向会报 No such file or directory）
await remote(`mkdir -p ${REMOTE_STAGE} && ls -ld ${REMOTE_STAGE}`, '准备暂存目录');

// 2. 上传 + 解包
putFile(TARBALL, `${REMOTE_STAGE}/app.tar.gz`);
const unpackOut = await remote(
  `set -e
   cd ${REMOTE_STAGE}
   rm -rf src build
   mkdir -p src
   tar -xzf app.tar.gz -C src
   echo "--- 顶层 ---"; ls src
   echo "--- cmd 权限（应 rwxr-xr-x）---"; ls -l src/cmd | head -4`,
  '远端解包'
);
console.log(unpackOut.split('\n').map((l) => `    ${l}`).join('\n'));

// 3. fnpack build
const buildOut = await remote(
  `set -e
   cd ${REMOTE_STAGE}
   rm -rf build && mkdir -p build
   cp -a src build/classic-games
   cd build/classic-games
   echo "--- manifest ---"; head -3 manifest
   echo "--- fnpack build ---"
   fnpack build -d . 2>&1 | tail -20
   echo "--- 产物 ---"
   ls -la *.fpk 2>/dev/null || find . -name "*.fpk" -maxdepth 2`,
  'fnpack 打包'
);
console.log(buildOut.split('\n').map((l) => `    ${l}`).join('\n'));

// 4. 可选安装（升级必须先卸载）
if (doInstall) {
  console.log(c.bold('\n安装 / 重装\n'));
  const installOut = await remote(
    `set -e
     printf 'wizard_port=${port}\\nwizard_enable_port=true\\nwizard_lan_only=false\\n' > /tmp/cg-inst.env
     # ssh-run.ps1 已在脚本头部注入 PW（口令只在内存变量里，不回显不落盘）
     printf '%s\\n' "$PW" | sudo -S -p '' appcenter-cli uninstall classic-games 2>&1 | tail -3 || true
     cd ${REMOTE_STAGE}/build/classic-games
     printf '%s\\n' "$PW" | sudo -S -p '' appcenter-cli install-fpk classic-games.fpk -e /tmp/cg-inst.env -v 1 2>&1 | tail -10
     echo "--- status ---"
     printf '%s\\n' "$PW" | sudo -S -p '' appcenter-cli status classic-games 2>&1 | tail -5`,
    '卸载旧版并安装'
  );
  console.log(installOut.split('\n').map((l) => `    ${l}`).join('\n'));
}

console.log(c.ok('\n✓ 部署完成（fpk 产物留在 NAS 上）'));
