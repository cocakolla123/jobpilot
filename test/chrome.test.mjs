// JobPilot must only ever attach to its own Chrome. Another app on the debugging
// port (an Electron app, another automation tool) answers /json/version too, and
// attaching to it fails with "Browser context management is not supported".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ensureWorkspace } from '../src/core/config.mjs';
import { attach, launchChrome, ownChromePort } from '../src/core/chrome.mjs';

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
