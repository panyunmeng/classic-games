/**
 * 蛇梯棋 · 输入映射。
 *
 * 本作只有一个动作「掷骰」，所以输入层做的事是：把三种等价触发
 * （掷骰按钮 / 空格或回车 / 点击盘面）收敛成一次 shell.submit('roll', 下标)，
 * 并在人机模式的 AI 回合把玩家输入挡掉——否则玩家能替电脑掷骰，
 * 逻辑层虽然也会以「还没轮到你」拒绝，但那会弹一条没意义的错误提示。
 */
export function createInput({ raw, shell, mode }) {
  /** 当前应接受输入的一方：返回 shell 认识的数字下标，-1 表示此刻不接玩家操作 */
  function activeIndex(state) {
    if (!state || state.winner || !state.turn) return -1;
    if (mode === 'ai') return state.turn === 'p1' ? 0 : -1;
    if (!Array.isArray(state.players)) return 0;
    const i = state.players.findIndex((p) => p.id === state.turn);
    return i;
  }

  return {
    // 回合制：没有需要持续按住的输入
    actions: [],

    update() {
      const state = shell.state();
      if (!state) return;

      // 三种触发方式每帧只采信一次，避免同一帧连掷两把
      const pressed = raw.justPressed('roll') || raw.justPressed('action');
      const tap = raw.consumeTap();
      if (!pressed && !tap) return;

      const idx = activeIndex(state);
      if (idx < 0) return;
      shell.submit('roll', idx);
    },

    dispose() {
      /* 没有自建监听器：掷骰按钮由外壳按 game.json.buttons 统一绑定 */
    },
  };
}
