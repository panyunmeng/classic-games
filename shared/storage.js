/**
 * 本地存储：所有游戏共用一套命名空间，避免 36 款互相覆盖。
 *
 * 键格式：cg:<gameId>:<key>；全局键：cg:g:<key>。
 * 值统一包成 { v, data }，将来换结构时可读到 v 做迁移；读失败一律回默认值，
 * 不让一条坏数据把整局游戏卡死（隐私模式/配额满都会抛异常）。
 */

const NS = 'cg';
const VERSION = 1;

function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function read(key, fallback) {
  const raw = safeGet(key);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 'data' in parsed) {
      return parsed.data;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function write(key, data) {
  return safeSet(key, JSON.stringify({ v: VERSION, data }));
}

export const store = {
  get(gameId, key, fallback) {
    return read(`${NS}:${gameId}:${key}`, fallback);
  },

  set(gameId, key, data) {
    return write(`${NS}:${gameId}:${key}`, data);
  },

  remove(gameId, key) {
    try {
      window.localStorage.removeItem(`${NS}:${gameId}:${key}`);
    } catch {
      /* 忽略：存储不可用时删除同样无效 */
    }
  },

  getGlobal(key, fallback) {
    return read(`${NS}:g:${key}`, fallback);
  },

  setGlobal(key, data) {
    return write(`${NS}:g:${key}`, data);
  },

  /** 最近游玩列表，门户用。最多保留 8 个 id。 */
  recent() {
    const list = this.getGlobal('recent', []);
    return Array.isArray(list) ? list : [];
  },

  touchRecent(gameId) {
    const list = this.recent().filter((id) => id !== gameId);
    list.unshift(gameId);
    this.setGlobal('recent', list.slice(0, 8));
  },

  best(gameId) {
    const v = this.get(gameId, 'best', 0);
    return Number.isFinite(v) ? v : 0;
  },

  setBest(gameId, score) {
    const cur = this.best(gameId);
    if (score > cur) {
      this.set(gameId, 'best', score);
      return true;
    }
    return false;
  },
};
