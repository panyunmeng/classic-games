/**
 * 麻将消除 · 输入映射。
 *
 * - 点按（raw.consumeTap 逻辑坐标）→ 命中最高层那张牌 → shell.submit('pick:id')；
 *   该牌是否被压住由逻辑层裁决（命中只看「画面上最上面那张」）。
 * - 每帧把 dt 喂给 game.step(dt) 推进 30 秒倒计时：turnBased 下 shell 不跑固定步长，
 *   计时必须由输入层驱动，逻辑层不碰墙钟（与 linkup 同一套做法）。
 * - 「重排」按钮由 shell 依 game.json.buttons 绑定成 raw.justPressed('shuffle')，
 *   这里转成 shell.submit('shuffle')；U 键作为同一动作的键盘别名。
 */
import { hitTest } from './layout.mjs';

export function createInput({ raw, shell }) {
  return {
    actions: [],

    update(dt) {
      const game = shell.game;
      if (game && typeof game.step === 'function' && Number.isFinite(dt)) {
        game.step(dt);
      }

      if (raw.justPressed('shuffle') || raw.justPressed('undo')) {
        shell.submit('shuffle');
        return;
      }

      const tap = raw.consumeTap();
      if (!tap) return;

      const s = shell.state ? shell.state() : null;
      if (!s || !Array.isArray(s.tiles)) return;
      const id = hitTest(s.tiles, tap.x, tap.y);
      if (id >= 0) shell.submit(`pick:${id}`);
    },
  };
}
