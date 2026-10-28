// Indeed: search, read a posting, press Save job, and "Easily apply".
// Indeed's bot protection is strict, so this source is the most careful:
// any security page stops Indeed for the run, and the daily cap is low.
import { assertNoWall, detectCaptcha, SecurityStop, sleep } from '../core/safety.mjs';
import { fillAll, attachFiles, dedupeUnknowns } from '../core/forms.mjs';

export const source = 'indeed';
export const label = 'Indeed';
export const home = 'https://www.indeed.com/';

const POSTED = { day: '1', week: '7', month: '30' };
const REMOTE_ID = '032b3046-06a3-4876-8dfd-474eb5e7ed11';

export function searchUrl(s) {
  if (s.urls?.indeed) return s.urls.indeed;
  const u = new URL('https://www.indeed.com/jobs');
  if (s.keywords) u.searchParams.set('q', s.keywords);
  if (s.location) u.searchParams.set('l', s.location);
  if (POSTED[s.posted]) u.searchParams.set('fromage', POSTED[s.posted]);
  const sc = [];
  if (s.easyApplyOnly !== false) sc.push('attr(DSQF7)');
  if ((s.experience || []).includes('entry')) sc.push('explvl(ENTRY_LEVEL)');
  if (sc.length) u.searchParams.set('sc', `0kf:${sc.join('')};`);
  const wp = Array.isArray(s.workplace) ? s.workplace : s.workplace ? [s.workplace] : [];
  if (wp.includes('remote')) u.searchParams.set('remotejob', REMOTE_ID);
  u.searchParams.set('sort', 'date');
  return u.toString();
}

export const viewUrl = (jk) => `https://www.indeed.com/viewjob?jk=${jk}`;

export async function search(page, s, ctx) {
  const max = ctx.limit || 25;
  await page.goto(searchUrl(s), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  await assertNoWall(page, source);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-jk]')].map((el) => {
    const jk = el.getAttribute('data-jk');
    const card = el.closest('li, [class*="job_seen" i], [class*="cardOutline" i]') || el;
    const lines = (card.innerText || '').split('\n').map((x) => x.trim()).filter((x) => x && !/^(new|easily apply|urgently hiring|often replies|responsive employer|view (10|similar))/i.test(x));
    return { jk, lines };
  })).catch(() => []);
  const out = new Map();
  for (const c of cards) {
    if (!c.jk || out.has(c.jk)) continue;
    out.set(c.jk, { source, jobId: c.jk, url: viewUrl(c.jk), title: c.lines[0] || '', company: c.lines[1] || '', location: c.lines[2] || '' });
  }
  ctx.log?.(`Indeed: ${out.size} job(s) on the results page`);
  return [...out.values()].slice(0, max);
}

export async function details(page, job, ctx) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3000);
  await assertNoWall(page, source);
  const info = await page.evaluate(() => {
    const t = (sel) => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ').trim();
    const doc = document.title.replace(/\s*[-|]\s*Indeed(\.com)?\s*$/i, '').split(/\s+-\s+/);
    return {
      title: t('h1[data-testid="jobsearch-JobInfoHeader-title"]') || t('.jobsearch-JobInfoHeader-title') || t('h1') || doc[0] || '',
      company: t('[data-testid="inlineHeader-companyName"]') || t('[data-company-name]') || (doc.length > 1 ? doc[doc.length - 1] : ''),
      location: t('[data-testid="inlineHeader-companyLocation"]') || t('[data-testid="job-location"]'),
      description: (document.querySelector('#jobDescriptionText, [id*="jobDescription" i], [class*="jobDescription" i]')?.innerText || document.querySelector('main')?.innerText || '').slice(0, 15000),
      indeedApply: !![...document.querySelectorAll('a[href*="smartapply.indeed.com"], button')].find((b) => /smartapply/.test(b.getAttribute('href') || '') || /^apply now$/i.test((b.innerText || '').trim())),
      external: [...document.querySelectorAll('a, button')].map((b) => ({ txt: (b.innerText || '').trim(), href: b.getAttribute('href') || '' })).find((b) => /apply on company site/i.test(b.txt)),
    };
  }).catch(() => ({}));
  let externalUrl = null;
  if (info.external?.href) {
    try { const u = new URL(info.external.href, 'https://www.indeed.com'); externalUrl = u.searchParams.get('url') || u.toString(); } catch { /* keep null */ }
  }
  const applyType = info.indeedApply ? 'easy' : info.external ? 'external' : 'unknown';
  ctx?.log?.(`Indeed: ${info.title || job.title || '?'} at ${info.company || job.company || '?'} (${applyType})`);
  return { title: info.title || job.title, company: info.company || job.company, location: info.location || job.location, description: info.description || '', applyType, externalUrl };
}

export async function save(page) {
  const btn = page.locator('button[aria-label^="Save job" i], button[aria-label*="save this job" i], button:has-text("Save job")').first();
  if (!await btn.isVisible({ timeout: 2000 }).catch(() => false)) return 'not-found';
  if (/saved|unsave/i.test(`${await btn.getAttribute('aria-label').catch(() => '')} ${await btn.innerText().catch(() => '')}`)) return 'already';
  await btn.click({ timeout: 4000 }).catch(() => {});
  await sleep(1000);
  return 'saved';
}

/**
 * Indeed Apply (smartapply.indeed.com): a few pages of questions, a resume
 * step, then Review and Submit. Opens in the same tab or a new one.
 */
export async function apply(page, job, ctx) {
  if (!page.url().includes(job.jobId)) { await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(3000); }
  await assertNoWall(page, source);
  const btn = page.locator('a[href*="smartapply.indeed.com"], button:has-text("Apply now")').first();
  if (!await btn.isVisible({ timeout: 4000 }).catch(() => false)) return { status: 'external_manual', note: 'no Indeed Apply button' };
  const popup = page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
  await btn.click({ timeout: 6000 }).catch(() => {});
  const opened = await popup;
  const form = opened || page;
  await form.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  const drafted = [];
  // Indeed Apply may open its own tab: that tab is the one to leave open
  const keep = (status, note, extra = {}) => ({ status, note, drafted, keepTab: true, formPage: opened || null, ...extra });
  const done = async (res) => { if (opened) await opened.close().catch(() => {}); return res; };
  for (let step = 0; step < 15; step++) {
    if (await detectCaptcha(form)) throw new SecurityStop('Indeed: a captcha appeared in Indeed Apply. Finish it yourself in the browser.', source);
    if (/smartapply\.indeed\.com\/.*(post-apply|confirmation)|application (has been )?submitted/i.test(form.url() + ' ' + (await form.locator('h1').first().innerText().catch(() => '')))) {
      return done({ status: 'submitted', note: '', drafted });
    }
    const root = form.locator('main, form, body').first();
    await attachFiles(root, { resume: ctx.docs.resume, coverLetter: ctx.docs.coverLetter });
    // the resume step lists uploaded resumes as cards; pick the matching one
    const want = ctx.resumeFile.replace(/\.(pdf|docx)$/i, '');
    const card = form.locator(`[data-testid*="resume" i]:has-text("${want}"), label:has-text("${want}")`).first();
    if (await card.isVisible({ timeout: 500 }).catch(() => false)) await card.click().catch(() => {});
    const unknowns = [];
    await fillAll(form, root, ctx.bank, unknowns, { draft: ctx.draft, drafted });
    const blocking = dedupeUnknowns(unknowns).filter((u) => u.required);
    if (blocking.length) return keep('needs_answer', `${blocking.length} question(s) need an answer; Indeed Apply is open in its tab`, { unknowns: blocking });
    const submit = form.locator('button').filter({ hasText: /^\s*submit (your )?application\s*$/i }).first();
    if (await submit.isVisible({ timeout: 800 }).catch(() => false)) {
      if (!ctx.submit) return keep('filled_not_submitted', 'filled; review and submit in the open tab (submit is off)');
      if (drafted.length && !ctx.aiAutoSubmit) return keep('needs_review', `AI wrote ${drafted.length} answer(s); read them in the open tab and submit`);
      await submit.click({ timeout: 8000 });
      await sleep(4000);
      const ok = await form.getByText(/application (has been )?submitted|your application has been sent/i).first().isVisible({ timeout: 10000 }).catch(() => false);
      return ok ? done({ status: 'submitted', note: '', drafted }) : keep('submitted', 'Submit was pressed but Indeed showed no confirmation; check the open tab');
    }
    const next = form.locator('button').filter({ hasText: /^\s*(continue|next|review( your application)?)\s*$/i }).first();
    if (!await next.isVisible({ timeout: 1500 }).catch(() => false)) return keep('error', 'Indeed Apply page had no Continue or Submit button; it is open in its tab');
    await next.click({ timeout: 8000 }).catch(() => {});
    await sleep(2500);
  }
  return keep('error', 'Indeed Apply did not finish in 15 pages; it is open in its tab');
}

export async function loginState(page) {
  await page.goto('https://www.indeed.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(2500);
  try { await assertNoWall(page, source); } catch (e) { return { loggedIn: false, note: e.message }; }
  const signIn = await page.locator('a:has-text("Sign in")').first().isVisible({ timeout: 1000 }).catch(() => false);
  return signIn ? { loggedIn: false, note: 'not signed in' } : { loggedIn: true, note: '' };
}

export const PROFILE_URL = 'https://profile.indeed.com/';

/** The uploaded resume file on your Indeed profile (Indeed keeps one), or null. */
export async function currentFile(page, { load = true } = {}) {
  if (load) {
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await assertNoWall(page, source);
  }
  await page.getByRole('tab', { name: /resume/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(1500);
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label^="Preview resume "]')].map((x) => x.getAttribute('aria-label').replace(/^Preview resume\s+/, '').trim());
    return b.find((n) => /\.(pdf|docx?|rtf|txt)$/i.test(n)) || null;
  }).catch(() => null);
}

/** Resumes on your Indeed profile. */
export async function siteResumes(page) {
  const f = await currentFile(page);
  return f ? [f] : [];
}

/**
 * Puts `filePath` on your Indeed profile in place of the current file, using
 * the file's own menu: Open resume options, then Replace file.
 */
export async function replaceResume(page, filePath) {
  const name = filePath.split(/[\\/]/).pop();
  const cur = await currentFile(page);
  if (cur === name) return { ok: true, note: 'already on Indeed' };
  let chooser;
  if (cur) {
    // the menu that belongs to the uploaded file, not to the Indeed Resume
    const tagged = await page.evaluate(() => {
      const prev = [...document.querySelectorAll('button[aria-label^="Preview resume "]')].find((x) => /\.(pdf|docx?|rtf|txt)$/i.test(x.getAttribute('aria-label')));
      for (let el = prev?.parentElement, i = 0; el && i < 8; el = el.parentElement, i++) {
        const opts = [...el.querySelectorAll('button[aria-label="Open resume options"]')];
        if (opts.length === 1) { opts[0].setAttribute('data-jp-opts', '1'); return true; }
      }
      return false;
    }).catch(() => false);
    if (!tagged) return { ok: false, note: 'could not find the options menu for your Indeed resume file' };
    await page.locator('[data-jp-opts]').click({ timeout: 5000 });
    await sleep(800);
    const replace = page.getByRole('option', { name: /replace file/i }).first();
    if (!await replace.isVisible({ timeout: 3000 }).catch(() => false)) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, note: 'Indeed did not offer Replace file' }; }
    const picker = page.waitForEvent('filechooser', { timeout: 12000 }).catch(() => null);
    await replace.click();
    // Indeed asks "Replace your resume?" first; the file picker opens after "Replace resume"
    const confirm = page.locator('[role=dialog] button, [aria-modal=true] button').filter({ hasText: /^\s*replace resume\s*$/i }).first();
    if (await confirm.isVisible({ timeout: 4000 }).catch(() => false)) await confirm.click();
    chooser = await picker;
  } else {
    const up = page.locator('button, a').filter({ hasText: /upload (a )?resume|add (a )?resume/i }).first();
    if (!await up.isVisible({ timeout: 3000 }).catch(() => false)) return { ok: false, note: 'no resume upload button on your Indeed profile' };
    [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null), up.click()]);
  }
  if (chooser) await chooser.setFiles(filePath);
  else {
    const fi = page.locator('input[type=file]').first();
    if (!await fi.count()) return { ok: false, note: 'Indeed did not open a file picker' };
    await fi.setInputFiles(filePath);
  }
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    // some versions ask to confirm the replacement
    const ok = page.locator('[role=dialog] button, [aria-modal=true] button').filter({ hasText: /^\s*(replace|continue|confirm|save|upload|done)\s*$/i }).first();
    if (await ok.isVisible({ timeout: 300 }).catch(() => false)) await ok.click().catch(() => {});
    if (i % 3 === 2 && await currentFile(page, { load: false }) === name) return { ok: true, note: '' };
  }
  const now = await currentFile(page);
  return now === name ? { ok: true, note: '' } : { ok: false, note: `Indeed still shows ${now || 'no file'} instead of ${name}` };
}
