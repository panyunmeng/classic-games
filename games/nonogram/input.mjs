/**
 * 数织 · 输入映射。
 *
 * 输入事实（为什么这样接）：
 * - 玩法只有两种格操作：填充三态翻转（点按）与插 X（长按/右键）。单击与长按共用
 *   同一次按下，必须靠「按下时长」区分，所以自己按 raw.pointer 计时，而不是把
 *   justUp 直接当点击；
 * - 长按一旦达到 400ms 立即提交 mark，并置 longFired，抬手时即使 shared/input
 *   仍会产出一个 tap（<700ms 且位移 <16px）也不再 toggle，避免一次长按改两次；
 * - tap 用 raw.consumeTap() 的坐标（逻辑坐标，已由 shared/input 换算），比手算
 *   getBoundingClientRect 更稳，取到格坐标再提交 'toggle:r,c'；
 * - 桌面右键走 canvas 的 contextmenu（raw 只跟踪左键），自己换算逻辑坐标；
 * - 提示 / 撤销 / 重置 三个按钮由 shell 按 game.json.buttons 自动 bindButton，
 *   提交过来的 action 就是按钮 id，logic.submit 直接识别，这里不重复绑定。
 */
import { cellAt } from './render.mjs';

const LONG_PRESS_MS = 400;

export function createInput({ raw, shell }) {
  let hold = null;      // { cell: {r,c}|null, ms: 已按住毫秒数 }
  let longFired = false;

  const surface = typeof document !== 'undefined' ? document.getElementById('game-canvas') : null;

  function state() {
    return shell.state ? shell.state() : null;
  }

  function submit(action) {
    // shell.submit(action, playerIndex=0) 内部转成 game.submit(0, action)
    shell.submit(action);
  }

  function onContextMenu(e) {
    e.preventDefault();
    const s = state();
    if (!s || !surface) return;
    const rect = surface.getBoundingClientRect();
    const logical = shell.getLogicalSize ? shell.getLogicalSize() : { w: 480, h: 640 };
    const lx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * logical.w;
    const ly = ((e.clientY - rect.top) / Math.max(1, rect.height)) * logical.h;
    const cell = cellAt(s, lx, ly);
    if (cell) submit(`mark:${cell.r},${cell.c}`);
  }

  surface?.addEventListener('contextmenu', onContextMenu);

  return {
    // 回合制：没有持续动作，step 也不读这个数组
    actions: [],

    update(dt) {
      const s = state();
      if (!s) return;
      const p = raw.pointer;

      if (p && p.justDown) {
        hold = { cell: cellAt(s, p.x, p.y), ms: 0 };
        longFired = false;
      }

      if (hold && p && p.down) {
        hold.ms += (dt || 0) * 1000;
        if (!longFired && hold.ms >= LONG_PRESS_MS && hold.cell) {
          submit(`mark:${hold.cell.r},${hold.cell.c}`);
          longFired = true;
        }
      }

      // 先处理 tap，再清 justUp：两者由同一次 pointerup 在同一帧写入
      const tap = raw.consumeTap();
      if (tap) {
        if (!longFired) {
          const cur = state();
          const cell = cur ? cellAt(cur, tap.x, tap.y) : null;
          if (cell) submit(`toggle:${cell.r},${cell.c}`);
        }
        hold = null;
      }

      if (p && p.justUp) {
        hold = null;
        longFired = false;
      }
    },

    dispose() {
      surface?.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
