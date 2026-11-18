/**
 * 数独 · 输入映射。
 * - raw.consumeTap() → 选格（点击/触摸）
 * - 数字键 1～9（KEYMAP 的 n1..n9）→ 笔记模式切候选 / 普通模式填数
 * - note 键（N）/ note 按钮 → 切换笔记模式
 * - 按钮：提示 / 撤销 / 擦除；键盘 U 撤销、Backspace/Delete 擦除
 */
import { inBoard, cellCenter, ui, resetUi } from './ui.mjs';

export function createInput({ raw, shell }) {
  // 新局（restart / 暂停重开 / 切难度）会创建新的 game 对象，重置视图状态
  let lastGame = null;

  return {
    actions: [],

    update() {
      const state = shell.state();
      if (!state) return;
      if (shell.game !== lastGame) {
        lastGame = shell.game;
        resetUi();
      }

      // 选格
      const tap = raw.consumeTap();
      if (tap && typeof tap.x === 'number' && typeof tap.y === 'number' && inBoard(tap.x, tap.y)) {
        const { r, c } = cellCenter(tap.x, tap.y);
        ui.selected = { r, c };
        return;
      }

      // 笔记模式切换：note 键或 note 按钮
      if (raw.justPressed('note')) {
        ui.noteMode = !ui.noteMode;
      }

      // 功能按钮
      if (raw.justPressed('hint')) shell.submit('hint', 0);
      if (raw.justPressed('undo')) shell.submit('undo', 0);
      if (raw.justPressed('erase') && ui.selected) {
        shell.submit(`set:${ui.selected.r},${ui.selected.c},0`, 0);
      }

      // 数字键 → 填数或候选
      for (let n = 1; n <= 9; n++) {
        if (!raw.justPressed(`n${n}`)) continue;
        if (!ui.selected) break;
        const { r, c } = ui.selected;
        if (ui.noteMode) shell.submit(`note:${r},${c},${n}`, 0);
        else shell.submit(`set:${r},${c},${n}`, 0);
        break;
      }
    },
  };
}
