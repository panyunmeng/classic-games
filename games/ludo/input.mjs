/**
 * 飞行棋 · 输入映射。
 *
 * 交互只有三件事，全部走 shell.submit：
 *  - 「掷骰」按钮 / 空格 / 点骰子面板 → 'roll'；
 *  - 点自己的棋子（或数字键 1~4 选子）→ 'move:i'；
 *  - 掷出的点数没有任何子能走时，自动替玩家发 'skip'（规则要求显式跳过，
 *    但不该让玩家再点一次没有意义的按钮）。
 * 人机模式下 p2 的回合交给 shell 的 AI 驱动，本地输入完全不接管。
 */
import { DICE, piecePositions } from './board.mjs';

const TAP_R = 19; // 点选半径：比棋子半径略大，方便手指

export function createInput({ raw, shell, mode }) {
  /** 当前由本地操控的一方：人机模式只有 p1，其余按 turn 走 */
  function activeIndex(state) {
    if (!state || !state.turn || state.winner) return -1;
    const idx = state.turn === 'p2' ? 1 : 0;
    if (mode === 'ai' && idx === 1) return -1;
    return idx;
  }

  function hitPiece(state, pi, tap) {
    let best = -1;
    let bestDist = TAP_R;
    for (const p of piecePositions(state, pi)) {
      const d = Math.hypot(p.x - tap.x, p.y - tap.y);
      if (d < bestDist) {
        bestDist = d;
        best = p.piece;
      }
    }
    return best;
  }

  function insideDice(tap) {
    return (
      tap.x >= DICE.x && tap.x <= DICE.x + DICE.w && tap.y >= DICE.y && tap.y <= DICE.y + DICE.h
    );
  }

  return {
    actions: [],

    update() {
      // 先取走本帧点击：AI 回合里的误触不能残留到自己的回合
      const tap = raw.consumeTap();
      const state = shell.state();
      const pi = activeIndex(state);
      if (pi < 0) return;

      // 无子可走 → 替玩家跳过（点「掷骰」也没有别的合法动作）
      if (state.phase === 'move' && state.moves.length === 0) {
        shell.submit('skip', pi);
        return;
      }

      // 掷骰：按钮（shell 绑定的 roll）/ 空格 / 回车
      if (state.phase === 'roll' && (raw.justPressed('roll') || raw.justPressed('action'))) {
        shell.submit('roll', pi);
        return;
      }

      // 数字键 1~4 选子
      if (state.phase === 'move') {
        for (let i = 0; i < 4; i++) {
          if (raw.justPressed(`n${i + 1}`)) {
            shell.submit(`move:${i}`, pi);
            return;
          }
        }
      }

      if (!tap) return;

      if (state.phase === 'roll') {
        if (insideDice(tap)) shell.submit('roll', pi);
        return;
      }
      if (state.phase !== 'move') return;

      const piece = hitPiece(state, pi, tap);
      if (piece >= 0) shell.submit(`move:${piece}`, pi);
    },

    dispose() {},
  };
}
