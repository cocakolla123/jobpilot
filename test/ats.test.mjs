// Company forms (Greenhouse, Lever, Ashby) on local copies of how those sites
// are built today. Every request to a real site is answered from a fixture or
// blocked, so nothing ever leaves the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../src/core/chrome.mjs';
import { ensureWorkspace, writeJson } from '../src/core/config.mjs';
import { loadAnswerBank, addAnswer } from '../src/core/answers.mjs';
import { fillCheckboxGroups } from '../src/core/forms.mjs';
import { detectCaptcha } from '../src/core/safety.mjs';
import * as ats from '../src/platforms/ats.mjs';

const FIX = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
let browser, bank, resumePdf;

// fake sites: each host gets a page, everything else is blocked
const SITES = {
  'job-boards.greenhouse.io': () => read('greenhouse-react.html'),
  'jobs.lever.co': () => read('lever-location.html'),
  'careers.acme.test': (u) => {
    if (u.pathname === '/frame') {
      return `<h1>Software Engineer</h1><div id="grnhse_app"><iframe id="grnhse_iframe" width="100%" height="900"
        src="https://job-boards.greenhouse.io/embed/job_app?for=acme&validityToken=abc&token=${u.searchParams.get('gh_jid')}"></iframe></div>`;
    }
    if (u.pathname === '/script') {
      return '<h1>Software Engineer</h1><div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>';
    }
    if (u.pathname === '/ashby') return '<h1>Software Engineer</h1><div id="ashby_embed"></div><script src="https://jobs.ashbyhq.com/acme/embed?version=2"></script>';
    if (u.pathname === '/button') return '<h1>Data Engineer</h1><a href="https://jobs.lever.co/acme/1234-abcd/apply">Apply for this job</a>';
    return '<h1>Our careers</h1><p>Apply through our own portal.</p><a href="/portal">Apply</a>';
  },
};

async function fakeWeb(page) {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'about:' || u.protocol === 'data:') return route.continue();
    if (u.hostname === 'jobs.acme.test') {
      // a tracking link that sends you on (a script redirect, so the next request is answered here too)
      return route.fulfill({ contentType: 'text/html', body: `<script>location.replace('https://job-boards.greenhouse.io/acme/jobs/${u.pathname.split('/').pop()}')</script>` });
    }
    const site = SITES[u.hostname];
    if (!site) return route.abort();
    if (/\.js$|\/js$|\/embed$/.test(u.pathname)) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.fulfill({ contentType: 'text/html', body: site(u) });
  });
}

before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
  const ws = ensureWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-ats-')));
  writeJson(ws.profile, {
    firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '5550100123', city: 'Austin', state: 'Texas', country: 'United States',
    workAuthorized: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes',
  });
  bank = loadAnswerBank(ws); // includes the starter consent answer
  resumePdf = path.join(ws.resumes, 'Jane_Resume.pdf');
  fs.writeFileSync(resumePdf, '%PDF-1.4\n% test\n');
});
after(async () => { await browser?.close(); });

test('captcha check: an invisible reCAPTCHA badge or hidden hCaptcha is not a check, a visible one is', async () => {
  const page = await browser.newPage();
  const shows = async (html) => { await page.setContent(html); return detectCaptcha(page); };
  assert.equal(await shows('<div class="grecaptcha-badge" style="width:256px;height:60px"><iframe title="reCAPTCHA" width="256" height="60"></iframe></div>'), false, 'Greenhouse badge');
  assert.equal(await shows('<iframe title="reCAPTCHA" src="about:blank#k=1&size=invisible" width="256" height="60"></iframe>'), false, 'invisible widget');
  assert.equal(await shows('<div style="visibility:hidden;position:absolute;top:-10000px"><iframe title="recaptcha challenge expires in two minutes" width="400" height="580"></iframe></div>'), false, 'parked puzzle');
  assert.equal(await shows('<div class="h-captcha" style="height:0"></div><iframe title="hCaptcha checkbox" style="visibility:hidden" width="300" height="80"></iframe>'), false, 'Lever hCaptcha at rest');
  assert.equal(await shows('<div class="g-recaptcha" style="width:304px;height:78px"><iframe title="reCAPTCHA" width="304" height="78"></iframe></div>'), true, '"I\'m not a robot" box');
  assert.equal(await shows('<iframe title="recaptcha challenge expires in two minutes" width="400" height="580"></iframe>'), true, 'picture puzzle showing');
  await page.close();
});

test('Greenhouse today: react-select dropdowns, a city that loads as you type, consent, and no false captcha', async () => {
  const page = await browser.newPage();
  await fakeWeb(page);
  const job = { url: 'https://job-boards.greenhouse.io/acme/jobs/1', title: 'Software Engineer', company: 'Acme' };
  const res = await ats.apply(page, job, { bank, submit: false, docs: { resume: resumePdf } });
  assert.equal(res.status, 'filled_not_submitted', `${res.note} ${JSON.stringify(res.unknowns || [])}`);
  assert.equal(res.resumeUsed, 'Jane_Resume.pdf');
  const v = await page.evaluate(() => ({ ...window.__picked, first: document.getElementById('first_name').value, consent: document.getElementById('consent').checked }));
  assert.equal(v.first, 'Jane');
  assert.equal(v.country, 'United States +1', 'the closest country, not "United States Minor Outlying Islands"');
  assert.equal(v['candidate-location'], 'Austin, Texas, United States', 'Austin in Texas, not Minnesota');
  assert.equal(v.question_1, 'Yes');
  assert.equal(v.question_2, 'No');
  assert.equal(v.question_3, 'Yes', 'located in the US, from the profile country');
  assert.equal(v.gender, "I don't wish to answer");
  assert.equal(v.veteran_status, "I don't wish to answer", '"military status" is the veteran question');
  assert.equal(v.consent, true, '"By checking this box, I consent..." follows the consent answer');
  await page.close();
});

test('Greenhouse: a dropdown with no matching choice is asked, and the rest of the form still fills', async () => {
  const page = await browser.newPage();
  await fakeWeb(page);
  await page.route('https://job-boards.greenhouse.io/**', (r) => r.fulfill({ contentType: 'text/html',
    body: read('greenhouse-react.html').replace('data-options="Yes|No"><label id="question_1-label">', 'data-options="Maybe|Later"><label id="question_1-label">') }));
  const res = await ats.apply(page, { url: 'https://job-boards.greenhouse.io/acme/jobs/2' }, { bank, submit: false, docs: { resume: resumePdf } });
  assert.equal(res.status, 'needs_answer');
  assert.deepEqual(res.unknowns.map((u) => u.question), ['Are you legally authorized to work in the United States for our Company?*']);
  const v = await page.evaluate(() => ({ ...window.__picked, typed: document.getElementById('question_1').value }));
  assert.equal(v.question_1, undefined, 'never guessed');
  assert.equal(v.typed, '', 'what was typed to search is cleared');
  assert.equal(v.question_2, 'No', 'later questions are still answered');
  await page.close();
});

test('Lever: "Current location" picks the suggestion in your state, and Enter is never pressed', async () => {
  const page = await browser.newPage();
  await fakeWeb(page);
  const res = await ats.apply(page, { url: 'https://jobs.lever.co/acme/1234-abcd' }, { bank, submit: false, docs: { resume: resumePdf } });
  assert.equal(res.status, 'filled_not_submitted', `${res.note} ${JSON.stringify(res.unknowns || [])}`);
  assert.equal(page.url(), 'https://jobs.lever.co/acme/1234-abcd/apply');
  const v = await page.evaluate(() => ({ loc: document.getElementById('location-input').value, chosen: document.getElementById('selected-location').value, submits: window.__submits }));
  assert.equal(v.loc, 'Austin, TX, USA');
  assert.match(v.chosen, /Austin, TX/);
  assert.equal(v.submits, 0);
  await page.close();
});

test('company careers pages lead to the form they hold', async () => {
  const page = await browser.newPage();
  await fakeWeb(page);
  assert.equal(await ats.resolveAts(page, 'https://job-boards.greenhouse.io/acme/jobs/9'), 'https://job-boards.greenhouse.io/acme/jobs/9', 'a form link is used as is');
  assert.equal(await ats.resolveAts(page, 'https://careers.acme.test/frame?gh_jid=77'),
    'https://job-boards.greenhouse.io/embed/job_app?for=acme&validityToken=abc&token=77', 'the Greenhouse frame on the page');
  assert.equal(await ats.resolveAts(page, 'https://careers.acme.test/script?gh_jid=55'),
    'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=55', 'built from the board the page loads');
  assert.equal(await ats.resolveAts(page, 'https://careers.acme.test/ashby?ashby_jid=1fc309c8-da20-4ff2-84c7-8b863ece2b0a'),
    'https://jobs.ashbyhq.com/acme/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application', 'Ashby embed');
  assert.equal(await ats.resolveAts(page, 'https://careers.acme.test/button'), 'https://jobs.lever.co/acme/1234-abcd/apply', 'the page\'s Apply link');
  assert.equal(await ats.resolveAts(page, 'https://jobs.acme.test/r/31'), 'https://job-boards.greenhouse.io/acme/jobs/31', 'a redirect');
  assert.equal(await ats.resolveAts(page, 'https://careers.acme.test/other'), null, 'a site JobPilot cannot fill');
  // and the form it found fills like any other, though it has no heading
  const form = await ats.resolveAts(page, 'https://careers.acme.test/frame?gh_jid=77');
  await page.route('https://job-boards.greenhouse.io/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: read('greenhouse-react.html').replace('<h1>Software Engineer</h1>', '') }));
  const res = await ats.apply(page, { url: form }, { bank, submit: false, docs: { resume: resumePdf } });
  assert.equal(res.status, 'filled_not_submitted', `${res.note} ${JSON.stringify(res.unknowns || [])}`);
  await page.close();
});

test('which links are company forms', () => {
  assert.equal(ats.detectAts('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1'), 'greenhouse');
  assert.equal(ats.detectAts('https://my.greenhouse.io/users/sign_in'), null);
  assert.equal(ats.detectAts('https://jobs.ashbyhq.com/acme/embed'), null, 'an Ashby board embed is not one job');
  assert.equal(ats.detectAts('https://api.lever.co/v0/postings/acme'), null);
});

test('tick all that apply: asked when there is no answer, and every saved choice is ticked', async () => {
  const page = await browser.newPage();
  await page.setContent(`<form><ul><li class="application-question">
    <div class="application-label"><div class="text">Which languages do you speak? <span class="required">✱</span></div></div>
    <div class="application-field"><ul>
      <li><label><input type="checkbox" name="cards[1][field0]" value="English (ENG)"> English (ENG)</label></li>
      <li><label><input type="checkbox" name="cards[1][field0]" value="Spanish (SPA)"> Spanish (SPA)</label></li>
      <li><label><input type="checkbox" name="cards[1][field0]" value="Other"> Other</label></li>
    </ul></div></li></ul></form>`);
  const form = page.locator('form');
  const unknowns = [];
  await fillCheckboxGroups(form, bank, unknowns);
  assert.equal(unknowns.length, 1);
  assert.equal(unknowns[0].question, 'Which languages do you speak? ✱');
  assert.deepEqual(unknowns[0].options, ['English (ENG)', 'Spanish (SPA)', 'Other']);
  // answered once on the Questions tab
  const ws = ensureWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-ats-')));
  addAnswer(ws, { question: unknowns[0].question, answer: 'English, Spanish' });
  const again = [];
  await fillCheckboxGroups(form, loadAnswerBank(ws), again);
  assert.deepEqual(again, []);
  const ticked = await page.$$eval('input:checked', (els) => els.map((e) => e.value));
  assert.deepEqual(ticked, ['English (ENG)', 'Spanish (SPA)']);
  await page.close();
});
