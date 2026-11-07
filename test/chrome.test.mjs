// JobPilot must only ever attach to its own Chrome. Another app on the debugging
// port (an Electron app, another automation tool) answers /json/version too, and
// attaching to it fails with "Browser context management is not supported".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureWorkspace } from '../src/core/config.mjs';
import { attach, browserGone, ChromeProblem, findChrome, friendlyError, launchChrome, ownChromePort, profileChromePids } from '../src/core/chrome.mjs';
import { Runner } from '../src/runner.mjs';
import { saveSettings } from '../src/core/config.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-chrome-'));

/** A stand in for some other app holding a debugging port. */
function otherApp() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const port = server.address().port;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        Browser: 'Chrome/140.0.0.0',
        'User-Agent': 'Mozilla/5.0 SomeApp/1.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/someone-else`,
      }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('chrome: skips another app on the preferred port and finds its own Chrome again', async () => {
  const ws = ensureWorkspace(tmp());
  const other = await otherApp();
  const taken = other.address().port;
  let session;
  try {
    assert.equal(await ownChromePort(ws), null, 'nothing running yet');
    // a stale file from a crash that happens to point at the other app
    fs.mkdirSync(ws.chromeProfile, { recursive: true });
    fs.writeFileSync(path.join(ws.chromeProfile, 'DevToolsActivePort'), `${taken}\n/devtools/browser/old\n`);
    assert.equal(await ownChromePort(ws), null, 'a port that is not ours is never trusted');

    const port = await launchChrome(ws, taken, [], { headless: true });
    assert.ok(port, 'Chrome started');
    assert.notEqual(port, taken, 'did not attach to the other app');
    assert.equal(await ownChromePort(ws), port);
    assert.equal(await launchChrome(ws, taken, [], { headless: true }), port, 'a second run reuses the same Chrome');

    session = await attach(port);
    const page = await session.newTab();
    await page.setContent('<p id="x">attached</p>');
    assert.equal(await page.textContent('#x'), 'attached');
  } finally {
    if (session) {
      const cdp = await session.browser.newBrowserCDPSession().catch(() => null);
      await cdp?.send('Browser.close').catch(() => {});
    }
    other.close();
  }
});

test('chrome: reopens its own Chrome when it is running without remote control', async () => {
  const ws = ensureWorkspace(tmp());
  fs.mkdirSync(ws.chromeProfile, { recursive: true });
  // JobPilot's Chrome, but started with no debugging port (as when another app held the port)
  const stuck = spawn(findChrome(), ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${ws.chromeProfile}`,
    '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let session;
  try {
    for (let i = 0; i < 40 && !profileChromePids(ws.chromeProfile).length; i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok(profileChromePids(ws.chromeProfile).includes(stuck.pid), 'found the stuck Chrome by its profile');
    assert.equal(await ownChromePort(ws), null, 'it has no port JobPilot can use');

    const logs = [];
    const port = await launchChrome(ws, 0, [], { headless: true, log: (m) => logs.push(m) });
    assert.ok(port, 'a controllable Chrome is running');
    assert.match(logs.join(' '), /reopened/);
    assert.ok(!profileChromePids(ws.chromeProfile).includes(stuck.pid), 'the stuck copy was closed');
    session = await attach(port);
    const page = await session.newTab();
    await page.setContent('<p id="x">ok</p>');
    assert.equal(await page.textContent('#x'), 'ok');
  } finally {
    if (session) {
      const cdp = await session.browser.newBrowserCDPSession().catch(() => null);
      await cdp?.send('Browser.close').catch(() => {});
    }
    try { stuck.kill('SIGKILL'); } catch { /* already closed */ }
  }
});

test('chrome: errors read as plain instructions', () => {
  assert.ok(browserGone(new Error('page.goto: Target page, context or browser has been closed')));
  assert.ok(!browserGone(new Error('Timeout 30000ms exceeded')));
  assert.match(friendlyError(new Error('page.goto: Target page, context or browser has been closed')), /closed while it was working/);
  assert.match(friendlyError(new Error('browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.\nCall log: ...')), /Quit JobPilot's Chrome window/);
  assert.match(friendlyError(new Error('net::ERR_INTERNET_DISCONNECTED at https://www.linkedin.com')), /internet connection/);
  assert.equal(friendlyError(new ChromeProblem('Do this.')), 'Do this.');
  assert.equal(friendlyError(new Error('first line\nsecond line')), 'first line');
});

test('chrome: a lock left by a crash does not block the next launch', async () => {
  const ws = ensureWorkspace(tmp());
  fs.mkdirSync(ws.chromeProfile, { recursive: true });
  // what a crash on another computer name leaves: a lock naming a dead process
  fs.symlinkSync('some-other-mac-99999', path.join(ws.chromeProfile, 'SingletonLock'));
  const port = await launchChrome(ws, 0, [], { headless: true });
  assert.ok(port);
  const session = await attach(port);
  const cdp = await session.browser.newBrowserCDPSession();
  await cdp.send('Browser.close').catch(() => {});
});

test('runner: reopens Chrome when it closes mid step, and stops with an instruction if it keeps closing', async () => {
  process.env.JOBPILOT_HEADLESS = '1';
  const ws = ensureWorkspace(tmp());
  saveSettings(ws, { cdpPort: 0 });
  const r = new Runner(ws);
  r.on('log', () => {});
  const closeChrome = async (s) => { const cdp = await s.browser.newBrowserCDPSession(); await cdp.send('Browser.close').catch(() => {}); };
  try {
    let calls = 0;
    const out = await r.withChrome(async (s) => {
      calls++;
      const page = await s.newTab();
      if (calls === 1) { await closeChrome(s); await page.goto('about:blank'); }
      return 'done';
    });
    assert.equal(out, 'done');
    assert.equal(calls, 2, 'retried once on a fresh Chrome');
    await assert.rejects(r.withChrome(async (s) => { await closeChrome(s); await s.newTab(); }), /keeps closing/);
  } finally {
    // a Chrome that is mid shutdown never answers a new session, so don't wait on it forever
    const settle = (p) => Promise.race([p.catch(() => {}), new Promise((res) => setTimeout(res, 3000))]);
    if (r.session?.browser.isConnected()) await settle(closeChrome(r.session));
    delete process.env.JOBPILOT_HEADLESS;
  }
});
