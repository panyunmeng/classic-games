/**
 * 泡泡消消 · 输入映射（触屏优先，键盘同权）。
 *
 * - ←→ / A D / 屏幕方向键：持续动作 'left'/'right'，由 logic.step 按固定步长微调角度；
 * - 空格 / Enter / 发射键（game.json.buttons 的 shoot，外壳已绑定）：submit('shoot')；
 * - 轻触画面（consumeTap）：按触点位置瞄准 —— 点在炮口上方时用 atan2 直接指向触点；
 *   点在炮口附近或更下方（手指挡在底部很常见）时退化为水平位置映射，避免角度乱跳；
 * - 按住拖动（raw.pointer.down）：用 raw.pointer.x 连续瞄准，手感与轻触一致。
 */
import { SHOOTER_X, SHOOTER_Y, MAX_ANGLE } from './logic.mjs';

/** 把逻辑坐标换成炮口角度（度，0 = 正上，正数偏右） */
export function aimDegFromPoint(x, y) {
  const dx = x - SHOOTER_X;
  const dy = SHOOTER_Y - y; // 向上为正
  if (dy > 40) {
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, deg));
  }
  // 触点离炮口太近/在炮口下方：只按水平偏移给角度，横拖也走这条分支
  const deg = (dx / 200) * MAX_ANGLE;
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, deg));
}

export function createInput({ raw, shell }) {
  return {
    actions: [],

    update() {
      const actions = [];
      if (raw.isDown('left')) actions.push('left');
      if (raw.isDown('right')) actions.push('right');
      this.actions = actions;

      // 结束后不再发指令：否则 shell 会把「本局已结束」每帧弹一次 toast
      const state = shell.state ? shell.state() : null;
      if (state && state.over) return;

      if (raw.justPressed('action') || raw.justPressed('shoot')) shell.submit('shoot');

      const tap = raw.consumeTap();
      if (tap) shell.submit(`aim:${aimDegFromPoint(tap.x, tap.y).toFixed(1)}`);

      if (raw.pointer.down) {
        shell.submit(`aim:${aimDegFromPoint(raw.pointer.x, raw.pointer.y).toFixed(1)}`);
      }
    },

    dispose() {},
  };
}
