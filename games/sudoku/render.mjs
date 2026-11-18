/**
 * 数独 · 渲染（只读 state，不改状态）。坐标系固定 480×640。
 * 9×9 网格线（每 3 格粗线）、给定数字深色、填入数字强调色、
 * 笔记小字 3×3、选中格高亮、错误红标、顶部状态与底部提示。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';
import { SIZE } from './logic.mjs';
import { W, H, CELL, LEFT, TOP, BOARD, COLORS, ui } from './ui.mjs';

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

function drawGrid(ctx) {
  ctx.save();
  // 棋盘底
  ctx.shadowColor = 'rgba(167, 139, 250, 0.18)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(9, 13, 24, 0.92)';
  roundRect(ctx, LEFT - 6, TOP - 6, BOARD + 12, BOARD + 12, 12);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 格线：3 的倍数用粗线
  for (let i = 0; i <= SIZE; i++) {
    const bold = i % 3 === 0;
    ctx.strokeStyle = bold ? COLORS.gridBold : COLORS.grid;
    ctx.lineWidth = bold ? 2.5 : 1;
    const p = i * CELL;
    ctx.beginPath();
    ctx.moveTo(LEFT + p, TOP);
    ctx.lineTo(LEFT + p, TOP + BOARD);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(LEFT, TOP + p);
    ctx.lineTo(LEFT + BOARD, TOP + p);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNotes(ctx, list, x, y) {
  ctx.save();
  ctx.fillStyle = COLORS.note;
  ctx.font = `500 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let n = 1; n <= 9; n++) {
    if (!list.includes(n)) continue;
    const nr = ((n - 1) / 3) | 0;
    const nc = (n - 1) % 3;
    ctx.fillText(String(n), x + (nc + 0.5) * (CELL / 3), y + (nr + 0.5) * (CELL / 3));
  }
  ctx.restore();
}

function drawNumbers(ctx, state) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const given = state.puzzle[r][c];
      const val = given || state.values[r][c];
      const x = LEFT + c * CELL;
      const y = TOP + r * CELL;
      if (!val) {
        const notes = state.notes[r][c];
        if (notes && notes.length) drawNotes(ctx, notes, x, y);
        continue;
      }
      const wrong = !given && state.values[r][c] !== state.solution[r][c];
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${given ? '700' : '600'} 26px ${FONT}`;
      ctx.fillStyle = wrong ? COLORS.error : given ? COLORS.given : COLORS.filled;
      if (!given && !wrong) {
        ctx.shadowColor = 'rgba(167,139,250,0.5)';
        ctx.shadowBlur = 10;
      }
      ctx.fillText(String(val), x + CELL / 2, y + CELL / 2 + 1);
      ctx.restore();
    }
  }
}

function drawSelection(ctx) {
  if (!ui.selected) return;
  const { r, c } = ui.selected;
  const x = LEFT + c * CELL;
  const y = TOP + r * CELL;
  ctx.save();
  ctx.fillStyle = 'rgba(167,139,250,0.22)';
  ctx.fillRect(x, y, CELL, CELL);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
  ctx.restore();
}

function drawHeader(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.accent2;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(`数独 · ${state.levelName || '简单'}`, W / 2, 44);

  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = 'rgba(196,181,253,0.9)';
  ctx.fillText(
    `失误 ${state.mistakes}   提示 ${state.hintsLeft}   给定 ${state.puzzle.flat().filter(Boolean).length}`,
    W / 2,
    70
  );

  // 笔记模式指示
  ctx.fillStyle = ui.noteMode ? '#0b1120' : 'rgba(147,160,184,0.9)';
  ctx.font = `600 12px ${FONT}`;
  const label = ui.noteMode ? '● 笔记模式 开' : '○ 笔记模式 关（N 切换）';
  const tw = ctx.measureText(label).width;
  if (ui.noteMode) {
    ctx.fillStyle = COLORS.accent2;
    roundRect(ctx, W / 2 - tw / 2 - 10, 82, tw + 20, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#0b1120';
  }
  ctx.fillText(label, W / 2, 99);
  ctx.restore();
}

function drawFooter(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.85)';
  ctx.font = `12px ${FONT}`;
  if (state.solved) {
    ctx.fillStyle = COLORS.accent2;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText('✦ 恭喜完成！', W / 2, H - 46);
  } else {
    ctx.fillText('点格选位 · 1～9 填数 · N 笔记 · U 撤销', W / 2, H - 46);
  }
  ctx.fillStyle = 'rgba(100,112,138,0.9)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('数字键落子 / 切候选 · 按钮提示 · 撤销 · 擦除', W / 2, H - 24);
  ctx.restore();
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w || W, view.h || H, COLORS.accent);
  drawHeader(ctx, state);
  drawGrid(ctx);
  drawSelection(ctx);
  drawNumbers(ctx, state);
  drawFooter(ctx, state);
}
