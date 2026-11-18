/**
 * 极简 CDP 客户端：驱动本机 Chrome 做三视口验收与截图。
 *
 * 为什么不用 Puppeteer：36 款游戏的验收只需要「打开页面 → 点一下 → 读数值 → 截图」，
 * 中间层越薄越容易定位；Node 24 自带 WebSocket，连第三方依赖都不需要。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (p && existsSync(p)) return p;
    } catch {
      /* 继续找 */
    }
  }
  throw new Error('找不到 Chrome/Edge 可执行文件');
}

async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

async function waitForVersion(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return res.json();
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Chrome 调试端口未就绪：${lastErr?.message || 'timeout'}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const fns = this.listeners.get(msg.method) || [];
        for (const fn of fns) fn(msg.params, msg.sessionId);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

export async function launchBrowser() {
  const chrome = findChrome();
  const port = await freePort();
  const profile = path.join(os.tmpdir(), `cg-cdp-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--hide-scrollbars',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const version = await waitForVersion(port);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new CDP(ws);

  return {
    cdp,
    async newPage({ width = 375, height = 812, dpr = 2, mobile = true } = {}) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(cdp, sessionId, targetId);
      await page.init({ width, height, dpr, mobile });
      return page;
    },
    async close() {
      try {
        await cdp.send('Browser.close');
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }, 300);
      await new Promise((r) => setTimeout(r, 500));
      try {
        await fs.rm(profile, { recursive: true, force: true });
      } catch {
        /* Windows 上偶尔删不掉，留给系统清理 */
      }
    },
  };
}

class Page {
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.errors = [];
    this.logs = [];
    this.loadFired = false;
  }

  async init({ width, height, dpr, mobile }) {
    await this.cdp.send('Page.enable', {}, this.sessionId);
    await this.cdp.send('Runtime.enable', {}, this.sessionId);
    await this.cdp.send('Log.enable', {}, this.sessionId);
    await this.cdp.send('Network.enable', {}, this.sessionId);

    this.cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'assert') {
        const text = (p.args || [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ');
        this.errors.push({ kind: 'console', text });
      }
      if (p.type === 'warning') {
        this.logs.push({ kind: 'warn', text: (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
      }
    });
    this.cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      this.errors.push({
        kind: 'exception',
        text: d.exception?.description || d.text || 'unknown exception',
      });
    });
    this.cdp.on('Log.entryAdded', (p) => {
      const e = p.entry || {};
      if (e.level === 'error') this.errors.push({ kind: 'log', text: e.text, url: e.url });
    });
    this.cdp.on('Page.loadEventFired', () => {
      this.loadFired = true;
    });

    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile,
        screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
      },
      this.sessionId
    );
    await this.cdp.send(
      'Emulation.setTouchEmulationEnabled',
      { enabled: mobile, maxTouchPoints: 5 },
      this.sessionId
    );
  }

  async goto(url, { waitMs = 1200 } = {}) {
    this.loadFired = false;
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    const deadline = Date.now() + 15000;
    while (!this.loadFired && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 80));
    }
    const readyDeadline = Date.now() + 8000;
    while (Date.now() < readyDeadline) {
      const st = await this.evaluate('document.readyState');
      if (st === 'complete') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }

  async evaluate(expression) {
    const res = await this.cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      this.sessionId
    );
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  async click(selector) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    return ok;
  }

  async tapSelector(selector) {
    const rect = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!rect) return false;
    await this.cdp.send(
      'Input.dispatchTouchEvent',
      { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] },
      this.sessionId
    );
    await this.cdp.send(
      'Input.dispatchTouchEvent',
      { type: 'touchEnd', touchPoints: [] },
      this.sessionId
    );
    return true;
  }

  async close() {
    try {
      await this.cdp.send('Target.closeTarget', { targetId: this.targetId });
    } catch {
      /* 页面可能已关 */
    }
  }

  async screenshot(file) {
    const res = await this.cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      this.sessionId
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(res.data, 'base64'));
    return file;
  }

  async metrics() {
    return this.evaluate(`(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
      };
      const canvas = document.querySelector('canvas');
      const buttons = [...document.querySelectorAll('button, .cg-mode, .cg-iconbtn, .portal-card')]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((b) => ({ text: (b.textContent || '').trim().slice(0, 10), ...rect(b) }));
      const minTarget = buttons.reduce((m, b) => Math.min(m, Math.min(b.w, b.h)), Infinity);
      return {
        innerWidth, innerHeight, dpr: devicePixelRatio,
        scrollWidth: document.scrollingElement.scrollWidth,
        scrollHeight: document.scrollingElement.scrollHeight,
        bodyW: +document.body.getBoundingClientRect().width.toFixed(1),
        root: rect(document.querySelector('.cg-root')),
        overlay: rect(document.querySelector('.cg-overlay')),
        panel: rect(document.querySelector('.cg-panel')),
        stage: rect(document.querySelector('.cg-stage')),
        canvas: canvas ? rect(canvas) : null,
        canvasVisibleRatio: canvas ? (() => {
          const r = canvas.getBoundingClientRect();
          const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
                       Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
          return +(area / (r.width * r.height || 1)).toFixed(3);
        })() : 0,
        minTarget: Number.isFinite(minTarget) ? +minTarget.toFixed(1) : null,
        buttons,
      };
    })()`);
  }
}
