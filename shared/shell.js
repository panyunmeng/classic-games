/**
 * 游戏外壳：所有游戏共用的一套「菜单 / 暂停 / 结算 / 画布 / 输入 / 存储 / 音效」。
 *
 * 一款游戏只需要提供四样东西（见计划书 §4）：
 *   createGame({seed, mode, players}) -> { step, submit?, state, result }
 *   render(ctx, state, view)
 *   createInput({raw, shell, mode})  -> { update(dt), actions?, dispose? }
 *   ai?: { choose(state, playerId, level) }
 *
 * 联机钩子：cfg.createOnline({shell, meta}) 存在时才会显示「联机对战」入口。
 * 联机时本地仍持有同一份 logic，服务端确认的着法通过 shell.applyRemote 落盘，
 * 保证「客户端只渲染、服务端做裁决」。
 */
import { store } from './storage.js';
import { audio } from './audio.js';
import { createRawInput } from './input.js';
import { el, panel, showOverlay, hideOverlay } from './hud.js';
import { STEP, fitCanvas, drawBackdrop } from './engine.js';

const MODE_META = {
  solo: { label: '单人开始', note: '本地最高分' },
  ai: { label: '人机对战', note: '内置 AI' },
  local2p: { label: '双人同屏', note: '一台设备轮流' },
  online: { label: '联机对战', note: '房间码邀请' },
};

export async function createShell(cfg) {
  const meta = cfg.meta || (await fetch(cfg.metaUrl || './game.json').then((r) => r.json()));
  const logical = meta.canvas || { w: 480, h: 720 };
  const audioOn = meta.audio !== false;

  const app = document.getElementById('app') || document.body;
  app.innerHTML = '';

  const root = el('div', 'cg-root');
  root.dataset.gameId = meta.id;
  root.style.setProperty('--accent', meta.accent || '#6cf0a8');
  root.style.setProperty('--accent-2', meta.accent2 || '#6ad9ff');

  const top = el('header', 'cg-top');
  const back = el('a', 'cg-iconbtn');
  back.href = '../../';
  back.textContent = '←';
  back.title = '返回大厅';
  back.setAttribute('aria-label', '返回大厅');

  const titlebox = el('div', 'cg-titlebox');
  titlebox.appendChild(el('div', 'cg-title', meta.title || meta.id));
  if (meta.subtitle) titlebox.appendChild(el('div', 'cg-sub', meta.subtitle));

  const hud = el('div', 'cg-hud');
  const scoreEl = el('span', '', '');
  const bestEl = el('small', 'cg-best', '');
  hud.appendChild(scoreEl);
  hud.appendChild(bestEl);

  const pauseBtn = el('button', 'cg-iconbtn', '⏸');
  pauseBtn.title = '暂停（Esc/P）';
  pauseBtn.setAttribute('aria-label', '暂停');
  const muteBtn = el('button', 'cg-iconbtn', audio.muted ? '🔇' : '🔊');
  muteBtn.title = '静音（M）';
  muteBtn.setAttribute('aria-label', '静音');
  if (!audioOn) muteBtn.hidden = true;

  top.appendChild(back);
  top.appendChild(titlebox);
  top.appendChild(hud);
  top.appendChild(pauseBtn);
  top.appendChild(muteBtn);

  const stage = el('div', 'cg-stage');
  const canvas = el('canvas', 'cg-canvas');
  canvas.id = 'game-canvas';
  stage.appendChild(canvas);

  const controls = el('div', 'cg-controls touch-only');
  const dpad = el('div', 'cg-dpad');
  const btnWrap = el('div', 'cg-actions');
  const hint = el('div', 'cg-hint', meta.hint || '');
  controls.appendChild(dpad);
  controls.appendChild(hint);
  controls.appendChild(btnWrap);

  const overlay = el('div', 'cg-overlay');
  overlay.hidden = true;
  const toastEl = el('div', 'cg-toast');

  root.appendChild(top);
  root.appendChild(stage);
  root.appendChild(controls);
  root.appendChild(overlay);
  root.appendChild(toastEl);
  app.appendChild(root);

  const ctx = canvas.getContext('2d');
  let view = { scale: 1, dpr: 1 };

  function fit() {
    view = fitCanvas({ canvas, stage, logical, ctx });
  }
  fit();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fit).observe(stage);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));

  /* ── 状态 ─────────────────────────────────────────────── */

  let game = null;
  let mode = 'solo';
  let phase = 'menu'; // menu | playing | paused | over
  let inputAdapter = null;
  let overInfo = null;
  let online = null;
  let onlineSeq = 0;
  let remoteState = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let best = store.best(meta.id);
  let toastTimer = 0;

  const raw = createRawInput({
    surface: canvas,
    getLogicalSize: () => logical,
    onFirstGesture: () => audio.unlock(),
  });

  /* ── HUD ──────────────────────────────────────────────── */

  function refreshHud() {
    const s = remoteState || game?.state?.();
    if (!s) {
      scoreEl.textContent = '';
      bestEl.textContent = '';
      return;
    }
    if (Number.isFinite(s.score)) {
      scoreEl.textContent = String(s.score);
    } else if (s.hud != null) {
      scoreEl.textContent = String(s.hud);
    } else if (s.turn === 'p2') {
      scoreEl.textContent = '对手回合';
    } else if (s.turn === 'p1') {
      scoreEl.textContent = '你的回合';
    } else {
      scoreEl.textContent = '';
    }
    bestEl.textContent = best > 0 ? `最佳 ${best}` : '';
  }

  function toast(msg, ms = 1600) {
    if (!msg) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  /* ── 面板 ─────────────────────────────────────────────── */

  function showMenu() {
    phase = 'menu';
    const modes = (meta.modes || ['solo'])
      .filter((m) => MODE_META[m] && (m !== 'online' || cfg.createOnline || meta.online))
      .map((m) => ({
        id: m,
        label: MODE_META[m].label,
        note: MODE_META[m].note,
        primary: m === (meta.primaryMode || 'solo'),
        onClick: () => {
          if (m === 'online') startOnline();
          else start(m);
        },
      }));

    showOverlay(
      overlay,
      panel({
        title: meta.title || meta.id,
        desc: meta.desc || '',
        big: best > 0 ? best : '',
        sub: best > 0 ? '本机最高分' : '',
        modes,
        note: meta.note || 'Esc/P 暂停 · R 重开 · 手机端用屏幕按键',
      })
    );
  }

  function showPause() {
    showOverlay(
      overlay,
      panel({
        title: '已暂停',
        buttons: [
          { label: '继续', primary: true, onClick: resume },
          { label: '重开', onClick: () => start(mode) },
          { label: '返回大厅', ghost: true, onClick: () => { window.location.href = '../../'; } },
        ],
        note: 'Esc/P 继续 · R 重开',
      })
    );
  }

  function showOver(info) {
    const isBest = Number.isFinite(info.score) ? store.setBest(meta.id, info.score) : false;
    if (isBest) best = info.score;
    const title =
      info.winner === 'p1' && mode === 'solo'
        ? '本局结束'
        : info.title || (info.winner === 'p2' ? '惜败' : '胜利');
    showOverlay(
      overlay,
      panel({
        title,
        big: Number.isFinite(info.score) ? info.score : '',
        sub: isBest ? '新纪录！' : Number.isFinite(info.score) ? `历史最佳 ${best}` : '',
        desc: info.text || '',
        buttons: [
          { label: '再来一局', primary: true, onClick: () => start(mode) },
          { label: '返回大厅', ghost: true, onClick: () => { window.location.href = '../../'; } },
        ],
      })
    );
  }

  /* ── 开局与流程 ───────────────────────────────────────── */

  function newSeed() {
    return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  function start(nextMode) {
    mode = nextMode;
    const players = mode === 'local2p' ? ['p1', 'p2'] : mode === 'ai' ? ['p1', 'p2'] : ['p1'];
    remoteState = null;
    game = cfg.createGame({
      seed: newSeed(),
      mode,
      players,
      level: meta.level || 1,
      meta,
    });
    inputAdapter?.dispose?.();
    inputAdapter = cfg.createInput ? cfg.createInput({ raw, shell, mode }) : null;
    overInfo = null;
    hideOverlay(overlay);
    phase = 'playing';
    last = 0;
    acc = 0;
    store.touchRecent(meta.id);
    audio.unlock();
    audio.play('click');
    refreshHud();
  }

  function resume() {
    if (phase !== 'paused') return;
    phase = 'playing';
    hideOverlay(overlay);
    last = 0;
  }

  function togglePause() {
    if (phase === 'playing') {
      phase = 'paused';
      showPause();
    } else if (phase === 'paused') {
      resume();
    }
  }

  function toggleMute() {
    audio.toggle();
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    toast(audio.muted ? '已静音' : '已开启声音', 900);
  }

  function submit(action, playerIndex = 0) {
    if (!game || phase !== 'playing') return;
    if (mode === 'online' && online) {
      // 回合制发 move，实时制发 input（服务端按游戏类型分别处理）
      if (meta.turnBased || meta.online === 'turnbased') online.move(action);
      else online.input(action, ++onlineSeq);
      return;
    }
    const res = game.submit ? game.submit(playerIndex, action) : null;
    if (res && res.ok === false && res.error) toast(res.error);
    refreshHud();
  }

  function checkOver() {
    const info = game?.result?.();
    if (!info || phase !== 'playing') return;
    overInfo = info;
    phase = 'over';
    audio.play(info.winner === 'p2' ? 'lose' : 'win');
    showOver(info);
  }

  /* ── 联机（由游戏自行提供 createOnline） ─────────────── */

  async function startOnline() {
    phase = 'menu';

    const hooks = {
      shell,
      meta,
      onStart: ({ seat } = {}) => {
        // 联机开局：用服务端 seed 建一局本地逻辑（只用于渲染 + 接收快照）
        game = cfg.createGame({
          seed: (Date.now() ^ 0x5a5a5a5a) >>> 0,
          mode: 'online',
          players: ['p1', 'p2'],
          meta,
        });
        inputAdapter?.dispose?.();
        inputAdapter = cfg.createInput ? cfg.createInput({ raw, shell, mode: 'online' }) : null;
        hideOverlay(overlay);
        phase = 'playing';
        last = 0;
        if (seat) toast(`你是 ${seat === 'p1' ? '先手' : '后手'}`, 1600);
      },
      onEnd: (info) => {
        phase = 'over';
        showOver({ ...info, title: info.title || '对局结束' });
      },
    };

    if (cfg.createOnline) {
      online = cfg.createOnline(hooks);
    } else if (meta.online) {
      // 默认：共享 net-client。游戏只需在 game.json 写 "online": true 或 "turnbased"
      try {
        const { createNetClient } = await import('../../shared/net-client.js');
        online = createNetClient(hooks);
      } catch (err) {
        toast(`联机加载失败：${err.message}`, 2400);
        return;
      }
    } else {
      toast('联机暂不可用');
      return;
    }

    showOverlay(
      overlay,
      panel({
        title: '联机对战',
        desc: '创建房间，把 6 位房间码发给对手；或输入房间码加入。',
        extra: online.lobby(),
        buttons: [{ label: '返回', ghost: true, onClick: () => { online?.close?.(); online = null; showMenu(); } }],
      })
    );
  }

  /* ── 渲染循环 ─────────────────────────────────────────── */

  function draw(dt) {
    ctx.clearRect(0, 0, logical.w, logical.h);
    const state = remoteState || game?.state?.();
    if (state && cfg.render) {
      try {
        cfg.render(ctx, state, {
          w: logical.w,
          h: logical.h,
          dt,
          time: performance.now() / 1000,
          meta,
          shell,
          mode,
        });
      } catch (err) {
        drawBackdrop(ctx, logical.w, logical.h, meta.accent);
        ctx.fillStyle = '#e05a4f';
        ctx.font = '14px sans-serif';
        ctx.fillText(`渲染异常：${err && err.message ? err.message : err}`, 16, 24);
        console.error(err);
      }
    } else {
      drawBackdrop(ctx, logical.w, logical.h, meta.accent);
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!last) last = t;
    const dtReal = Math.min(0.05, (t - last) / 1000);
    last = t;

    if (raw.justPressed('pause')) togglePause();
    if (raw.justPressed('mute') && audioOn) toggleMute();
    if (raw.justPressed('restart') && phase === 'playing' && game) start(mode);

    if (phase === 'playing' && game) {
      inputAdapter?.update?.(dtReal);
      if (meta.turnBased) {
        driveAI(dtReal);
      } else {
        acc = Math.min(acc + dtReal, 0.25);
        let steps = 0;
        while (acc >= STEP && steps < 5) {
          game.step(STEP, inputAdapter?.actions ?? []);
          acc -= STEP;
          steps++;
        }
      }
      refreshHud();
      // 联机胜负由服务端 over 消息裁决；本地 game 未应用对手着法，不能自行 result()
      if (mode !== 'online') checkOver();
    }

    draw(dtReal);
    raw.endFrame();
  }

  /* ── AI ───────────────────────────────────────────────── */

  let aiCooldown = 0;

  function driveAI(dt) {
    if (!cfg.ai || mode !== 'ai' || !game) return;
    const s = remoteState || game.state();
    if (!s || !s.turn || s.turn === 'p1') {
      aiCooldown = 0;
      return;
    }
    aiCooldown -= dt;
    if (aiCooldown > 0) return;
    aiCooldown = 0.4;
    const action = cfg.ai.choose(s, s.turn, meta.level || 1);
    if (action != null) submit(action, s.turn);
  }

  /* ── 虚拟按键 ─────────────────────────────────────────── */

  const cleanups = [];
  const wantDpad = (meta.inputs || []).includes('keys') || (meta.inputs || []).includes('dpad');
  if (wantDpad) {
    const dirs = [
      ['up', '▲', 'd-up'],
      ['left', '◀', 'd-left'],
      ['right', '▶', 'd-right'],
      ['down', '▼', 'd-down'],
    ];
    for (const [action, glyph, cls] of dirs) {
      const b = el('button', cls, glyph);
      b.type = 'button';
      b.setAttribute('aria-label', action);
      cleanups.push(raw.bindButton(b, action));
      dpad.appendChild(b);
    }
  } else {
    dpad.hidden = true;
  }

  const extraButtons = meta.buttons || [];
  const wantAction = (meta.inputs || []).includes('action');
  if (wantAction) extraButtons.unshift({ id: 'action', label: '动作' });
  for (const btn of extraButtons) {
    const b = el('button', 'cg-actionbtn', btn.label || btn.id);
    b.type = 'button';
    cleanups.push(raw.bindButton(b, btn.id));
    btnWrap.appendChild(b);
  }
  if (!extraButtons.length) btnWrap.hidden = true;
  if (!wantDpad && !extraButtons.length) controls.hidden = true;

  if (!meta.hint) hint.textContent = wantDpad ? '方向键 / 屏幕按键' : '';

  /* ── 全局事件 ─────────────────────────────────────────── */

  pauseBtn.addEventListener('click', togglePause);
  muteBtn.addEventListener('click', toggleMute);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') {
      phase = 'paused';
      showPause();
    }
  });
  window.addEventListener('blur', () => {
    if (phase === 'playing') {
      phase = 'paused';
      showPause();
    }
  });

  /* ── 对外 API ─────────────────────────────────────────── */

  const shell = {
    meta,
    logical,
    raw,
    store,
    audio,
    canvas,
    ctx,
    get mode() {
      return mode;
    },
    get phase() {
      return phase;
    },
    get game() {
      return game;
    },
    get online() {
      return online;
    },
    /** 供 render 读取输入层自定义状态（如扫雷插旗模式） */
    get input() {
      return inputAdapter;
    },
    state: () => remoteState || game?.state?.(),
    submit,
    applyRemote(action, playerIndex = 1) {
      if (!game) return;
      const res = game.submit ? game.submit(playerIndex, action) : null;
      refreshHud();
      return res;
    },
    setRemoteState(s) {
      remoteState = s;
      refreshHud();
    },
    clearRemoteState() {
      remoteState = null;
    },
    toast,
    start,
    showMenu,
    refreshHud,
    /** 页面级调试/验收钩子，mobile-check 用它判断是否进入对局 */
    get debug() {
      return { phase, mode, overInfo, best };
    },
  };

  window.__CG_SHELL__ = shell;

  showMenu();
  refreshHud();
  raf = requestAnimationFrame(frame);

  return shell;
}
