/**
 * 统一输入层：键盘 + 指针 + 触屏虚拟按键 + 手势。
 *
 * 设计约束（来自移动端规范）：
 * - 只绑 pointer 事件，鼠标/触摸/笔同一套逻辑；
 * - 玩法区 touch-action: none，避免页面滚动吃掉操作；
 * - 虚拟按键走 pointerdown/up，不依赖 click（触摸有 300ms 延迟且易误触）；
 * - 多点触控用 pointerId 区分，但本层只维护主指针，复杂手势由各游戏自己扩展。
 */

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'action',
  Enter: 'action',
  KeyJ: 'action',
  KeyZ: 'action2',
  KeyX: 'action2',
  KeyK: 'action2',
  KeyR: 'restart',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  KeyN: 'note',
  KeyU: 'undo',
  KeyT: 'toggle',
  Backspace: 'erase',
  Delete: 'erase',
  Digit1: 'n1',
  Digit2: 'n2',
  Digit3: 'n3',
  Digit4: 'n4',
  Digit5: 'n5',
  Digit6: 'n6',
  Digit7: 'n7',
  Digit8: 'n8',
  Digit9: 'n9',
};

const SWIPE_MIN = 24; // CSS px
const TAP_MAX = 16;
const GESTURE_MS = 700;

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function createRawInput({ surface, getLogicalSize, onFirstGesture }) {
  const down = new Set();
  const pressed = new Set();
  const vbtn = Object.create(null);
  const pointer = { x: 0, y: 0, down: false, justDown: false, justUp: false, id: null };

  let swipe = null;
  let tap = null;
  let start = null;
  let unlocked = false;

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    try {
      onFirstGesture?.();
    } catch {
      /* 解锁失败不影响输入 */
    }
  };

  function toLogical(e) {
    const rect = surface.getBoundingClientRect();
    const size = getLogicalSize();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * size.w;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * size.h;
    return {
      x: Math.max(0, Math.min(size.w, x)),
      y: Math.max(0, Math.min(size.h, y)),
    };
  }

  function onKeyDown(e) {
    if (isEditable(e.target)) return;
    const action = KEYMAP[e.code];
    if (!action) return;
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    down.add(action);
    pressed.add(action);
    unlock();
    if (
      e.code.startsWith('Arrow') ||
      e.code === 'Space' ||
      e.code === 'Backspace' ||
      e.code === 'Delete'
    ) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const action = KEYMAP[e.code];
    if (!action) return;
    down.delete(action);
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointer.down) return; // 只跟踪主指针
    surface.setPointerCapture?.(e.pointerId);
    const p = toLogical(e);
    pointer.id = e.pointerId;
    pointer.down = true;
    pointer.justDown = true;
    pointer.x = p.x;
    pointer.y = p.y;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), lp: p };
    unlock();
  }

  function onPointerMove(e) {
    if (e.pointerId !== pointer.id) return;
    const p = toLogical(e);
    pointer.x = p.x;
    pointer.y = p.y;
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointer.id) return;
    const p = toLogical(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.down = false;
    pointer.justUp = true;

    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dist = Math.hypot(dx, dy);
      const elapsed = performance.now() - start.t;
      if (dist >= SWIPE_MIN && elapsed <= GESTURE_MS) {
        swipe = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      } else if (dist <= TAP_MAX && elapsed <= GESTURE_MS) {
        tap = { x: p.x, y: p.y };
      }
    }

    start = null;
    pointer.id = null;
  }

  function onPointerCancel(e) {
    if (e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.justUp = true;
    pointer.id = null;
    start = null;
  }

  function bindButton(element, action) {
    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();
      vbtn[action] = true;
      pressed.add(action);
      unlock();
      element.setPointerCapture?.(e.pointerId);
    };
    const release = (e) => {
      e.preventDefault();
      vbtn[action] = false;
    };
    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointerleave', release);
    return () => {
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointercancel', release);
      element.removeEventListener('pointerleave', release);
    };
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);

  return {
    down,
    pressed,
    vbtn,
    pointer,
    isDown(action) {
      return down.has(action) || vbtn[action] === true;
    },
    justPressed(action) {
      return pressed.has(action);
    },
    consumeSwipe() {
      const s = swipe;
      swipe = null;
      return s;
    },
    consumeTap() {
      const t = tap;
      tap = null;
      return t;
    },
    bindButton,
    endFrame() {
      pressed.clear();
      pointer.justDown = false;
      pointer.justUp = false;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}
