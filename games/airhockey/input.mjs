/**
 * 空气曲棍球 · 输入映射。
 *
 * 键位（需求指定）：
 *   上方 p1：W / A / S / D → 上 / 左 / 下 / 右
 *   下方 p2：↑ / ← / ↓ / →
 * 本机玩家永远是「下拍 p2」（人机模式下 p1 是 AI），所以单人/人机时
 *   WASD 与 ↑↓←→ 都作用在 p2 上，两种习惯都能玩；只有同屏双人才分开归属。
 *
 * 拖拽 / 触屏：
 *   单人/人机 → 拖动屏幕任意位置都控 p2；
 *   同屏双人 → 按按下点落在中线哪一侧决定控 p1 还是 p2（分半屏）；
 *   拖拽把拍心直接写到指针位置，logic.submit 负责夹到半场边界，
 *   所以拖到中线外只会停在边界，越不过中线。
 *
 * 联机（实时制）：
 *   服务端只认白名单裸方向词 left/right/up/down（shoot 用来抢先发球），
 *   方向由 logic 按 seat 归属到自己的拍；客户端绝不发坐标、不发结果。
 *   持续方向按 30 Hz 节奏重发（与服务端 tick 对齐），方向不变就不刷屏。
 */
import { CENTER_Y } from './logic.mjs';

const P1_KEYS = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right' };
const P2_KEYS = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };
const TRACKED = new Set([...Object.keys(P1_KEYS), ...Object.keys(P2_KEYS)]);
const REPEAT = 1 / 30; // 联机持续动作重发间隔（对齐服务端 30 Hz tick）
const DRAG_EPS = 0.5;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function keyVec(pressed, map) {
  let x = 0;
  let y = 0;
  for (const [code, dir] of Object.entries(map)) {
    if (!pressed.has(code)) continue;
    if (dir === 'left') x -= 1;
    else if (dir === 'right') x += 1;
    else if (dir === 'up') y -= 1;
    else if (dir === 'down') y += 1;
  }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}

function padVec(vbtn) {
  const v = vbtn || {};
  const x = (v.left ? -1 : 0) + (v.right ? 1 : 0);
  const y = (v.up ? -1 : 0) + (v.down ? 1 : 0);
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}

/** 方向向量 → 逻辑动作词（'p1left' 这类；斜向两个词，logic 会自动归一化） */
function tokens(prefix, v) {
  const out = [];
  if (v.x < 0) out.push(`${prefix}left`);
  else if (v.x > 0) out.push(`${prefix}right`);
  if (v.y < 0) out.push(`${prefix}up`);
  else if (v.y > 0) out.push(`${prefix}down`);
  return out;
}

export function createInput({ raw, shell, mode }) {
  const pressed = new Set();
  let dragSide = null;
  let lastX = null;
  let lastY = null;
  let onlineKey = '';
  let onlineWait = 0;

  const onKeyDown = (e) => {
    if (isEditable(e.target)) return;
    if (e.repeat) return;
    if (TRACKED.has(e.code)) pressed.add(e.code);
  };
  const onKeyUp = (e) => {
    pressed.delete(e.code);
  };
  const onBlur = () => pressed.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function mySeat() {
    return shell.online?.seat === 'p1' ? 'p1' : 'p2';
  }

  function pickDragSide(y) {
    if (mode === 'local2p') return y < CENTER_Y ? 'p1' : 'p2';
    if (mode === 'online') return mySeat();
    return 'p2';
  }

  /** 联机：把持续方向按节奏发给服务端 */
  function sendOnline(v, dt) {
    onlineWait -= dt;
    const key = `${v.x},${v.y}`;
    if (v.x === 0 && v.y === 0) {
      onlineKey = '';
      onlineWait = 0;
      return;
    }
    if (key === onlineKey && onlineWait > 0) return;
    if (v.x < 0) shell.submit('left');
    else if (v.x > 0) shell.submit('right');
    if (v.y < 0) shell.submit('up');
    else if (v.y > 0) shell.submit('down');
    onlineKey = key;
    onlineWait = REPEAT;
  }

  /** 联机拖拽：只按相对拍心的方向发词，不发坐标 */
  function onlineDragVec(pointer) {
    const st = shell.state?.();
    const p = st?.paddles?.[mySeat()];
    if (!p) return { x: 0, y: 0 };
    return {
      x: Math.abs(pointer.x - p.x) > 6 ? Math.sign(pointer.x - p.x) : 0,
      y: Math.abs(pointer.y - p.y) > 6 ? Math.sign(pointer.y - p.y) : 0,
    };
  }

  return {
    actions: [],

    update(dt = 0) {
      const pointer = raw.pointer;
      const pad = padVec(raw.vbtn);
      const v1 = keyVec(pressed, P1_KEYS);
      const v2 = keyVec(pressed, P2_KEYS);

      if (pointer.justDown) {
        dragSide = pickDragSide(pointer.y);
        lastX = null;
        lastY = null;
      }

      if (mode === 'online') {
        // 联机：两个键位都控自己的拍；拖拽按拍心相对位置给方向
        let v;
        if (pointer.down) v = onlineDragVec(pointer);
        else v = { x: clamp(v1.x + v2.x + pad.x, -1, 1), y: clamp(v1.y + v2.y + pad.y, -1, 1) };
        sendOnline(v, dt);
        this.actions = [];
      } else if (mode === 'local2p') {
        const actions = [
          ...tokens('p1', v1),
          ...tokens('p2', { x: clamp(v2.x + pad.x, -1, 1), y: clamp(v2.y + pad.y, -1, 1) }),
        ];
        this.actions = actions;
        // 拖拽：按下点在中线哪一侧就控哪块拍
        if (pointer.down && dragSide) {
          if (lastX === null || Math.abs(pointer.x - lastX) > DRAG_EPS || Math.abs(pointer.y - lastY) > DRAG_EPS) {
            shell.submit(`pointer:${dragSide}:${pointer.x.toFixed(1)},${pointer.y.toFixed(1)}`);
            lastX = pointer.x;
            lastY = pointer.y;
          }
        }
      } else {
        // 单人 / 人机：WASD 与 ↑↓←→ 合并控下拍 p2
        const v = {
          x: clamp(v1.x + v2.x + pad.x, -1, 1),
          y: clamp(v1.y + v2.y + pad.y, -1, 1),
        };
        this.actions = tokens('p2', v);
        if (pointer.down && dragSide) {
          if (lastX === null || Math.abs(pointer.x - lastX) > DRAG_EPS || Math.abs(pointer.y - lastY) > DRAG_EPS) {
            shell.submit(`pointer:${dragSide}:${pointer.x.toFixed(1)},${pointer.y.toFixed(1)}`);
            lastX = pointer.x;
            lastY = pointer.y;
          }
        }
      }

      if (!pointer.down) {
        dragSide = null;
        lastX = null;
        lastY = null;
      }

      // 发球：空格 / 点击可跳过 0.9 s 准备；联机发球由服务端计时，客户端只能 shoot 抢先
      const serving = shell.state?.()?.serving === true;
      if (raw.justPressed('action')) {
        if (mode === 'online') shell.submit('shoot');
        else if (serving) shell.submit('start');
      }
      const tap = raw.consumeTap();
      if (tap && mode !== 'online' && shell.state?.()?.serving === true) shell.submit('start');
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      pressed.clear();
    },
  };
}
