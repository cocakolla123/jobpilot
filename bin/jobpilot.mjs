#!/usr/bin/env node
// JobPilot command line.
//   jobpilot                 start the dashboard (same as `jobpilot start`)
//   jobpilot chrome          open JobPilot's Chrome window to sign in
//   jobpilot search          run your saved searches without the dashboard
//   jobpilot apply           apply to saved jobs without the dashboard
//   jobpilot check           check sign-ins and resume names on each site
//   jobpilot sync            upload your resumes to each site under dated names
// Options: --workspace <folder>   --port <n>   --no-open
import { spawn } from 'node:child_process';
import { ensureWorkspace, defaultWorkspaceDir, loadSettings } from '../src/core/config.mjs';
import { launchChrome } from '../src/core/chrome.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const VALUE_FLAGS = new Set(['--workspace', '--port', '--limit']);
const cmd = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) || 'start';
const ws = ensureWorkspace(flag('workspace', defaultWorkspaceDir()));

function openInBrowser(url) {
  const c = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(c[0], c[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* print the URL instead */ }
}

async function cli(task) {
  const { Runner } = await import('../src/runner.mjs');
  const r = new Runner(ws);
  r.on('log', (e) => console.log(`${e.ts.slice(11, 19)} ${e.level === 'info' ? '' : `[${e.level}] `}${e.msg}`));
  process.on('SIGINT', () => r.stop());
  try {
    const out = task === 'search' ? await r.searchAndSave() : task === 'apply' ? await r.applySaved({ limit: Number(flag('limit', 25)) })
      : task === 'sync' ? await r.syncResumes() : await r.checkAccounts();
    console.log(`\n${out.summary}`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  await r.session?.detach();
}

if (cmd === 'chrome') {
  const ok = await launchChrome(ws, loadSettings(ws).cdpPort, ['https://www.linkedin.com/login', 'https://app.joinhandshake.com/login', 'https://secure.indeed.com/auth']);
  console.log(ok ? 'JobPilot Chrome is open. Sign in to LinkedIn, Handshake and Indeed there once; it remembers you.' : 'Chrome did not start.');
} else if (['search', 'apply', 'check', 'sync'].includes(cmd)) {
  await cli(cmd);
} else {
  const { startServer } = await import('../src/server.mjs');
  const port = Number(flag('port', process.env.JOBPILOT_PORT || 4123));
  try {
    const { url } = await startServer(ws, { port });
    console.log(`\nJobPilot is running at ${url}`);
    console.log(`Workspace: ${ws.dir}`);
    console.log('Leave this window open while you use the dashboard. Press Ctrl+C to quit.\n');
    if (!args.includes('--no-open')) openInBrowser(url);
  } catch (e) {
    if (e.code === 'EADDRINUSE') { console.log(`Something is already using port ${port}. JobPilot may already be running at http://127.0.0.1:${port}/`); openInBrowser(`http://127.0.0.1:${port}/`); }
    else throw e;
  }
}
