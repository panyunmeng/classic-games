# 游戏契约（唯一权威）

> 子代理写任何一款游戏，必须照本文件产出文件；主代理按本文件验收。
> 样板：`games/snake/`、`games/g2048/`（已通过单测与三视口检查）。

## 1. 每款游戏必须产出的文件

```text
games/<id>/
├── game.json          元数据（字段见 §2）
├── index.html         固定模板（照抄 games/snake/index.html，只改 title）
├── logic.mjs          纯逻辑：无 DOM / 无 Math.random / 无 Date.now
├── render.mjs         Canvas 2D 渲染：只读 state，不改状态
├── input.mjs          输入映射：raw / shell → shell.submit
├── game.js            组装入口（照抄 games/snake/game.js）
└── tests/logic.test.mjs   node --test，≥8 条
```

**允许**额外文件（如 `ai.mjs`），但不得改 `shared/`、`platform/`、`scripts/`、`tools/`。

## 2. game.json 字段

```json
{
  "id": "与目录名完全一致的小写英文/数字/连字符",
  "title": "中文名",
  "subtitle": "英文名",
  "category": "arcade|puzzle|board|action|strategy|casual|card",
  "modes": ["solo"] 或 ["solo","ai"] 或 ["solo","local2p","online"],
  "inputs": ["keys"] | ["swipe"] | ["drag"] | ["tap"] | ["keys","action"],
  "buttons": [{"id":"undo","label":"撤销"}],
  "canvas": {"w": 480, "h": 640},
  "accent": "#6cf0a8",
  "accent2": "#6ad9ff",
  "desc": "一句话玩法",
  "hint": "键位提示",
  "order": 1,
  "turnBased": false,
  "audio": true,
  "ai": true
}
```

- `accent` 只能用计划书 §设计语言规范里各游戏的保留色，别自造。
- `canvas.w/h` 建议 480×640（竖屏主档）；横屏类可用 640×480。
- `turnBased: true` 时 shell 不跑固定步长，由 `submit` 直接驱动（棋牌/2048 类）。
- `ai: true` 且 `modes` 含 `ai` 时，额外导出 `ai.mjs`。

## 3. logic.mjs 接口（客户端与服务端共用，必须严格遵守）

```js
import { createRng } from '../../shared/rng.js';

export function createGame({ seed = 1, mode = 'solo', players = ['p1'], level = 1 } = {}) {
  // 所有随机用 rng，所有状态放闭包变量
  return {
    submit(playerId, action) { /* → {ok:boolean, error?:string} */ },
    step(dt, actions) { /* 实时制：按固定步长推进；回合制可空实现 */ },
    state() { /* → 纯数据对象（可 JSON 序列化），必须含 turn: 'p1'|'p2'|null */ },
    result() { /* → null | {over:true, winner:'p1'|'p2'|'draw', score?, scores?, text?} */ },
    reset() { /* 重置到开局 */ },
  };
}
```

硬约束：
- **纯逻辑**：不出现 `document` / `window` / `canvas` / `Math.random` / `Date.now`；
- `state()` 返回的对象每次都应是**新对象**（渲染层只读，但防止外部改内部）；
- `submit` 第二个参数 `action` 是字符串（如 `'left'`, `'up'`, `'place:7,8'`, `'n:5'`）；
- 联机游戏里 `turn` 字段**必须有**，服务端靠它判回合归属。

## 4. render.mjs 接口

```js
export function render(ctx, state, view) {
  // view = { w, h, dt, time, meta, shell, mode }
  // 先 drawBackdrop(ctx, view.w, view.h, accent)
  // 再按 state 画棋盘/实体；state 是只读快照
}
```

- 坐标系统一用 game.json 的 canvas 尺寸；不要自己读 window 尺寸。
- 字体用 `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`。
- 不要画「返回大厅」按钮（shell 顶栏已有）。

## 5. input.mjs 接口

```js
export function createInput({ raw, shell, mode }) {
  return {
    actions: [],           // 实时制：给 game.step 的持续动作数组
    update(dt) { /* 读 raw.justPressed / raw.consumeSwipe / raw.pointer，调 shell.submit */ },
    dispose() {},           // 可选
  };
}
```

`raw` 的可用 API：
- `raw.isDown('left'|'right'|'up'|'down'|'action'|'action2'|...)`
- `raw.justPressed(action)`
- `raw.consumeSwipe()` → `'left'|'right'|'up'|'down'|null`
- `raw.consumeTap()` → `{x,y}|null`（逻辑坐标）
- `raw.pointer` → `{x,y,down,justDown,justUp}`
- `raw.bindButton(element, action)` → cleanup 函数（shell 已自动绑定 game.json.buttons，别重复）

`KEYMAP` 已含：`left/right/up/down/action/action2/restart/pause/mute/undo/toggle/note/erase/n1..n9`。
需要新键位先在 input.mjs 里按 `e.code` 自己处理，或告知主代理加 KEYMAP。

## 6. game.js（固定样板）

```js
import { createShell } from '../../shared/shell.js';
import { createGame } from './logic.mjs';
import { render } from './render.mjs';
import { createInput } from './input.mjs';

createShell({ metaUrl: './game.json', createGame, render, createInput });
```

有 AI 的棋类游戏额外：

```js
import { chooseMove } from './ai.mjs';
createShell({ metaUrl: './game.json', createGame, render, createInput, ai: { choose: chooseMove } });
```

## 7. AI 模块（仅棋类/需要 AI 的游戏）

```js
// ai.mjs
export function chooseMove(state, playerId, level = 1) {
  // 返回与 logic.submit(action) 兼容的 action 字符串
  // level 1/2/3 对应浅/中/深（可用不同搜索深度）
  // 必须纯函数，不用随机（要随机用 state.rngSeed 或固定种子）
}
```

## 8. 联机兼容（仅 modes 含 online 的游戏）

服务端会 `import('./logic.mjs')` 直接跑权威逻辑，因此：
- `createGame({seed, mode:'online', players:['p1','p2']})` 必须可用；
- `submit(playerId, action)` 的 playerId 必须是 `'p1'|'p2'`，服务端据此鉴权；
- `state()` 必须含 `turn`；实时制还要含位置/速度等可 JSON 序列化字段；
- 客户端只发「意图」（坐标/方向），不发「结果」（落子后的棋盘/分数）。

## 9. 测试要求（≥8 条）

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../logic.mjs';
```

覆盖：初始状态、合法/非法动作、胜负判定、边界、重置、状态可序列化、连走 N 步不崩、AI 出招合法（有 AI 时）。

## 10. 命名与版权

只复刻玩法，名称/角色/美术/音乐必须原创或程序化生成（见计划书 §5.3 对照表）。
