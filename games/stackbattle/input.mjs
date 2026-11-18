/**
 * 方块对战 · 输入映射（raw / shell → shell.submit）
 *
 * 设计事实与推导：
 * 1. 联机服务端实时制白名单只放行
 *    left / right / up / down / action / action2 / rotate / shoot / hold / drop / none
 *    （platform/server/protocol.mjs）。所以本文件对外只发这些词，
 *    绝不发 'p2left' 这类带座位前缀的串；座位由服务端按连接认定。
 * 2. raw 的 KEYMAP 把 ←/A、→/D、↓/S、↑/W 归并成同一个 action，
 *    同屏双人要区分左右两套键位，所以键位在本文件按 e.code 原生处理；
 *    raw 只用来读屏幕按钮（raw.vbtn）和滑动手势。
 * 3. 移动 / 软降是「按住持续」的动作：自己做 DAS（首按立刻响应，长按按固定间隔重复），
 *    每次重复只发一个动作词——与服务端按 30Hz tick 消费离散词的语义对齐。
 * 4. 旋转 / 硬降 / 暂存是「按一次发一次」：先入 pending 队列再统一发出，
 *    这样同一帧里按下又抬起也不会丢（不依赖 justPressed 的帧窗口）。
 * 5. 同屏双人：左场 WASD + F 硬降 + Q 暂存，右场 ←→↓ + ↑/空格 硬降 + X 旋转 + C 暂存；
 *    屏幕按钮归左场（手机不做双人分区）。
 */
const DAS = 0.16; // 长按开始连发的延迟
const ARR = 0.055; // 连发间隔
const SOFT_REPEAT = 0.045; // 软降连发间隔

// 单人 / 人机 / 联机：一套键位，WASD 与方向键都能用
const COMMON = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  ArrowUp: 'rotate', KeyW: 'rotate', KeyX: 'rotate', KeyZ: 'rotate',
  Space: 'drop', Enter: 'drop', KeyF: 'drop',
  KeyC: 'hold', KeyH: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
};

// 同屏双人：左场（p1）
const P1_KEYS = {
  KeyA: 'left', KeyD: 'right', KeyS: 'down',
  KeyW: 'rotate', KeyF: 'drop', KeyQ: 'hold', KeyE: 'hold',
};
// 同屏双人：右场（p2）
const P2_KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down',
  ArrowUp: 'rotate', Space: 'drop', Enter: 'drop',
  KeyX: 'rotate', KeyZ: 'rotate', KeyC: 'hold', KeyH: 'hold',
};

// 屏幕按钮 id → 动作词（shell 已按 game.json.buttons 与 dpad 自动绑定）
const TOUCH = {
  left: 'left', right: 'right', up: 'rotate', down: 'down',
  rotate: 'rotate', drop: 'drop', hold: 'hold',
};

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function newRepeat() {
  return { dir: 0, t: 0, charging: false, soft: false, softT: 0 };
}

export function createInput({ raw, shell, mode }) {
  const local2p = mode === 'local2p';
  const codes = new Set(); // 按下的物理键 code
  const pending = []; // 待发出的单次动作 {seat, word}
  const lastVbtn = Object.create(null);
  const rep = { p1: newRepeat(), p2: newRepeat() };

  function send(seat, word) {
    // 联机座位由服务端认定，多传 playerIndex 反而会让本地逻辑错位
    if (mode === 'online') shell.submit(word);
    else shell.submit(word, seat === 'p2' ? 1 : 0);
  }

  function onKeyDown(e) {
    if (e.repeat || isEditable(e.target)) return;
    const table = local2p ? (P2_KEYS[e.code] ? P2_KEYS : P1_KEYS) : COMMON;
    const word = table[e.code];
    if (!word) return;
    const seat = local2p && P2_KEYS[e.code] ? 'p2' : 'p1';
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    codes.add(e.code);
    if (word === 'rotate' || word === 'drop' || word === 'hold') pending.push({ seat, word });
  }

  function onKeyUp(e) {
    codes.delete(e.code);
  }

  function onBlur() {
    codes.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  /** 某座位当前按住的动作词集合（物理键 + 屏幕按钮；屏幕按钮归左场）。 */
  function heldWords(seat) {
    const out = new Set();
    const table = local2p ? (seat === 'p1' ? P1_KEYS : P2_KEYS) : COMMON;
    for (const code of codes) {
      const word = table[code];
      if (word) out.add(word);
    }
    if (seat === 'p1') {
      for (const id of Object.keys(raw.vbtn || {})) {
        if (raw.vbtn[id] && TOUCH[id]) out.add(TOUCH[id]);
      }
    }
    return out;
  }

  function pump(seat, words, dt) {
    const st = rep[seat];
    const dir = words.has('right') && !words.has('left') ? 1 : words.has('left') && !words.has('right') ? -1 : 0;
    if (dir !== st.dir) {
      st.dir = dir;
      st.t = 0;
      st.charging = true;
      if (dir) send(seat, dir < 0 ? 'left' : 'right');
    } else if (dir !== 0) {
      st.t += dt;
      if (st.t >= (st.charging ? DAS : ARR)) {
        st.t = 0;
        st.charging = false;
        send(seat, dir < 0 ? 'left' : 'right');
      }
    }

    if (words.has('down')) {
      if (!st.soft) {
        st.soft = true;
        st.softT = 0;
        send(seat, 'down');
      } else {
        st.softT += dt;
        if (st.softT >= SOFT_REPEAT) {
          st.softT = 0;
          send(seat, 'down');
        }
      }
    } else {
      st.soft = false;
      st.softT = 0;
    }
  }

  return {
    actions: [],

    update(dt = 0) {
      // 屏幕按钮的按下沿补齐到 pending（连续方向键由 heldWords + DAS 处理，不重复入队）
      for (const id of Object.keys(TOUCH)) {
        const on = raw.vbtn && raw.vbtn[id] === true;
        if (on && !lastVbtn[id]) {
          const word = TOUCH[id];
          if (word === 'rotate' || word === 'drop' || word === 'hold') {
            pending.push({ seat: 'p1', word });
          }
        }
        lastVbtn[id] = on;
      }

      const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;

      if (local2p) {
        pump('p1', heldWords('p1'), step);
        pump('p2', heldWords('p2'), step);
      } else {
        pump('p1', heldWords('p1'), step);
      }

      // 单次动作按按下顺序发出，保证「先转再落」的语义
      while (pending.length > 0) {
        const item = pending.shift();
        send(item.seat, item.word);
      }

      // 触屏手势：左右移动一格、下滑软降、上滑旋转
      if (!local2p) {
        const swipe = raw.consumeSwipe();
        if (swipe === 'left' || swipe === 'right') send('p1', swipe);
        else if (swipe === 'down') send('p1', 'down');
        else if (swipe === 'up') send('p1', 'rotate');
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      codes.clear();
      pending.length = 0;
    },
  };
}
