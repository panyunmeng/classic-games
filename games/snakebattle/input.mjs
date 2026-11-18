/**
 * 贪吃蛇大作战 · 输入映射。
 *
 * 规则事实：转向是「按一下改一次」，不是持续按住，所以只认按下沿：
 *   - 键盘方向键 / WASD（单人时两套都控 p1）；
 *   - 屏幕虚拟方向键（shell 按 game.json.inputs 含 keys 渲染 ▲▼◀▶）；
 *   - 触屏滑动。
 * 双人同屏必须区分两套键：shared/input.js 的 KEYMAP 把 W 和 ↑ 都归成 'up'，
 * 分不出是谁按的，所以这里像 pong 一样自己听 keydown 的 e.code：
 *   WASD → p1，方向键 → p2。
 * 联机时 shell.submit 只把动作词发给服务端（座位由服务端认定），
 * 本地的 actions 只用于即时预演；座位前缀/结果一律不往服务端发。
 */
const KEY_DIR = {
  KeyW: 'up',
  KeyA: 'left',
  KeyS: 'down',
  KeyD: 'right',
  ArrowUp: 'up',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowRight: 'right',
};

const P2_CODES = new Set(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const DIRS = ['left', 'right', 'up', 'down'];

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function seatIndex(seat) {
  const n = Number(String(seat).slice(1));
  return Number.isInteger(n) && n >= 1 ? n - 1 : 0;
}

export function createInput({ raw, shell, mode }) {
  const online = mode === 'online';
  const local2p = mode === 'local2p';
  const buffer = [];

  function mySeat() {
    if (local2p) return 'p1';
    if (online) return shell.online?.seat || 'p1';
    return 'p1';
  }

  function fire(dir, seat) {
    if (!DIRS.includes(dir)) return;
    const owner = seat || 'p1';
    shell.submit(dir, seatIndex(owner));
    if (online) buffer.push({ seat: mySeat(), action: dir });
  }

  const onKeyDown = (e) => {
    if (e.repeat || isEditable(e.target)) return;
    const dir = KEY_DIR[e.code];
    if (!dir) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    fire(dir, local2p && P2_CODES.has(e.code) ? 'p2' : 'p1');
  };

  window.addEventListener('keydown', onKeyDown);

  const adapter = {
    actions: [],

    update() {
      const vbtn = raw.vbtn || {};
      // 虚拟方向键：bindButton 写入 vbtn 并塞进 pressed，按下沿 = justPressed 且 vbtn 为真
      for (const dir of DIRS) {
        if (vbtn[dir] === true && raw.justPressed(dir)) fire(dir, 'p1');
      }
      const swipe = raw.consumeSwipe();
      if (swipe) fire(swipe, 'p1');

      this.actions = online ? buffer.splice(0) : [];
      if (!online) buffer.length = 0;
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      buffer.length = 0;
    },
  };

  return adapter;
}
