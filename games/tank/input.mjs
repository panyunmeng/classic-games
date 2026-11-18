/**
 * 坦克战场 · 输入映射。
 *
 * 事实与推导：
 * - 移动是「持续动作」：键盘按住期间每帧都要把方向塞进 actions，交给 step 的固定步长
 *   消费；点按/滑动只给一次方向脉冲，由 logic 的 PULSE_TIME 决定走一格。
 * - 开火是「边沿动作」：空格 / 回车 / 「开火」按钮按下那一帧 submit('shoot')，
 *   冷却由 logic 判，输入层不重复发（联机也不刷屏）。
 * - 联机走实时制 input：服务端只放行 left/right/up/down/action/action2/rotate/
 *   shoot/hold/drop/none，所以发的是裸词 'shoot' / 方向；座位归属由服务端按连接判，
 *   客户端不拼座位前缀。
 * - 本地双人同屏：p1 = WASD + 空格，p2 = 方向键 + 回车/小键盘 0；logic 接受
 *   p1left / p2shoot 这类本地前缀词（服务端白名单不放行，故不会成为联机通道）。
 * - 触屏：外壳把 game.json.buttons 的「开火」绑到 raw 的 shoot 动作；单/人机/联机
 *   用 raw 的虚拟方向键即可，本地双人时虚拟方向键归 p1。
 */
const P1_MOVE = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const P2_MOVE = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const P1_FIRE = new Set(['Space']);
const P2_FIRE = new Set(['Enter', 'NumpadEnter', 'Numpad0', 'Slash']);
const DIRS = ['left', 'right', 'up', 'down'];
const NET_DIR_INTERVAL = 1 / 30; // 联机持续方向的重发间隔（对齐服务端 tick）

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function createInput({ raw, shell, mode }) {
  const isLocal2p = mode === 'local2p';
  const isOnline = mode === 'online';

  const heldP1 = new Set();
  const heldP2 = new Set();
  let p1Fire = false;
  let p2Fire = false;

  let netDir = null;
  let netWait = 0;

  const onKeyDown = (e) => {
    if (isEditable(e.target) || e.repeat) return;
    if (isLocal2p) {
      if (P1_MOVE[e.code]) heldP1.add(e.code);
      if (P2_MOVE[e.code]) heldP2.add(e.code);
      if (P1_FIRE.has(e.code)) p1Fire = true;
      if (P2_FIRE.has(e.code)) p2Fire = true;
    }
  };

  const onKeyUp = (e) => {
    heldP1.delete(e.code);
    heldP2.delete(e.code);
  };

  const onBlur = () => {
    heldP1.clear();
    heldP2.clear();
    p1Fire = false;
    p2Fire = false;
    netDir = null;
    netWait = 0;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  /** 取集合里第一个方向（Set 按按下顺序，先按的先响应） */
  function dirOf(held, map) {
    for (const code of held) {
      if (map[code]) return map[code];
    }
    return null;
  }

  /** 虚拟方向键（外壳渲染的 ▲▼◀▶）在主模式里归 p1 */
  function padDir() {
    const v = raw.vbtn || {};
    if (v.up) return 'up';
    if (v.down) return 'down';
    if (v.left) return 'left';
    if (v.right) return 'right';
    return null;
  }

  /** 联机：按住方向时按固定节奏重发，方向变了立即发 */
  function sendOnlineDir(dir, dt) {
    netWait -= dt;
    if (!dir) {
      netDir = null;
      netWait = 0;
      return;
    }
    if (dir !== netDir || netWait <= 0) {
      shell.submit(dir);
      netDir = dir;
      netWait = NET_DIR_INTERVAL;
    }
  }

  function pressedFire() {
    return raw.justPressed('shoot') || raw.justPressed('action');
  }

  return {
    actions: [],

    update(dt = 0) {
      const acts = [];

      if (isOnline) {
        let dir = null;
        for (const d of DIRS) {
          if (raw.isDown(d)) dir = d;
        }
        sendOnlineDir(dir, dt);
        // 联机以服务端快照为准，本地 actions 不参与推进
        this.actions = [];
      } else if (isLocal2p) {
        const p1 = dirOf(heldP1, P1_MOVE) || padDir();
        const p2 = dirOf(heldP2, P2_MOVE);
        if (p1) acts.push(`p1${p1}`);
        if (p2) acts.push(`p2${p2}`);
        this.actions = acts;
      } else {
        for (const d of DIRS) {
          if (raw.isDown(d)) acts.push(d);
        }
        this.actions = acts;
      }

      // 开火：单/人机/联机统一发裸词 shoot；双人局按座位加本地前缀
      if (isLocal2p) {
        if (p1Fire || raw.justPressed('shoot')) {
          p1Fire = false;
          shell.submit('p1shoot');
        }
        if (p2Fire) {
          p2Fire = false;
          shell.submit('p2shoot');
        }
      } else if (pressedFire()) {
        shell.submit('shoot');
      }

      // 滑动换向：单/人机/联机发裸方向，双人局归 p1
      const swipe = raw.consumeSwipe();
      if (swipe) {
        if (isLocal2p) shell.submit(`p1${swipe}`);
        else shell.submit(swipe);
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      heldP1.clear();
      heldP2.clear();
    },
  };
}
