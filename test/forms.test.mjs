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
import { fillAll, attachFiles, dedupeUnknowns, fillCheckboxes } from '../src/core/forms.mjs';
import * as linkedin from '../src/platforms/linkedin.mjs';
import * as ats from '../src/platforms/ats.mjs';
import * as handshake from '../src/platforms/handshake.mjs';
import { pdfText } from '../src/core/resumes.mjs';
import { buildMatcher } from '../src/core/matcher.mjs';

const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
let server, base, browser, ws, bank, resumePdf;

before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.startsWith('/jobs/view/') ? 'linkedin-easy-apply.html' : req.url.startsWith('/job-search/') ? 'handshake-apply.html' : req.url.replace(/^\//, '').split('?')[0];
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

test('Submit off: a plain "Current location" box is never sent with Enter', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/lever-like.html`);
  const unknowns = [];
  await fillAll(page, page.locator('form'), bank, unknowns);
  assert.equal(await page.evaluate(() => window.__submits), 0, 'filling never submitted the form');
  assert.equal(await page.locator('input[name=location]').inputValue(), 'Austin, TX', 'full answer typed, no suggestion list needed');
  assert.equal(await page.locator('input[name=name]').inputValue(), 'Jane Doe');
  await page.close();
});

test('essay questions never get a profile fact, and AI is asked instead', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/lever-like.html`);
  const unknowns = [];
  await fillAll(page, page.locator('form'), bank, unknowns);
  // "excellent" holds "cell" and "major challenge" holds "major": neither is a phone or major question
  assert.equal(await page.locator('textarea[name=project]').inputValue(), '', 'no phone number typed into an essay');
  assert.equal(await page.locator('textarea[name=challenge]').inputValue(), '');
  const essays = dedupeUnknowns(unknowns).filter((u) => u.essay).map((u) => u.question);
  assert.ok(essays.some((q) => /excellent project/.test(q)) && essays.some((q) => /major challenge/.test(q)), essays.join(' | '));

  await page.reload();
  const calls = [], drafted = [];
  await fillAll(page, page.locator('form'), bank, [], { draft: fakeDraft(calls), drafted });
  assert.deepEqual(calls.map((c) => c.question).sort(), ['Tell us about an excellent project you built', 'What was a major challenge you faced and how did you overcome it?']);
  assert.equal(await page.locator('textarea[name=project]').inputValue(), 'I like React because the component model keeps UI code small.');
  assert.equal(await page.evaluate(() => window.__submits), 0);
  await page.close();
});

test('radio groups without a fieldset: grouped by name, question read from the text before them', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/radios-loose.html`);
  const unknowns = [];
  await fillAll(page, page.locator('form'), bank, unknowns);
  const v = await page.evaluate(() => ({
    auth: document.querySelector('input[name=auth]:checked')?.value || null,
    sp: document.querySelector('input[name=sp]:checked')?.value || null,
    relocate: [...document.querySelectorAll('input[type=radio]:not([name])')].filter((r) => r.checked).map((r) => r.value),
  }));
  assert.equal(v.auth, 'yes');
  assert.equal(v.sp, 'wont', 'No sponsorship picks "I will not require", never "I will require"');
  assert.deepEqual(v.relocate, ['Yes']);
  const q = dedupeUnknowns(unknowns);
  assert.deepEqual(q.map((u) => u.question), ['What is your favorite color?'], 'options are never queued as questions');
  assert.deepEqual(q[0].options, ['Blue', 'Red']);
  await page.close();
});

test('consent boxes that state a fact follow the profile, even with the old starter answers', async () => {
  const ws2 = ensureWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-forms-')));
  writeJson(ws2.profile, { firstName: 'Jane', workAuthorized: 'No', needsSponsorship: 'Yes', over18: 'Yes' });
  // the pattern every workspace got before this fix
  writeJson(ws2.answers, [{ q: 'Consent', pattern: '^i (have read|agree|acknowledge|consent|certify|understand|confirm|attest)|privacy (policy|notice)|terms (of|and) (use|service|conditions)', answer: 'Yes', type: 'check' }]);
  const page = await browser.newPage();
  await page.goto(`${base}/consent.html`);
  const unknowns = [];
  await fillCheckboxes(page.locator('form'), loadAnswerBank(ws2), unknowns);
  const ticked = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input[type=checkbox]')].map((c) => [c.name, c.checked])));
  assert.deepEqual(ticked, { privacy: true, auth: false, spon: false, sms: false, age: true });
  const q = unknowns.map((u) => u.question);
  assert.ok(q.some((x) => /legally authorized/.test(x)), 'work authorization box goes to Questions');
  assert.ok(q.some((x) => /will not require visa sponsorship/.test(x)), 'a negated statement goes to Questions');
  assert.ok(!q.some((x) => /marketing/.test(x)), 'an optional marketing box is just left alone');
  await page.close();
});

test('company form: Submit counts only a confirmation that newly appears', async () => {
  const fixture = fs.readFileSync(path.join(FIX, 'ats-confirm.html'));
  const run = async (mode) => {
    const page = await browser.newPage();
    // the "site" is the local fixture: nothing leaves the machine
    await page.route('https://boards.greenhouse.io/**', (r) => r.fulfill({ contentType: 'text/html', body: fixture }));
    const job = { url: `https://boards.greenhouse.io/acme/jobs/1?mode=${mode}`, title: 'Software Engineer Intern', company: 'Acme' };
    const res = await ats.apply(page, job, { bank, submit: true, docs: { resume: resumePdf }, confirmTimeout: 1000 });
    const clicks = await page.evaluate(() => window.__clicks);
    await page.close();
    return { res, clicks };
  };
  const [ok, silent, errors] = await Promise.all([run('ok'), run('silent'), run('errors')]);
  assert.equal(ok.res.status, 'submitted', ok.res.note);
  assert.equal(ok.res.resumeUsed, 'Jane_Resume.pdf');
  // "Thank you for your interest" was in the posting before the click
  assert.equal(silent.res.status, 'needs_review', 'never "submitted" without a confirmation');
  assert.equal(silent.res.keepTab, true);
  assert.equal(silent.res.note, 'clicked Submit but did not see a confirmation; check the tab');
  assert.ok(silent.clicks >= 1);
  assert.equal(errors.res.status, 'needs_answer');
  assert.deepEqual(errors.res.unknowns.map((u) => u.question), ['Phone'], 'the flagged field, not "This field is required."');
});

test('LinkedIn resume: the exact file is picked and read back, or the window is left for you', async () => {
  const run = async (id, query) => {
    const page = await browser.newPage();
    const job = { source: 'linkedin', jobId: id, url: `${base}/jobs/view/${id}/?${query}`, title: 'Frontend Engineer', company: 'Acme' };
    await page.goto(job.url);
    const res = await linkedin.apply(page, job, { bank, submit: true, docs: { resume: resumePdf }, resumeFile: 'Jane_Resume.pdf' });
    const sent = await page.evaluate(() => window.__sent);
    const open = await page.getByRole('dialog').isVisible().catch(() => false);
    await page.close();
    return { res, sent, open };
  };
  const [similar, missing] = await Promise.all([run('4100000128', 'similar=1'), run('4100000129', 'missing=1')]);
  assert.equal(similar.res.status, 'submitted', similar.res.note);
  assert.equal(similar.sent.resume, 'Jane_Resume.pdf', 'not Jane_Resume_ML.pdf, which starts the same');
  assert.equal(similar.res.resumeUsed, 'Jane_Resume.pdf');
  assert.equal(missing.res.status, 'needs_review');
  assert.equal(missing.res.keepTab, true);
  assert.match(missing.res.note, /couldn't confirm the right resume is attached; check before sending/);
  assert.equal(missing.sent, null, 'nothing was sent');
  assert.equal(missing.open, true, 'the Easy Apply window is left open on the resume step');
});

test('Handshake Quick apply: the exact resume, and "applied on" in the posting is not a confirmation', async () => {
  const run = async (id, mode) => {
    const page = await browser.newPage();
    const job = { source: 'handshake', jobId: id, url: `${base}/job-search/${id}?mode=${mode}`, title: 'Software Engineer Intern', company: 'Acme' };
    await page.goto(job.url);
    const res = await handshake.apply(page, job, { bank, submit: true, docs: { resume: resumePdf }, confirmTimeout: 1000 });
    const out = { res, sent: await page.evaluate(() => window.__sent), clicks: await page.evaluate(() => window.__clicks) };
    await page.close();
    return out;
  };
  const [ok, silent] = await Promise.all([run('9100001', 'ok'), run('9100002', 'silent')]);
  assert.equal(ok.res.status, 'submitted', ok.res.note);
  assert.equal(ok.sent.resume, 'Jane_Resume.pdf', 'swapped out Jane_Resume_ML.pdf, which starts the same');
  assert.equal(ok.res.resumeUsed, 'Jane_Resume.pdf');
  assert.equal(silent.clicks, 1, 'Submit was pressed once');
  assert.equal(silent.res.status, 'needs_review', 'never "submitted" without a confirmation');
  assert.equal(silent.res.keepTab, true);
  assert.equal(silent.res.note, 'clicked Submit but did not see a confirmation; check the tab');
});
