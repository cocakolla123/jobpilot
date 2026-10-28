// Company application forms: Lever, Ashby and Greenhouse. These are the
// "small forms" most external links lead to. Other sites are left for you,
// with the link saved in the dashboard.
import { detectCaptcha, sleep } from '../core/safety.mjs';
import { fillAll, fillRadios, fillSegmented, fillText, attachFiles, dedupeUnknowns } from '../core/forms.mjs';

export const source = 'ats';
export const label = 'Company forms (Lever, Ashby, Greenhouse)';

export function detectAts(url) {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (h.endsWith('ashbyhq.com')) return 'ashby';
  if (h.endsWith('greenhouse.io') && h !== 'app.greenhouse.io') return 'greenhouse';
  if (h.endsWith('lever.co')) return 'lever';
  return null;
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

/** ctx: { bank, submit, aiAutoSubmit, draft, docs: {resume, coverLetter, transcript}, log } */
export async function apply(page, job, ctx) {
  const ats = detectAts(job.url);
  if (!ats) return { status: 'external_manual', note: 'not a Lever, Ashby or Greenhouse form' };
  const url = applyUrl(job.url);
  if (page.url().replace(/\/+$/, '') !== url.replace(/\/+$/, '')) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  if (await detectCaptcha(page)) return { status: 'blocked', note: `${ats}: a captcha is showing; finish this one yourself`, keepTab: true };
  const title = await titleOf(page, ats);
  if (!title || /page not found|job not found|\b404\b|no longer (accepting|available)|position.*(closed|filled)/i.test(title)) {
    return { status: 'error', note: `${ats}: the posting looks closed`, keepTab: false };
  }
  const root = formRoot(page, ats);
  await attachFiles(root, ctx.docs);
  // Ashby reads the resume and re-renders the form; wait so answers stick
  await sleep(ats === 'ashby' ? 5000 : 1500);
  const unknowns = [];
  const drafted = [];
  await fillAll(page, root, ctx.bank, unknowns, { draft: ctx.draft, drafted });
  const blocking = dedupeUnknowns(unknowns).filter((u) => u.required);
  if (blocking.length) return { status: 'needs_answer', note: `${blocking.length} required question(s) need an answer; the tab is left open`, unknowns: blocking, drafted, keepTab: true };
  if (!ctx.submit) return { status: 'filled_not_submitted', note: 'filled; review and submit in the open tab (submit is off)', drafted, keepTab: true };
  if (drafted.length && !ctx.aiAutoSubmit) return { status: 'needs_review', note: `AI wrote ${drafted.length} answer(s); read them in the open tab and submit`, drafted, keepTab: true };

  const submit = page.locator('button:has-text("Submit application"), button:has-text("Submit Application"), input[type="submit"][value*="Submit" i], button[type="submit"]').first();
  if (!await submit.isVisible({ timeout: 3000 }).catch(() => false)) return { status: 'error', note: 'no submit button found; the tab is left open', keepTab: true };
  await submit.click({ timeout: 8000 });
  await sleep(3000);
  if (await detectCaptcha(page)) return { status: 'blocked', note: 'a captcha appeared after submit; finish it in the open tab', keepTab: true };
  let ok = await page.getByText(CONFIRM).first().isVisible({ timeout: 15000 }).catch(() => false);
  if (!ok) {
    // one repair round: some widgets lose state when the page re-renders
    const scratch = [];
    await fillRadios(root, ctx.bank, scratch, { force: true });
    await fillSegmented(root, ctx.bank, scratch, { force: true });
    await fillText(page, root, ctx.bank, scratch);
    if (await submit.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submit.click({ timeout: 8000 }).catch(() => {});
      await sleep(3000);
      ok = await page.getByText(CONFIRM).first().isVisible({ timeout: 12000 }).catch(() => false);
    }
  }
  if (ok) return { status: 'submitted', note: '', drafted };
  const errs = [...new Set((await page.locator('[class*="error" i], [role="alert"]').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter((t) => t && t.length < 200))];
  return errs.length
    ? { status: 'needs_answer', note: 'the form flagged answers after submit; the tab is left open', unknowns: errs.map((q) => ({ question: q, options: [], required: true })), drafted, keepTab: true }
    : { status: 'submitted', note: 'Submit was pressed but no confirmation showed; check the open tab', drafted, keepTab: true };
}
