/**
 * 扫雷 · 输入映射。
 * - 触屏/鼠标点按 → 翻开；长按 ≥400ms → 插旗；快速双击已翻开数字格 → 和弦展开。
 * - 鼠标右键 → 插旗（shared/input.js 只跟踪左键，故这里单独监听 canvas 的 contextmenu）。
 * - 键盘方向键 → 移动光标；Enter → 翻开；F → 插旗（KEYMAP 无 F，自行按 e.code 监听）；
 *   U → 撤销（KEYMAP: undo）；R 由 shell 处理重开。
 */
import { cellAt } from './render.mjs';

const LONG_PRESS_MS = 400;
const DOUBLE_TAP_MS = 320;

export function createInput({ raw, shell }) {
  let holdStart = null;   // {x, y, ms} 当前按下的起点
  let holdCell = null;
  let longFired = false;
  let lastTap = null;     // {x, y, t} 用于双击和弦
  let fDown = false;
  let rightDown = false;

  const surface = typeof document !== 'undefined' ? document.getElementById('game-canvas') : null;

  function state() {
    return shell.state ? shell.state() : (shell.game ? shell.game.state() : null);
  }

  function submit(action) {
    // shell.submit 的签名是 (action, playerIndex=0)，内部再调 game.submit(playerIndex, action)
    shell.submit(action);
  }

  function onKeyDown(e) {
    if (e.code === 'KeyF' && !fDown) {
      fDown = true;
      e.preventDefault();
      const s = state();
      if (s && s.cursor) submit(`flag:${s.cursor.x},${s.cursor.y}`);
    }
  }

  function onKeyUp(e) {
    if (e.code === 'KeyF') fDown = false;
  }

  function onContextMenu(e) {
    e.preventDefault();
    if (rightDown) return;
    rightDown = true;
    const s = state();
    if (!s || !surface) return;
    const rect = surface.getBoundingClientRect();
    const logical = shell.logical || { w: 480, h: 640 };
    const lx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * logical.w;
    const ly = ((e.clientY - rect.top) / Math.max(1, rect.height)) * logical.h;
    const cell = cellAt(s, lx, ly);
    if (cell) submit(`flag:${cell.x},${cell.y}`);
  }

  function onPointerDownForRight(e) {
    if (e.button === 2) rightDown = true;
  }

  function onAnyPointerUp() {
    rightDown = false;
  }

  surface?.addEventListener('contextmenu', onContextMenu);
  surface?.addEventListener('pointerdown', onPointerDownForRight);
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerup', onAnyPointerUp);
  }

  return {
    actions: [],

    update(dt) {
      const s = state();
      if (!s) return;
      const p = raw.pointer;

      // ── 键盘：方向移动光标 / Enter 翻开 / F 由 keydown 直接处理
      if (raw.justPressed('left')) submit('cursor:-1,0');
      if (raw.justPressed('right')) submit('cursor:1,0');
      if (raw.justPressed('up')) submit('cursor:0,-1');
      if (raw.justPressed('down')) submit('cursor:0,1');
      if (raw.justPressed('action')) {
        const cur = state().cursor;
        submit(`reveal:${cur.x},${cur.y}`);
      }
      if (raw.justPressed('undo')) submit('undo');

      // ── 指针：按下开始计时，抬起按时长判定
      if (p && p.justDown) {
        holdCell = cellAt(s, p.x, p.y);
        holdStart = { ms: 0 };
        longFired = false;
      }

      if (holdStart && p && p.down) {
        holdStart.ms += (dt || 0) * 1000;
        // 长按到阈值时立即插旗并锁定，避免松开时又翻开
        if (!longFired && holdStart.ms >= LONG_PRESS_MS && holdCell) {
          const cur = state();
          const target = cur.cells[holdCell.y * cur.cols + holdCell.x];
          if (!target.revealed) {
            submit(`flag:${holdCell.x},${holdCell.y}`);
            longFired = true;
          }
        }
      }

      if (p && p.justUp && holdStart) {
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        const cell = holdCell;
        const wasLong = longFired || holdStart.ms >= LONG_PRESS_MS;
        holdStart = null;
        holdCell = null;
        longFired = false;

        if (!cell || wasLong) {
          lastTap = null;
          return;
        }

        const cur = state();
        const target = cur.cells[cell.y * cur.cols + cell.x];
        if (target && target.revealed && target.adjacent > 0 && lastTap
            && cell.x === lastTap.x && cell.y === lastTap.y
            && now - lastTap.t <= DOUBLE_TAP_MS) {
          submit(`chord:${cell.x},${cell.y}`);
          lastTap = null;
        } else {
          submit(`reveal:${cell.x},${cell.y}`);
          lastTap = { x: cell.x, y: cell.y, t: now };
        }
      }
    },

    dispose() {
      surface?.removeEventListener('contextmenu', onContextMenu);
      surface?.removeEventListener('pointerdown', onPointerDownForRight);
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('pointerup', onAnyPointerUp);
      }
    },
  };
}
