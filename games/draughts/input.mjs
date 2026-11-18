/**
 * 国际跳棋 · 输入映射。
 * - 点击/触摸：raw.consumeTap() 逻辑坐标 → 棋盘格；选中起点后再点终点 → shell.submit('move:from,to')
 * - 键盘：方向键移动光标，Enter 选中/落子（两段式），U/按钮 撤销。
 * - 人机模式玩家恒为 p1；其余按 state.turn 决定提交者。
 */
import { cursor, resetCursor } from './cursor.mjs';
import { selection, clearSelection } from './render.mjs';
import { SIZE } from './logic.mjs';

// 与 render.mjs 一致的棋盘几何
const CELL = 52;
const LEFT = (480 - CELL * SIZE) / 2; // 32
const TOP = 120;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createInput({ raw, shell, mode }) {
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

  function activePlayer(state) {
    if (mode === 'ai') return 0;
    return state && state.turn === 'p2' ? 1 : 0;
  }

  /** 两段式落子：首次点选起点，二次点选终点提交 move */
  function tapCell(index) {
    if (index < 0 || index >= SIZE * SIZE) return;
    cursor.x = index % SIZE;
    cursor.y = Math.floor(index / SIZE);
    cursor.visible = true;

    if (selection.index < 0) {
      // 仅允许选中当前方棋子
      const state = shell.state();
      const v = state && state.board[index];
      const mine = state && state.turn === 'p1' ? (v === 1 || v === 3) : (v === 2 || v === 4);
      if (v && mine) selection.index = index;
      return;
    }
    if (selection.index === index) {
      clearSelection(); // 再点自己取消选中
      return;
    }
    const from = selection.index;
    clearSelection();
    shell.submit(`move:${from},${index}`, activePlayer(shell.state()));
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

      // 点击 → 格索引（深格/浅格都换算，浅格选中会被忽略）
      const tap = raw.consumeTap();
      if (tap && typeof tap.x === 'number' && typeof tap.y === 'number') {
        const col = Math.floor((tap.x - LEFT) / CELL);
        const row = Math.floor((tap.y - TOP) / CELL);
        if (col >= 0 && col < SIZE && row >= 0 && row < SIZE) {
          tapCell(row * SIZE + col);
        }
      }

      // Enter 选中/落子
      const enter = enterPending || raw.justPressed('action');
      enterPending = false;
      if (enter && cursor.visible) tapCell(cursor.y * SIZE + cursor.x);

      // 撤销：U 键
      if (raw.justPressed('undo')) {
        shell.submit('undo', activePlayer(state));
      }
    },

    dispose() {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('keydown', onKeyDown);
      }
      resetCursor();
      clearSelection();
    },
 };
}
