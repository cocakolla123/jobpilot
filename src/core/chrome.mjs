// JobPilot drives a REAL Google Chrome over the DevTools protocol, using its
// own profile folder inside the workspace. You log in to LinkedIn, Handshake
// and Indeed once in that window and the logins stick. Playwright only
// attaches; it never launches a test browser, so sites see a normal Chrome.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { sleep } from './safety.mjs';

export function findChrome() {
  if (process.env.JOBPILOT_CHROME && fs.existsSync(process.env.JOBPILOT_CHROME)) return process.env.JOBPILOT_CHROME;
  const cands = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium']) {
    try {
      const found = execSync(process.platform === 'win32' ? `where ${name}` : `command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')[0].trim();
      if (found) return found;
    } catch { /* keep looking */ }
  }
  return null;
}

export const cdpUrl = (port) => `http://127.0.0.1:${port}`;

/** What answers on a debugging port (/json/version), or null when nothing does. */
export async function chromeInfo(port) {
  try {
    const r = await fetch(`${cdpUrl(port)}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function chromeIsUp(port) { return !!(await chromeInfo(port)); }

/**
 * The port JobPilot's own Chrome is listening on, or null when it isn't running.
 * Chrome writes DevToolsActivePort (the port, then the browser's socket path)
 * into its profile folder, so this only ever finds the Chrome using JobPilot's
 * profile. Other apps often sit on 9222 too (Electron apps, other automation
 * tools, a personal Chrome with debugging on), and attaching to one of those
 * fails with errors like "Browser context management is not supported".
 */
export async function ownChromePort(ws) {
  let port, socketPath;
  try {
    [port, socketPath] = fs.readFileSync(path.join(ws.chromeProfile, 'DevToolsActivePort'), 'utf8').split('\n').map((s) => s.trim());
  } catch { return null; }
  const info = await chromeInfo(Number(port));
  return info?.webSocketDebuggerUrl && socketPath && info.webSocketDebuggerUrl.endsWith(socketPath) ? Number(port) : null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/**
 * Opens JobPilot's Chrome (once) and returns the port it listens on, or null
 * if it did not start. Uses the preferred port when it is free; when another
 * app holds it, Chrome picks a free port and says which in DevToolsActivePort.
 */
export async function launchChrome(ws, preferredPort, startUrls = [], { headless = false } = {}) {
  const running = await ownChromePort(ws);
  if (running) return running;
  const bin = findChrome();
  if (!bin) throw new Error('Google Chrome was not found. Install it, or set JOBPILOT_CHROME to its path.');
  fs.mkdirSync(ws.chromeProfile, { recursive: true });
  fs.rmSync(path.join(ws.chromeProfile, 'DevToolsActivePort'), { force: true });   // left over from a crash
  const port = preferredPort && await portFree(preferredPort) ? preferredPort : 0;
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${ws.chromeProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
    ...startUrls,
  ];
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    const p = await ownChromePort(ws);
    if (p) return p;
    await sleep(500);
  }
  return null;
}

/** Attach to JobPilot's Chrome. Tabs JobPilot opens are the only ones it closes. */
export async function attach(port) {
  const browser = await chromium.connectOverCDP(cdpUrl(port));
  const context = browser.contexts()[0] || await browser.newContext();
  const owned = new Set();
  return {
    browser,
    context,
    /** One reusable work tab per source, opened in the background. */
    async workTab(name) {
      const existing = [...owned].find((p) => p.__jp === name && !p.isClosed());
      if (existing) return existing;
      const page = await context.newPage();
      page.__jp = name;
      owned.add(page);
      return page;
    },
    async newTab() { const p = await context.newPage(); owned.add(p); return p; },
    /** Closes the per-site work tabs (search and check) when a task ends, except sites that need you. */
    async closeWorkTabs(keep = []) { for (const p of [...owned]) if (p.__jp && !keep.includes(p.__jp)) { await p.close().catch(() => {}); owned.delete(p); } },
    async closeOwned() { for (const p of owned) await p.close().catch(() => {}); owned.clear(); },
    async detach() { await browser.close().catch(() => {}); },
  };
}
