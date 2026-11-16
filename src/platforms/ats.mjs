// Company application forms: Lever, Ashby and Greenhouse. These are the
// "small forms" most external links lead to. Other sites are left for you,
// with the link saved in the dashboard.
import { detectCaptcha, sleep } from '../core/safety.mjs';
import { fillAll, fillRadios, fillSegmented, fillText, attachFiles, dedupeUnknowns, beforeSubmit, submitConfirmed, flaggedQuestions, NOT_CONFIRMED } from '../core/forms.mjs';

export const source = 'ats';
export const label = 'Company forms (Lever, Ashby, Greenhouse)';

export function detectAts(url) {
  let h;
  let p;
  try { ({ hostname: h, pathname: p } = new URL(url)); h = h.toLowerCase(); } catch { return null; }
  if (h.endsWith('ashbyhq.com') && !h.startsWith('api.') && !/\/embed\/?$/.test(p)) return 'ashby';
  // app/my are Greenhouse's own sign in and candidate pages, not a job form
  if (h.endsWith('greenhouse.io') && !/^(app|my|api|boards-api)\./.test(h)) return 'greenhouse';
  if (h.endsWith('lever.co') && !h.startsWith('api.')) return 'lever';
  return null;
}

/**
 * The Lever, Ashby or Greenhouse form behind a link, or null. The link itself
 * when it is one; otherwise it is opened in `page` and followed: a redirect
 * (Indeed and LinkedIn wrap links), the form a company careers page embeds
 * (careers.airbnb.com/positions/123?gh_jid=123 holds a Greenhouse form in a
 * frame), or the page's own Apply link to one of them.
 */
export async function resolveAts(page, url) {
  if (detectAts(url)) return url;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch { return null; }
  await sleep(3000);
  if (detectAts(page.url())) return page.url();
  const found = await page.evaluate(() => {
    const ATS = /(^|\.)(greenhouse\.io|ashbyhq\.com|lever\.co)$/i;
    const host = (u) => { try { return new URL(u, location.href).hostname; } catch { return ''; } };
    return {
      frames: [...document.querySelectorAll('iframe[src]')].map((f) => f.src).filter((u) => ATS.test(host(u))),
      scripts: [...document.querySelectorAll('script[src]')].map((x) => x.src).filter((u) => ATS.test(host(u))),
      links: [...document.querySelectorAll('a[href]')].filter((a) => ATS.test(host(a.href)) && /apply|application/i.test(`${a.textContent} ${a.href}`)).map((a) => a.href),
      search: location.search,
    };
  }).catch(() => null);
  if (!found) return null;
  const q = new URLSearchParams(found.search);
  // Greenhouse: the embedded form frame, or build it from the board the page loads
  const ghFrame = found.frames.find((u) => /greenhouse\.io\/embed\/job_app\b/i.test(u));
  if (ghFrame) return ghFrame;
  const ghBoard = found.scripts.map((u) => { try { return new URL(u).searchParams.get('for'); } catch { return null; } }).find(Boolean);
  if (ghBoard && /^\d+$/.test(q.get('gh_jid') || '')) return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(ghBoard)}&token=${q.get('gh_jid')}`;
  // Ashby: its embed names the company, and ashby_jid names the job
  const ashbyOrg = [...found.frames, ...found.scripts].map((u) => { try { const x = new URL(u); return /ashbyhq\.com$/i.test(x.hostname) ? x.pathname.split('/').filter(Boolean)[0] : null; } catch { return null; } }).find(Boolean);
  const ashbyJob = q.get('ashby_jid');
  if (ashbyOrg && ashbyJob && /^[\w-]{8,}$/.test(ashbyJob)) return `https://jobs.ashbyhq.com/${encodeURIComponent(ashbyOrg)}/${ashbyJob}/application`;
  const frame = found.frames.find((u) => detectAts(u));
  if (frame) return frame;
  return found.links.find((u) => detectAts(u)) || null;
}

/** Follows ?url= style redirect wrappers that job boards put around links. */
export function unwrapRedirect(u) {
  try {
    const url = new URL(u);
    for (const k of ['url', 'redirect', 'redirect_url', 'to', 'target', 'destination', 'u', 'dest']) {
      const v = url.searchParams.get(k);
      if (v && /^https?:\/\//i.test(v)) return v;
    }
  } catch { /* keep */ }
  return u;
}

export function applyUrl(url) {
  const ats = detectAts(url);
  const u = new URL(url);
  const p = u.pathname.replace(/\/+$/, '');
  if (ats === 'ashby' && !/\/application$/.test(p)) u.pathname = `${p}/application`;
  if (ats === 'lever' && !/\/apply$/.test(p)) u.pathname = `${p}/apply`;
  return u.toString();
}

const pretty = (seg) => { try { seg = decodeURIComponent(seg); } catch { /* raw */ } return seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim(); };
export function companyFromUrl(url) {
  try { return pretty(new URL(url).pathname.split('/').filter(Boolean)[0] || ''); } catch { return ''; }
}

async function titleOf(page, ats) {
  const sels = {
    ashby: ['h1[class*="_title"]', 'h1'],
    greenhouse: ['h1.app-title', '.job__title h1', 'h1.section-header--large', 'h1'],
    lever: ['.posting-headline h2', 'h2.posting-headline', 'h1', 'h2'],
  }[ats] || ['h1', 'h2'];
  for (const sel of sels) {
    const t = (await page.locator(sel).first().innerText({ timeout: 1500 }).catch(() => '')).trim().replace(/\s+/g, ' ');
    if (t) return t;
  }
  return (await page.title().catch(() => '')).split(/[|@–-]/)[0].trim();
}

function formRoot(page, ats) {
  const sel = {
    ashby: 'form, [class*="_applicationForm"], body',
    greenhouse: '#application-form, #application_form, form[action*="greenhouse"], #main_fields, form, body',
    lever: 'form#application-form, form[action*="lever"], form, body',
  }[ats] || 'form, body';
  return page.locator(sel).first();
}

export async function details(page, job) {
  await page.goto(applyUrl(job.url), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  const ats = detectAts(job.url);
  const title = await titleOf(page, ats);
  const description = (await page.locator('main, body').first().innerText({ timeout: 3000 }).catch(() => '')).slice(0, 15000);
  return { title: job.title || title, company: job.company || companyFromUrl(job.url), description, applyType: 'ats' };
}

const CONFIRM = /thank(s| you)|application (has been )?(submitted|received|sent)|we('| ha)ve received|successfully submitted/i;

/**
 * ctx: { bank, submit, aiAutoSubmit, draft, docs: {resume, coverLetter, transcript}, log, confirmTimeout? }
 * 'submitted' is returned only when the site confirmed it; a click with no
 * confirmation comes back as 'needs_review' with the tab left open.
 */
export async function apply(page, job, ctx) {
  const ats = detectAts(job.url);
  if (!ats) return { status: 'external_manual', note: 'not a Lever, Ashby or Greenhouse form' };
  const url = applyUrl(job.url);
  if (page.url().replace(/\/+$/, '') !== url.replace(/\/+$/, '')) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  if (await detectCaptcha(page)) return { status: 'blocked', note: `${ats}: a captcha is showing; finish this one yourself`, keepTab: true };
  const title = await titleOf(page, ats);
  const root = formRoot(page, ats);
  // an embedded form has no heading, so a form with fields is never "closed"
  const fields = await root.locator('input:not([type=hidden]), textarea, select').count().catch(() => 0);
  // a closed Greenhouse job sends you to the company's board with ?error=true
  const gone = /[?&]error=true\b/.test(page.url());
  if (gone || /page not found|job not found|\b404\b|no longer (accepting|available)|position.*(closed|filled)/i.test(title) || (!title && !fields)) {
    return { status: 'error', note: `${ats}: the posting looks closed`, keepTab: false };
  }
  if (!fields) return { status: 'error', note: `${ats}: no application form on this page; the tab is left open`, keepTab: true };
  const attached = await attachFiles(root, ctx.docs);
  // the file input holds exactly this file, so this is the resume that was sent
  const resumeUsed = attached.includes('resume') ? String(ctx.docs.resume).split(/[\\/]/).pop() : null;
  // Ashby reads the resume and re-renders the form; wait so answers stick
  await sleep(ats === 'ashby' ? 5000 : 1500);
  const unknowns = [];
  const drafted = [];
  await fillAll(page, root, ctx.bank, unknowns, { draft: ctx.draft, drafted });
  const blocking = dedupeUnknowns(unknowns).filter((u) => u.required);
  if (blocking.length) return { status: 'needs_answer', note: `${blocking.length} required question(s) need an answer; the tab is left open`, unknowns: blocking, drafted, resumeUsed, keepTab: true };
  if (!ctx.submit) return { status: 'filled_not_submitted', note: 'filled; review and submit in the open tab (submit is off)', drafted, resumeUsed, keepTab: true };
  if (drafted.length && !ctx.aiAutoSubmit) return { status: 'needs_review', note: `AI wrote ${drafted.length} answer(s); read them in the open tab and submit`, drafted, resumeUsed, keepTab: true };

  const submit = page.locator('button:has-text("Submit application"), button:has-text("Submit Application"), input[type="submit"][value*="Submit" i], button[type="submit"]').first();
  if (!await submit.isVisible({ timeout: 3000 }).catch(() => false)) return { status: 'error', note: 'no submit button found; the tab is left open', keepTab: true };
  // "Thank you for your interest" is often already in the posting, so only
  // text that appears after the click (or the form going away) counts
  let before = await beforeSubmit(page, submit, CONFIRM);
  await submit.click({ timeout: 8000 });
  await sleep(3000);
  if (await detectCaptcha(page)) return { status: 'blocked', note: 'a captcha appeared after submit; finish it in the open tab', keepTab: true };
  const wait = ctx.confirmTimeout ?? 12000;
  let ok = await submitConfirmed(page, before, { re: CONFIRM, submit, timeout: wait });
  if (!ok) {
    // one repair round: some widgets lose state when the page re-renders
    const scratch = [];
    await fillRadios(root, ctx.bank, scratch, { force: true });
    await fillSegmented(root, ctx.bank, scratch, { force: true });
    await fillText(page, root, ctx.bank, scratch);
    if (await submit.isVisible({ timeout: 2000 }).catch(() => false)) {
      before = await beforeSubmit(page, submit, CONFIRM);
      await submit.click({ timeout: 8000 }).catch(() => {});
      await sleep(3000);
      ok = await submitConfirmed(page, before, { re: CONFIRM, submit, timeout: wait });
    }
  }
  if (ok) return { status: 'submitted', note: '', drafted, resumeUsed };
  // ask about the flagged fields by their labels, never by the error text
  const flagged = await flaggedQuestions(page.locator('body'));
  if (flagged.flagged) {
    return { status: 'needs_answer', note: 'the form flagged answers after submit; the tab is left open', unknowns: flagged.questions.map((q) => ({ question: q, options: [], required: true })), drafted, resumeUsed, keepTab: true };
  }
  return { status: 'needs_review', note: NOT_CONFIRMED, drafted, resumeUsed, keepTab: true };
}
