/**
 * 蜘蛛纸牌 · 输入映射。
 * - 点发牌堆：发一轮（stock 空时由逻辑层报错并 toast）；
 * - 点一张翻开的牌选源（自动取该牌到列末的同花色连续段），再点目标列发 move:src,dst,n；
 * - 再点同一张 / 点同列空白 / 点空白处：取消选择；
 * - 底部「发牌 / 撤销」按钮由 shell 依据 game.json.buttons 绑定为 raw.justPressed(id)。
 */
import { ui, hitTest, sourceAt } from './layout.mjs';
import { isMovableRun } from './logic.mjs';

export function createInput({ raw, shell }) {
  function stateOf() {
    return shell.state ? shell.state() : shell.game?.state?.();
  }

  function clear() {
    ui.selected = null;
  }

  /** 局面可能被发牌/撤销/收组改变，落手前校验选中段仍合法 */
  function validateSelection(s) {
    const sel = ui.selected;
    if (!sel) return;
    const col = s.tableau[sel.col];
    if (!col || sel.index >= col.length || !isMovableRun(col, sel.index)) ui.selected = null;
  }

  return {
    actions: [],

    update() {
      if (raw.justPressed('deal') || raw.justPressed('action')) {
        clear();
        shell.submit('stock');
        return;
      }
      if (raw.justPressed('undo')) {
        clear();
        shell.submit('undo');
        return;
      }

      const tap = raw.consumeTap();
      if (!tap) return;
      const s = stateOf();
      if (!s || s.won) return;

      const hit = hitTest(tap.x, tap.y, s);
      if (!hit) {
        clear();
        return;
      }
      if (hit.kind === 'stock') {
        clear();
        shell.submit('stock');
        return;
      }

      validateSelection(s);
      const sel = ui.selected;

      if (!sel) {
        ui.selected = sourceAt(hit, s);
        return;
      }

      if (hit.i === sel.col) {
        // 同列：点同一张取消；点另一张则改选那一张起的合法段
        ui.selected = hit.index === sel.index ? null : sourceAt(hit, s);
        return;
      }

      const srcCol = s.tableau[sel.col];
      const n = srcCol.length - sel.index;
      clear();
      shell.submit(`move:t${sel.col},t${hit.i},${n}`);
    },

    dispose() {
      clear();
    },
  };
}
