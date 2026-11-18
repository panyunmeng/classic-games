/**
 * 敲地鼠 · 输入映射。
 * 点击九宫格 → shell.submit('hit:i')，i = row*3+col。
 * 格子中心与 render.mjs 同源：CX=[120,240,360]，CY=[230,350,470]。
 */
const CX = [120, 240, 360];
const CY = [230, 350, 470];

export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      const tap = raw.consumeTap?.();
      if (!tap) return;
      if (tap.x < 60 || tap.x > 420 || tap.y < 170 || tap.y > 530) return;

      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < 9; i++) {
        const dx = tap.x - CX[i % 3];
        const dy = tap.y - CY[Math.floor(i / 3)];
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      shell.submit(`hit:${best}`);
    },

    dispose() {},
  };
}
