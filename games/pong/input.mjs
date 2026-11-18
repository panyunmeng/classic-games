/**
 * 乒乓对决 · 输入映射。
 *
 * 键位（需求指定）：上方 p1 用 W / S，下方 p2 用 ↑ / ↓。
 * 单人/人机时玩家固定控下拍 p2，W S 和 ↑ ↓ 都作用在 p2 上（两种习惯都能玩）；
 * 双人同屏才分开：W S → p1，↑ ↓ → p2。
 * 因为球拍是顶/底两块横拍，只沿 x 滑动，动作词表沿用 up / down：
 *   W / ↑ = 向左（up 词），S / ↓ = 向右（down 词）。
 *
 * 触屏/鼠标：按住画布拖动，拍心跟随手指 x；在双人模式下按落点 y 分半场
 *   （上半屏控 p1、下半屏控 p2），单人与人机固定控下拍 p2。
 *
 * 联机：shell 会把 submit 的动作用 WebSocket 发给权威服务端（实时制 input），
 *   因此这里只发服务端放行的裸方向词 left / right；p1/p2 词前缀只用于本地 step。
 */
const W = 480;
const H = 640;
const P1_KEYS = { left: 'KeyW', right: 'KeyS' };
const P2_KEYS = { left: 'ArrowUp', right: 'ArrowDown' };
const REPEAT_INTERVAL = 1 / 30; // 联机持续动作的重发间隔（对齐全服 30 Hz tick）

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function createInput({ raw, shell, mode }) {
  const pressed = new Set();
  let dragSide = null;
  let lastDragX = null;
  let onlineDir = 0;
  let onlineWait = 0;

  const onKeyDown = (e) => {
    if (isEditable(e.target) || e.repeat) return;
    const code = e.code;
    if (code === P1_KEYS.left || code === P1_KEYS.right || code === P2_KEYS.left || code === P2_KEYS.right) {
      pressed.add(code);
    }
  };
  const onKeyUp = (e) => {
    pressed.delete(e.code);
  };
  const onBlur = () => pressed.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function keyDir() {
    const p1 = (pressed.has(P1_KEYS.left) ? -1 : 0) + (pressed.has(P1_KEYS.right) ? 1 : 0);
    const p2 = (pressed.has(P2_KEYS.left) ? -1 : 0) + (pressed.has(P2_KEYS.right) ? 1 : 0);
    return { p1, p2 };
  }

  /** 虚拟方向键（shell 渲染的 ▲▼◀▶）只控下拍 p2 */
  function padDir() {
    const v = raw.vbtn || {};
    return (v.up || v.left ? -1 : 0) + (v.down || v.right ? 1 : 0);
  }

  function pickDragSide(y) {
    if (mode === 'local2p') return y < H / 2 ? 'p1' : 'p2';
    if (mode === 'online') return shell.online?.seat || 'p2';
    return 'p2';
  }

  function mySeat() {
    return shell.online?.seat === 'p1' ? 'p1' : 'p2';
  }

  /** 联机：把持续方向按节奏发给服务端（服务端按 30 Hz tick 消费） */
  function sendOnline(dir, dt) {
    onlineWait -= dt;
    if (dir === 0) {
      onlineDir = 0;
      onlineWait = 0;
      return;
    }
    if (dir !== onlineDir || onlineWait <= 0) {
      shell.submit(dir < 0 ? 'left' : 'right');
      onlineDir = dir;
      onlineWait = REPEAT_INTERVAL;
    }
  }

  function dragOnlineDir() {
    const seat = mySeat();
    const state = shell.state?.();
    const p = state?.paddles?.[seat];
    const center = p ? p.x + p.w / 2 : W / 2;
    const diff = raw.pointer.x - center;
    if (Math.abs(diff) <= 8) return 0;
    return diff > 0 ? 1 : -1;
  }

  return {
    actions: [],

    update(dt = 0) {
      const { p1, p2 } = keyDir();
      const pad = padDir();
      const pointer = raw.pointer;

      // 拖拍：按下时决定控制哪块拍，之后跟随 x
      if (pointer.justDown) {
        dragSide = pickDragSide(pointer.y);
        lastDragX = null;
      }

      if (mode === 'online') {
        // 联机：两个键位都控自己的拍；拖拽按拍心相对位置给方向
        const seat = mySeat();
        const dir = pointer.down ? dragOnlineDir() : clamp(p1 + p2 + pad, -1, 1);
        this.actions = dir === 0 ? [] : [`${seat}${dir < 0 ? 'up' : 'down'}`];
        sendOnline(dir, dt);
      } else {
        const actions = [];
        if (mode === 'local2p') {
          if (p1 !== 0) actions.push(p1 < 0 ? 'p1up' : 'p1down');
          const p2dir = clamp(p2 + pad, -1, 1);
          if (p2dir !== 0) actions.push(p2dir < 0 ? 'p2up' : 'p2down');
        } else {
          // 单人 / 人机：玩家控下拍，W S 与 ↑ ↓ 合并
          const press = clamp(p1 + p2 + pad, -1, 1);
          if (press !== 0) actions.push(press < 0 ? 'p2up' : 'p2down');
        }
        this.actions = actions;

        // 离线：拖拽直接写拍心坐标（logic.submit 负责夹到墙内）
        if (pointer.down && dragSide) {
          if (pointer.x !== lastDragX) {
            shell.submit(`pointer:${dragSide}:${pointer.x.toFixed(1)}`);
            lastDragX = pointer.x;
          }
        }
      }

      if (!pointer.down) {
        dragSide = null;
        lastDragX = null;
      }

      // 发球：空格 / 点击跳过 0.9 s 准备；联机的发球由服务端 tick 自动完成
      const tap = raw.consumeTap();
      const serving = shell.state?.()?.serving === true;
      if (mode !== 'online' && serving) {
        if (raw.justPressed('action') || tap) shell.submit('start');
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      pressed.clear();
    },
  };
}
