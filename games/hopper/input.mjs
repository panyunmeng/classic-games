/**
 * 过河青蛙 · 输入映射。
 *
 * 事实：
 * - 每次跳格是离散动作，所以方向键「边沿」立即 submit('move:dir')；
 * - 按住不放应能连续跳，但重复节奏由逻辑层统一控制（0.20 s 首延迟 → 0.12 s 一跳），
 *   输入层只把「当前按住的方向」放进 actions 交给 game.step；
 * - 手机端滑动一次 = 一格，由 raw.consumeSwipe() 归一成同一套 move:dir。
 */
const DIRS = ['left', 'right', 'up', 'down'];

export function createInput({ raw, shell }) {
  const actions = [];

  return {
    actions,

    update() {
      actions.length = 0;

      // 持续按住 → 逻辑层连发
      for (const d of DIRS) {
        if (raw.isDown(d)) actions.push(d);
      }

      // 边沿：键盘按下 / 屏幕方向键按下 → 立刻跳一格
      for (const d of DIRS) {
        if (raw.justPressed(d)) shell.submit(`move:${d}`);
      }

      // 滑动手势：一次一格
      const swipe = raw.consumeSwipe();
      if (swipe) shell.submit(`move:${swipe}`);
    },

    dispose() {
      actions.length = 0;
    },
  };
}
