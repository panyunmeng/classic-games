/**
 * 键盘光标位置（纯 UI 状态，不进游戏逻辑 state）。
 * input.mjs 写，render.mjs 读；模块单例，一局一个实例即可。
 */
export const cursor = { x: 2, y: 3, visible: false };

export function resetCursor() {
  cursor.x = 2;
  cursor.y = 3;
  cursor.visible = false;
}
