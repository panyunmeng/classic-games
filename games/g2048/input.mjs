/**
 * 2048 · 输入。
 * 滑动 / 方向键 / 屏幕方向键 → move；U 或「撤销」按钮 → undo。
 */
export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      if (raw.justPressed('undo')) {
        shell.submit('undo');
        return;
      }

      const swipe = raw.consumeSwipe();
      if (swipe) {
        shell.submit(swipe);
        return;
      }

      for (const dir of ['left', 'right', 'up', 'down']) {
        if (raw.justPressed(dir)) {
          shell.submit(dir);
          return;
        }
      }
    },
  };
}
