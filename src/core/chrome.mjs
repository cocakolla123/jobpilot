// JobPilot drives a REAL Google Chrome over the DevTools protocol, using its
// own profile folder inside the workspace. You log in to LinkedIn, Handshake
// and Indeed once in that window and the logins stick. Playwright only
// attaches; it never launches a test browser, so sites see a normal Chrome.
import fs from 'node:fs';
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

export async function chromeIsUp(port) {
  try { const r = await fetch(`${cdpUrl(port)}/json/version`); return r.ok; } catch { return false; }
}

/** Opens JobPilot's Chrome (once). Returns true when it is listening. */
export async function launchChrome(ws, port, startUrls = []) {
  if (await chromeIsUp(port)) return true;
  const bin = findChrome();
  if (!bin) throw new Error('Google Chrome was not found. Install it, or set JOBPILOT_CHROME to its path.');
  fs.mkdirSync(ws.chromeProfile, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${ws.chromeProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...startUrls,
  ];
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) { if (await chromeIsUp(port)) return true; await sleep(500); }
  return false;
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
