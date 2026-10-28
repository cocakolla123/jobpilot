// LinkedIn: search, read a posting, press Save, and Easy Apply.
import { assertNoWall, SecurityStop, sleep } from '../core/safety.mjs';
import { fillAll, attachFiles, dedupeUnknowns } from '../core/forms.mjs';

export const source = 'linkedin';
export const label = 'LinkedIn';
export const home = 'https://www.linkedin.com/jobs/';

const EXP = { internship: '1', entry: '2', associate: '3', mid: '4' };
const POSTED = { day: 'r86400', week: 'r604800', month: 'r2592000' };
const WORKPLACE = { onsite: '1', remote: '2', hybrid: '3' };

export function searchUrl(s) {
  if (s.urls?.linkedin) return s.urls.linkedin;
  const u = new URL('https://www.linkedin.com/jobs/search/');
  // LinkedIn's 2026 AI search drops the experience filter from the URL, so the
  // level also goes into the words ("entry level software engineer").
  const exps = s.experience || [];
  const lead = exps.includes('internship') && !/intern/i.test(s.keywords || '') ? 'internship'
    : exps.includes('entry') && !/entry|new grad|junior/i.test(s.keywords || '') ? 'entry level' : '';
  const words = [lead, s.keywords].filter(Boolean).join(' ');
  if (words) u.searchParams.set('keywords', words);
  if (s.location) u.searchParams.set('location', s.location);
  if (s.easyApplyOnly !== false) u.searchParams.set('f_AL', 'true');
  const exp = (s.experience || []).map((e) => EXP[e]).filter(Boolean);
  if (exp.length) u.searchParams.set('f_E', exp.join(','));
  if (POSTED[s.posted]) u.searchParams.set('f_TPR', POSTED[s.posted]);
  const wt = (Array.isArray(s.workplace) ? s.workplace : s.workplace ? [s.workplace] : []).map((w) => WORKPLACE[w]).filter(Boolean);
  if (wt.length) u.searchParams.set('f_WT', wt.join(','));
  u.searchParams.set('sortBy', 'DD');
  return u.toString();
}

async function firstText(page, selectors, timeout = 1500) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      const t = (await loc.innerText({ timeout }).catch(() => '')).trim().replace(/\s+/g, ' ');
      if (t) return t;
    }
  }
  return '';
}

const idFromUrl = (u) => (String(u).match(/currentJobId=(\d{6,})/) || String(u).match(/\/jobs\/view\/(\d{6,})/) || [])[1] || null;
export const viewUrl = (id) => `https://www.linkedin.com/jobs/view/${id}/`;

/** Job ids from a results page. Classic layout has data ids; the 2026 layout needs card clicks. */
export async function search(page, s, ctx) {
  const max = ctx.limit || 25;
  await page.goto(searchUrl(s), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  await assertNoWall(page, source);
  const found = new Map();
  for (let round = 0; round < 12 && found.size < max; round++) {
    const cards = await page.evaluate(() => [...document.querySelectorAll('li[data-occludable-job-id], [data-job-id]')].map((li) => {
      const id = li.getAttribute('data-occludable-job-id') || li.getAttribute('data-job-id');
      const lines = (li.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
      return { id, lines };
    })).catch(() => []);
    for (const c of cards) {
      if (!c.id || found.has(c.id)) continue;
      // card text: title, (title again), company, location, ...
      const [title, ...rest] = c.lines;
      const company = rest.find((l) => l !== title) || '';
      const location = rest.find((l) => l !== title && l !== company) || '';
      found.set(c.id, { source, jobId: c.id, url: viewUrl(c.id), title, company, location });
    }
    if (!cards.length) break;
    await page.evaluate(() => {
      const last = [...document.querySelectorAll('li[data-occludable-job-id]')].pop();
      last?.scrollIntoView();
      const sc = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
      if (sc) sc.scrollTop += 1500;
    }).catch(() => {});
    await sleep(1100);
  }
  if (!found.size) for (const j of await collectNewUi(page, max)) found.set(j.jobId, j);
  ctx.log?.(`LinkedIn: ${found.size} job(s) on the results page`);
  return [...found.values()].slice(0, max);
}

// 2026 results layout: hashed classes and no ids in the DOM. Tag the scroller
// and its cards, click each one, and read ?currentJobId= from the URL.
async function collectNewUi(page, max) {
  const jobs = []; const seen = new Set(); const home = page.url(); let stale = 0;
  for (let round = 0; round < 15 && jobs.length < max && stale < 2; round++) {
    const n = await page.evaluate(() => {
      document.querySelectorAll('[data-jp-card]').forEach((x) => x.removeAttribute('data-jp-card'));
      const scrollers = [...document.querySelectorAll('div')].filter((d) => /(auto|scroll)/.test(getComputedStyle(d).overflowY) && d.scrollHeight > d.clientHeight + 100);
      let best = null, bestN = 0;
      for (const sc of scrollers) {
        const k = [...sc.children].filter((c) => (c.innerText || '').length > 40 && c.querySelector('[role=button],a,button')).length;
        if (k > bestN) { best = sc; bestN = k; }
      }
      if (!best || bestN < 2) return 0;
      best.setAttribute('data-jp-scroller', '1');
      let i = 0;
      for (const c of best.children) {
        if ((c.innerText || '').length > 40 && c.querySelector('[role=button],a,button') && !/premium/i.test(c.innerText || '')) c.setAttribute('data-jp-card', String(i++));
      }
      return i;
    }).catch(() => 0);
    if (!n) break;
    const before = jobs.length;
    for (let i = 0; i < n && jobs.length < max; i++) {
      const card = page.locator(`[data-jp-card="${i}"]`);
      const lines = (await card.innerText().catch(() => '')).split('\n').map((x) => x.trim()).filter(Boolean);
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click({ timeout: 4000 }).catch(() => {});
      await sleep(1100);
      if (!/linkedin\.com\/jobs\/search/.test(page.url())) { await page.goto(home, { waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(3500); break; }
      const id = idFromUrl(page.url());
      if (id && !seen.has(id)) {
        seen.add(id);
        jobs.push({ source, jobId: id, url: viewUrl(id), title: lines[0] || '', company: lines.find((l, k) => k > 0 && l !== lines[0]) || '', location: '' });
      }
    }
    stale = jobs.length === before ? stale + 1 : 0;
    await page.evaluate(() => { const sc = document.querySelector('[data-jp-scroller]'); if (sc) sc.scrollTop += sc.clientHeight * 0.9; }).catch(() => {});
    await sleep(1200);
  }
  return jobs;
}

const EASY_RE = /^\s*(easy apply|continue( applying)?)\s*$/i;

/** Opens the posting and reads title, company, location, description and how to apply. */
export async function details(page, job, ctx) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2200);
  await assertNoWall(page, source);
  if (!/\/jobs\/view\//.test(page.url())) return { gone: true };
  let title = await firstText(page, ['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', 'h1']);
  let company = await firstText(page, ['.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name']);
  const dt = (await page.title().catch(() => '')).split('|').map((x) => x.trim());
  if (dt.length >= 3 && /linkedin/i.test(dt[dt.length - 1])) { title ||= dt[0]; company ||= dt[1]; }
  if (!company) company = await firstText(page, ['main a[href*="/company/"]']);
  const location = await firstText(page, ['.job-details-jobs-unified-top-card__tertiary-description-container span', '.jobs-unified-top-card__bullet', '.job-details-jobs-unified-top-card__primary-description-container span']);
  let description = await firstText(page, ['#job-details', '.jobs-description__content', '.jobs-box__html-content', '[class*="jobs-description" i]', 'article'], 2500);
  if (!description) description = (await page.locator('main').innerText({ timeout: 2500 }).catch(() => '')).slice(0, 12000);

  const easy = page.locator('button, a').filter({ hasText: EASY_RE }).filter({ hasNotText: /see more|similar/i }).first();
  let applyType = 'unknown';
  if (await easy.isVisible({ timeout: 8000 }).catch(() => false)) applyType = 'easy';
  else if (await page.getByText(/^applied\b|application submitted/i).first().isVisible({ timeout: 500 }).catch(() => false)) applyType = 'applied';
  else if (await page.locator('button, a').filter({ hasText: /^\s*apply\s*$/i }).first().isVisible({ timeout: 500 }).catch(() => false)) applyType = 'external';
  ctx?.log?.(`LinkedIn: ${title || '?'} at ${company || '?'} (${applyType})`);
  return { title, company, location, description: description.slice(0, 15000), applyType };
}

/** Presses LinkedIn's own Save button on the posting (page must be open). */
export async function save(page) {
  const btn = page.locator('button.jobs-save-button, button[aria-label^="Save" i], button:has-text("Save")').filter({ hasText: /^\s*(save|saved)\b/i }).first();
  if (!await btn.isVisible({ timeout: 2500 }).catch(() => false)) return 'not-found';
  const txt = (await btn.innerText().catch(() => '')).trim();
  if (/^saved/i.test(txt) || (await btn.getAttribute('aria-pressed').catch(() => '')) === 'true') return 'already';
  await btn.click({ timeout: 4000 }).catch(() => {});
  await sleep(1200);
  return 'saved';
}

/** Captures where LinkedIn's offsite "Apply" button goes, then closes that tab. */
export async function externalUrl(page) {
  const btn = page.locator('button, a').filter({ hasText: /^\s*apply\s*$/i }).first();
  if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) return null;
  const href = await btn.getAttribute('href').catch(() => null);
  if (href && /^https?:/.test(href) && !/linkedin\.com/.test(href)) return href;
  const popup = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
  await btn.click({ timeout: 4000 }).catch(() => {});
  const p = await popup;
  if (!p) return null;
  await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  const url = p.url();
  await p.close().catch(() => {});
  return /^https?:/.test(url) && !/linkedin\.com/.test(url) ? url : null;
}

async function pickResume(dialog, resumeFile, resumePath) {
  const want = resumeFile.replace(/\.(pdf|docx)$/i, '');
  const more = dialog.getByRole('button', { name: /show more resumes/i }).first();
  if (await more.isVisible({ timeout: 400 }).catch(() => false)) { await more.click().catch(() => {}); await sleep(600); }
  const card = dialog.locator(`[class*="document-upload"]:has-text("${want}"), [class*="jobs-resume-picker"]:has-text("${want}"), label:has-text("${want}")`).first();
  if (await card.isVisible({ timeout: 500 }).catch(() => false)) {
    const radio = card.locator('input[type="radio"], [role="radio"]').first();
    if (await radio.count()) await radio.check({ force: true }).catch(async () => { await card.click().catch(() => {}); });
    else await card.click().catch(() => {});
    return 'picked';
  }
  const onResumeStep = await dialog.getByText(/resume/i).first().isVisible({ timeout: 300 }).catch(() => false);
  if (onResumeStep && await dialog.locator('input[type="file"]').count()) {
    await attachFiles(dialog, { resume: resumePath });
    await sleep(1500);
    return 'uploaded';
  }
  return 'none';
}

/**
 * Easy Apply. ctx: { bank, submit, aiAutoSubmit, draft, docs: {resume, coverLetter}, resumeFile, log }.
 * Returns { status, note, unknowns, drafted, keepTab }. keepTab means the
 * Easy Apply window is left open in this tab for you to finish.
 */
export async function apply(page, job, ctx) {
  if (!/\/jobs\/view\//.test(page.url()) || idFromUrl(page.url()) !== job.jobId) {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2200);
  }
  await assertNoWall(page, source);
  const easy = page.locator('button, a').filter({ hasText: EASY_RE }).filter({ hasNotText: /see more|similar/i }).first();
  if (!await easy.isVisible({ timeout: 12000 }).catch(() => false)) {
    if (await page.getByText(/^applied\b|application submitted/i).first().isVisible({ timeout: 500 }).catch(() => false)) return { status: 'already_applied', note: 'LinkedIn shows Applied' };
    return { status: 'external_manual', note: 'no Easy Apply button' };
  }
  await easy.click({ timeout: 8000 });
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  const drafted = [];
  const keep = (status, note, extra = {}) => ({ status, note, drafted, keepTab: true, ...extra });
  let hadErrors = false;
  for (let step = 0; step < 20; step++) {
    await sleep(700);
    await pickResume(dialog, ctx.resumeFile, ctx.docs.resume);
    const unknowns = [];
    await fillAll(page, dialog, ctx.bank, unknowns, { overwriteBadCity: true, draft: ctx.draft, drafted });
    const blocking = dedupeUnknowns(unknowns).filter((u) => u.required || !u.question.match(/optional/i));
    if (blocking.length) return keep('needs_answer', `${blocking.length} question(s) need an answer; the Easy Apply window is open in its tab`, { unknowns: blocking });

    const submit = dialog.getByRole('button', { name: /submit application/i }).first();
    if (await submit.isVisible({ timeout: 800 }).catch(() => false)) {
      // don't auto-follow the company
      const follow = dialog.locator('input[type="checkbox"][id*="follow" i]').first();
      if (await follow.count() && await follow.isChecked().catch(() => false)) {
        const id = await follow.getAttribute('id');
        await dialog.locator(`label[for="${id}"]`).first().click({ timeout: 2000 }).catch(() => follow.uncheck({ force: true }).catch(() => {}));
      }
      if (!ctx.submit) return keep('filled_not_submitted', 'filled up to Submit; review and send it in the open tab (submit is off)');
      if (drafted.length && !ctx.aiAutoSubmit) return keep('needs_review', `AI wrote ${drafted.length} answer(s); read them in the open tab and press Submit`);
      await submit.click({ timeout: 8000 });
      const sent = await page.getByText(/application (was )?(sent|submitted)/i).first().isVisible({ timeout: 12000 }).catch(() => false);
      if (!sent) return keep('submitted', 'Submit was pressed but LinkedIn showed no confirmation; check the open tab');
      return { status: 'submitted', note: '', drafted };
    }

    const next = dialog.getByRole('button', { name: /^(next|review|continue)/i }).first();
    if (!await next.isVisible({ timeout: 800 }).catch(() => false)) {
      const txt = (await dialog.innerText().catch(() => '')).toLowerCase();
      if (/(application|apply).*limit|limit.*(application|apply)|try again (tomorrow|later)/.test(txt)) {
        throw new SecurityStop('LinkedIn: daily Easy Apply limit reached. Try again tomorrow.', source);
      }
      return keep('error', 'no Next, Review or Submit button in the Easy Apply window; it is open in its tab');
    }
    await next.click({ timeout: 8000 });
    await sleep(1200);
    const err = dialog.locator('.artdeco-inline-feedback--error, [role="alert"]');
    const hasErr = await err.first().isVisible({ timeout: 400 }).catch(() => false);
    if (hasErr && hadErrors) {
      const qs = await err.evaluateAll((nodes) => nodes.map((n) => {
        for (let el = n.parentElement, h = 0; el && h < 8; h++, el = el.parentElement) {
          const l = el.querySelector('label, legend, [id$="-label"], [class*="label" i]');
          const t = (l?.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && !/please (enter|select|make)|required|valid/i.test(t)) return t;
        }
        return '';
      }).filter(Boolean)).catch(() => []);
      return keep('needs_answer', 'LinkedIn rejected an answer; fix it in the open tab', { unknowns: [...new Set(qs)].map((q) => ({ question: q, options: [], required: true })) });
    }
    hadErrors = hasErr;
  }
  return keep('error', 'Easy Apply did not finish in 20 steps; it is open in its tab');
}

/** Logged in? Reads the feed; a login wall means no. */
export async function loginState(page) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1500);
  const u = page.url();
  if (/login|authwall|signup|checkpoint/.test(u)) return { loggedIn: false, note: 'not signed in' };
  return { loggedIn: true, note: '' };
}

export const RESUMES_URL = 'https://www.linkedin.com/jobs/application-settings/';

/** Names in the resumes section, after opening "+N more resumes". */
async function listOnPage(page) {
  await page.getByText(/upload resume/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  const more = page.getByRole('button', { name: /show more resumes|more resumes/i }).first();
  if (await more.isVisible({ timeout: 1500 }).catch(() => false)) { await more.click().catch(() => {}); await sleep(1200); }
  // each file has a "Show options for <name>" button (as text or as its label)
  return page.evaluate(() => [...document.querySelectorAll('button')]
    .map((b) => `${b.getAttribute('aria-label') || ''}\n${b.innerText || ''}`)
    .map((t) => (t.match(/Show options for\s+(.+\.(?:pdf|docx?|rtf|txt|odt))/i) || [])[1])
    .filter(Boolean).map((x) => x.trim())).catch(() => []);
}

/** Resume files saved in LinkedIn's Resumes and application data section. */
export async function siteResumes(page) {
  await page.goto(RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await assertNoWall(page, source);
  return [...new Set(await listOnPage(page))];
}

/** Uploads one file in the resumes section and waits until LinkedIn lists it. */
export async function uploadResume(page, filePath) {
  const name = filePath.split(/[\\/]/).pop();
  await page.goto(RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await assertNoWall(page, source);
  const before = await listOnPage(page);
  if (before.includes(name)) return { ok: true, note: 'already there' };
  const input = page.locator('#resume-upload-button, input[type=file][name=file]').first();
  if (!await input.count()) return { ok: false, note: 'no upload button in the resumes section' };
  await input.setInputFiles(filePath);
  for (let i = 0; i < 16; i++) {
    await sleep(1500);
    const err = await page.locator('[role=alert], .artdeco-toast-item, .artdeco-inline-feedback--error').filter({ hasText: /limit|maximum|up to \d+|couldn.t|could not|failed|try again|too large/i }).first().innerText({ timeout: 300 }).catch(() => '');
    if (err) return { ok: false, full: /limit|maximum|up to \d+/i.test(err), note: err.replace(/\s+/g, ' ').trim().slice(0, 160) };
    if (i % 2 === 1 && (await listOnPage(page)).includes(name)) return { ok: true, note: '' };
  }
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const after = await listOnPage(page);
  if (after.includes(name)) return { ok: true, note: '' };
  return { ok: false, full: after.length >= before.length && before.length >= 10, note: `LinkedIn did not list ${name} after the upload (it shows ${after.length} resumes)` };
}
