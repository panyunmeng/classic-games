/**
 * 空当接龙 · 输入映射。
 * - 点自由格/基础堆/牌列上的牌 = 选源（高亮）；
 * - 再点目标（列 / 空自由格 / 基础堆）= 发 move:src,dst；再点自己或点空白 = 取消；
 * - 已占用的自由格被点时改选那格的牌（它进不去，只能是被选）；
 * - 底部「自动收 / 撤销」按钮由 shell 依据 game.json.buttons 自动绑定成 raw.justPressed(id)。
 * 命中判定与叠距都在 layout.mjs，和 render 共用一套坐标，避免"画得到点不到"。
 */
import { ui, hitTest, hitAsSource, hitAsDest, selectedRun } from './layout.mjs';

export function createInput({ raw, shell }) {
  function stateOf() {
    return shell.state ? shell.state() : null;
  }

  return {
    actions: [],

    update() {
      if (raw.justPressed('auto')) {
        ui.selected = null;
        shell.submit('auto');
        return;
      }
      if (raw.justPressed('undo')) {
        ui.selected = null;
        shell.submit('undo');
        return;
      }

      const tap = raw.consumeTap();
      if (!tap) return;
      const s = stateOf();
      if (!s) return;
      const hit = hitTest(tap.x, tap.y, s);
      if (!hit) {
        ui.selected = null;
        return;
      }

      if (ui.selected) {
        const src = hitAsSource(hit, s);
        if (src && src === ui.selected) {
          ui.selected = null; // 再点自己 = 取消
          return;
        }
        if (hit.kind === 'free' && s.freeCells[hit.i]) {
          // 自由格已占用：不可能作为落点，改成选它
          ui.selected = src;
          return;
        }
        const dst = hitAsDest(hit);
        if (dst) {
          const sel = ui.selected;
          ui.selected = null;
          shell.submit(`move:${sel},${dst}`);
          return;
        }
        ui.selected = src || null;
        return;
      }

      const src = hitAsSource(hit, s);
      if (!src) {
        ui.selected = null;
        return;
      }
      if (!selectedRun(s, src).length) {
        shell.toast?.('这组牌不是红黑交替递减序列，不能整组搬');
        ui.selected = null;
        return;
      }
      ui.selected = src;
    },

    dispose() {
      ui.selected = null;
    },
  };
}
