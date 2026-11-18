/**
 * 管道连接 · 输入映射。
 * 点击网格 → 顺时针旋转该格；底部按钮「重置/提示」由 shell 自动绑定为 reset/hint；
 * 键盘 5/6/7 切换难度（game.setSize），R 重开由 shell 处理。
 */
export function createInput({ raw, shell }) {
  const board = { ox: 0, oy: 108, pad: 26 };

  function layout() {
    const s = shell.state();
    const n = s ? s.n : 6;
    const w = shell.logical ? shell.logical.w : 480;
    const cell = Math.floor(Math.min((w - board.pad * 2) / n, 300 / n));
    const boardW = cell * n;
    return { n, cell, ox: Math.floor((w - boardW) / 2), oy: board.oy };
  }

  return {
    actions: [],

    update() {
      const tap = raw.consumeTap();
      if (tap) {
        const L = layout();
        const gx = Math.floor((tap.x - L.ox) / L.cell);
        const gy = Math.floor((tap.y - L.oy) / L.cell);
        if (gx >= 0 && gy >= 0 && gx < L.n && gy < L.n) {
          shell.submit(`rot:${gx},${gy}`);
        }
      }

      // 重置 / 提示：按钮已由 shell 绑定为 justPressed 动作，这里转 submit。
      if (raw.justPressed('reset')) shell.submit('reset');
      if (raw.justPressed('hint')) shell.submit('hint');

      // 难度切换：数字键 5/6/7（KEYMAP 的 n5/n6/n7），直接调逻辑 setSize。
      for (const key of ['n5', 'n6', 'n7']) {
        if (raw.justPressed(key)) {
          const game = shell.game;
          if (game && game.setSize) {
            const size = Number(key[1]);
            if (game.setSize(size) === size) {
              shell.toast(`难度 ${size}×${size}`, 1000);
            }
          }
        }
      }
    },
  };
}
