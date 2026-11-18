/**
 * 贪吃蛇 · 输入映射。
 * 键盘方向键 / WASD / 屏幕方向键 → submit；滑动 → submit；T 或「穿墙」按钮 → 切换模式。
 */
export function createInput({ raw, shell }) {
  let wrapBusy = false;

  return {
    actions: [],

    update() {
      // 穿墙开关：按钮与 T 键都映射到 'toggle'
      if (raw.justPressed('toggle') && !wrapBusy) {
        wrapBusy = true;
        const game = shell.game;
        if (game) {
          const next = game.setWrap(!game.isWrap());
          shell.toast(next ? '穿墙模式：开' : '穿墙模式：关', 1100);
        }
      }
      if (!raw.justPressed('toggle')) wrapBusy = false;

      const swipe = raw.consumeSwipe();
      if (swipe) shell.submit(swipe);

      for (const dir of ['left', 'right', 'up', 'down']) {
        if (raw.justPressed(dir)) shell.submit(dir);
      }
    },
  };
}
