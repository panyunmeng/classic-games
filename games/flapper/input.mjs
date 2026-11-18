/**
 * 单键飞行 · 输入映射。
 * 任意点击 / 空格 / ↑ → shell.submit('flap')。
 * 空格在 KEYMAP 里是 'action'，↑ 是 'up'；两者与点击统一归一为 flap。
 */
export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      // 任意点击（含虚拟按键之外的画面点击）
      if (raw.consumeTap() || raw.pointer.justDown) {
        shell.submit('flap');
        return;
      }
      // 空格 / 回车 / J 映射为 'action'，方向键上 / W 映射为 'up'
      if (raw.justPressed('action') || raw.justPressed('up')) {
        shell.submit('flap');
      }
    },

    dispose() {},
  };
}
