/**
 * 房间管理：创建 / 加入 / 断线重连 / 超时回收。
 *
 * 事实约束：
 * - 房间只存在内存，服务重启即清空（写进安装向导说明）；
 * - 房间码 6 位，去掉 0/O/1/I，避免口述歧义；
 * - 每房最多 2 人（首期全是 1v1），空房 5 分钟回收，断线保留座位 30 秒。
 */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL = 5 * 60 * 1000;
const RECONNECT_GRACE = 30 * 1000;

let seq = 0;

function makeCode() {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  }
  return out;
}

export class RoomManager {
  constructor({ log = () => {} } = {}) {
    this.rooms = new Map();
    this.log = log;
  }

  create(gameId, host, { mode = 'online' } = {}) {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();

    const room = {
      code,
      gameId,
      mode,
      phase: 'waiting',
      players: [],
      game: null,
      seed: 0,
      createdAt: Date.now(),
      lastActive: Date.now(),
      tick: 0,
      tickTimer: null,
      snapshotTimer: null,
      result: null,
      _seq: ++seq,
    };
    this.rooms.set(code, room);
    this.addPlayer(room, host);
    this.log(`[room] 创建 ${code} game=${gameId}`);
    return room;
  }

  addPlayer(room, player) {
    const seat = room.players.length === 0 ? 'p1' : 'p2';
    player.seat = seat;
    player.ready = false;
    player.connected = true;
    player.joinedAt = Date.now();
    room.players.push(player);
    room.lastActive = Date.now();
    return seat;
  }

  findFree(gameId) {
    for (const room of this.rooms.values()) {
      if (room.gameId === gameId && room.phase === 'waiting' && room.players.length < 2) {
        return room;
      }
    }
    return null;
  }

  join(code, player) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.phase !== 'waiting') return { ok: false, error: '对局已经开始' };
    if (room.players.length >= 2) return { ok: false, error: '房间已满' };

    // 断线重连：同一 clientId 恢复原座位
    const existing = room.players.find((p) => p.clientId === player.clientId);
    if (existing) {
      existing.ws = player.ws;
      existing.connected = true;
      existing.disconnectedAt = 0;
      room.lastActive = Date.now();
      this.log(`[room] ${room.code} 玩家 ${existing.seat} 重连`);
      return { ok: true, room, player: existing, reconnected: true };
    }

    const seat = this.addPlayer(room, player);
    this.log(`[room] ${room.code} 玩家加入 ${seat}`);
    return { ok: true, room, player, reconnected: false };
  }

  markDisconnected(player) {
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    const room = this.findByPlayer(player);
    if (room) {
      room.lastActive = Date.now();
      this.log(`[room] ${room.code} 玩家 ${player.seat} 断线，保留座位 ${RECONNECT_GRACE / 1000}s`);
    }
  }

  findByPlayer(player) {
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p === player || p.clientId === player?.clientId)) return room;
    }
    return null;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase()) || null;
  }

  allReady(room) {
    return room.players.length === 2 && room.players.every((p) => p.ready && p.connected);
  }

  close(room, reason = '') {
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.snapshotTimer) clearInterval(room.snapshotTimer);
    room.tickTimer = null;
    room.snapshotTimer = null;
    this.rooms.delete(room.code);
    this.log(`[room] ${room.code} 关闭${reason ? `：${reason}` : ''}`);
  }

  /** 定期清理空房与断线超时的玩家；对局中断线超时则对方判胜 */
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      if (!room.players.some((p) => p.connected) && now - room.lastActive > ROOM_TTL) {
        this.close(room, '空房超时');
        continue;
      }
      for (const p of room.players) {
        if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE) {
          this.log(`[room] ${room.code} 玩家 ${p.seat} 断线超时`);
          room._disconnectTimeout = room._disconnectTimeout || [];
          if (!room._disconnectTimeout.includes(p.seat)) room._disconnectTimeout.push(p.seat);
        }
      }
    }
  }
}

export { ROOM_TTL, RECONNECT_GRACE };
