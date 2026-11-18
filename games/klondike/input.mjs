/**
 * 纸牌接龙 · 输入映射。
 * - 点 stock：有牌 draw，无牌 recycle；
 * - 点牌/牌堆选源（高亮），再点目标发 move:src,dst；点别处/同源取消；
 * - 双击一张翻开牌：若它可进 foundation 则自动收（等价 on 该牌的直接收集）；
 * - 底部「发牌 / 自动收 / 撤销」按钮由 shell 依据 game.json 自动绑定为 raw.justPressed(id)。
 */
import { ui, hitTest, hitAsSource, hitAsDest } from './layout.mjs';

const DOUBLE_TAP_MS = 320;

export function createInput({ raw, shell }) {
  let lastTap = null; // { key, at }

  function stateOf() {
    return shell.state ? shell.state() : shell.game?.state?.();
  }

  function keyOf(hit) {
    if (!hit) return '';
    if (hit.kind === 'stock' || hit.kind === 'waste') return hit.kind;
    return `${hit.kind}${hit.i ?? hit.index ?? ''}`;
  }

  return {
    actions: [],

    update() {
      // 抽屉按钮
      if (raw.justPressed('draw')) { shell.submit('draw'); return; }
      if (raw.justPressed('auto')) { shell.submit('auto'); return; }
      if (raw.justPressed('undo')) { shell.submit('undo'); return; }

      const tap = raw.consumeTap();
      if (!tap) return;
      const s = stateOf();
      if (!s) return;
      const hit = hitTest(tap.x, tap.y, s);
      if (!hit) {
        ui.selected = null; // 点空白取消
        lastTap = null;
        return;
      }

      // stock：发牌 / 回收
      if (hit.kind === 'stock') {
        ui.selected = null;
        shell.submit(s.stock.length ? 'draw' : 'recycle');
        lastTap = null;
        return;
      }

      const key = keyOf(hit);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const isDouble = lastTap && lastTap.key === key && now - lastTap.at < DOUBLE_TAP_MS;
      lastTap = { key, at: now };

      // 双击已选源牌：尝试自动收（auto 会收走所有可收的顶张）
      if (isDouble && ui.selected) {
        shell.submit('auto');
        ui.selected = null;
        return;
      }

      // 已选源，点目标 → 发 move
      if (ui.selected) {
        if (key === keyOf(hitTestSourceKey(ui.selected, s))) {
          ui.selected = null; // 再点同源取消
          return;
        }
        const dst = hitAsDest(hit);
        if (dst) {
          const action = `move:${ui.selected},${dst}`;
          ui.selected = null;
          shell.submit(action);
          return;
        }
        // 点在非目标上：若本身是可选源，则改选它；否则取消
        const src2 = hitAsSource(hit, s);
        ui.selected = src2 || null;
        return;
      }

      // 未选源：点一张可移动的牌 → 选中
      const src = hitAsSource(hit, s);
      ui.selected = src;
    },

    dispose() {
      ui.selected = null;
    },
  };
}

/** 把源字符串还原成一个可比较的命中 key（用于判断"再点同源取消"） */
function hitTestSourceKey(src, state) {
  if (src === 'w') return { kind: 'waste' };
  if (src[0] === 'f') return { kind: 'foundation', i: Number(src[1]) };
  if (src[0] === 't') {
    const m = /^t(\d):(\d+)$/.exec(src);
    return m ? { kind: 'tableau', i: Number(m[1]), index: Number(m[2]) } : null;
  }
  return null;
}
