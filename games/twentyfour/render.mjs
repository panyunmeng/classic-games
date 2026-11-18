/**
 * 24 点 · 渲染。只读 state()。
 * 布局 480×640：顶部得分区、中部牌/合并栈区、底部提示区。
 * 运算符按钮由 shell 的 buttons 渲染在底部控件区，这里不重复画。
 */
import { roundRect, drawBackdrop } from '../../shared/engine.js';

const ACCENT = '#fb923c';

/** 牌的落位：原始 4 张在上排，合并出的数在下排 */
function layoutCards(stack) {
  const originals = stack.filter((s) => s.prec === null);
  const merged = stack.filter((s) => s.prec !== null);
  const cards = [];
  const cardW = 96;
  const gap = 14;

  const place = (list, y, startIndex) => {
    const total = list.length * cardW + (list.length - 1) * gap;
    const x0 = (480 - total) / 2;
    list.forEach((s, i) => {
      cards.push({ ...s, index: startIndex + i, x: x0 + i * (cardW + gap), y, w: cardW, h: 132 });
    });
  };

  place(originals, 150, 0);
  place(merged, 320, originals.length);
  return cards;
}

export function render(ctx, state, view) {
  drawBackdrop(ctx, view.w, view.h, ACCENT);

  const cards = layoutCards(state.stack);

  // 顶部：分数与连击
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(147,160,184,0.95)';
  ctx.font = '13px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`第 ${state.rounds + 1} 题 · 目标 24`, view.w / 2, 44);
  ctx.fillStyle = ACCENT;
  ctx.font = '800 30px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(String(state.score), view.w / 2, 84);
  if (state.streak > 1) {
    ctx.fillStyle = '#5fd08a';
    ctx.font = '600 13px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(`连击 ×${state.streak}`, view.w / 2, 108);
  }
  ctx.restore();

  // 中线提示：合并方向
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(100,112,138,0.9)';
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('点两张牌 → 底部选运算符', view.w / 2, 300);
  ctx.restore();

  // 卡片
  for (const c of cards) {
    const sel = state.selected.indexOf(c.index) >= 0;
    const isMerged = c.prec !== null;

    ctx.save();
    if (sel) {
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 22;
    } else if (isMerged) {
      ctx.shadowColor = 'rgba(189,242,250,0.35)';
      ctx.shadowBlur = 12;
    }
    // 手绘渐变
    const g = ctx.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
    if (sel) {
      g.addColorStop(0, '#4a3826');
      g.addColorStop(1, '#33251a');
    } else if (isMerged) {
      g.addColorStop(0, '#1b2940');
      g.addColorStop(1, '#131d2e');
    } else {
      g.addColorStop(0, '#223049');
      g.addColorStop(1, '#182236');
    }
    ctx.fillStyle = g;
    roundRect(ctx, c.x, c.y, c.w, c.h, 14);
    ctx.fill();
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeStyle = sel ? ACCENT : 'rgba(140,165,210,0.25)';
    ctx.stroke();
    ctx.restore();

    // 数值（大字）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sel ? '#ffd7a8' : isMerged ? '#bdf2fa' : '#e8edf7';
    const digits = String(c.value).length;
    const fontSize = digits <= 2 ? 46 : digits === 3 ? 36 : 26;
    const shown = isMerged && c.expr.length <= 11 ? c.expr : formatVal(c.value, isMerged);
    ctx.font = `800 ${shown.length > 6 ? 20 : fontSize}px -apple-system, "PingFang SC", sans-serif`;
    ctx.fillText(shown, c.x + c.w / 2, c.y + c.h / 2 - (isMerged && c.expr.length > 6 ? 0 : 4));
    ctx.restore();

    // 合并卡下方显示表达式
    if (isMerged && c.expr.length > 6) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(147,160,184,0.85)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(c.expr, c.x + c.w / 2, c.y + c.h - 18);
      ctx.restore();
    }
  }

  // 选中顺序提示
  if (state.selected.length > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT;
    ctx.font = '600 13px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(
      state.selected.length === 1 ? '再选一张，然后按运算符' : '已选两张，按运算符合并',
      view.w / 2,
      500
    );
    ctx.restore();
  }

  // 空栈兜底（不可能，但防渲染崩）
  if (!cards.length) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(147,160,184,0.9)';
    ctx.font = '14px sans-serif';
    ctx.fillText('发牌中…', view.w / 2, view.h / 2);
    ctx.restore();
  }
}

function formatVal(v, isMerged) {
  if (Number.isInteger(v)) return String(v);
  // 保留 2 位小数的分数感
  const rounded = Math.round(v * 100) / 100;
  return String(rounded);
}
