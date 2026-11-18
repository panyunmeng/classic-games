/**
 * 记忆翻牌 · 棋盘布局（纯几何，无 DOM / 无随机 / 无时间）。
 *
 * 三档难度：4×3=12 张（6 对）、4×4=16 张（8 对）、6×4=24 张（12 对）。
 * 画布 480×640；每档把棋盘居中，卡片按可用区域自动算格子宽高，保证不越界且留边距。
 * input / render / logic 共用这一份定义，避免坐标漂移。
 */

export const LEVELS = {
  1: { cols: 4, rows: 3, label: '4×3 · 6 对' },
  2: { cols: 4, rows: 4, label: '4×4 · 8 对' },
  3: { cols: 6, rows: 4, label: '6×4 · 12 对' },
};

export function levelConfig(level = 1) {
  return LEVELS[level] || LEVELS[1];
}

/**
 * 返回白板区域里的卡片网格。
 * @param {number} level 难度档 1/2/3
 * @param {number} w 画布逻辑宽
 * @param {number} h 画布逻辑高
 */
export function boardLayout(level = 1, w = 480, h = 640) {
  const { cols, rows } = levelConfig(level);
  const padX = 26;
  const top = 148;
  const bottom = 52;
  const gap = 10;
  const availW = w - padX * 2;
  const availH = h - top - bottom;
  const cellW = (availW - gap * (cols - 1)) / cols;
  const cellH = (availH - gap * (rows - 1)) / rows;
  return {
    cols,
    rows,
    gap,
    x0: padX,
    y0: top,
    cellW,
    cellH,
    count: cols * rows,
    /** 逻辑坐标 (x,y) → 卡片索引，落在间隙/边界外返回 -1 */
    indexAt(x, y) {
      if (x < this.x0 || y < this.y0) return -1;
      const col = Math.floor((x - this.x0) / (this.cellW + gap));
      const row = Math.floor((y - this.y0) / (this.cellH + gap));
      if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
      const inX = x - this.x0 - col * (this.cellW + gap);
      const inY = y - this.y0 - row * (this.cellH + gap);
      if (inX > this.cellW || inY > this.cellH) return -1;
      return row * cols + col;
    },
  };
}
