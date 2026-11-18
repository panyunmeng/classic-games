/**
 * 连连看 · 输入。
 * - 点按（raw.consumeTap）转成格索引 → shell.submit('select:i')；
 * - 每帧把 dt 喂给 game.step(dt) 推进本步计时（turnBased 下 shell 不自动 step）；
 * - hint / shuffle 按钮由 shell 依据 game.json.buttons 自动绑定，此处不重复绑定。
 *
 * 棋盘在渲染层的位置必须与此处一致：OFF_X=40, OFF_Y=118, CELL=50。
 */
const COLS = 8;
const ROWS = 6;
const CELL = 50;
const OFF_X = 40;
const OFF_Y = 118;

export function createInput({ raw, shell }) {
  return {
    actions: [],

    update(dt) {
      // 计时：每帧推进，超时由 logic.step 判负。
      const game = shell.game;
      if (game && typeof game.step === 'function' && Number.isFinite(dt)) {
        game.step(dt);
      }

      const tap = raw.consumeTap();
      if (!tap) return;
      const gx = Math.floor((tap.x - OFF_X) / CELL);
      const gy = Math.floor((tap.y - OFF_Y) / CELL);
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return; // 棋盘外点按忽略
      const index = gy * COLS + gx;
      shell.submit(`select:${index}`);
    },
  };
}
