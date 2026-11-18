/**
 * 联机服务：WebSocket 权威对局（回合制已落地，实时制预留 tick 框架）。
 *
 * 第一性原则：
 * - 客户端只发意图（落子坐标/方向），胜负与命中一律服务端跑 logic.mjs 判定；
 * - 一个 WSS 服务两个 http.Server（端口 + 网关 socket）→ noServer + 手写 upgrade；
 * - 网关请求带 /app/<appname> 前缀，WS 路径也要剥前缀才匹配。
 *
 * 依赖：ws。理由：Node 24 内置 WebSocket 只有客户端，手写 RFC6455 握手/掩码/
 * 分片/ping 是几百行且易错；3D 合集已在 NAS 实测 ws 可用。
 */
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.mjs';
import {
  parseClientMessage,
  sanitizeAction,
  send,
  broadcast,
  RateLimiter,
} from './protocol.mjs';
import { loadLogic, isRegistered } from './netgames.mjs';

const TICK_MS = 1000 / 30;
const SNAPSHOT_MS = 1000 / 15;

export function createNetServer({ prefix = '', webRoot = '', log = console.log } = {}) {
  const rooms = new RoomManager({ log });
  const limiter = new RateLimiter();
  const normalizePrefix = (p) => (p || '').replace(/\/$/, '');
  const PFX = normalizePrefix(prefix);

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

  function pathInner(url) {
    let p = (url || '/').split('?')[0];
    if (PFX && (p === PFX || p.startsWith(PFX + '/'))) p = p.slice(PFX.length) || '/';
    return p;
  }

  function isGamePath(inner) {
    return /^\/games\/[^/]+\/ws$/.test(inner);
  }

  function gameIdFromPath(inner) {
    const m = /^\/games\/([^/]+)\/ws$/.exec(inner);
    return m ? m[1] : null;
  }

  function snapshot(room) {
    if (!room.game) return;
    broadcast(room, {
      type: 'snapshot',
      tick: room.tick,
      state: room.game.state(),
    });
  }

  function finish(room, result) {
    room.phase = 'over';
    room.result = result;
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.snapshotTimer) clearInterval(room.snapshotTimer);
    room.tickTimer = null;
    room.snapshotTimer = null;
    broadcast(room, {
      type: 'over',
      winner: result.winner,
      scores: result.scores || null,
      score: result.score,
      text: result.text || '',
    });
    log(`[room] ${room.code} 结束 winner=${result.winner}`);
  }

  function checkDisconnectTimeout() {
    for (const room of [...rooms.rooms.values()]) {
      if (!room._disconnectTimeout?.length) continue;
      if (room.phase === 'playing') {
        const winner = room._disconnectTimeout[0] === 'p1' ? 'p2' : 'p1';
        finish(room, { winner, text: '对手断线超时' });
      }
      rooms.close(room, '断线超时');
    }
  }

  const sweepTimer = setInterval(() => {
    rooms.sweep();
    checkDisconnectTimeout();
  }, 5000);
  sweepTimer.unref?.();

  wss.on('connection', (ws, req) => {
    const inner = pathInner(req.url);
    const gameId = gameIdFromPath(inner);
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket.remoteAddress || 'unknown';

    const player = {
      ws,
      clientId: '',
      name: '',
      seat: null,
      ready: false,
      connected: true,
      disconnectedAt: 0,
      ip,
      gameId,
      room: null,
    };

    send(ws, { type: 'welcome', ok: true, gameId, serverTick: 0 });

    ws.on('message', async (data) => {
      if (!limiter.allow(`${ip}:${player.clientId || 'anon'}`)) {
        send(ws, { type: 'error', code: 'RATE_LIMIT', msg: '消息过快' });
        return;
      }

      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        send(ws, { type: 'error', code: 'BAD_MESSAGE', msg: parsed.error });
        return;
      }
      const msg = parsed.msg;

      try {
        switch (msg.type) {
          case 'hello': {
            player.name = String(msg.name || '玩家').slice(0, 12);
            player.clientId = String(msg.clientId || '').slice(0, 64);
            if (!player.clientId) {
              send(ws, { type: 'error', code: 'NO_CLIENT_ID', msg: '缺少 clientId' });
              return;
            }
            send(ws, { type: 'hello_ok', name: player.name, clientId: player.clientId });
            break;
          }

          case 'quick': {
            if (player.gameId !== msg.gameId) {
              send(ws, { type: 'error', code: 'GAME_MISMATCH', msg: '游戏不匹配' });
              return;
            }
            let room = rooms.findFree(player.gameId);
            if (!room) room = rooms.create(player.gameId, player, { mode: msg.mode || 'online' });
            else {
              const r = rooms.join(room.code, player);
              if (!r.ok) {
                send(ws, { type: 'error', code: 'JOIN_FAILED', msg: r.error });
                return;
              }
            }
            player.room = room;
            sendRoom(ws, room, player);
            if (rooms.allReady(room)) startRoom(room);
            break;
          }

          case 'join': {
            if (!limiter.allowCodeAttempt(ip)) {
              send(ws, { type: 'error', code: 'TOO_MANY_ATTEMPTS', msg: '尝试房间码过于频繁' });
              return;
            }
            const r = rooms.join(msg.code, player);
            if (!r.ok) {
              send(ws, { type: 'error', code: 'JOIN_FAILED', msg: r.error });
              return;
            }
            player.room = r.room;
            if (player.gameId !== r.room.gameId) {
              send(ws, { type: 'error', code: 'GAME_MISMATCH', msg: '房间游戏不匹配' });
              return;
            }
            if (roomFullWithSameClient(r.room, player)) {
              send(ws, { type: 'error', code: 'DUPLICATE', msg: '不能在两个座位同时出现' });
              return;
            }
            sendRoom(ws, r.room, r.player, r.reconnected);
            if (rooms.allReady(r.room)) startRoom(r.room);
            break;
          }

          case 'ready': {
            const room = player.room;
            if (!room || !room.players.includes(player)) {
              send(ws, { type: 'error', code: 'NOT_IN_ROOM', msg: '不在房间中' });
              return;
            }
            player.ready = Boolean(msg.ready);
            broadcast(room, {
              type: 'room',
              code: room.code,
              phase: room.phase,
              players: publicPlayers(room),
            });
            if (rooms.allReady(room)) startRoom(room);
            break;
          }

          case 'move': {
            await handleMove(player, msg);
            break;
          }

          case 'input': {
            await handleInput(player, msg);
            break;
          }

          case 'restart': {
            const room = player.room;
            if (!room || room.phase !== 'over') return;
            // 服务端重置同一局：用新 seed 重开，双方仍需 ready
            room.phase = 'waiting';
            room.result = null;
            room.game = null;
            for (const p of room.players) p.ready = false;
            broadcast(room, {
              type: 'room',
              code: room.code,
              phase: room.phase,
              players: publicPlayers(room),
              restart: true,
            });
            break;
          }

          case 'leave': {
            const room = player.room;
            if (room) leaveRoom(room, player);
            break;
          }

          case 'ping': {
            send(ws, { type: 'pong', ts: msg.ts, server: Date.now() });
            break;
          }
        }
      } catch (err) {
        log(`[net] 处理 ${msg.type} 失败: ${err.stack || err}`);
        send(ws, { type: 'error', code: 'INTERNAL', msg: '服务内部错误' });
      }
    });

    ws.on('close', () => {
      player.connected = false;
      rooms.markDisconnected(player);
      if (player.room) {
        broadcast(player.room, {
          type: 'room',
          code: player.room.code,
          phase: player.room.phase,
          players: publicPlayers(player.room),
          disconnect: player.seat,
        });
      }
      limiter.reset(`${ip}:${player.clientId || 'anon'}`);
    });

    ws.on('error', () => {
      /* close 事件会兜底清理 */
    });
  });

  function publicPlayers(room) {
    return room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      ready: p.ready,
      connected: p.connected,
    }));
  }

  function sendRoom(ws, room, player, reconnected = false) {
    send(ws, {
      type: 'room',
      code: room.code,
      gameId: room.gameId,
      phase: room.phase,
      seat: player.seat,
      players: publicPlayers(room),
      reconnected,
      state: room.game ? room.game.state() : null,
    });
  }

  function roomFullWithSameClient(room, player) {
    return room.players.filter((p) => p.clientId === player.clientId && p.connected).length > 1;
  }

  async function startRoom(room) {
    if (room.phase !== 'waiting') return;
    const logic = await loadLogic(room.gameId);
    if (!logic) {
      broadcast(room, { type: 'error', code: 'NO_LOGIC', msg: '该游戏联机逻辑未就绪' });
      log(`[room] ${room.code} 无联机逻辑 game=${room.gameId}`);
      return;
    }
    room.seed = (Math.random() * 0xffffffff) >>> 0;
    room.game = logic.createGame({
      seed: room.seed,
      mode: 'online',
      players: ['p1', 'p2'],
    });
    room.phase = 'playing';
    room.tick = 0;
    room.lastInputSeq = { p1: 0, p2: 0 };

    broadcast(room, {
      type: 'start',
      seed: room.seed,
      tick: room.tick,
      state: room.game.state(),
    });
    log(`[room] ${room.code} 开始 game=${room.gameId} seed=${room.seed}`);

    if (!logic.turnBased) {
      room.tickTimer = setInterval(() => {
        if (room.phase !== 'playing') return;
        try {
          room.game.step(TICK_MS / 1000, room.pendingInputs || []);
          room.pendingInputs = [];
          room.tick++;
          const res = room.game.result?.();
          if (res) finish(room, res);
        } catch (err) {
          log(`[room] ${room.code} tick 异常: ${err.message}`);
          finish(room, { winner: 'p2', text: '服务异常' });
        }
      }, TICK_MS);
      room.snapshotTimer = setInterval(() => {
        if (room.phase === 'playing') snapshot(room);
      }, SNAPSHOT_MS);
      room.tickTimer.unref?.();
      room.snapshotTimer.unref?.();
    }
  }

  async function handleMove(player, msg) {
    const room = player.room;
    if (!room || room.phase !== 'playing' || !room.game) return;
    const logic = await loadLogic(room.gameId);
    if (!logic?.turnBased) {
      send(player.ws, { type: 'error', code: 'WRONG_MODE', msg: '该游戏不使用落子消息' });
      return;
    }
    const state = room.game.state();
    if (state.turn && state.turn !== player.seat) {
      send(player.ws, { type: 'error', code: 'NOT_YOUR_TURN', msg: '还没轮到你' });
      return;
    }
    const action = sanitizeAction('move', msg.action, { turnBased: true });
    if (!action) {
      send(player.ws, { type: 'error', code: 'BAD_ACTION', msg: '非法着法' });
      return;
    }
    const res = room.game.submit(player.seat, action);
    if (res && res.ok === false) {
      send(player.ws, { type: 'error', code: 'ILLEGAL', msg: res.error || '非法着法' });
      return;
    }
    broadcast(room, { type: 'event', action, by: player.seat, tick: room.tick });
    broadcast(room, { type: 'snapshot', tick: room.tick, state: room.game.state() });

    const result = room.game.result?.();
    if (result) finish(room, result);
  }

  async function handleInput(player, msg) {
    const room = player.room;
    if (!room || room.phase !== 'playing' || !room.game) return;
    const logic = await loadLogic(room.gameId);
    if (logic?.turnBased) {
      send(player.ws, { type: 'error', code: 'WRONG_MODE', msg: '该游戏使用落子消息' });
      return;
    }
    const seq = Number(msg.seq) || 0;
    if (seq <= (room.lastInputSeq?.[player.seat] || 0)) return;
    room.lastInputSeq[player.seat] = seq;
    const action = sanitizeAction('input', msg.action);
    if (!action) return;
    room.pendingInputs = room.pendingInputs || [];
    room.pendingInputs.push({ seat: player.seat, action });
  }

  function leaveRoom(room, player) {
    room.players = room.players.filter((p) => p !== player);
    player.room = null;
    if (room.phase === 'playing' && room.players.length < 2) {
      const winner = room.players[0]?.seat || 'p1';
      finish(room, { winner, text: '对手离开' });
    }
    if (room.players.length === 0) rooms.close(room, '所有人离开');
    else {
      broadcast(room, {
        type: 'room',
        code: room.code,
        phase: room.phase,
        players: publicPlayers(room),
      });
    }
  }

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      const inner = pathInner(req.url);
      if (!isGamePath(inner)) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const gameId = gameIdFromPath(inner);
      if (!isRegistered(gameId)) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  }

  function close() {
    clearInterval(sweepTimer);
    for (const room of [...rooms.rooms.values()]) rooms.close(room, '服务关闭');
    wss.close();
  }

  return { attach, close, rooms, wss, isReady: true };
}
