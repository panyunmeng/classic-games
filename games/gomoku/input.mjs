/**
 * 五子棋 · 输入映射。
 * - 点击/触摸：raw.consumeTap() 逻辑坐标 → 棋盘格 → shell.submit('place:x,y')
 * - 键盘：方向键移动光标，Enter 落子（e.code 自行监听或 raw.justPressed('action')）
 * - U / 撤销按钮：悔棋
 */
import { cursor, resetCursor } from './cursor.mjs';
import { SIZE } from './logic.mjs';

// 与 render.mjs 保持一致的棋盘几何
const GRID = 30;
const LEFT = 30;
const TOP = 150;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createInput({ raw, shell, mode }) {
  // Enter 用 e.code 自行监听（KEYMAP 的 action 未必覆盖 Enter）
  let enterPending = false;
  const onKeyDown = (e) => {
    if (e.code === 'Enter' || e.key === 'Enter') {
      enterPending = true;
      e.preventDefault();
    }
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', onKeyDown);
  }

  /** 当前应由哪一方提交：人机模式玩家恒为 p1；其余按 turn 走 */
  function activePlayer(state) {
    if (mode === 'ai') return 0;
    return state && state.turn === 'p2' ? 1 : 0;
  }

  function placeAt(x, y) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    cursor.x = x;
    cursor.y = y;
    cursor.visible = true;
    shell.submit(`place:${x},${y}`, activePlayer(shell.state()));
  }

  return {
    actions: [],

    update() {
      const state = shell.state();
      if (!state) return;

      // 方向键移动光标
      let dx = 0;
      let dy = 0;
      if (raw.justPressed('left')) dx = -1;
      else if (raw.justPressed('right')) dx = 1;
      else if (raw.justPressed('up')) dy = -1;
      else if (raw.justPressed('down')) dy = 1;
      if (dx || dy) {
        cursor.visible = true;
        cursor.x = clamp(cursor.x + dx, 0, SIZE - 1);
        cursor.y = clamp(cursor.y + dy, 0, SIZE - 1);
      }

      // 点击 → 格坐标（棋盘格中心落在交叉点）
      const tap = raw.consumeTap();
      if (tap && typeof tap.x === 'number' && typeof tap.y === 'number') {
        // raw 给的是逻辑坐标（canvas 480×640），直接换算
        const gx = Math.round((tap.x - LEFT) / GRID);
        const gy = Math.round((tap.y - TOP) / GRID);
        placeAt(gx, gy);
      }

      // Enter 落子：自监听优先，兼容 KEYMAP 的 action 映射
      const enter = enterPending || raw.justPressed('action');
      enterPending = false;
      if (enter && cursor.visible) placeAt(cursor.x, cursor.y);

      // 悔棋：U 键或 shell 的 undo 按钮
      if (raw.justPressed('undo')) {
        shell.submit('undo', activePlayer(state));
      }
    },

    dispose() {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('keydown', onKeyDown);
      }
      resetCursor();
    },
  };
}
