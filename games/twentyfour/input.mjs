/**
 * 24 点 · 输入。
 * consumeTap 把逻辑坐标映射到卡片索引 → 'pick:i'；
 * 运算符/撤销/跳过由 shell buttons 提供 id（op-add 等）→ 映射成 submit 动作。
 */

/** 与 render.mjs 布局同源的命中检测：原始 4 张上排、合并数下排 */
function hitTest(state, x, y) {
  const originals = state.stack.filter((s) => s.prec === null);
  const merged = state.stack.filter((s) => s.prec !== null);
  const cardW = 96;
  const gap = 14;

  const hit = (list, topY, startIndex) => {
    const total = list.length * cardW + (list.length - 1) * gap;
    const x0 = (480 - total) / 2;
    for (let i = 0; i < list.length; i++) {
      const cx = x0 + i * (cardW + gap);
      if (x >= cx && x <= cx + cardW && y >= topY && y <= topY + 132) {
        return startIndex + i;
      }
    }
    return -1;
  };

  let idx = hit(originals, 150, 0);
  if (idx >= 0) return idx;
  return hit(merged, 320, originals.length);
}

export function createInput({ raw, shell }) {
  const BUTTON_ACTIONS = {
    'op-add': 'op:add',
    'op-sub': 'op:sub',
    'op-mul': 'op:mul',
    'op-div': 'op:div',
    undo: 'undo',
    skip: 'skip',
  };

  return {
    actions: [],

    update() {
      // 点击选牌
      const tap = raw.consumeTap();
      if (tap) {
        const state = shell.state();
        if (state) {
          const idx = hitTest(state, tap.x, tap.y);
          if (idx >= 0) shell.submit(`pick:${idx}`);
        }
      }

      // 按钮（shell 已把 buttons 绑成 raw 按键，这里映射动作）
      for (const [btnId, action] of Object.entries(BUTTON_ACTIONS)) {
        if (raw.justPressed(btnId)) shell.submit(action);
      }
    },
  };
}
