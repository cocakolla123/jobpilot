// Browser tests on local fixture pages, run in your installed Chrome with no
// window (the same browser JobPilot drives). They never touch a real job site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { findChrome } from '../src/core/chrome.mjs';
import { ensureWorkspace, writeJson } from '../src/core/config.mjs';
import { loadAnswerBank } from '../src/core/answers.mjs';
import { fillAll, attachFiles, dedupeUnknowns } from '../src/core/forms.mjs';
import * as linkedin from '../src/platforms/linkedin.mjs';
import { pdfText } from '../src/core/resumes.mjs';
import { buildMatcher } from '../src/core/matcher.mjs';

const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
let server, base, browser, ws, bank, resumePdf;

before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.startsWith('/jobs/view/') ? 'linkedin-easy-apply.html' : req.url.replace(/^\//, '').split('?')[0];
    const f = path.join(FIX, name);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
  ws = ensureWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-forms-')));
  writeJson(ws.profile, {
    firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '555-0100', city: 'Austin', state: 'TX',
    linkedin: 'https://linkedin.com/in/jane', workAuthorized: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes',
    skills: [{ name: 'React', years: 3 }],
  });
  bank = loadAnswerBank(ws);
  resumePdf = path.join(ws.resumes, 'Jane_Resume.pdf');
  fs.writeFileSync(resumePdf, '%PDF-1.4\n% test\n');
});

after(async () => { await browser?.close(); server?.close(); });

test('Greenhouse-style form: text, selects, radios, consent, resume upload, unknowns', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/greenhouse-like.html`);
  const root = page.locator('form');
  const done = await attachFiles(root, { resume: resumePdf });
  assert.deepEqual(done, ['resume']);
  const unknowns = [];
  await fillAll(page, root, bank, unknowns);
  const v = await page.evaluate(() => Object.fromEntries([...new FormData(document.querySelector('form'))].filter(([, x]) => typeof x === 'string')));
  assert.equal(v.first_name, 'Jane');
  assert.equal(v.last_name, 'Doe');
  assert.equal(v.email, 'jane@example.com');
  assert.equal(v.phone, '555-0100');
  assert.equal(v.linkedin, 'https://linkedin.com/in/jane');
  assert.equal(v.authorized, 'yes');
  assert.equal(v.gender, 'decline');
  assert.equal(v.sponsorship, 'no');
  assert.equal(v.consent, 'on');
  assert.equal(await page.locator('input[type=file]').evaluate((el) => el.files.length), 1);
  const q = dedupeUnknowns(unknowns).map((u) => u.question);
  assert.ok(q.some((x) => /why do you want to work here/i.test(x)), `unknown question queued (${q.join(' | ')})`);
  await page.close();
});

test('Ashby-style Yes/No buttons register a real click', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/ashby-like.html`);
  const unknowns = [];
  await fillAll(page, page.locator('form'), bank, unknowns);
  assert.equal(await page.locator('button[aria-pressed="true"]').innerText(), 'Yes');
  assert.equal(await page.evaluate(() => window.__relocate), 'Yes');
  await page.close();
});

test('LinkedIn Easy Apply flow: steps, skill years, submit', async () => {
  const page = await browser.newPage();
  const job = { source: 'linkedin', jobId: '4100000123', url: `${base}/jobs/view/4100000123/`, title: 'Frontend Engineer', company: 'Acme' };
  await page.goto(job.url);
  const res = await linkedin.apply(page, job, { bank, submit: true, docs: { resume: resumePdf }, resumeFile: 'Jane_Resume.pdf' });
  assert.equal(res.status, 'submitted', res.note);
  const sent = await page.evaluate(() => window.__sent);
  assert.equal(sent.phone, '555-0100');
  assert.equal(sent.resume, 'Jane_Resume.pdf', 'picked the matched resume, not the preselected one');
  assert.equal(sent.years, '3', 'years from profile skills');
  assert.equal(sent.k8s, 'No', 'skill not in profile');
  assert.equal(sent.follow, false, 'unticked "follow company"');
  await page.close();
});

test('LinkedIn Easy Apply stops on an unknown question and reports it', async () => {
  const page = await browser.newPage();
  const job = { source: 'linkedin', jobId: '4100000124', url: `${base}/jobs/view/4100000124/?unknown=1`, title: 'Frontend Engineer', company: 'Acme' };
  await page.goto(job.url);
  const res = await linkedin.apply(page, job, { bank, submit: true, docs: { resume: resumePdf }, resumeFile: 'Jane_Resume.pdf' });
  assert.equal(res.status, 'needs_answer');
  assert.equal(res.keepTab, true, 'unsure, so the tab stays open');
  assert.ok(res.unknowns.some((u) => /favorite framework/i.test(u.question)));
  assert.equal(await page.getByRole('dialog').isVisible(), true, 'the Easy Apply window is left open for you');
  assert.equal(await page.evaluate(() => window.__sent), null, 'nothing was sent');
  await page.close();
});

test('submit off: fills every step but never sends', async () => {
  const page = await browser.newPage();
  const job = { source: 'linkedin', jobId: '4100000125', url: `${base}/jobs/view/4100000125/`, title: 'Frontend Engineer', company: 'Acme' };
  await page.goto(job.url);
  const res = await linkedin.apply(page, job, { bank, submit: false, docs: { resume: resumePdf }, resumeFile: 'Jane_Resume.pdf' });
  assert.equal(res.status, 'filled_not_submitted');
  assert.equal(res.keepTab, true);
  assert.equal(await page.getByRole('button', { name: /submit application/i }).isVisible(), true, 'stopped on the Submit step');
  assert.equal(await page.evaluate(() => window.__sent), null);
  await page.close();
});

// a stand-in for the AI so the tests never call the API
const fakeDraft = (calls) => async (question, { maxChars }) => { calls.push({ question, maxChars }); return 'I like React because the component model keeps UI code small.'; };

test('AI answer, review mode: drafted, left open at Submit, not sent', async () => {
  const page = await browser.newPage();
  const job = { source: 'linkedin', jobId: '4100000126', url: `${base}/jobs/view/4100000126/?unknown=1`, title: 'Frontend Engineer', company: 'Acme' };
  await page.goto(job.url);
  const calls = [];
  const res = await linkedin.apply(page, job, { bank, submit: true, aiAutoSubmit: false, draft: fakeDraft(calls), docs: { resume: resumePdf }, resumeFile: 'Jane_Resume.pdf' });
  assert.equal(res.status, 'needs_review', res.note);
  assert.equal(res.keepTab, true);
  assert.equal(calls.length, 1, 'only the open-ended question went to AI');
  assert.match(calls[0].question, /favorite framework/i);
  assert.equal(res.drafted[0].answer, 'I like React because the component model keeps UI code small.');
  assert.equal(await page.getByRole('button', { name: /submit application/i }).isVisible(), true);
  assert.equal(await page.evaluate(() => window.__sent), null);
  await page.close();
});

test('AI answer, auto submit: sends with the drafted text', async () => {
  const page = await browser.newPage();
  const job = { source: 'linkedin', jobId: '4100000127', url: `${base}/jobs/view/4100000127/?unknown=1`, title: 'Frontend Engineer', company: 'Acme' };
  await page.goto(job.url);
  const res = await linkedin.apply(page, job, { bank, submit: true, aiAutoSubmit: true, draft: fakeDraft([]), docs: { resume: resumePdf }, resumeFile: 'Jane_Resume.pdf' });
  assert.equal(res.status, 'submitted', res.note);
  assert.notEqual(res.keepTab, true, 'confirmed, so the tab can close');
  const sent = await page.evaluate(() => window.__sent);
  assert.equal(sent.fav, 'I like React because the component model keeps UI code small.');
  assert.equal(sent.years, '3', 'numbers still come from your profile, not AI');
  await page.close();
});

test('AI only touches open-ended fields on a company form', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/greenhouse-like.html`);
  const calls = [], drafted = [], unknowns = [];
  await fillAll(page, page.locator('form'), bank, unknowns, { draft: fakeDraft(calls), drafted });
  assert.deepEqual(calls.map((c) => c.question), ['Why do you want to work here? *']);
  assert.equal(await page.locator('#why').inputValue(), 'I like React because the component model keeps UI code small.');
  assert.equal(await page.locator('#first_name').inputValue(), 'Jane');
  assert.equal(dedupeUnknowns(unknowns).length, 0, (unknowns.map((u) => u.question).join(' | ')));
  await page.close();
});

test('PDF resumes: text comes out of a real PDF and drives the match', async () => {
  const page = await browser.newPage();
  const mk = async (body) => { await page.setContent(`<html><body style="font-family:Arial">${body}</body></html>`); return page.pdf({ format: 'Letter' }); };
  const fe = await mk('<h1>Jane Doe</h1><p>Frontend engineer. React, TypeScript, Next.js, CSS, accessibility, design systems.</p>');
  const be = await mk('<h1>Jane Doe</h1><p>Backend engineer. Go, PostgreSQL, Kafka, distributed systems, gRPC, Kubernetes.</p>');
  await page.close();
  const feText = await pdfText(fe);
  assert.match(feText, /React, TypeScript/);
  const match = buildMatcher([
    { file: 'Jane_A.pdf', name: 'Jane_A', text: feText },
    { file: 'Jane_B.pdf', name: 'Jane_B', text: await pdfText(be) },
  ]);
  const r = match({ title: 'Software Engineer', description: 'We use React and TypeScript with Next.js to build our design system.' });
  assert.equal(r.resume.file, 'Jane_A.pdf', r.why);
  const r2 = match({ title: 'Software Engineer', description: 'Own Kafka pipelines and PostgreSQL in a distributed systems team on Kubernetes.' });
  assert.equal(r2.resume.file, 'Jane_B.pdf', r2.why);
});
