// Keeping a user's data and job states right: broken files, settings typos,
// the applications sheet, jobs stuck mid application, and the Apply loop's
// rules (reread each job, Retry, never send twice when Chrome dies). The Apply
// tests use a fake Chrome session and a stub site, so no browser is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureWorkspace, readJson, writeJson, cleanSettings, saveSettings } from '../src/core/config.mjs';
import { appendRow, appendRowSafe, ensureSheet, readSheet, submittedToday, dedupIndex, csvField } from '../src/core/sheet.mjs';
import { loadJobs, upsertJob, jobKey } from '../src/core/jobs.mjs';
import { Runner, PLATFORMS, releaseStuckJobs, STUCK_NOTE } from '../src/runner.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-state-'));

test('a JSON file with a typo is copied aside once and never silently lost', () => {
  const dir = tmp();
  const p = path.join(dir, 'profile.json');
  fs.writeFileSync(p, '{"firstName": "Jane",, }');
  assert.deepEqual(readJson(p, {}), {});
  assert.deepEqual(readJson(p, {}), {}, 'reading again does not make another copy');
  const copies = fs.readdirSync(dir).filter((f) => f.startsWith('profile.json.broken-'));
  assert.equal(copies.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, copies[0]), 'utf8'), '{"firstName": "Jane",, }');
  fs.writeFileSync(p, '﻿{"ok": true}');
  assert.deepEqual(readJson(p, {}), { ok: true }, 'a byte order mark from a Windows editor is fine');
  writeJson(p, { a: 1 });
  assert.deepEqual(readJson(p, {}), { a: 1 });
});

test('settings typos are kept in range instead of crashing a run', () => {
  const s = cleanSettings({ pauseSeconds: 8, maxOpenTabs: 0, cdpPort: 80, dailyCaps: { linkedin: 'lots' }, sites: ['indeed', 'myspace'], submit: 'true' });
  assert.deepEqual(s.pauseSeconds, [8, 8]);
  assert.equal(s.maxOpenTabs, 1);
  assert.equal(s.cdpPort, 9222);
  assert.equal(s.dailyCaps.linkedin, 25);
  assert.deepEqual(s.sites, ['indeed']);
  assert.equal(s.submit, true);
  assert.deepEqual(cleanSettings({}).sites, ['linkedin', 'handshake', 'indeed']);
});

test('the applications sheet: Excel byte order mark, formulas, local dates, sent vs filled', () => {
  const dir = tmp();
  const p = path.join(dir, 'applications.csv');
  fs.writeFileSync(p, '﻿timestamp,source,job_id,title,company,status\n');   // as Excel saves "CSV UTF-8"
  const now = new Date();
  appendRow(p, { timestamp: now.toISOString(), source: 'linkedin', title: '=HYPERLINK("x")', company: 'Acme', status: 'submitted' });
  appendRow(p, { timestamp: now.toISOString(), source: 'linkedin', title: 'Dev', company: 'Beta', status: 'filled_not_submitted' });
  const rows = readSheet(p);
  assert.ok(rows[0].timestamp, 'timestamp is written even with a byte order mark in the header');
  assert.equal(rows[0].title, `'=HYPERLINK("x")`, 'a formula is stored as text');
  assert.equal(submittedToday(rows, 'linkedin', now), 1);
  const d = dedupIndex(rows);
  assert.ok(d.isDone({ company: 'Beta', title: 'Dev' }) && !d.isSent({ company: 'Beta', title: 'Dev' }));
  assert.ok(d.isSent({ company: 'Acme', title: `'=HYPERLINK("x")` }));
  assert.equal(csvField('-5'), "'-5");
});

test('a locked sheet keeps the row and adds it later', () => {
  const dir = tmp();
  const p = path.join(dir, 'applications.csv');
  const pending = path.join(dir, '.cache', 'pending-rows.json');
  ensureSheet(p);
  fs.chmodSync(p, 0o444);
  const first = appendRowSafe(p, pending, { title: 'A', status: 'submitted' });
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    assert.equal(first.ok, false);
    assert.equal(readJson(pending, []).length, 1);
  }
  fs.chmodSync(p, 0o644);
  assert.equal(appendRowSafe(p, pending, { title: 'B', status: 'submitted' }).ok, true);
  assert.deepEqual(readSheet(p).map((r) => r.title), ['A', 'B']);
  assert.ok(!fs.existsSync(pending));
});

test('jobs left in "applying" by a crash wait for the user instead of being stuck', () => {
  const ws = ensureWorkspace(tmp());
  upsertJob(ws, { source: 'linkedin', jobId: '1', title: 'A', company: 'X', status: 'applying' });
  upsertJob(ws, { source: 'linkedin', jobId: '2', title: 'B', company: 'X', status: 'saved' });
  assert.equal(releaseStuckJobs(ws), 1);
  const [a, b] = loadJobs(ws);
  assert.equal(a.status, 'error');
  assert.equal(a.note, STUCK_NOTE);
  assert.equal(b.status, 'saved');
});

test('only one run at a time per workspace, even from another window', async () => {
  const ws = ensureWorkspace(tmp());
  const r = new Runner(ws);
  r.on('log', () => {});
  writeJson(path.join(ws.dir, '.jobpilot.lock'), { pid: process.ppid, task: 'apply' });   // another live JobPilot
  await assert.rejects(r.run('search', async () => 'ran'), /already running apply in another window/);
  fs.rmSync(path.join(ws.dir, '.jobpilot.lock'));
  assert.equal(await r.run('search', async () => 'ran'), 'ran');
  assert.ok(!fs.existsSync(path.join(ws.dir, '.jobpilot.lock')), 'the lock is released');
});

// ---- the Apply loop with a fake Chrome and a stub LinkedIn ----
function applyRig(jobs, applyFn) {
  const ws = ensureWorkspace(tmp());
  fs.writeFileSync(path.join(ws.resumes, 'Jane_Doe_Resume_SWE.txt'), 'Software engineer. Java, Python, React, SQL.');
  saveSettings(ws, { pauseSeconds: [0, 0], autoSyncResumes: false, submit: true });
  for (const j of jobs) upsertJob(ws, { source: 'linkedin', company: 'Acme', status: 'saved', url: `https://example.com/${j.jobId}`, ...j });
  const r = new Runner(ws);
  const logs = [];
  r.on('log', (e) => logs.push(e));
  const page = () => ({ isClosed: () => false, close: async () => {}, bringToFront: async () => {}, goto: async () => {} });
  r.connect = async () => ({ newTab: async () => page(), workTab: async () => page(), closeWorkTabs: async () => {}, browser: { isConnected: () => true } });
  const real = PLATFORMS.linkedin;
  PLATFORMS.linkedin = { ...real, apply: (tab, job, ctx) => applyFn(job, ws, ctx) };
  const restore = () => { PLATFORMS.linkedin = real; };
  return { ws, r, logs, restore };
}

test('apply: a job skipped or removed during the run is left alone', async () => {
  const applied = [];
  const { ws, r, restore } = applyRig([{ jobId: '1', title: 'One', score: 3 }, { jobId: '2', title: 'Two', score: 2 }, { jobId: '3', title: 'Three', score: 1 }], (job, w) => {
    applied.push(job.jobId);
    if (job.jobId === '1') {
      // while job 1 is being applied, the user skips job 2 and removes job 3 in the dashboard
      const list = loadJobs(w).map((j) => (j.jobId === '2' ? { ...j, status: 'skipped' } : j)).filter((j) => j.jobId !== '3');
      writeJson(w.jobs, list);
    }
    return { status: 'submitted', note: 'confirmed' };
  });
  try {
    await r.applySaved({ limit: 10 });
    assert.deepEqual(applied, ['1']);
    assert.equal(loadJobs(ws).find((j) => j.jobId === '2').status, 'skipped');
  } finally { restore(); }
});

test('apply: Retry really retries a job that was only filled in, never one that was sent', async () => {
  const applied = [];
  const { ws, r, restore } = applyRig([
    { jobId: '1', title: 'Filled', company: 'Acme', retry: true },
    { jobId: '2', title: 'Sent', company: 'Beta', retry: true },
    { jobId: '3', title: 'Filled no retry', company: 'Gamma' },
  ], (job) => { applied.push(job.jobId); return { status: 'submitted' }; });
  ensureSheet(ws.sheet);
  appendRow(ws.sheet, { timestamp: new Date().toISOString(), source: 'linkedin', job_id: '1', title: 'Filled', company: 'Acme', status: 'filled_not_submitted' });
  appendRow(ws.sheet, { timestamp: new Date().toISOString(), source: 'linkedin', job_id: '2', title: 'Sent', company: 'Beta', status: 'submitted' });
  appendRow(ws.sheet, { timestamp: new Date().toISOString(), source: 'linkedin', job_id: '3', title: 'Filled no retry', company: 'Gamma', status: 'filled_not_submitted' });
  try {
    await r.applySaved({ limit: 10 });
    assert.deepEqual(applied, ['1']);
    const by = Object.fromEntries(loadJobs(ws).map((j) => [j.jobId, j]));
    assert.equal(by['1'].status, 'submitted');
    assert.equal(by['1'].retry, false);
    assert.equal(by['2'].status, 'duplicate');
    assert.equal(by['3'].status, 'duplicate');
  } finally { restore(); }
});

test('apply: if Chrome dies mid application the job is not sent again, and a second death stops the run', async () => {
  const applied = [];
  const { ws, r, logs, restore } = applyRig([{ jobId: '1', title: 'One', score: 3 }, { jobId: '2', title: 'Two', score: 2 }, { jobId: '3', title: 'Three', score: 1 }], (job) => {
    applied.push(job.jobId);
    throw new Error('locator.click: Target page, context or browser has been closed');
  });
  try {
    await assert.rejects(r.applySaved({ limit: 10 }), /keeps closing/);
    assert.deepEqual(applied, ['1', '2'], 'each job tried once, never retried');
    const by = Object.fromEntries(loadJobs(ws).map((j) => [j.jobId, j]));
    assert.equal(by['1'].status, 'error');
    assert.match(by['1'].note, /Check the site to see if it was sent/);
    assert.equal(by['3'].status, 'saved', 'the job after the stop is untouched');
    assert.ok(!loadJobs(ws).some((j) => j.status === 'applying'));
    assert.ok(logs.some((l) => /Apply stopped: JobPilot's Chrome keeps closing/.test(l.msg)));
  } finally { restore(); }
});

test('apply: log lines name the job and use plain status words', async () => {
  const { r, logs, restore } = applyRig([{ jobId: '1', title: 'One' }], () => ({ status: 'filled_not_submitted', keepTab: true }));
  try {
    await r.applySaved({ limit: 10 });
    const line = logs.find((l) => l.job === 'linkedin:1');
    assert.ok(line, 'the job line carries its key');
    assert.match(line.msg, /One at Acme: filled in, waiting for you to send/);
    assert.equal(r.waitingTabs().size, 1, 'its tab is tracked by job');
    assert.equal(await r.showTab('linkedin:1'), true);
    await r.closeTabFor('linkedin:1');
    assert.equal(r.waitingTabs().size, 0);
  } finally { restore(); }
});

// ---- dashboard routes on a real server (no Chrome) ----
test('dashboard routes: Retry, I submitted it, answering a question, stuck jobs at start', async () => {
  const { startServer } = await import('../src/server.mjs');
  const { queueUnknowns, readQueue } = await import('../src/core/review.mjs');
  const ws = ensureWorkspace(tmp());
  upsertJob(ws, { source: 'linkedin', jobId: '1', title: 'Filled', company: 'Acme', url: 'https://example.com/1', status: 'filled_not_submitted', tabOpen: true });
  upsertJob(ws, { source: 'linkedin', jobId: '2', title: 'Company site', company: 'Beta', url: 'https://example.com/2', status: 'external_manual' });
  upsertJob(ws, { source: 'linkedin', jobId: '3', title: 'Asked', company: 'Gamma', url: 'https://example.com/3', status: 'needs_answer' });
  upsertJob(ws, { source: 'linkedin', jobId: '4', title: 'Skipped since', company: 'Delta', url: 'https://example.com/4', status: 'skipped' });
  upsertJob(ws, { source: 'linkedin', jobId: '5', title: 'Crashed', company: 'Eps', url: 'https://example.com/5', status: 'applying' });
  queueUnknowns(ws, { key: 'linkedin:3', title: 'Asked', company: 'Gamma' }, [{ question: 'Favorite color?' }], 'linkedin');
  queueUnknowns(ws, { key: 'linkedin:4', title: 'Skipped since', company: 'Delta' }, [{ question: 'Favorite color?' }], 'linkedin');
  const { server, url } = await startServer(ws, { port: 0 });
  const call = async (route, body) => {
    const r = await fetch(url + route.replace(/^\//, ''), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JobPilot': '1' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try {
    const by = () => Object.fromEntries(loadJobs(ws).map((j) => [j.jobId, j]));
    assert.equal(by()['5'].status, 'error', 'a job caught mid application at startup waits for the user');
    assert.equal(by()['1'].tabOpen, false, 'no tab from before a restart is open');

    let r = await call('/api/jobs/update', { key: 'linkedin:1', patch: { status: 'saved' } });
    assert.equal(r.body.retry, true, 'Retry marks the job for a real retry');

    r = await call('/api/jobs/update', { key: 'linkedin:2', patch: { status: 'submitted' } });
    assert.equal(r.body.status, 'submitted');
    const rows = readSheet(ws.sheet);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'submitted');

    const q = readQueue(ws)[0];
    r = await call('/api/review/answer', { id: q.id, answer: 'Blue' });
    assert.equal(r.status, 200);
    assert.equal(by()['3'].status, 'saved', 'the job waiting on that question goes back on the list');
    assert.equal(by()['4'].status, 'skipped', 'a job skipped meanwhile stays skipped');

    r = await call('/api/jobs/update', { key: 'linkedin:nope', patch: { status: 'saved' } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no longer on the list/);
    r = await call('/api/jobs/show-tab', { key: 'linkedin:1' });
    assert.equal(r.body.shown, false);
  } finally {
    server.close();
  }
});
