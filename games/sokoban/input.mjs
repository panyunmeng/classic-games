/**
 * 推箱子 · 输入映射。
 * 方向键 / 滑动 → submit 方向；撤销 / 重做 → 按钮 justPressed；下一关 → 读当前关号拼 level:N。
 * shell 已自动 bindButton(game.json.buttons)，这里只读 justPressed，不重复绑定。
 */
export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      if (raw.justPressed('undo')) shell.submit('undo');
      if (raw.justPressed('redo')) shell.submit('redo');
      if (raw.justPressed('next')) {
        const s = shell.state();
        if (s && s.level < s.levelCount) shell.submit(`level:${s.level + 1}`);
        else shell.toast('已是最后一关', 1000);
      }

      const swipe = raw.consumeSwipe();
      if (swipe) {
        shell.submit(swipe);
        return;
      }
      for (const dir of ['left', 'right', 'up', 'down']) {
        if (raw.justPressed(dir)) shell.submit(dir);
      }
    },
  };
}
