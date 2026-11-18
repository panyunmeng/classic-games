/**
 * 键盘光标位置（纯 UI 状态，不属于游戏逻辑，故不进 state 序列化）。
 * input.mjs 写，render.mjs 读；模块单例即可，一局一个实例足够。
 */
export const cursor = { x: 7, y: 7, visible: false };

export function resetCursor() {
  cursor.x = 7;
  cursor.y = 7;
  cursor.visible = false;
}
