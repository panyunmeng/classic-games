/**
 * 豆豆迷宫 · 输入映射。
 * 键盘方向键 / WASD、屏幕虚拟方向键 → submit('dir:xxx')；
 * 滑动 → submit('dir:xxx')；空格 / 回车 → submit('start') 显式开局。
 */
export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      const game = shell.game;
      if (game && !game.state().started && raw.justPressed('action')) {
        shell.submit('start');
      }

      const swipe = raw.consumeSwipe();
      if (swipe) shell.submit(`dir:${swipe}`);

      for (const dir of ['up', 'left', 'down', 'right']) {
        if (raw.justPressed(dir)) shell.submit(`dir:${dir}`);
      }
    },
  };
}
