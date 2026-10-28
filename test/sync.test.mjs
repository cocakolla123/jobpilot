// Resume sync: dated names, the sync record, and the upload flows on
// practice copies of each site's resume page. Requests to the real sites are
// answered with the local fixture pages, and everything else is blocked, so
// nothing is ever sent to LinkedIn, Handshake or Indeed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../src/core/chrome.mjs';
import { ensureWorkspace } from '../src/core/config.mjs';
import { datedName, baseKey, nameDate, stamp, datedCopy, docFor, resumeState, recordUpload, loadSync } from '../src/core/resumeSync.mjs';
import * as linkedin from '../src/platforms/linkedin.mjs';
import * as handshake from '../src/platforms/handshake.mjs';
import * as indeed from '../src/platforms/indeed.mjs';

const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-sync-'));
let browser, ws, pdf;

before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
  ws = ensureWorkspace(tmp());
  pdf = path.join(ws.resumes, 'Jane_Doe_Resume_SWE.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n% swe v1\n');
});
after(async () => { await browser?.close(); });

/** A page where real site URLs are answered with local fixtures; [prefix, fixture] pairs, longest prefix first. */
async function sitePage(...pairs) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    const hit = pairs.find(([prefix]) => u.startsWith(prefix));
    if (hit) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(FIX, hit[1])) });
    return route.abort();
  });
  return ctx.newPage();
}

test('dated names and base keys', () => {
  const d = new Date(2026, 9, 28, 9, 5);
  assert.equal(stamp(d), '2026-10-28_0905');
  assert.equal(datedName('Jane_Doe_Resume_SWE.pdf', d), 'Jane_Doe_Resume_SWE_2026-10-28_0905.pdf');
  assert.equal(datedName('Jane_Doe_Resume_SWE_2026-10-01_1200.pdf', d), 'Jane_Doe_Resume_SWE_2026-10-28_0905.pdf', 'no double dates');
  assert.equal(baseKey('Jane_Doe_Resume_SWE_2026-10-28_0905.pdf'), baseKey('Jane_Doe_Resume_SWE.pdf'));
  assert.equal(baseKey('Transcript (2).pdf'), baseKey('Transcript.pdf'));
  assert.ok(nameDate('X_2026-10-28_0905.pdf') > nameDate('X_2026-10-01_1200.pdf'));
});

test('sync record: current until the file changes, then the plain file is used', () => {
  const w = ensureWorkspace(tmp());
  const f = path.join(w.resumes, 'R_Backend.pdf');
  fs.writeFileSync(f, 'v1');
  const r = { file: 'R_Backend.pdf', path: f };
  assert.equal(resumeState(loadSync(w), 'linkedin', r).state, 'missing');
  recordUpload(w, 'linkedin', r, 'R_Backend_2026-10-28_0905.pdf');
  assert.equal(resumeState(loadSync(w), 'linkedin', r, ['R_Backend_2026-10-28_0905.pdf']).state, 'current');
  assert.equal(resumeState(loadSync(w), 'linkedin', r, ['R_Backend.pdf']).state, 'missing', 'gone from the site');
  const d = docFor(w, 'linkedin', r);
  assert.equal(d.name, 'R_Backend_2026-10-28_0905.pdf');
  assert.equal(fs.readFileSync(d.path, 'utf8'), 'v1', 'dated copy has the same content');
  fs.writeFileSync(f, 'v2');
  assert.equal(resumeState(loadSync(w), 'linkedin', r).state, 'outdated');
  assert.equal(docFor(w, 'linkedin', r).name, 'R_Backend.pdf');
});

test('LinkedIn: reads every resume (including "+N more") and uploads a dated copy', async () => {
  const page = await sitePage([linkedin.RESUMES_URL, 'linkedin-resumes.html']);
  const names = await linkedin.siteResumes(page);
  assert.deepEqual(names, ['Jane_Doe_Resume_FDE.pdf', 'Jane_Doe_Resume_AI.pdf', 'Jane_Doe_Resume_SWE.pdf', 'Old_Resume_A.pdf', 'Old_Resume_B.pdf']);
  const name = datedName('Jane_Doe_Resume_SWE.pdf');
  const res = await linkedin.uploadResume(page, datedCopy(ws, pdf, name));
  assert.equal(res.ok, true, res.note);
  assert.ok((await linkedin.siteResumes(page)).includes(name));
  await page.context().close();
});

test('Handshake: reads all pages newest first, uploads with the right category', async () => {
  const page = await sitePage([`${handshake.DOCS_URL}/new`, 'handshake-docs-new.html'], [handshake.DOCS_URL, 'handshake-docs.html']);
  const docs = await handshake.siteDocuments(page);
  assert.equal(docs.length, 30, 'all 30, not just the first page of 25');
  assert.ok(docs.some((d) => d.name === 'FDE_Main'), 'names without .pdf count too');
  assert.ok(docs[0].time >= docs[1].time && docs[1].time >= docs[29].time, 'newest first');
  assert.equal(docs.find((d) => /transcript/i.test(d.category)).name, 'Transcript 2.pdf (1)', 'newest transcript');
  const name = datedName('Jane_Doe_Resume_SWE.pdf');
  const res = await handshake.uploadDocument(page, datedCopy(ws, pdf, name), 'Resume');
  assert.equal(res.ok, true, res.note);
  assert.equal(res.category, 'Resume');
  const t = await handshake.uploadDocument(page, datedCopy(ws, pdf, 'Transcript_2026-10-28_0900.pdf'), 'Transcript');
  assert.equal(t.ok, true, t.note);
  assert.equal(t.category, 'Transcript', 'Document Type was switched');
  const added = await page.evaluate(() => JSON.parse(sessionStorage.getItem('added')));
  assert.ok(added.every((d) => d.pub === false), 'never made visible to employers');
  await page.context().close();
});

test('Indeed: finds the one uploaded file and swaps it with Replace file', async () => {
  const page = await sitePage([indeed.PROFILE_URL, 'indeed-profile.html']);
  assert.equal(await indeed.currentFile(page), 'Jane_Doe_Resume_FDE.pdf');
  const name = datedName('Jane_Doe_Resume_SWE.pdf');
  const res = await indeed.replaceResume(page, datedCopy(ws, pdf, name));
  assert.equal(res.ok, true, res.note);
  assert.equal(await indeed.currentFile(page), name);
  assert.equal((await indeed.replaceResume(page, datedCopy(ws, pdf, name))).note, 'already on Indeed');
  await page.context().close();
});
