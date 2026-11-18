/**
 * 麻将消除 · 分层牌堆几何（纯几何：无 DOM / 无随机 / 无时间）。
 *
 * 事实与推导：
 * - 画布固定 480×640，逻辑层与渲染层共用同一套坐标，避免命中与画面漂移。
 * - 层数固定 4 层，自下而上每层列数、行数各少 1，且每层居中：
 *   由于宽度每层少一整张（左右各半张），上层自然落在下层「四张牌的交点」上，
 *   于是每张上层牌压住下层 4 张牌各一角——这就是「梯形堆叠、每侧露半张」的几何来源。
 * - 遮挡判定只看几何：A 层比 B 层高且两块矩形有正面积重叠，就算 A 压住 B。
 *   与真实麻将堆叠一致（上面有牌压着就抽不出来），且与层数无关（隔层压住也算）。
 * - 命中检测取「包含该点的最高层牌」，因为画面上就是它盖在最上面。
 */

export const CANVAS = { w: 480, h: 640 };

/** 单张牌边长（px）；7 列 × 60 = 420，左右各留 30 */
export const TILE = 60;

/** 最底层（第 0 层）左上角 y，给顶部标题/计时留出空间 */
export const STACK_TOP = 196;

/** 自下而上的层规格：28 + 18 + 10 + 4 = 60 张（偶数，30 对） */
export const LAYERS = [
  { cols: 7, rows: 4 },
  { cols: 6, rows: 3 },
  { cols: 5, rows: 2 },
  { cols: 4, rows: 1 },
];

/** 第 layer 层网格左上角（每层水平居中、相对最底层垂直居中） */
export function layerOrigin(layer, layers = LAYERS) {
  const spec = layers[layer];
  const base = layers[0];
  return {
    x: (CANVAS.w - spec.cols * TILE) / 2,
    y: STACK_TOP + ((base.rows - spec.rows) * TILE) / 2,
  };
}

/** 单张牌的屏幕矩形 */
export function tileRect(layer, col, row, layers = LAYERS) {
  const o = layerOrigin(layer, layers);
  return { x: o.x + col * TILE, y: o.y + row * TILE, w: TILE, h: TILE };
}

/** 铺出整副牌：id 按「层→行→列」递增，保证同种子同 id 同位置 */
export function layoutTiles(layers = LAYERS) {
  const out = [];
  for (let layer = 0; layer < layers.length; layer++) {
    const { cols, rows } = layers[layer];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const r = tileRect(layer, col, row, layers);
        out.push({ id: out.length, layer, col, row, x: r.x, y: r.y, w: r.w, h: r.h });
      }
    }
  }
  return out;
}

/** 两矩形是否有正面积重叠（贴边不算） */
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 预计算每张牌「被谁压住」：只记录层数更高且矩形重叠的牌 id。
 * 结果与牌状态无关，一局只算一次；判断可点只需看这些牌是否已被移除。
 */
export function buildBlockers(tiles) {
  const blockers = tiles.map(() => []);
  for (const upper of tiles) {
    for (const lower of tiles) {
      if (upper.layer <= lower.layer) continue;
      if (overlaps(upper, lower)) blockers[lower.id].push(upper.id);
    }
  }
  return blockers;
}

/** 该牌当前是否可点（其上没有任何未移除的压牌） */
export function isFree(id, removed, blockers) {
  const list = blockers[id];
  for (let i = 0; i < list.length; i++) {
    if (!removed[list[i]]) return false;
  }
  return true;
}

/** 命中检测：返回包含该点的最高层「未移除」牌 id，落空返回 -1 */
export function hitTest(tiles, x, y) {
  let best = -1;
  let bestLayer = -1;
  for (const t of tiles) {
    if (t.removed) continue;
    if (x < t.x || x >= t.x + t.w || y < t.y || y >= t.y + t.h) continue;
    if (t.layer > bestLayer) {
      best = t.id;
      bestLayer = t.layer;
    }
  }
  return best;
}
