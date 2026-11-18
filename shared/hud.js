/**
 * HUD 基础组件：元素构造与面板。
 * 只负责形状，不持状态——状态都在 shell 里，避免两处各记一份。
 */

export function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '' && text != null) node.textContent = text;
  return node;
}

/**
 * 通用面板。
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.desc]
 * @param {string|number} [opts.big]      大号分数
 * @param {string} [opts.sub]             分数下的说明
 * @param {Array}  [opts.modes]           [{id,label,note,primary,onClick}]
 * @param {Array}  [opts.buttons]         [{label,primary,ghost,onClick}]
 * @param {string} [opts.note]            底部小字
 * @param {Node}   [opts.extra]           追加节点（联机房间 UI 等）
 */
export function panel({ title, desc, big, sub, modes = [], buttons = [], note, extra } = {}) {
  const root = el('div', 'cg-panel');

  if (title) root.appendChild(el('h1', '', title));
  if (desc) root.appendChild(el('p', 'cg-desc', desc));
  if (big != null && big !== '') root.appendChild(el('div', 'cg-bigscore', String(big)));
  if (sub) root.appendChild(el('div', 'cg-subline', sub));

  if (modes.length) {
    const wrap = el('div', 'cg-modes');
    for (const m of modes) {
      const btn = el('button', `cg-mode${m.primary ? ' primary' : ''}`);
      const label = el('span', '', m.label || m.id);
      btn.appendChild(label);
      if (m.note) btn.appendChild(el('span', 'cg-mode-note', m.note));
      btn.addEventListener('click', m.onClick);
      wrap.appendChild(btn);
    }
    root.appendChild(wrap);
  }

  if (extra) root.appendChild(extra);

  if (buttons.length) {
    const row = el('div', 'cg-row');
    for (const b of buttons) {
      const btn = el(
        'button',
        `cg-btn${b.primary ? ' primary' : ''}${b.ghost ? ' ghost' : ''}`,
        b.label
      );
      btn.addEventListener('click', b.onClick);
      row.appendChild(btn);
    }
    root.appendChild(row);
  }

  if (note) root.appendChild(el('div', 'cg-note', note));
  return root;
}

export function showOverlay(overlay, content) {
  overlay.innerHTML = '';
  overlay.appendChild(content);
  overlay.hidden = false;
}

export function hideOverlay(overlay) {
  overlay.hidden = true;
  overlay.innerHTML = '';
}
