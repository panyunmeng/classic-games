/**
 * 键盘光标与选中格（纯 UI 状态，不属于游戏逻辑，故不进 state 序列化）。
 * x=列(0～8)，y=行(0～9)；selection.index = 当前选中的棋格索引（-1 为未选）。
 * input.mjs 写，render.mjs 读。
 */
export const cursor = { x: 4, y: 6, visible: false };

export const selection = { index: -1 };

export function resetCursor() {
  cursor.x = 4;
  cursor.y = 6;
  cursor.visible = false;
}

export function clearSelection() {
  selection.index = -1;
}
