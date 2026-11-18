/**
 * 协议：消息校验、令牌桶限流、广播辅助。
 *
 * 安全边界（计划书 §7.4）：
 * - 单帧 ≤ 4 KB；单连接 ≤ 120 消息/秒；
 * - 房间码尝试 ≤ 10 次/分钟/IP；
 * - 客户端只发「意图」，胜负/命中一律服务端 logic 判定。
 */

export const MAX_FRAME = 4 * 1024;
const RATE_CAP = 120;
const RATE_WINDOW = 1000;
const CODE_ATTEMPT_CAP = 10;
const CODE_WINDOW = 60 * 1000;

export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.codeAttempts = new Map();
  }

  allow(key, cap = RATE_CAP, window = RATE_WINDOW) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || now - b.start >= window) {
      b = { start: now, count: 0 };
      this.buckets.set(key, b);
    }
    b.count++;
    if (this.buckets.size > 2000) {
      for (const [k, v] of this.buckets) {
        if (now - v.start >= window) this.buckets.delete(k);
      }
    }
    return b.count <= cap;
  }

  allowCodeAttempt(ip) {
    const now = Date.now();
    let e = this.codeAttempts.get(ip);
    if (!e || now - e.start >= CODE_WINDOW) {
      e = { start: now, count: 0 };
      this.codeAttempts.set(ip, e);
    }
    e.count++;
    return e.count <= CODE_ATTEMPT_CAP;
  }

  reset(key) {
    this.buckets.delete(key);
  }
}

const ALLOWED_TYPES = new Set([
  'hello',
  'join',
  'quick',
  'input',
  'move',
  'ready',
  'leave',
  'ping',
  'restart',
]);

/** 校验客户端消息；返回 {ok, msg} 或 {ok:false, error} */
export function parseClientMessage(raw, { maxFrame = MAX_FRAME } = {}) {
  if (typeof raw !== 'string') return { ok: false, error: '消息必须是文本帧' };
  if (Buffer.byteLength(raw, 'utf8') > maxFrame) return { ok: false, error: '帧过大' };

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'JSON 解析失败' };
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, error: '消息必须是对象' };
  }
  if (!ALLOWED_TYPES.has(msg.type)) return { ok: false, error: '未知消息类型' };
  return { ok: true, msg };
}

/** 校验落子/输入意图，防止客户端伪造结果字段 */
export function sanitizeAction(type, action, { turnBased = false } = {}) {
  if (typeof action !== 'string' || action.length > 64) return null;

  if (turnBased) {
    // 只接受 'place:x,y' / 'n:5' / 'col:3' 这类短指令，禁止带 board/score/winner
    if (/^(place|move|drop|col|n|put):[0-9,.\-]{1,16}$/.test(action)) return action;
    return null;
  }

  // 实时制：只接受方向/动作 token
  if (/^(left|right|up|down|action|action2|rotate|shoot|hold|drop|none)$/.test(action)) return action;
  return null;
}

export function send(ws, obj) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

export function broadcast(room, obj, { include = null } = {}) {
  for (const p of room.players) {
    if (!p.connected) continue;
    if (include && !include.includes(p.seat)) continue;
    send(p.ws, obj);
  }
}
