/**
 * 程序化音效：零音频文件，WebAudio 现场合成。
 *
 * 为什么不用音频资源：36 款游戏要装进 fnOS 包，每个 mp3 都会把包撑大，
 * 而且素材版权无法逐条自证。合成音足够做「点击/吃食/爆炸/胜利」这类反馈。
 *
 * 约定：浏览器要求首次用户手势后才能播放，shell 在第一次 pointerdown/keydown
 * 时调用 unlock()。静音状态持久化在 cg:g:audio。
 */
import { store } from './storage.js';

const PRESETS = {
  click: { type: 'square', freq: 660, to: 520, dur: 0.06, gain: 0.18 },
  move: { type: 'triangle', freq: 380, to: 440, dur: 0.05, gain: 0.12 },
  coin: { type: 'square', freq: 880, to: 1320, dur: 0.09, gain: 0.16 },
  eat: { type: 'sine', freq: 520, to: 760, dur: 0.08, gain: 0.2 },
  hit: { type: 'sawtooth', freq: 220, to: 110, dur: 0.12, gain: 0.2 },
  explode: { type: 'sawtooth', freq: 160, to: 40, dur: 0.3, gain: 0.24 },
  win: { type: 'triangle', freq: 523, to: 1046, dur: 0.35, gain: 0.2 },
  lose: { type: 'sine', freq: 330, to: 110, dur: 0.45, gain: 0.2 },
  invalid: { type: 'square', freq: 180, to: 140, dur: 0.1, gain: 0.14 },
  flip: { type: 'triangle', freq: 500, to: 620, dur: 0.05, gain: 0.1 },
};

const saved = store.getGlobal('audio', { muted: false });
let muted = Boolean(saved && saved.muted);
let ctx = null;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export const audio = {
  get muted() {
    return muted;
  },

  /** 必须在用户手势里调用一次，iOS/Safari 才允许发声 */
  unlock() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  },

  play(name) {
    if (muted) return;
    const preset = PRESETS[name] || PRESETS.click;
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    try {
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = preset.type;
      osc.frequency.setValueAtTime(preset.freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, preset.to), t0 + preset.dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(preset.gain, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + preset.dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + preset.dur + 0.02);
    } catch {
      /* 音频失败不影响玩法 */
    }
  },

  setMuted(next) {
    muted = Boolean(next);
    store.setGlobal('audio', { muted });
    if (!muted) this.unlock();
    return muted;
  },

  toggle() {
    return this.setMuted(!muted);
  },
};
