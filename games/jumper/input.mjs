/**
 * 蓄力跳 · 输入映射。
 *
 * 边沿事实：`raw` 只提供「按下」边沿（justPressed）与指针的 down/justDown/justUp，
 * 没有按键松开事件。所以「松开」必须由本层自己比较前后两帧的按住状态得到：
 *   held(上一帧) === true 且 held(本帧) === false  ⇒  松开边沿 → submit('release')
 * 按住状态 = 空格/回车/J（'action'）或虚拟 action 键 或 画面指针按下。
 * 指针 down→up 的同一帧用 raw.pointer.justUp 兜底（极短点击也要能起跳）。
 *
 * 方向：← → （或 A/D）按下边沿 → submit('direction:left'|'direction:right')，
 * 同时把持续按住放进 actions，供 step 每帧维持朝向。
 */
export function createInput({ raw, shell }) {
  const actions = [];
  let held = false;

  return {
    actions,

    update() {
      actions.length = 0;

      const pointerDown = Boolean(raw.pointer && raw.pointer.down);
      const pointerUp = Boolean(raw.pointer && raw.pointer.justUp);
      const keyDown = raw.isDown('action') || raw.isDown('action2');
      const down = pointerDown || keyDown;

      if (down) actions.push('charge');
      if (raw.isDown('left')) actions.push('left');
      if (raw.isDown('right')) actions.push('right');

      if (raw.justPressed('left')) shell.submit('direction:left');
      if (raw.justPressed('right')) shell.submit('direction:right');

      // 松开边沿：只发一次，且只在「上一帧还按着」时发
      if (held && !down) shell.submit('release');
      else if (!held && pointerUp) shell.submit('release');

      held = down;
    },

    dispose() {
      actions.length = 0;
      held = false;
    },
  };
}
