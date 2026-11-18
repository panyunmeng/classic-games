/**
 * 爆破迷宫 · 输入映射。
 *
 * 方向是持续动作（actions），交给 logic.step 的固定步长处理：
 * - 按住方向键 / WASD → 每帧持续推送；
 * - 轻点方向键或滑动 → 产生一小段脉冲，保证点一下也能走一格；
 * - 空格 / Z / X / 「炸弹」按钮 → submit('bomb')。
 * 方向输入本身即开局（logic 收到方向动作会把 started 置真）。
 */
const DIR_ORDER = ['up', 'left', 'down', 'right'];
const PULSE_TAP = 0.16;
const PULSE_SWIPE = 0.22;

export function createInput({ raw, shell }) {
  let pulseDir = null;
  let pulseTime = 0;

  const adapter = {
    actions: [],

    update(dt) {
      const actions = [];

      // 按住的方向：固定顺序推入，避免两键同按时顺序抖动
      for (const dir of DIR_ORDER) {
        if (raw.isDown(dir)) actions.push(dir);
      }

      // 轻点/滑动产生的方向脉冲
      if (pulseTime > 0) {
        pulseTime = Math.max(0, pulseTime - (Number(dt) || 0));
        if (pulseDir && !actions.includes(pulseDir)) actions.push(pulseDir);
      } else {
        pulseDir = null;
      }

      for (const dir of DIR_ORDER) {
        if (raw.justPressed(dir)) {
          pulseDir = dir;
          pulseTime = PULSE_TAP;
        }
      }

      const swipe = raw.consumeSwipe();
      if (swipe) {
        pulseDir = swipe;
        pulseTime = PULSE_SWIPE;
        if (!actions.includes(swipe)) actions.push(swipe);
      }

      if (raw.justPressed('bomb') || raw.justPressed('action') || raw.justPressed('action2')) {
        shell.submit('bomb');
      }

      adapter.actions = actions;
    },
  };

  return adapter;
}
