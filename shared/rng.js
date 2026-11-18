/**
 * 可播种随机数（mulberry32）。
 *
 * 游戏逻辑层禁止直接用 Math.random：联机需要两端同种子出同结果，
 * 单机也需要回放/每日挑战可复现。所有随机都由这里注入。
 */

export function createRng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;

  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed: () => s,
    next,
    /** 0 ≤ x < n 的整数 */
    int(n) {
      return Math.floor(next() * n);
    },
    /** [a, b) 浮点 */
    range(a, b) {
      return a + next() * (b - a);
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance(p) {
      return next() < p;
    },
  };
}
