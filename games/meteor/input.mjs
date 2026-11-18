/**
 * 陨石带 · 输入映射。
 *
 * 设计（为什么这样分两路）：
 * - 键盘/虚拟按键是"持续动作"：← → 旋转、↑ 推进、空格/开火（action/action2）射击，
 *   每个 update 把当前按住的动作写进 this.actions，由 shell 每帧交给 game.step。
 * - 触屏没有方向键的物理手感，所以用半屏语义 + 拖动：
 *   左半屏按住 = 持续左转 + 推进；右半屏按住 = 开火；
 *   按住后横向拖动 = 拖动转向（左右划决定转向），比"按左边就一定左转"更可控。
 * - 点按只按一帧时 actions 可能只出现一瞬，因此按下瞬间额外 shell.submit('shoot')，
 *   逻辑层把它缓冲到下一子步，保证"点一下必出一发"。
 */
const SHOOT_SOURCES = ['shoot', 'action', 'action2'];
/** 拖动死区：小于这个逻辑像素位移视为没动，避免手指抖动误转向 */
const DRAG_DEAD = 2.4;

export function createInput({ raw, shell }) {
  let prevX = null;

  return {
    actions: [],

    update() {
      const acts = [];
      const halfW = (shell.logical?.w || 480) / 2;

      // 键盘 + 虚拟按键：转 = 右转（单键只能给一个方向，左转由 ← / 拖动给）
      if (raw.isDown('left')) acts.push('left');
      if (raw.isDown('right') || raw.isDown('rotate')) acts.push('right');
      if (raw.isDown('up') || raw.isDown('thrust')) acts.push('up');
      let shoot = SHOOT_SOURCES.some((k) => raw.isDown(k));

      // 指针（鼠标/触摸同一套）
      const p = raw.pointer;
      if (p.down) {
        let steer = 0;
        if (prevX !== null) {
          const dx = p.x - prevX;
          if (dx > DRAG_DEAD) steer = 1;
          else if (dx < -DRAG_DEAD) steer = -1;
        }
        prevX = p.x;
        if (steer > 0) {
          acts.push('right');
        } else if (steer < 0) {
          acts.push('left');
        } else if (p.x < halfW) {
          acts.push('left', 'up');
        } else {
          shoot = true;
        }
      } else {
        prevX = null;
      }

      if (shoot) acts.push('shoot');
      this.actions = acts;

      if (SHOOT_SOURCES.some((k) => raw.justPressed(k))) shell.submit('shoot');
    },

    dispose() {
      this.actions = [];
      prevX = null;
    },
  };
}
