/**
 * 打砖块 · 输入映射（触屏为核心）。
 * - 键盘 ←→ 持续动作 → game.step 的 actions（'left'/'right'）；
 * - 空格 / 点击 → submit('launch') 发球；
 * - raw.pointer.x 拖拽：手指按住任意位置，挡板跟随 x（submit('pointer:x')）；
 * - raw.consumeSwipe() 的 x 位移也驱动挡板（相对当前位置平移），兼顾快速滑动。
 */
export function createInput({ raw, shell }) {
  let dragging = false;
  let lastDragX = null;

  return {
    actions: [],

    update() {
      const actions = [];
      if (raw.isDown('left')) actions.push('left');
      if (raw.isDown('right')) actions.push('right');
      this.actions = actions;

      // 发球：空格 / 点击 / 轻触（仅球粘板时，避免弹出"球已在运行"提示）
      const isStuck = shell.game?.state?.()?.stuck !== false;
      if (raw.justPressed('action') && isStuck) shell.submit('launch');
      const tap = raw.consumeTap();
      if (tap && isStuck) shell.submit('launch');

      // 拖拽挡板：pointer.down 时把逻辑 x 直接送给逻辑层
      if (raw.pointer.down) {
        if (!dragging) {
          dragging = true;
          if (isStuck) shell.submit('start'); // 首次触碰也尝试发球（球粘板时生效）
        }
        if (raw.pointer.x !== lastDragX) {
          shell.submit(`pointer:${raw.pointer.x.toFixed(1)}`);
          lastDragX = raw.pointer.x;
        }
      } else if (dragging) {
        dragging = false;
        lastDragX = null;
        shell.submit('pointer:end');
      }

      // 滑动的 x 位移也驱动挡板：以屏幕中点近似当前挡板位置的增量
      const swipe = raw.consumeSwipe();
      if (swipe === 'left' || swipe === 'right') {
        const state = shell.game?.state?.();
        const cx = state?.paddle ? state.paddle.x + state.paddle.w / 2 : 240;
        const dx = swipe === 'left' ? -48 : 48;
        shell.submit(`pointer:${Math.max(0, Math.min(480, cx + dx)).toFixed(1)}`);
      }
    },

    dispose() {},
  };
}
