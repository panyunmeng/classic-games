/**
 * 联机客户端（浏览器侧）：房间码 / 快速加入 / 准备 / 落子 / 断线重连。
 *
 * 与服务端协议一一对应（platform/server/net.mjs）：
 *   hello → join|quick → ready → move|input → restart|leave
 *   welcome / room / start / event / snapshot / over / error / pong
 *
 * 身份 clientId 存 localStorage，断线重连靠它恢复座位。
 */
import { store } from './storage.js';

const RECONNECT_DELAY = 800;

function wsUrl(gameId) {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';

  // 子路径部署：网关前缀从当前路径里取（形如 /app/classic-games/）
  let base = loc.pathname;
  if (!base.endsWith('/')) base += '/';
  // 当前在 /games/<id>/ 下，回到根
  const gameRoot = base.replace(/games\/[^/]*\/?$/, '');
  const prefix = gameRoot.endsWith('/') ? gameRoot.slice(0, -1) : gameRoot;
  return `${proto}//${loc.host}${prefix}/games/${gameId}/ws`;
}

export function createNetClient({ meta, shell, onStart, onEnd }) {
  const gameId = meta.id;
  let ws = null;
  let connected = false;
  let closedByUs = false;
  let reconnectTimer = 0;
  let pingTimer = 0;
  let seat = null;
  let roomCode = '';
  let phase = 'idle';
  let lastState = null;
  let clientId = store.getGlobal('clientId', '');

  if (!clientId) {
    clientId = `c_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    store.setGlobal('clientId', clientId);
  }

  const listeners = new Set();

  function emit(type, payload) {
    for (const fn of listeners) fn(type, payload);
  }

  function send(msg) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  function connect() {
    if (closedByUs) return;
    try {
      ws = new WebSocket(wsUrl(gameId));
    } catch (err) {
      shell.toast(`连接失败：${err.message}`);
      return;
    }

    ws.addEventListener('open', () => {
      connected = true;
      send({ type: 'hello', name: store.getGlobal('nickname', '玩家'), clientId });
      clearTimeout(reconnectTimer);
      emit('connected');
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleMessage(msg);
    });

    ws.addEventListener('close', () => {
      connected = false;
      clearInterval(pingTimer);
      if (!closedByUs) {
        emit('disconnected');
        shell.toast('连接断开，正在重连…', 2000);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
      }
    });

    ws.addEventListener('error', () => {
      /* close 事件负责重连 */
    });
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        break;

      case 'hello_ok':
        if (roomCode) send({ type: 'join', code: roomCode });
        break;

      case 'room':
        roomCode = msg.code;
        seat = msg.seat || seat;
        phase = msg.phase;
        if (msg.state) lastState = msg.state;
        emit('room', msg);
        break;

      case 'start':
        phase = 'playing';
        lastState = msg.state;
        shell.clearRemoteState();
        onStart?.({ seed: msg.seed, seat, state: msg.state });
        emit('start', msg);
        break;

      case 'event':
        emit('event', msg);
        break;

      case 'snapshot':
        lastState = msg.state;
        // 服务端已应用对手着法；本地通过 shell 同步显示
        shell.setRemoteState?.(msg.state);
        emit('snapshot', msg);
        break;

      case 'over':
        phase = 'over';
        onEnd?.({
          winner: msg.winner,
          score: msg.score,
          text: msg.text,
          title: msg.winner === seat ? '胜利' : msg.winner === 'draw' ? '平局' : '惜败',
        });
        emit('over', msg);
        break;

      case 'error':
        shell.toast(msg.msg || '联机错误', 2200);
        emit('error', msg);
        break;

      case 'pong':
        emit('ping', Date.now() - msg.ts);
        break;
    }
  }

  const api = {
    get connected() {
      return connected;
    },
    get seat() {
      return seat;
    },
    get code() {
      return roomCode;
    },
    get phase() {
      return phase;
    },
    get state() {
      return lastState;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    connect,

    create() {
      roomCode = '';
      if (!connected) connect();
      else send({ type: 'quick', gameId, mode: 'online' });
    },

    join(code) {
      roomCode = String(code || '').trim().toUpperCase().slice(0, 6);
      if (roomCode.length !== 6) {
        shell.toast('请输入 6 位房间码');
        return;
      }
      if (!connected) connect();
      else send({ type: 'join', code: roomCode });
    },

    quick() {
      roomCode = '';
      if (!connected) connect();
      else send({ type: 'quick', gameId, mode: 'online' });
    },

    ready(ready = true) {
      send({ type: 'ready', ready });
    },

    /** 回合制：发落子意图 */
    move(action) {
      send({ type: 'move', action });
    },

    /** 实时制：发方向/动作意图 */
    input(action, seq) {
      send({ type: 'input', action, seq });
    },

    restart() {
      send({ type: 'restart' });
    },

    leave() {
      send({ type: 'leave' });
    },

    lobby() {
      const wrap = document.createElement('div');
      wrap.className = 'cg-net';
      wrap.innerHTML = `
        <div class="cg-net-status" data-role="status">正在连接…</div>
        <div class="cg-net-actions">
          <button class="cg-mode primary" data-act="quick">快速匹配</button>
          <button class="cg-mode" data-act="create">创建房间</button>
        </div>
        <div class="cg-net-code">
          <input class="cg-net-input" maxlength="6" placeholder="输入 6 位房间码" aria-label="房间码">
          <button class="cg-btn" data-act="join">加入</button>
        </div>
        <div class="cg-net-info" data-role="info"></div>
      `;

      const statusEl = wrap.querySelector('[data-role=status]');
      const infoEl = wrap.querySelector('[data-role=info]');
      const inputEl = wrap.querySelector('.cg-net-input');

      const refresh = () => {
        statusEl.textContent = connected ? '已连接联机服务' : '连接中…';
      };
      refresh();
      const off = api.on((type, payload) => {
        if (type === 'connected') refresh();
        if (type === 'disconnected') refresh();
        if (type === 'room') {
          infoEl.textContent = payload.code
            ? `房间码：${payload.code} · 座位：${payload.seat || '等待'} · 玩家 ${payload.players.length}/2`
            : '';
        }
      });

      wrap.querySelector('[data-act=quick]').addEventListener('click', () => api.quick());
      wrap.querySelector('[data-act=create]').addEventListener('click', () => api.create());
      wrap.querySelector('[data-act=join]').addEventListener('click', () => api.join(inputEl.value));
      inputEl.addEventListener('input', () => {
        inputEl.value = inputEl.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
      });

      wrap._dispose = off;
      return wrap;
    },

    close() {
      closedByUs = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
    },
  };

  connect();
  pingTimer = setInterval(() => {
    if (connected) send({ type: 'ping', ts: Date.now() });
  }, 5000);

  return api;
}
