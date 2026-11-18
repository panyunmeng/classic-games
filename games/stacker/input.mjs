/**
 * 方块坠落 · 输入映射。
 *
 * 键位：←→ 移动；↓ 软降；Space 硬降；↑ / X 顺时针；C / Z 逆时针；H / Shift 暂存。
 *
 * 设计事实（第一性原则）：
 * 1. raw.KEYMAP 把 X、Z 都映射成 action2，无法区分顺/逆时针，C 与 H 干脆没有映射；
 *    所以这几个键在 input.mjs 里按 e.code 原生处理，并对物理键加"按住只触发一次"的锁。
 * 2. 其余键（←→↓↑、Space、屏幕按钮）走 raw，保持与 dpad/自定义按钮统一。
 * 3. 软降是持续动作，放进 actions 交给 step(dt) 按固定步长处理，大 dt 细分也不丢格。
 * 4. 触屏：屏幕按钮由 shell 按 game.json.buttons 自动绑定；棋盘滑动左/右移动、下软降、上旋转。
 */

// 仅这些键需要绕开 raw（KEYMAP 不够用），按 e.code 原生处理。
const NATIVE_KEY = {
  KeyX: 'rotCW',
  KeyC: 'rotCCW',
  KeyZ: 'rotCCW',
  KeyH: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
};

export function createInput({ raw, shell, mode }) {
  const actions = [];
  const held = new Set(); // 已按下的物理键，屏蔽系统长按重复

  function onKeyDown(e) {
    const act = NATIVE_KEY[e.code];
    if (!act) return;
    if (held.has(e.code)) return;
    held.add(e.code);
    shell.submit(act);
  }

  function onKeyUp(e) {
    held.delete(e.code);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    actions,

    update() {
      // 持续软降：↓ 键或 d-down 按钮按住时进 actions，step 按固定步长推进。
      actions.length = 0;
      if (raw.isDown('down')) actions.push('soft');

      // 单次动作：键盘与 dpad 统一走 raw（justPressed 每帧仅一次，endFrame 会清）。
      if (raw.justPressed('left')) shell.submit('left');
      if (raw.justPressed('right')) shell.submit('right');
      if (raw.justPressed('up')) shell.submit('rotCW');       // ↑ / W / dpad 上
      if (raw.justPressed('action')) shell.submit('hard');    // Space / Enter / J
      if (raw.justPressed('rotate')) shell.submit('rotCW');   // 自定义「转」按钮
      if (raw.justPressed('drop')) shell.submit('hard');      // 自定义「落」按钮
      if (raw.justPressed('hold')) shell.submit('hold');      // 自定义「存」按钮

      // 触屏滑动：左/右移动一格，下滑软降一格，上滑顺旋。
      const swipe = raw.consumeSwipe();
      if (swipe) {
        if (swipe === 'left' || swipe === 'right') shell.submit(swipe);
        else if (swipe === 'down') shell.submit('soft');
        else if (swipe === 'up') shell.submit('rotCW');
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
