/**
 * 联机游戏注册表：把 gameId 映射到服务端权威逻辑工厂。
 *
 * 服务端 import 各游戏的 logic.mjs（纯逻辑，无 DOM），与客户端共用同一份规则。
 * 未注册的游戏显示「联机暂不可用」，不影响其它游戏。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** gameId → { module: 相对 games 根的路径, turnBased } */
const REGISTRY = {
  gomoku: { module: 'gomoku/logic.mjs', turnBased: true, label: '五子棋' },
  othello: { module: 'othello/logic.mjs', turnBased: true, label: '黑白棋' },
  draughts: { module: 'draughts/logic.mjs', turnBased: true, label: '国际跳棋' },
  xiangqi: { module: 'xiangqi/logic.mjs', turnBased: true, label: '中国象棋' },
  pong: { module: 'pong/logic.mjs', turnBased: false, label: '乒乓对决' },
  airhockey: { module: 'airhockey/logic.mjs', turnBased: false, label: '空气曲棍球' },
  tank: { module: 'tank/logic.mjs', turnBased: false, label: '坦克战场' },
  snakebattle: { module: 'snakebattle/logic.mjs', turnBased: false, label: '贪吃蛇大作战' },
  stackbattle: { module: 'stackbattle/logic.mjs', turnBased: false, label: '方块对战' },
};

const cache = new Map();

/**
 * 逻辑文件候选位置（按部署形态逐条 try）：
 *   1. WEB_ROOT/games —— 部署后 www 是静态根，游戏产物在它下面的 games/
 *   2. GAMES_ROOT     —— 显式指定（本地联调或其它布局）
 *   3. cwd/games      —— 仓库根直接启动
 * 三者都找不到才判定为「联机逻辑未就绪」，不影响其它游戏。
 */
export async function loadLogic(gameId) {
  if (cache.has(gameId)) return cache.get(gameId);
  const entry = REGISTRY[gameId];
  if (!entry) return null;

  const candidates = [];
  const webRoot = process.env.WEB_ROOT;
  if (webRoot) candidates.push(path.join(webRoot, 'games', entry.module));
  if (process.env.GAMES_ROOT) candidates.push(path.join(process.env.GAMES_ROOT, entry.module));
  candidates.push(path.resolve('games', entry.module));

  let mod = null;
  for (const c of candidates) {
    try {
      mod = await import(pathToFileURL(c).href);
      break;
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' && err?.code !== 'ENOENT') {
        console.warn(`[netgames] 加载 ${c} 失败: ${err.message}`);
      }
    }
  }

  const result = mod ? { ...entry, createGame: mod.createGame } : null;
  cache.set(gameId, result);
  return result;
}

export function isRegistered(gameId) {
  return Boolean(REGISTRY[gameId]);
}

export function registeredGames() {
  return Object.entries(REGISTRY).map(([id, v]) => ({ id, label: v.label, turnBased: v.turnBased }));
}
