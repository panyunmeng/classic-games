/**
 * 合集服务：静态托管 + 网关前缀剥离 + 联机 WebSocket 挂载点。
 *
 * 事实来源：
 * - fnOS 统一网关会把请求连同 /app/<appname> 前缀一起转发，所以服务必须会剥前缀；
 * - 一个 http.Server 只能 listen 一个地址，端口与网关 socket 必须建两个实例共享处理逻辑；
 * - 静态资源全部相对路径，服务端只负责查文件，不重写 HTML。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const ROOT = path.resolve(process.env.WEB_ROOT || path.join(REPO, 'build', 'www'));
const PORT = Number(process.env.PORT || 8099);
const HOST = process.env.HOST || '0.0.0.0';
const SOCKET = process.env.GATEWAY_SOCKET_PATH || '';
const PREFIX = normalizePrefix(process.env.GATEWAY_PREFIX || '');
const VERSION = process.env.APP_VERSION || 'dev';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function normalizePrefix(p) {
  let s = (p || '').trim();
  if (!s) return '';
  if (!s.startsWith('/')) s = '/' + s;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function splitPath(pathname) {
  if (PREFIX && (pathname === PREFIX || pathname.startsWith(PREFIX + '/'))) {
    return { prefix: PREFIX, inner: pathname.slice(PREFIX.length) || '/' };
  }
  return { prefix: '', inner: pathname };
}

function safeJoin(inner) {
  const rel = decodeURIComponent(inner.replace(/^\/+/, ''));
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local');
  const { prefix, inner } = splitPath(url.pathname);

  // favicon：单文件游戏内联图标，浏览器仍会来根路径要；统一 204 避免假报错
  if (inner === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (inner === '/healthz') {
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      games: await countGames(),
      uptime: Math.round(process.uptime()),
    });
  }
  if (inner === '/version.json') {
    return sendJson(res, 200, { version: VERSION });
  }

  let filePath = safeJoin(inner);
  if (!filePath) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('404 not found');
  }

  if (stat.isDirectory()) {
    // 目录请求补斜杠，相对路径才能算对
    if (!url.pathname.endsWith('/')) {
      res.writeHead(302, { location: url.pathname + '/' });
      return res.end();
    }
    filePath = path.join(filePath, 'index.html');
    try {
      stat = await fsp.stat(filePath);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 not found');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const isHtml = ext === '.html';
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': isHtml ? 'no-cache' : 'public, max-age=60' });
    return res.end();
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    etag,
    'cache-control': isHtml ? 'no-cache' : 'public, max-age=60',
    'x-content-type-options': 'nosniff',
  });

  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    })
    .pipe(res);
}

let gamesCache = null;
async function countGames() {
  if (gamesCache != null) return gamesCache;
  try {
    const raw = await fsp.readFile(path.join(ROOT, 'manifest.json'), 'utf8');
    gamesCache = (JSON.parse(raw).games || []).length;
  } catch {
    gamesCache = 0;
  }
  return gamesCache;
}

function onRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end('method not allowed');
  }
  serveStatic(req, res).catch((err) => {
    console.error('[server]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end('internal error');
  });
}

function listen(server, target, label) {
  return new Promise((resolve, reject) => {
    const done = (err) => (err ? reject(err) : resolve(label));
    if (typeof target === 'number') server.listen(target, HOST, () => done());
    else server.listen(target, () => done());
  });
}

async function main() {
  const servers = [];

  if (PORT) {
    const s = http.createServer(onRequest);
    await listen(s, PORT, `端口 ${PORT}`);
    servers.push(s);
    console.log(`[server] http://${HOST}:${PORT}${PREFIX || '/'}  root=${ROOT}`);
  }

  if (SOCKET) {
    try {
      await fsp.unlink(SOCKET);
    } catch {
      /* 上次异常退出可能留下 socket 文件，删掉才能重新绑定 */
    }
    const s = http.createServer(onRequest);
    await listen(s, SOCKET, `网关 socket ${SOCKET}`);
    servers.push(s);
    console.log(`[server] 网关 socket ${SOCKET} prefix=${PREFIX || '(空)'}`);
  }

  // 联机服务：ws 是唯一第三方运行时依赖；未安装时降级为 503，静态游戏照常可用。
  // 一个 WSS(noServer) 服务所有监听点，端口与网关 socket 的 WS 路径都能进。
  let net = null;
  try {
    const { createNetServer } = await import('./net.mjs');
    net = createNetServer({ prefix: PREFIX, webRoot: ROOT });
    for (const s of servers) net.attach(s);
    console.log('[server] 联机服务已挂载（端口 + 网关 socket）');
  } catch (err) {
    console.warn(`[server] 联机服务不可用，静态游戏不受影响：${err.message}`);
    for (const s of servers) {
      s.on('upgrade', (req, socket) => {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
      });
    }
  }

  const shutdown = async () => {
    console.log('[server] 收到退出信号，正在关闭');
    net?.close?.();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    if (SOCKET) {
      try {
        await fsp.unlink(SOCKET);
      } catch {
        /* 已经没了 */
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
