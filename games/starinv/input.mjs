/**
 * 星际入侵 · 输入映射。
 * 键盘：←/→ 或 A/D 移动，Space（action）/「开火」按钮射击。
 * 触屏：在画布上按住并左右拖拽移动玩家，pointer.down 期间持续自动开火。
 */
export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      const actions = [];

      // 键盘 / 虚拟方向键：持续按住即持续生效
      if (raw.isDown('left')) actions.push('left');
      if (raw.isDown('right')) actions.push('right');
      // Space/Enter → 'action'；on-screen「开火」按钮 → 'shoot'
      if (
        raw.isDown('action') ||
        raw.justPressed('action') ||
        raw.isDown('shoot') ||
        raw.justPressed('shoot')
      ) {
        actions.push('shoot');
      }

      // 触屏拖拽：把指针逻辑 x 与目标玩家中心比较，判定方向；按住持续开火
      const p = raw.pointer;
      if (p.down) {
        const state = shell.state?.();
        const px = state?.player ? state.player.x + state.player.w / 2 : p.x;
        const gap = p.x - px;
        if (gap > 8) actions.push('right');
        else if (gap < -8) actions.push('left');
        actions.push('shoot');
      }

      this.actions = actions;
    },

    dispose() {},
  };
}
