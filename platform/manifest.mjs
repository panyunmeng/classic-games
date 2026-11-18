/**
 * 合集清单：唯一事实来源（游戏 id + 展示顺序）。
 *
 * 每款游戏的元数据以 `games/<id>/game.json` 为准，构建脚本会读取并合并，
 * 生成 `build/www/manifest.json` 供门户使用。新增一款游戏 = 加目录 + 在这里加一行。
 * order 与《经典小游戏平台合集-计划书.md》§5.1 清单序号一致。
 */
export const GAMES = [
  { id: 'snake', order: 1 },
  { id: 'stacker', order: 2 },
  { id: 'minesweeper', order: 3 },
  { id: 'g2048', order: 4 },
  { id: 'breakout', order: 5 },
  { id: 'gomoku', order: 6 },
  { id: 'sokoban', order: 7 },
  { id: 'linkup', order: 8 },
  { id: 'beanmaze', order: 9 },
  { id: 'starinv', order: 10 },
  { id: 'memory', order: 11 },
  { id: 'sudoku', order: 12 },
  { id: 'othello', order: 13 },
  { id: 'draughts', order: 14 },
  { id: 'klondike', order: 15 },
  { id: 'spider', order: 16 },
  { id: 'tilematch', order: 17 },
  { id: 'bubbler', order: 18 },
  { id: 'hopper', order: 19 },
  { id: 'meteor', order: 20 },
  { id: 'pong', order: 21 },
  { id: 'whack', order: 22 },
  { id: 'flapper', order: 23 },
  { id: 'jumper', order: 24 },
  { id: 'pipes', order: 25 },
  { id: 'nonogram', order: 26 },
  { id: 'tank', order: 27 },
  { id: 'snakebattle', order: 28 },
  { id: 'airhockey', order: 29 },
  { id: 'stackbattle', order: 30 },
  { id: 'bomber', order: 31 },
  { id: 'xiangqi', order: 32 },
  { id: 'ludo', order: 33 },
  { id: 'snakeladder', order: 34 },
  { id: 'freecell', order: 35 },
  { id: 'twentyfour', order: 36 },
];
