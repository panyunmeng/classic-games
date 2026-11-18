# 经典游戏合集 · 工作区入口

本目录是**单仓库 monorepo**：`platform/` + `shared/` + `games/<id>/` + `packaging/`。
计划书：[经典小游戏平台合集-计划书.md](经典小游戏平台合集-计划书.md)。

## 动手前必读

- `.agents/constraints/game-contract.md` —— **游戏契约**（子代理写任何游戏前必读，照它产出文件）
- `.agents/context/current-state.md` —— 进度台账（按日期追加，只追加不覆盖）
- `shared/shell.js` —— 统一外壳的规则来源（菜单/暂停/结算/联机钩子）
- `shared/input.js` —— 输入键位映射（`KEYMAP` 是权威）
- `platform/manifest.mjs` —— 36 款清单，新增一款必须在这里加一行

## 目录职责

| 路径 | 作用 |
| --- | --- |
| `games/<id>/` | 一款游戏的全部代码与单测，自包含 |
| `shared/` | 引擎、输入、HUD、存储、音频、RNG、样式（平台负责人统一改） |
| `platform/portal/` | 门户页 |
| `platform/server/index.mjs` | 静态服务 + 网关前缀 + WS 升级拒绝（联机阶段替换） |
| `platform/manifest.mjs` | 唯一清单 |
| `scripts/build.mjs` | 收拢 + 自检 → `build/www/` |
| `tools/cdp.mjs`、`tools/check-game.mjs` | 三视口验收（Node 内置 WebSocket，零依赖） |
| `packaging/fnapp/` | fnOS 包骨架（阶段 2 建） |
| `build/` | 产物，不进 git |
| `.agents/work/` | 过程文件（截图、日志），不进 git |

## 常用命令

```bash
node scripts/build.mjs                       # 构建 + 自检
node --test games/*/tests/*.test.mjs         # 全量逻辑单测
PORT=8101 node platform/server/index.mjs     # 本地起服务
node tools/check-game.mjs --url=http://127.0.0.1:8101/games/snake/ --width=375 --height=812
```

## 资源纪律（硬）

- Chrome/CDP 验收脚本**自己 spawn、结束 kill**，禁止 `chrome.exe &` 常驻；
- 同一验收脚本复用**一个**浏览器实例，不为每个游戏/视口重开；
- 跑完核对 `Get-Process chrome` 归零；
- 子代理**不得各自起浏览器/服务/做验收**，只写代码与 `node --test`；验收由主代理串行统一做。

## 约定

- 中文回答与注释，标识符英文；流程/结构/状态用 Mermaid（单图 ≤15 节点）。
- 区间号用中文「～」；同一行不出现两个 ASCII `~`。
- 游戏名只复刻玩法，不复刻名称/角色/美术（见计划书 §5.3）。
- 凭据不进仓库：NAS 口令只在 `D:\MyProjects\W.FNOS维护\.sshpass_askpass.cmd`。
- 删除先走回收站 `C:\Users\panyunmeng\.agents\tools\recycle.ps1`。

## 本层版本管理

工作区根是正式仓库，首版完成后 `git init` + 中文首次提交 + 推 Gitea（见全局 `gitea-workspace-git-init` 技能）。
