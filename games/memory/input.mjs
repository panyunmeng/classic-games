/**
 * 记忆翻牌 · 输入映射。
 * 点击卡片（raw.consumeTap 逻辑坐标）→ 换算格子索引 → shell.submit('flip:i')。
 * 未匹配的两张在逻辑层由下一次翻牌自动翻回；撤销由 shell 的 undo 按钮（KEYMAP KeyU）自动绑定。
 */
import { boardLayout } from './layout.mjs';

export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      if (raw.justPressed('undo')) {
        shell.submit('undo');
        return;
      }
      const tap = raw.consumeTap();
      if (!tap) return;
      const s = shell.state ? shell.state() : shell.game?.state?.();
      const layout = boardLayout(s?.level || 1);
      const index = layout.indexAt(tap.x, tap.y);
      if (index >= 0) shell.submit(`flip:${index}`);
    },
  };
}
