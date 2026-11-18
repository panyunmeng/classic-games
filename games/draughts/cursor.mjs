/**
 * 键盘光标位置（纯 UI 状态，不属于游戏逻辑，故不进 state 序列化）。
 * x=列(0～7)，y=行(0～7)，与 render/input 的坐标系一致。
 * input.mjs 写，render.mjs 读。
 */
export const cursor = { x: 1, y: 2, visible: false };

export function resetCursor() {
  cursor.x = 1;
  cursor.y = 2;
  cursor.visible = false;
}
