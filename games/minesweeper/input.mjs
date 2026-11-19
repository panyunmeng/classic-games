/**
 * 扫雷 · 输入映射。
 * - 触屏/鼠标点按 → 翻开；长按 ≥400ms → 插旗；快速双击已翻开数字格 → 和弦展开。
 * - 【插旗模式】点「🚩插旗」按钮切换：开启后点格子直接插旗，再点按钮退出。
 *   手机端长按易被系统菜单/pointercancel 打断，插旗模式是可靠替代入口。
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
  let flagMode = false;   // 插旗模式：开启后点格子插旗而非翻开

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

    /** 当前是否处于插旗模式（供 render 画提示） */
    isFlagMode() {
      return flagMode;
    },

    update(dt) {
      const s = state();
      if (!s) return;
      const p = raw.pointer;

      // ── 插旗模式切换按钮：shell 把 game.json.buttons 的 id 作为 action 放入 pressed
      if (raw.justPressed('flag')) {
        flagMode = !flagMode;
        shell.toast(flagMode ? '插旗模式：点格子插旗' : '插旗模式：关', 1200);
      }

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

      // ── 指针：按下记录格子并开始长按计时；抬起按时长/模式判定
      if (p && p.justDown) {
        holdCell = cellAt(s, p.x, p.y);
        // 插旗模式下不启动长按计时，抬起直接插旗
        holdStart = flagMode ? null : { ms: 0 };
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

      // 插旗模式抬起也要分发：条件是 holdStart 存在（普通模式）或当前在插旗模式
      if (p && p.justUp && (holdStart || flagMode) && holdCell) {
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        const cell = holdCell;
        const wasLong = Boolean(holdStart) && (longFired || holdStart.ms >= LONG_PRESS_MS);
        holdStart = null;
        holdCell = null;
        longFired = false;

        // 长按已插过旗，或落点在棋盘外：不再处理
        if (wasLong || !cell) {
          lastTap = null;
          return;
        }

        const cur = state();
        const target = cur.cells[cell.y * cur.cols + cell.x];

        // 插旗模式：点未翻开的格子直接插旗/取消旗，不走翻开与双击和弦
        if (flagMode) {
          if (target && !target.revealed) submit(`flag:${cell.x},${cell.y}`);
          lastTap = null;
          return;
        }

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

      // 插旗模式但落点在棋盘外时，justUp 后要清 holdCell（否则残留）
      if (p && p.justUp && flagMode && !holdCell) {
        holdStart = null;
        longFired = false;
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
