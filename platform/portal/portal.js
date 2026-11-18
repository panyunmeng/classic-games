/**
 * 门户页：读构建产物 manifest.json，渲染分类、搜索、最近游玩与卡片。
 * 不硬编码任何游戏——新增游戏只改 platform/manifest.mjs 与 games/<id>/game.json。
 */
import { store } from './shared/storage.js';

const CATEGORIES = [
  ['all', '全部'],
  ['arcade', '街机'],
  ['puzzle', '益智'],
  ['board', '棋牌'],
  ['action', '动作'],
  ['strategy', '策略'],
  ['casual', '休闲'],
];

const MODE_LABEL = { solo: '单人', ai: '人机', local2p: '双人', online: '联机' };

const state = {
  games: [],
  cat: 'all',
  query: '',
};

const grid = document.getElementById('grid');
const cats = document.getElementById('cats');
const empty = document.getElementById('empty');
const count = document.getElementById('count');
const search = document.getElementById('search');
const recentWrap = document.getElementById('recent-wrap');
const recentList = document.getElementById('recent');
const versionEl = document.getElementById('version');

function card(game) {
  const a = document.createElement('a');
  a.className = 'portal-card';
  a.href = `./games/${game.id}/`;
  a.style.setProperty('--card-accent', game.accent || '#6cf0a8');

  const top = document.createElement('div');
  top.className = 'portal-card-top';

  const left = document.createElement('div');
  const h = document.createElement('h3');
  h.className = 'portal-card-title';
  h.textContent = game.title;
  left.appendChild(h);
  if (game.subtitle) {
    const sub = document.createElement('div');
    sub.className = 'portal-card-sub';
    sub.textContent = game.subtitle;
    left.appendChild(sub);
  }
  top.appendChild(left);

  const acc = document.createElement('span');
  acc.className = 'portal-card-acc';
  top.appendChild(acc);
  a.appendChild(top);

  const desc = document.createElement('p');
  desc.className = 'portal-card-desc';
  desc.textContent = game.desc || '';
  a.appendChild(desc);

  const meta = document.createElement('div');
  meta.className = 'portal-card-meta';
  for (const m of game.modes || []) {
    if (MODE_LABEL[m]) {
      const b = document.createElement('span');
      b.className = `portal-badge${m === 'online' ? ' online' : ''}`;
      b.textContent = MODE_LABEL[m];
      meta.appendChild(b);
    }
  }
  const catLabel = (CATEGORIES.find(([id]) => id === game.category) || [])[1];
  if (catLabel) {
    const b = document.createElement('span');
    b.className = 'portal-badge';
    b.textContent = catLabel;
    meta.appendChild(b);
  }
  const best = store.best(game.id);
  if (best > 0) {
    const b = document.createElement('span');
    b.className = 'portal-badge best';
    b.textContent = `最佳 ${best}`;
    meta.appendChild(b);
  }
  a.appendChild(meta);
  return a;
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.games.filter((g) => {
    if (state.cat !== 'all' && g.category !== state.cat) return false;
    if (!q) return true;
    return (
      g.title.toLowerCase().includes(q) ||
      g.id.includes(q) ||
      (g.subtitle || '').toLowerCase().includes(q)
    );
  });
}

function renderCats() {
  cats.innerHTML = '';
  const present = new Set(state.games.map((g) => g.category));
  for (const [id, label] of CATEGORIES) {
    if (id !== 'all' && !present.has(id)) continue;
    const b = document.createElement('button');
    b.className = `portal-cat${state.cat === id ? ' on' : ''}`;
    b.textContent = label;
    b.type = 'button';
    b.addEventListener('click', () => {
      state.cat = id;
      renderCats();
      renderGrid();
    });
    cats.appendChild(b);
  }
}

function renderGrid() {
  const list = filtered();
  grid.innerHTML = '';
  for (const g of list) grid.appendChild(card(g));
  empty.hidden = list.length > 0;
  count.textContent = `${list.length} / ${state.games.length} 款`;
}

function renderRecent() {
  const ids = store.recent();
  const byId = new Map(state.games.map((g) => [g.id, g]));
  const items = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 6);
  recentWrap.hidden = items.length === 0;
  recentList.innerHTML = '';
  for (const g of items) {
    const a = document.createElement('a');
    a.className = 'portal-recent-item';
    a.href = `./games/${g.id}/`;
    a.textContent = g.title;
    recentList.appendChild(a);
  }
}

search.addEventListener('input', () => {
  state.query = search.value;
  renderGrid();
});

async function boot() {
  try {
    const res = await fetch('./manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const data = await res.json();
    state.games = (data.games || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99));
    versionEl.textContent = data.version ? `v${data.version}` : '';
    renderCats();
    renderRecent();
    renderGrid();
  } catch (err) {
    grid.innerHTML = `<p style="color:#e05a4f">加载清单失败：${err.message}</p>`;
  }
}

boot();
