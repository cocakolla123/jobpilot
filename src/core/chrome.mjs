// JobPilot drives a REAL Google Chrome over the DevTools protocol, using its
// own profile folder inside the workspace. You log in to LinkedIn, Handshake
// and Indeed once in that window and the logins stick. Playwright only
// attaches; it never launches a test browser, so sites see a normal Chrome.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync, execFileSync } from 'node:child_process';
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

/** Main process ids of any Chrome running on this profile folder (helper processes skipped). */
export function profileChromePids(profileDir) {
  const needle = `--user-data-dir=${profileDir}`;
  let out = '';
  try {
    out = process.platform === 'win32'
      ? execFileSync('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      : execFileSync('ps', ['-axww', '-o', 'pid=,command='], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 }).toString();
  } catch { return []; }
  return out.split('\n')
    .filter((line) => line.includes(needle) && !line.includes('--type='))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Closes Chrome the normal way so it saves its tabs; forces it only if it hangs. */
async function quitChrome(pids) {
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    } catch { /* already gone */ }
  }
  for (let i = 0; i < 40 && pids.some(alive); i++) await sleep(250);
  for (const pid of pids.filter(alive)) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    } catch { /* gone */ }
  }
  await sleep(500);
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** A Chrome problem JobPilot could not fix itself. The message tells the user what to do. */
export class ChromeProblem extends Error {
  constructor(message) { super(message); this.name = 'ChromeProblem'; }
}

export const CHROME_HELP = {
  notFound: 'Google Chrome is not installed. Install it from https://www.google.com/chrome and try again. If it is installed somewhere unusual, set JOBPILOT_CHROME to its full path.',
  wontQuit: "JobPilot's Chrome is open but not responding. Quit it yourself (click its window, then Chrome menu, then Quit Google Chrome) and try again.",
  policy: 'Chrome on this computer is managed by a school or employer, and its settings block the remote control JobPilot needs. Use a personal computer, or install Chromium and set JOBPILOT_CHROME to it.',
  wontStart: "JobPilot could not open its own Chrome window. Quit every Chrome window (Chrome menu, then Quit), then try again. If it still fails, restart your computer. Chrome's own messages are saved in the logs folder of your JobPilot workspace (chrome.log).",
  keepsClosing: "JobPilot's Chrome keeps closing while it works. Leave its window open (minimizing it is fine) and run again.",
};

/** True when a Playwright error means the browser or its connection went away. */
export function browserGone(e) {
  return /Target page, context or browser has been closed|Browser has been closed|browser has disconnected|Target closed|Session closed|Connection closed|WebSocket is not open|Failed to open a new tab|ECONNREFUSED|ECONNRESET|socket hang up/i.test(String(e?.message || e));
}

/** A plain English version of an error, with what to do next, for the activity log. */
export function friendlyError(e) {
  const msg = String(e?.message || e || '');
  if (e instanceof ChromeProblem) return msg;
  if (browserGone(e)) return "JobPilot's Chrome closed while it was working. Run again and it will reopen.";
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_(RESET|CLOSED|TIMED_OUT)|ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'The internet connection dropped. Check your connection and run again.';
  if (/Timeout \d+ms exceeded|timed out/i.test(msg)) return 'A page took too long to load. Check your internet connection and run again.';
  if (/Protocol error|connectOverCDP|Browser context management/i.test(msg)) return "JobPilot could not control its Chrome. Quit JobPilot's Chrome window (Chrome menu, then Quit) and run again.";
  return msg.split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 240);
}

/** True when a Chrome policy on this computer turns off remote debugging. */
function policyBlocksDebugging() {
  const blocked = (text) => /RemoteDebuggingAllowed"?\s*[=:]\s*(0|false)\b|DeveloperToolsAvailability"?\s*[=:]\s*2\b/i.test(text);
  const read = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };
  if (process.platform === 'darwin') {
    return blocked(read('defaults', ['read', '/Library/Managed Preferences/com.google.Chrome'])) || blocked(read('defaults', ['read', 'com.google.Chrome']));
  }
  if (process.platform === 'win32') {
    return ['HKLM', 'HKCU'].some((hive) => /0x0\b/.test(read('reg', ['query', `${hive}\\SOFTWARE\\Policies\\Google\\Chrome`, '/v', 'RemoteDebuggingAllowed']))
      || /0x2\b/.test(read('reg', ['query', `${hive}\\SOFTWARE\\Policies\\Google\\Chrome`, '/v', 'DeveloperToolsAvailability'])));
  }
  try {
    const dir = '/etc/opt/chrome/policies/managed';
    return fs.readdirSync(dir).some((f) => blocked(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch { return false; }
}

/** Lock files a crash or a restart can leave behind; Chrome then refuses the profile as "in use". */
function clearStaleLocks(profileDir) {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    try { fs.rmSync(path.join(profileDir, f), { force: true }); } catch { /* not there, or locked by a live Chrome */ }
  }
}

/** One launch attempt. Resolves to the port, or null if Chrome never offered remote control. */
async function startChrome(bin, ws, port, { headless, restore, startUrls }) {
  fs.rmSync(path.join(ws.chromeProfile, 'DevToolsActivePort'), { force: true });
  const logDir = path.join(ws.dir || path.dirname(ws.chromeProfile), 'logs');
  let err = 'ignore';
  try { fs.mkdirSync(logDir, { recursive: true }); err = fs.openSync(path.join(logDir, 'chrome.log'), 'a'); } catch { /* no log, still launch */ }
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${ws.chromeProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
    ...(restore ? ['--restore-last-session'] : []),
    ...startUrls,
  ];
  let exited = false;
  const child = spawn(bin, args, { detached: true, stdio: ['ignore', 'ignore', err] });
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });
  child.unref();
  if (typeof err === 'number') fs.closeSync(err);
  for (let i = 0; i < 50; i++) {
    const p = await ownChromePort(ws);
    if (p) return p;
    // it quit straight away and nothing else is running on the profile: no point waiting
    if (exited && i >= 4 && !profileChromePids(ws.chromeProfile).length) break;
    await sleep(400);
  }
  return null;
}

/**
 * Opens JobPilot's Chrome (once) and returns the port it listens on. Handles
 * what it can by itself: another app on the preferred port (Chrome picks a free
 * one), its own Chrome stuck without remote control (closed and reopened with
 * its tabs), stale profile locks after a crash. Anything it cannot fix throws a
 * ChromeProblem whose message says what to do.
 */
export async function launchChrome(ws, preferredPort, startUrls = [], { headless = false, log = () => {} } = {}) {
  const running = await ownChromePort(ws);
  if (running) return running;
  const bin = findChrome();
  if (!bin) throw new ChromeProblem(CHROME_HELP.notFound);
  fs.mkdirSync(ws.chromeProfile, { recursive: true });
  // JobPilot's Chrome can be open with no remote control: it started while
  // another app held the port, or someone closed its windows but not the app.
  // A new launch would just hand its window to that copy and exit, so close it
  // the normal way (Chrome saves its tabs) and bring the tabs back.
  let restore = false;
  const stuck = profileChromePids(ws.chromeProfile);
  if (stuck.length) {
    log("JobPilot's Chrome was open without remote control, so it is being reopened with its tabs.");
    await quitChrome(stuck);
    if (profileChromePids(ws.chromeProfile).length) throw new ChromeProblem(CHROME_HELP.wontQuit);
    restore = true;
  }
  clearStaleLocks(ws.chromeProfile);
  const ports = [];
  if (preferredPort && await portFree(preferredPort)) ports.push(preferredPort);
  ports.push(0);   // Chrome picks a free port and names it in DevToolsActivePort
  for (const port of ports) {
    const p = await startChrome(bin, ws, port, { headless, restore, startUrls });
    if (p) return p;
    const left = profileChromePids(ws.chromeProfile);   // started, but without remote control
    if (left.length) { await quitChrome(left); restore = true; }
    clearStaleLocks(ws.chromeProfile);
  }
  throw new ChromeProblem(policyBlocksDebugging() ? CHROME_HELP.policy : CHROME_HELP.wontStart);
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
