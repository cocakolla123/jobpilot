// Handshake: search, read a posting, press Save, and Quick apply.
// Handshake attaches documents from your Handshake library, so the resume
// (and transcript) you upload there should have the same file name as the one
// in your JobPilot resumes folder. Setup > Check my accounts compares them.
import { assertNoWall, sleep } from '../core/safety.mjs';
import { fillAll, attachFiles, dedupeUnknowns } from '../core/forms.mjs';

export const source = 'handshake';
export const label = 'Handshake';
export const home = 'https://app.joinhandshake.com/job-search';

export function searchUrl(s) {
  if (s.urls?.handshake) return s.urls.handshake;
  const u = new URL('https://app.joinhandshake.com/job-search');
  const words = [s.keywords, (s.experience || []).includes('internship') ? 'internship' : ''].filter(Boolean).join(' ');
  if (words) u.searchParams.set('query', words);
  u.searchParams.set('per_page', '25');
  return u.toString();
}

export const viewUrl = (id) => `https://app.joinhandshake.com/job-search/${id}`;

/** Cards on the results page: id from the card link, company and title from its text. */
async function readCards(page) {
  return page.evaluate(() => {
    const out = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/job-search/"]')) {
      const id = (a.getAttribute('href').match(/job-search\/(\d+)/) || [])[1];
      if (!id || seen.has(id)) continue;
      let card = a;
      for (let i = 0; i < 6 && card.parentElement && (card.innerText || '').split('\n').filter(Boolean).length < 3; i++) card = card.parentElement;
      const lines = (card.innerText || '').split('\n').map((x) => x.trim()).filter((x) => x && x !== '∙' && !/^selected,/i.test(x));
      if (lines.length < 2) continue;
      seen.add(id);
      out.push({ id, company: lines[0], title: lines[1], meta: lines.slice(2, 6).join(' · ') });
    }
    return out;
  }).catch(() => []);
}

export async function search(page, s, ctx) {
  const max = ctx.limit || 25;
  await page.goto(searchUrl(s), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4000);
  await assertNoWall(page, source);
  const found = new Map();
  for (let round = 0; round < 10 && found.size < max; round++) {
    const before = found.size;
    for (const c of await readCards(page)) {
      if (!found.has(c.id)) found.set(c.id, { source, jobId: c.id, url: viewUrl(c.id), title: c.title, company: c.company, location: (c.meta.match(/Remote|[A-Z][a-z]+, [A-Z]{2}|United States/) || [''])[0] });
    }
    if (found.size === before) break;
    await page.mouse.wheel(0, 2500).catch(() => {});
    await page.evaluate(() => {
      const sc = [...document.querySelectorAll('div, ul')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.querySelector('a[href*="/job-search/"]') && e.scrollHeight > e.clientHeight + 100);
      if (sc) sc.scrollTop += sc.clientHeight * 0.9;
    }).catch(() => {});
    await sleep(1500);
  }
  ctx.log?.(`Handshake: ${found.size} job(s) on the results page`);
  return [...found.values()].slice(0, max);
}

const APPLY_RE = /^(quick apply|apply)$/i;
const EXTERNAL_RE = /apply externally|apply on (company|employer) site/i;

async function panelButtons(page) {
  return page.evaluate(() => [...new Set([...document.querySelectorAll('button, a')]
    .filter((b) => b.offsetParent !== null && !b.closest('[role=dialog]'))
    .map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => /^(quick )?apply( externally)?$/i.test(t) || /apply on (company|employer) site/i.test(t)))]).catch(() => []);
}

/** Opens the posting and reads it from the job panel. */
export async function details(page, job, ctx) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4000);
  await assertNoWall(page, source);
  const info = await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const btn = [...document.querySelectorAll('button, a')].find((b) => b.offsetParent && /^(quick apply|apply|apply externally)$/i.test(clean(b.innerText)));
    let panel = btn;
    for (let i = 0; i < 12 && panel?.parentElement; i++) { panel = panel.parentElement; if ((panel.innerText || '').length > 1500) break; }
    const text = panel ? panel.innerText : (document.querySelector('main')?.innerText || '');
    const h = panel?.querySelector('h1, h2, h3');
    return { text: (text || '').slice(0, 15000), heading: clean(h?.textContent || '') };
  }).catch(() => ({ text: '', heading: '' }));
  const buttons = await panelButtons(page);
  const applyType = buttons.some((b) => APPLY_RE.test(b)) ? 'quick' : buttons.some((b) => EXTERNAL_RE.test(b)) ? 'external' : 'unknown';
  ctx?.log?.(`Handshake: ${job.title || info.heading || '?'} at ${job.company || '?'} (${applyType})`);
  return { title: job.title || info.heading, company: job.company, description: info.text, applyType };
}

/** Handshake's own Save button for the open posting. */
export async function save(page, job) {
  const btn = page.locator('button').filter({ hasText: /^\s*(save|saved)\s*$/i }).first();
  const byLabel = page.locator(`button[aria-label="Save ${String(job.title || '').replace(/"/g, '\\"')}"], button[aria-label^="Save this job"]`).first();
  if (await page.locator('button[aria-label^="Unsave"], button:has-text("Saved")').first().isVisible({ timeout: 800 }).catch(() => false)) return 'already';
  const target = await btn.isVisible({ timeout: 1500 }).catch(() => false) ? btn : byLabel;
  if (!await target.isVisible({ timeout: 1500 }).catch(() => false)) return 'not-found';
  await target.click({ timeout: 4000 }).catch(() => {});
  await sleep(1000);
  return 'saved';
}

/** Where "Apply externally" goes: read the new tab's URL and close it. */
export async function externalUrl(page) {
  const btn = page.locator('button, a').filter({ hasText: EXTERNAL_RE }).first();
  if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) return null;
  const href = await btn.getAttribute('href').catch(() => null);
  if (href && /^https?:/.test(href) && !/joinhandshake\.com/.test(href)) return href;
  const popup = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
  await btn.click({ timeout: 4000 }).catch(() => {});
  const p = await popup;
  if (!p) return null;
  await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  const url = p.url();
  await p.close().catch(() => {});
  return /^https?:/.test(url) && !/joinhandshake\.com/.test(url) ? url : null;
}

// ---- documents in the quick-apply window ----------------------------------

async function tagModal(page) {
  return page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role=dialog]')].find((d) => d.offsetParent !== null && /apply to|submit application/i.test(d.innerText || ''));
    if (!dlg) return false;
    document.querySelectorAll('[data-jp-modal]').forEach((n) => n.removeAttribute('data-jp-modal'));
    dlg.setAttribute('data-jp-modal', '1');
    return true;
  }).catch(() => false);
}

/** Tags each "Attach your resume / transcript / cover letter" section and reads what it holds. */
export async function readSlots(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[data-jp-modal]');
    if (!dlg) return {};
    const HEAD = /^attach (your )?(resume|transcript|cover letter|other required documents)/i;
    const heads = [...dlg.querySelectorAll('*')].filter((e) => HEAD.test((e.innerText || '').trim()) && ![...e.children].some((c) => HEAD.test((c.innerText || '').trim())));
    const out = {};
    for (const h of heads) {
      let sec = h;
      for (let i = 0; i < 8 && sec.parentElement && sec.parentElement !== dlg; i++) {
        if (heads.some((o) => o !== h && sec.parentElement.contains(o))) break;
        sec = sec.parentElement;
        if (sec.querySelector('button[aria-label="Close"], input[type=file]')) break;
      }
      const t = h.innerText.toLowerCase();
      const kind = /resume/.test(t) ? 'resume' : /transcript/.test(t) ? 'transcript' : /cover/.test(t) ? 'coverLetter' : 'other';
      sec.setAttribute('data-jp-slot', kind);
      out[kind] = (sec.innerText || '').replace(h.innerText, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    }
    return out;
  }).catch(() => ({}));
}

const baseName = (f) => String(f || '').split(/[\\/]/).pop().replace(/\.(pdf|docx?)$/i, '');

/** Make a slot hold the wanted document: pick it from the library, else upload it. */
async function ensureSlot(page, dialog, kind, filePath) {
  const want = baseName(filePath);
  let slots = await readSlots(page);
  if (!(kind in slots)) return 'no-slot';
  if (slots[kind].includes(want)) return 'ok';
  const sec = dialog.locator(`[data-jp-slot="${kind}"]`);
  const x = sec.locator('button[aria-label="Close"]').first();
  if (await x.isVisible({ timeout: 1000 }).catch(() => false)) { await x.click({ timeout: 3000 }).catch(() => {}); await sleep(1500); }
  const searchBox = dialog.locator('input[type=search]').first();
  if (await searchBox.isVisible({ timeout: 1500 }).catch(() => false)) { await searchBox.fill(want.slice(0, 40)).catch(() => {}); await sleep(1500); }
  const hit = await page.evaluate((want) => {
    const dlg = document.querySelector('[data-jp-modal]');
    const opts = [...dlg.querySelectorAll('[role=option], li, label')].filter((o) => o.offsetParent !== null && (o.innerText || '').split('\n')[0].includes(want));
    const opt = opts.find((o) => !/\(\d+\)/.test(o.innerText.split('\n')[0])) || opts[0];
    if (opt) { (opt.querySelector('button,a,input') || opt).click(); return true; }
    return false;
  }, want).catch(() => false);
  if (!hit && filePath) {
    const fi = sec.locator('input[type=file]').first();
    const any = await fi.count() ? fi : dialog.locator('input[type=file]').first();
    if (await any.count()) {
      await any.setInputFiles(filePath).catch(() => {});
      for (let i = 0; i < 10; i++) {
        await sleep(1500);
        if (!/(converting|uploading)\.\.\./i.test(await dialog.innerText().catch(() => ''))) break;
      }
    }
  }
  await sleep(1500);
  slots = await readSlots(page);
  return slots[kind]?.includes(want) ? 'ok' : 'unverified';
}

/**
 * Quick apply. ctx: { bank, submit, aiAutoSubmit, draft, docs: {resume, transcript, coverLetter}, log }.
 * When anything is unsure the Quick apply window is left open (keepTab).
 */
export async function apply(page, job, ctx) {
  if (!page.url().includes(`/job-search/${job.jobId}`)) {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(4000);
  }
  await assertNoWall(page, source);
  const clicked = await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const b = [...document.querySelectorAll('button, a')].find((x) => /^(quick )?apply$/i.test(clean(x.innerText)) && x.offsetParent !== null && !x.closest('[role=dialog]'));
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (!clicked) {
    const btns = await panelButtons(page);
    return btns.some((b) => EXTERNAL_RE.test(b)) ? { status: 'external_manual', note: 'Handshake says apply on the company site' } : { status: 'error', note: 'no Quick apply button', keepTab: true };
  }
  await sleep(3000);
  if (!await tagModal(page)) return { status: 'error', note: 'the Quick apply window did not open', keepTab: true };
  const dialog = page.locator('[data-jp-modal]');
  const drafted = [];
  const keep = (status, note, extra = {}) => ({ status, note, drafted, keepTab: true, ...extra });
  try {
    const resumeState = await ensureSlot(page, dialog, 'resume', ctx.docs.resume);
    const transcriptState = ctx.docs.transcript ? await ensureSlot(page, dialog, 'transcript', ctx.docs.transcript) : 'no-file';
    if (ctx.docs.coverLetter) await ensureSlot(page, dialog, 'coverLetter', ctx.docs.coverLetter);
    const slots = await readSlots(page);
    if (resumeState !== 'ok' && resumeState !== 'no-slot') {
      return keep('needs_answer', `could not attach ${baseName(ctx.docs.resume)}; pick it in the open tab (or upload it to your Handshake documents)`);
    }
    if ('transcript' in slots && !['ok', 'no-slot'].includes(transcriptState)) {
      return keep('needs_answer', 'this job wants a transcript: add one in Setup > Documents, or attach it in the open tab');
    }
    const unknowns = [];
    await fillAll(page, dialog, ctx.bank, unknowns, { draft: ctx.draft, drafted });
    const blocking = dedupeUnknowns(unknowns).filter((u) => u.required);
    if (blocking.length) return keep('needs_answer', `${blocking.length} question(s) need an answer; the Quick apply window is open in its tab`, { unknowns: blocking });
    if (!ctx.submit) return keep('filled_not_submitted', 'filled; review and submit in the open tab (submit is off)');
    if (drafted.length && !ctx.aiAutoSubmit) return keep('needs_review', `AI wrote ${drafted.length} answer(s); read them in the open tab and submit`);
    await dialog.locator('button').filter({ hasText: /submit application/i }).first().click({ timeout: 8000 });
    await sleep(4000);
    const ok = await page.getByText(/application submitted|you('| ha)ve applied|successfully applied|applied on/i).first().isVisible({ timeout: 8000 }).catch(() => false);
    if (!ok) return keep('submitted', 'Submit was pressed but Handshake showed no confirmation; check the open tab');
    await page.keyboard.press('Escape').catch(() => {});
    return { status: 'submitted', note: '', drafted };
  } catch (e) {
    return keep('error', String(e.message || e).split('\n')[0].slice(0, 120));
  }
}

export async function loginState(page) {
  await page.goto('https://app.joinhandshake.com/job-search', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(2500);
  if (/login|sign_in|signin|\/auth/.test(page.url())) return { loggedIn: false, note: 'not signed in' };
  return { loggedIn: true, note: '' };
}

export const DOCS_URL = 'https://app.joinhandshake.com/docs';

async function readDocRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('tr, [role=row]')]
    .map((r) => (r.innerText || '').split(/\t|\n/).map((x) => x.trim()).filter(Boolean))
    // the first cell is the document's Name, which may not end in .pdf ("FDE_Main"), so go by the Type column
    .filter((c) => c[0] && c.length >= 4 && /^(pdf|docx?|rtf|txt|odt|png|jpe?g)$/i.test(c[1] || ''))
    .map((c) => {
      const date = c.find((x) => /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(x)) || '';
      return { name: c[0], category: c.find((x) => /^(resume|transcript|cover letter|other document|work sample)$/i.test(x)) || '', date, time: date ? Date.parse(date) : 0 };
    })).catch(() => []);
}

/** Every document in your Handshake library (all pages), newest first. */
export async function siteDocuments(page) {
  await page.goto(DOCS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await assertNoWall(page, source);
  await page.locator('tr, [role=row]').nth(1).waitFor({ timeout: 15000 }).catch(() => {});
  // show 100 per page so fewer pages to read
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /^\s*100/ }) }).first();
  if (await sel.count()) { await sel.selectOption({ index: (await sel.locator('option').count()) - 1 }).catch(() => {}); await sleep(2500); }
  const all = [];
  for (let p = 0; p < 10; p++) {
    for (const r of await readDocRows(page)) if (!all.some((x) => x.name === r.name && x.date === r.date)) all.push(r);
    const next = page.getByRole('button', { name: /^next page$/i }).first();
    if (!await next.isVisible({ timeout: 800 }).catch(() => false) || await next.isDisabled().catch(() => true)) break;
    const first = (await readDocRows(page))[0]?.name;
    await next.click().catch(() => {});
    await sleep(2500);
    if ((await readDocRows(page))[0]?.name === first) break;
  }
  return all.sort((a, b) => b.time - a.time);
}

/** Documents in your Handshake library (names), for the account check. */
export async function siteResumes(page) {
  return (await siteDocuments(page)).map((d) => d.name);
}

/**
 * Uploads one document with Handshake's own form (Documents > Upload new
 * document): the file, its Name (the dated name), and its Document Type.
 * "Visible to employers" is left off.
 */
export async function uploadDocument(page, filePath, category = 'Resume') {
  const name = filePath.split(/[\\/]/).pop();
  await page.goto(`${DOCS_URL}/new`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await assertNoWall(page, source);
  const fi = page.locator('input#file, input[type=file][name=file]').first();
  if (!await fi.waitFor({ timeout: 15000 }).then(() => true).catch(() => false)) return { ok: false, note: 'the Upload new document form did not load' };
  await fi.setInputFiles(filePath);
  await sleep(1500);
  const nameBox = page.locator('#document-name, input[name=name]').first();
  if (await nameBox.count()) { await nameBox.fill(''); await nameBox.fill(name); }
  // Document Type: a dropdown that starts on Resume
  const type = page.locator('[role=combobox], [aria-haspopup=listbox]').filter({ hasText: /resume|cover letter|transcript|other/i }).first();
  if (await type.count() && !new RegExp(`^\\s*${category}\\s*$`, 'i').test(await type.innerText().catch(() => ''))) {
    await type.click().catch(() => {});
    await sleep(600);
    await page.getByRole('option', { name: new RegExp(`^\\s*${category}`, 'i') }).first().click({ timeout: 4000 }).catch(() => {});
    await sleep(600);
    if (!new RegExp(category, 'i').test(await type.innerText().catch(() => ''))) return { ok: false, note: `could not set Document Type to ${category}` };
  }
  const pub = page.locator('#document-public, input[name=public]').first();
  if (await pub.count() && await pub.isChecked().catch(() => false)) await pub.uncheck().catch(() => {});
  const save = page.locator('button[type=submit], input[type=submit]').filter({ hasText: /save/i }).first();
  const saveBtn = await save.count() ? save : page.getByRole('button', { name: /^save$/i }).first();
  await saveBtn.click({ timeout: 8000 });
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const msg = (await page.locator('[role=alert], [role=status], [class*="error" i], [class*="toast" i]').filter({ hasText: /\w/ }).first().innerText({ timeout: 300 }).catch(() => '')).replace(/\s+/g, ' ').trim();
    // "Document saved" is Handshake's success message
    if (/saved|success|uploaded/i.test(msg) || !/\/docs\/new/.test(page.url())) break;
    if (msg && /error|invalid|too large|must|failed|couldn.t|could not/i.test(msg)) return { ok: false, note: msg.slice(0, 160) };
  }
  const docs = await siteDocuments(page);
  const hit = docs.find((d) => d.name === name || d.name.startsWith(name));
  if (hit) return { ok: true, category: hit.category, note: hit.category && !new RegExp(category, 'i').test(hit.category) ? `uploaded, but Handshake filed it as ${hit.category}` : '' };
  return { ok: false, note: `Handshake did not list ${name} after Save` };
}
