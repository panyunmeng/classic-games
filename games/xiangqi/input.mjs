/**
 * 中国象棋 · 输入映射。
 * - 点击/触摸：raw.consumeTap() 逻辑坐标 → 最近交叉点；
 *   先点自己的棋子（选中，显示可落点），再点落点 → shell.submit('move:from,to')。
 * - 键盘：方向键移动光标，Enter/空格 选中或落子（两段式），U/悔棋按钮 撤销。
 * - 人机模式玩家恒为 p1，AI（p2）回合不接受输入；同屏双人按 state.turn 换手。
 * - 联机模式只发「意图」（move:from,to），由 shell → net-client 交给服务端裁决。
 */
import { cursor, selection, resetCursor, clearSelection } from './cursor.mjs';
import { GEOM } from './render.mjs';
import { COLS, ROWS, sideOf, RED } from './logic.mjs';

// 与 render.mjs 共用同一组棋盘几何
const GRID = GEOM.grid;
const LEFT = GEOM.left;
const TOP = GEOM.top;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createInput({ raw, shell, mode }) {
  // Enter 自行监听：KEYMAP 里 Enter 也映射 action，但部分浏览器 keypress 顺序不同
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

  /** 当前应由哪一方提交（人机模式玩家恒为 p1；其余按 turn） */
  function activePlayer(state) {
    if (mode === 'ai') return 0;
    return state && state.turn === 'p2' ? 1 : 0;
  }

  /** 我的回合才能操作；人机模式 AI 回合直接忽略 */
  function myTurn(state) {
    if (!state || state.winner) return false;
    if (mode === 'ai') return state.turn === RED;
    return Boolean(state.turn);
  }

  /** 两段式选子/落子 */
  function tapCell(index) {
    const state = shell.state();
    if (!state) return;
    if (index < 0 || index >= COLS * ROWS) return;
    // 光标跟随点击，键盘与鼠标共享同一个「当前位置」
    cursor.x = index % COLS;
    cursor.y = (index / COLS) | 0;
    cursor.visible = true;

    if (!myTurn(state)) return;

    const value = state.board[index];
    const mine = value !== 0 && sideOf(value) === state.turn;

    if (selection.index < 0) {
      if (mine) selection.index = index;
      else if (value === 0) shell.toast?.('先点自己的棋子');
      return;
    }
    if (index === selection.index) {
      clearSelection(); // 再点自己取消选中
      return;
    }
    if (mine) {
      selection.index = index; // 改选另一枚自己的子
      return;
    }

    const from = selection.index;
    clearSelection();
    shell.submit(`move:${from},${index}`, activePlayer(state));
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
        cursor.x = clamp(cursor.x + dx, 0, COLS - 1);
        cursor.y = clamp(cursor.y + dy, 0, ROWS - 1);
      }

      // 点击 → 最近交叉点
      const tap = raw.consumeTap();
      if (tap && typeof tap.x === 'number' && typeof tap.y === 'number') {
        const col = Math.round((tap.x - LEFT) / GRID);
        const row = Math.round((tap.y - TOP) / GRID);
        if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
          // 离交叉点太远（落在格子中间）就不算点击，避免误触
          const dxp = Math.abs(tap.x - (LEFT + col * GRID));
          const dyp = Math.abs(tap.y - (TOP + row * GRID));
          if (dxp <= GRID * 0.62 && dyp <= GRID * 0.62) tapCell(row * COLS + col);
        }
      }

      // Enter / 空格：选中或落子（光标未显示时按 Enter 也会作用在当前光标处）
      const enter = enterPending || raw.justPressed('action');
      enterPending = false;
      if (enter) tapCell(cursor.y * COLS + cursor.x);

      // 悔棋：U 键或 shell 的「悔棋」按钮
      if (raw.justPressed('undo')) {
        clearSelection();
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
