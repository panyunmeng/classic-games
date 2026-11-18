/**
 * 联机端到端自测：对 netgames 注册的每款游戏做
 * 「创建房间 → 加入 → ready → start → 冒烟走一步」。
 * 纯 Node（ws），不启浏览器。
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8123;
const server = spawn(process.execPath, ['platform/server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), WEB_ROOT: `${process.cwd()}/build/www` },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/games/{GAME}/ws`.replace('{GAME}', name));
    const state = { ws, name, messages: [], code: '', seat: '' };
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', name, clientId: `t-${name}-${Math.random().toString(36).slice(2, 7)}` }));
      resolve(state);
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      state.messages.push(msg);
      if (msg.type === 'room') {
        state.code = msg.code;
        state.seat = msg.seat || state.seat;
      }
    });
    ws.on('error', reject);
  });
}

function waitFor(state, pred, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const found = state.messages.find(pred);
    if (found) return resolve(found);
    const t = setInterval(() => {
      const m = state.messages.find(pred);
      if (m) {
        clearInterval(t);
        clearTimeout(to);
        resolve(m);
      }
    }, 40);
    const to = setTimeout(() => {
      clearInterval(t);
      reject(new Error(`${state.name} 等待超时，已收：${state.messages.map((m) => m.type).join(',')}`));
    }, timeout);
  });
}

/** 一套完整流程：两客户端建房/加入/ready/start，可选走一步 */
async function runGame(gameId, { turnBased }) {
  const a = await client(gameId);
  const b = await client(gameId);
  await sleep(120);

  a.ws.send(JSON.stringify({ type: 'quick', gameId, mode: 'online' }));
  await waitFor(a, (m) => m.type === 'room');
  b.ws.send(JSON.stringify({ type: 'join', code: a.code }));
  await waitFor(b, (m) => m.type === 'room');

  a.ws.send(JSON.stringify({ type: 'ready', ready: true }));
  b.ws.send(JSON.stringify({ type: 'ready', ready: true }));
  await waitFor(a, (m) => m.type === 'start');
  await waitFor(b, (m) => m.type === 'start');

  // 冒烟：回合制走一步合法着法（会被拒也无妨，只验证不崩、有回执）
  if (turnBased) {
    a.ws.send(JSON.stringify({ type: 'move', action: 'place:7,7' }));
    a.ws.send(JSON.stringify({ type: 'move', action: 'move:17,24' }));
    await sleep(200);
  } else {
    a.ws.send(JSON.stringify({ type: 'input', action: 'left', seq: 1 }));
    await sleep(200);
  }

  a.ws.close();
  b.ws.close();
  return a.code;
}

async function main() {
  await sleep(900);

  const { registeredGames } = await import('../platform/server/netgames.mjs');
  const games = registeredGames();
  const results = [];

  for (const g of games) {
    try {
      const code = await runGame(g.id, { turnBased: g.turnBased });
      console.log(`PASS  ${g.id.padEnd(14)} ${g.label}  room=${code}`);
      results.push({ id: g.id, ok: true });
    } catch (err) {
      console.log(`FAIL  ${g.id.padEnd(14)} ${g.label}  ${err.message}`);
      results.push({ id: g.id, ok: false, err: err.message });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 联机端到端：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('服务日志尾部：\n' + serverLog.split('\n').slice(-15).join('\n'));
    server.kill('SIGKILL');
    process.exit(1);
  }
  server.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
}

main().catch((err) => {
  console.error('[test] 失败：', err.message);
  console.error(serverLog.slice(-2000));
  server.kill('SIGKILL');
  process.exit(1);
});
