// Generic form filling, shared by every site. Each pass finds one kind of
// control (text, select, radio group, segmented buttons, checkbox, file),
// reads its question, looks it up in the answer bank, and fills it with real
// clicks and keystrokes. Anything the bank cannot answer is collected as an
// "unknown" instead of guessed.
import { matchAnswer, pickOption } from './answers.mjs';
import { isEssayQuestion } from './ai.mjs';
import { sleep } from './safety.mjs';

/**
 * React-controlled inputs (LinkedIn, Ashby) drop values set with fill() unless
 * real input events fire, so type the text key by key.
 */
export async function typeLikeHuman(loc, text, { delay = 18 } = {}) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 4000 });
  await loc.fill('').catch(() => {});
  await loc.pressSequentially(String(text), { delay });
  await loc.dispatchEvent('change').catch(() => {});
}

/** Long answers: fill at once, then a real keystroke so React notices. */
export async function fillLongText(loc, text) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 4000 }).catch(() => {});
  await loc.fill(String(text));
  await loc.press('End').catch(() => {});
  await loc.pressSequentially(' ', { delay: 20 }).catch(() => {});
  await loc.press('Backspace').catch(() => {});
  await loc.dispatchEvent('change').catch(() => {});
}

/** Typeahead / react-select: type, then pick the matching suggestion. */
export async function fillCombobox(page, input, entry) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ timeout: 4000 });
  await input.fill('').catch(() => {});
  const query = String(entry.typeaheadAnswer || entry.answer);
  await input.pressSequentially(query, { delay: 30 });
  await sleep(1200);
  const options = page.locator('[role="listbox"] [role="option"], [role="option"]');
  let n = await options.count().catch(() => 0);
  if (!n && query.includes(',')) {
    await input.fill('').catch(() => {});
    await input.pressSequentially(query.split(',')[0].trim(), { delay: 30 });
    await sleep(1200);
    n = await options.count().catch(() => 0);
  }
  if (!n) {
    // No suggestions, so this is a plain text box (Lever's "Current location").
    // Never press Enter here: in a plain input Enter submits the whole form,
    // even with Submit off. Type the full answer and leave the field instead.
    if (String(entry.answer) !== query) await input.fill(String(entry.answer)).catch(() => {});
    await input.dispatchEvent('change').catch(() => {});
    await input.evaluate((el) => el.blur()).catch(() => {});
    return true;
  }
  const texts = [];
  for (let i = 0; i < Math.min(n, 25); i++) texts.push((await options.nth(i).innerText().catch(() => '')).trim());
  const pick = pickOption(texts, entry);
  if (pick < 0) {
    if (entry.first) { await options.nth(0).click().catch(() => {}); return true; }
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  await options.nth(pick).click().catch(() => {});
  return true;
}

/** The question text for a control: label[for], aria, wrapping label, field container, placeholder. */
export async function labelFor(control) {
  return control.evaluate((el) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l && clean(l.textContent)) return clean(l.textContent);
      } catch { /* ignore */ }
    }
    const al = el.getAttribute('aria-label');
    if (al) return clean(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ');
      if (clean(t)) return clean(t);
    }
    const pl = el.closest('label');
    if (pl && clean(pl.textContent)) return clean(pl.textContent);
    const WRAP = '[class*="_fieldEntry"], [class*="fieldEntry"], .field, .application-question, .custom-question, .fb-dash-form-element, [data-test-form-element], fieldset, [class*="field" i], [class*="question" i]';
    // how many separate fields a wrapper holds (a radio group counts once)
    const fields = (w) => new Set([...w.querySelectorAll('input:not([type=hidden]), select, textarea')].map((x) => ((x.type === 'radio' || x.type === 'checkbox') && x.name ? `n:${x.name}` : x))).size;
    // the nearest wrapper may hold only the input (Lever's "application-field"),
    // so go on to the next one out while it still holds just this field
    for (let wrap = el.closest(WRAP), hops = 0; wrap && hops < 4; wrap = wrap.parentElement?.closest(WRAP), hops++) {
      if (hops > 0 && fields(wrap) > 1) break;
      const l = wrap.querySelector('label, legend, .application-label, [class*="label" i]');
      if (l && clean(l.textContent)) return clean(l.textContent);
    }
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
  }).catch(() => '');
}

export async function isRequired(control, label = '') {
  if (/[*✱]/.test(label)) return true;
  return control.evaluate((el) => {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const wrap = el.closest('[class*="field" i], .application-question, fieldset, .fb-dash-form-element');
    return !!(wrap && /[*✱]/.test(wrap.querySelector('label, legend')?.textContent || ''));
  }).catch(() => false);
}

const TEXT_SEL = 'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input:not([type]), textarea';

export async function fillText(page, root, bank, unknowns, opts = {}) {
  const { overwriteBadCity = false } = opts;
  const inputs = root.locator(TEXT_SEL);
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const inp = inputs.nth(i);
    if (!await inp.isVisible().catch(() => false)) continue;
    if (await inp.evaluate((el) => el.type === 'search' || el.readOnly || el.disabled).catch(() => true)) continue;
    const existing = (await inp.inputValue().catch(() => '')).trim();
    const label = await labelFor(inp);
    // some sites prefill "City" with a region string their own validator rejects
    const badCity = overwriteBadCity && existing && /\b(city|location)\b/i.test(label) && /bay area|metropolitan|greater /i.test(existing);
    if (existing && !badCity) continue;
    if (badCity) await inp.fill('').catch(() => {});
    const required = await isRequired(inp, label);
    const meta = await inp.evaluate((el) => ({ textarea: el.tagName === 'TEXTAREA', max: el.maxLength > 0 ? el.maxLength : 0 })).catch(() => ({}));
    // open-ended questions (and longer questions in a big text box) never get a
    // profile fact like your phone or school; only your own saved answers
    const essay = isEssayQuestion(label, meta);
    const entry = matchAnswer(bank, label, { essay });
    if (!entry) {
      // open-ended question: let AI draft it when that is switched on
      if (opts.draft && label && essay) {
        const text = await opts.draft(label, { maxChars: meta.max || 0 });
        if (text) { await fillLongText(inp, text); opts.drafted?.push({ question: label, answer: text }); continue; }
      }
      if (label) unknowns.push({ question: label, options: [], required, essay });
      continue;
    }
    if (entry.type === 'skip') continue;
    const combo = await inp.evaluate((el) => el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list'
      || !!el.closest('[class*="select__control" i], .select2-container')).catch(() => false);
    if (combo || /\b(city|location)\b/i.test(label) && entry.typeaheadAnswer) {
      const ok = await fillCombobox(page, inp, entry);
      if (!ok) unknowns.push({ question: label, options: [], required, note: 'no matching suggestion' });
    } else {
      await typeLikeHuman(inp, entry.answer);
    }
  }
}

export async function fillSelects(root, bank, unknowns) {
  const selects = root.locator('select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const sel = selects.nth(i);
    const label = await labelFor(sel);
    const optionTexts = (await sel.locator('option').allInnerTexts().catch(() => [])).map((t) => t.trim());
    const ph = optionTexts.findIndex((t) => !t || /^(select|choose|please|--)/i.test(t));
    const cur = await sel.evaluate((el) => el.selectedIndex).catch(() => -1);
    if (cur > 0 && cur !== ph) continue;
    const visible = await sel.isVisible().catch(() => false);
    const required = await isRequired(sel, label);
    const entry = matchAnswer(bank, label);
    const opts = optionTexts.filter((_, j) => j !== ph);
    if (!entry) { if (label) unknowns.push({ question: label, options: opts, required }); continue; }
    if (entry.type === 'skip') continue;
    const pick = pickOption(optionTexts, entry);
    if (pick < 0 || pick === ph) { unknowns.push({ question: label, options: opts, required }); continue; }
    if (visible) await sel.selectOption({ index: pick }).catch(() => {});
    else { await sel.selectOption({ index: pick }, { force: true }).catch(() => {}); await sel.dispatchEvent('change').catch(() => {}); }
  }
}

/**
 * Radios grouped by their `name` (what the browser groups them by), then the
 * question is the nearest text before the group that is not one of its options.
 * A name reused across separate fieldsets is split per fieldset; radios with
 * no name are grouped by question.
 */
export async function fillRadios(root, bank, unknowns, { force = false } = {}) {
  const found = await root.locator('input[type="radio"]').evaluateAll((els) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const key = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const labelOf = (el) => (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
    const optionOf = (el) => clean(labelOf(el)?.textContent || '') || clean(el.closest('label')?.textContent || el.getAttribute('aria-label') || el.value || '');
    const shown = (n) => !!(n && (n.offsetParent || n.getClientRects().length));
    const forms = [];
    const radios = els.map((el, idx) => {
      el.setAttribute('data-jp-radio', String(idx));
      if (!forms.includes(el.form)) forms.push(el.form);
      return { el, idx, name: el.name || '', option: optionOf(el) };
    });

    // 1. by name, per form
    const byName = new Map();
    for (const r of radios) {
      const k = r.name ? `${forms.indexOf(r.el.form)}|${r.name}` : `#${r.idx}`;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(r);
    }
    // 2. one name used for separate questions: split when each fieldset holds a real group
    const groups = [];
    for (const list of byName.values()) {
      const parts = new Map();
      for (const r of list) {
        const c = r.el.closest('fieldset, [role="radiogroup"]');
        if (!parts.has(c)) parts.set(c, []);
        parts.get(c).push(r);
      }
      if (parts.size > 1 && [...parts.values()].every((p) => p.length > 1)) groups.push(...parts.values());
      else groups.push(list);
    }

    // 3. the question: walk up from the first radio, reading the text just before it
    const questionOf = (list) => {
      const mine = new Set(list.map((r) => r.el));
      const name = list[0].name;
      const opts = new Set(list.map((r) => key(r.option)).filter(Boolean));
      const good = (t) => !!t && /\p{L}{2}/u.test(t) && !opts.has(key(t));
      const choiceLabel = (n) => {
        const f = n.tagName === 'LABEL' && n.getAttribute('for');
        const t = f && document.getElementById(f);
        return !!t && /^(radio|checkbox)$/i.test(t.type || '');
      };
      // another field (text box, select, checkbox, another radio group) sits between: stop there
      const otherField = (n) => {
        if (n.nodeType !== 1) return false;
        if (n.matches('input:not([type=hidden]):not([type=radio]), select, textarea') || n.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea')) return true;
        const rs = n.matches('input[type=radio]') ? [n] : [...n.querySelectorAll('input[type=radio]')];
        return rs.some((x) => !mine.has(x) && (name ? x.name !== name : !!x.name));
      };
      const textOf = (n) => {
        if (n.nodeType === 3) return clean(n.textContent);
        if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|BUTTON)$/.test(n.tagName) || choiceLabel(n)) return '';
        if (n.querySelector('input, select, textarea')) return '';
        return clean(n.textContent);
      };
      // a fieldset that holds only this group: its legend is the question
      const fs = list[0].el.closest('fieldset');
      const lg = fs && [...fs.children].find((c) => c.tagName === 'LEGEND');
      if (lg && [...fs.querySelectorAll('input[type=radio]')].every((x) => mine.has(x)) && good(clean(lg.textContent))) return clean(lg.textContent);
      for (let node = list[0].el, hops = 0; node && node !== document.body && hops < 8; node = node.parentElement, hops++) {
        if (hops > 0) {
          const lb = node.getAttribute('aria-labelledby');
          const t = lb ? clean(lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ')) : '';
          if (good(t)) return t;
          const al = /^(radiogroup|group)$/.test(node.getAttribute('role') || '') ? clean(node.getAttribute('aria-label')) : '';
          if (good(al)) return al;
        }
        for (let s = node.previousSibling; s; s = s.previousSibling) {
          if (otherField(s)) return '';
          const t = textOf(s);
          if (good(t)) return t;
        }
      }
      return '';
    };

    return groups.map((list) => ({
      named: !!list[0].name,
      question: questionOf(list),
      radios: list.map((r) => ({ idx: r.idx, option: r.option, checked: r.el.checked, visible: shown(r.el) || shown(r.el.closest('label')) || shown(labelOf(r.el)) })),
    }));
  }).catch(() => []);
  // radios with no name: one group per question, as before
  const groups = new Map();
  for (const g of found) {
    const k = g.named ? `${g.radios[0].idx}` : `q:${g.question}`;
    if (!groups.has(k)) groups.set(k, { question: g.question || '(unlabeled choice)', radios: [] });
    groups.get(k).radios.push(...g.radios);
  }
  for (const { question, radios } of groups.values()) {
    if (!force && radios.some((r) => r.checked)) continue;
    if (!radios.some((r) => r.visible)) continue;
    const texts = radios.map((r) => r.option);
    const entry = matchAnswer(bank, question);
    if (!entry) { unknowns.push({ question, options: texts, required: true }); continue; }
    if (entry.type === 'skip') continue;
    const pick = pickOption(texts, entry);
    if (pick < 0) { unknowns.push({ question, options: texts, required: true }); continue; }
    const r = root.locator(`input[data-jp-radio="${radios[pick].idx}"]`);
    const id = await r.getAttribute('id').catch(() => null);
    let clicked = false;
    if (id) {
      const lab = root.locator(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`).first();
      if (await lab.count()) clicked = await lab.click({ timeout: 4000 }).then(() => true).catch(() => false);
    }
    if (!clicked) clicked = await r.click({ timeout: 4000 }).then(() => true).catch(() => false);
    if (!clicked) await r.check({ force: true }).catch(() => {});
    await sleep(200);
  }
}

/** Yes/No questions drawn as a pair of pressed/unpressed buttons (Ashby). */
export async function fillSegmented(root, bank, unknowns, { force = false } = {}) {
  const items = await root.locator('button[aria-pressed]').evaluateAll((els) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return els.map((el, idx) => {
      el.setAttribute('data-jp-seg', String(idx));
      let question = '';
      for (let n = el.parentElement, hops = 0; n && hops < 8 && !question; hops++, n = n.parentElement) {
        for (const l of n.querySelectorAll('legend, label, [class*="label" i], h3, h4')) {
          const t = clean(l.textContent);
          if (t && t.length > 8 && !l.contains(el)) { question = t; break; }
        }
      }
      return { idx, question, option: clean(el.innerText), pressed: el.getAttribute('aria-pressed') === 'true' };
    });
  }).catch(() => []);
  const byQ = new Map();
  for (const g of items) { const k = g.question || '(unlabeled buttons)'; if (!byQ.has(k)) byQ.set(k, []); byQ.get(k).push(g); }
  for (const [question, opts] of byQ) {
    if (opts.length < 2) continue;
    if (!force && opts.some((o) => o.pressed)) continue;
    const entry = matchAnswer(bank, question);
    if (!entry) { unknowns.push({ question, options: opts.map((o) => o.option), required: true }); continue; }
    if (entry.type === 'skip') continue;
    const pick = pickOption(opts.map((o) => o.option), entry);
    if (pick < 0) { unknowns.push({ question, options: opts.map((o) => o.option), required: true }); continue; }
    if (force && opts.length === 2) {
      // React only registers a CHANGE, so toggle away and back
      await root.locator(`button[data-jp-seg="${opts[pick ? 0 : 1].idx}"]`).click({ timeout: 4000 }).catch(() => {});
      await sleep(250);
    }
    await root.locator(`button[data-jp-seg="${opts[pick].idx}"]`).click({ timeout: 4000 }).catch(() => {});
    await sleep(200);
  }
}

/** Single consent / acknowledgement checkboxes. */
export async function fillCheckboxes(root, bank, unknowns) {
  const boxes = root.locator('input[type="checkbox"]');
  const n = await boxes.count();
  const names = new Map();
  for (let i = 0; i < n; i++) {
    const nm = (await boxes.nth(i).getAttribute('name').catch(() => '')) || `__${i}`;
    names.set(nm, (names.get(nm) || 0) + 1);
  }
  for (let i = 0; i < n; i++) {
    const cb = boxes.nth(i);
    const nm = (await cb.getAttribute('name').catch(() => '')) || `__${i}`;
    if (names.get(nm) > 1) continue;
    if (await cb.isChecked().catch(() => false)) continue;
    const label = await labelFor(cb);
    const required = await isRequired(cb, label);
    const entry = matchAnswer(bank, label);
    if (!entry) { if (required) unknowns.push({ question: label, options: ['(checkbox)'], required }); continue; }
    if (entry.type === 'skip') continue;
    if (entry.type === 'check' || /^yes/i.test(entry.answer || '')) {
      const id = await cb.getAttribute('id').catch(() => null);
      const lab = id ? root.locator(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`).first() : null;
      if (lab && await lab.count()) await lab.click({ timeout: 3000 }).catch(() => cb.check({ force: true }).catch(() => {}));
      else await cb.check({ force: true }).catch(() => {});
    } else if (required) {
      // your profile says this statement is not true for you (for example "I am
      // authorized to work" with authorization set to No): never tick it, ask you
      unknowns.push({ question: label, options: ['(checkbox)'], required, note: `your profile answer is "${entry.answer}", so it was left unticked` });
    }
  }
}

/**
 * Attaches files by what each upload field is for: resume/CV, cover letter,
 * transcript. Returns which documents were attached.
 */
export async function attachFiles(root, docs = {}) {
  const inputs = root.locator('input[type="file"]');
  const n = await inputs.count();
  const done = [];
  for (let i = 0; i < n; i++) {
    const fi = inputs.nth(i);
    const ctx = (await fi.evaluate((el) => {
      const w = el.closest('[class*="_fieldEntry"], [class*="fieldEntry"], .field, [class*="field" i], [class*="upload" i], div');
      return `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${(w?.textContent || '').slice(0, 250)}`;
    }).catch(() => '')).toLowerCase();
    let kind = /cover/.test(ctx) ? 'coverLetter' : /transcript/.test(ctx) ? 'transcript' : /resume|\bcv\b/.test(ctx) ? 'resume' : null;
    if (!kind && n === 1) kind = 'resume';
    if (!kind || !docs[kind] || done.includes(kind)) continue;
    await fi.setInputFiles(docs[kind]).catch(() => {});
    done.push(kind);
    await sleep(1500);
  }
  return done;
}

/** Every pass, in the order that survives re-renders best. */
export async function fillAll(page, root, bank, unknowns, opts = {}) {
  await fillText(page, root, bank, unknowns, opts);
  await fillSelects(root, bank, unknowns);
  await fillRadios(root, bank, unknowns);
  await fillSegmented(root, bank, unknowns);
  await fillCheckboxes(root, bank, unknowns);
  await sleep(500);
  // dependent fields (state after country) appear after the first pass
  await fillText(page, root, bank, unknowns, opts);
}

/** Collapse repeats so each unknown question shows once. */
export function dedupeUnknowns(unknowns) {
  const seen = new Set();
  return unknowns.filter((u) => {
    const k = String(u.question || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ---- after Submit: did the site really confirm it? --------------------------

async function visibleMatches(page, re) {
  return page.getByText(re).evaluateAll((els) => els
    .filter((e) => (e.offsetParent || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200))).catch(() => []);
}

/**
 * Call right before clicking Submit. Remembers the URL, any confirmation-like
 * text already on the page ("Thank you for your interest" in a job
 * description), and tags the visible fields of the form the button belongs to.
 */
export async function beforeSubmit(page, submit, re) {
  const texts = await visibleMatches(page, re);
  const fields = await submit.evaluate((b) => {
    const box = b.form || b.closest('form, [role=dialog], [data-jp-modal]') || document.body;
    document.querySelectorAll('[data-jp-sent]').forEach((x) => x.removeAttribute('data-jp-sent'));
    let n = 0;
    for (const el of box.querySelectorAll('input:not([type=hidden]), textarea, select')) {
      if (el.offsetParent || el.getClientRects().length) { el.setAttribute('data-jp-sent', '1'); n++; }
    }
    return n;
  }).catch(() => 0);
  return { url: page.url(), texts, fields };
}

/**
 * True only when the submit really went through: confirmation text that was
 * not on the page before, or the Submit button is gone and either the page
 * moved to a new URL or the form's fields are gone.
 */
export async function submitConfirmed(page, before, { re, submit, timeout = 15000 }) {
  const end = Date.now() + timeout;
  for (;;) {
    const left = [...before.texts];
    for (const t of await visibleMatches(page, re)) {
      const i = left.indexOf(t);
      if (i < 0) return true;
      left.splice(i, 1);
    }
    if (!await submit.isVisible().catch(() => false)) {
      if (page.url() !== before.url) return true;
      const gone = before.fields > 0 && await page.evaluate(() => ![...document.querySelectorAll('[data-jp-sent]')]
        .some((el) => el.isConnected && (el.offsetParent || el.getClientRects().length))).catch(() => false);
      if (gone) return true;
    }
    if (Date.now() >= end) return false;
    await sleep(500);
  }
}

export const NOT_CONFIRMED = 'clicked Submit but did not see a confirmation; check the tab';

// ---- which resume is attached ------------------------------------------------

const DOC_EXT = /\.(pdf|docx?|rtf|txt|odt)$/i;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `text` names exactly this file: "Jane_Doe_Resume.pdf" matches
 * "Jane_Doe_Resume.pdf" or "Jane_Doe_Resume", but not "Jane_Doe_Resume_ML.pdf".
 */
export function hasFileName(text, file) {
  const re = fileNameRe(file);
  return !!re && re.test(String(text || ''));
}

/** The regex behind hasFileName (its .source can go into page.evaluate), or null for no file. */
export function fileNameRe(file) {
  const full = String(file || '').split(/[\\/]/).pop().trim();
  if (!full) return null;
  const ext = (full.match(DOC_EXT) || [''])[0];
  const base = ext ? full.slice(0, -ext.length) : full;
  return new RegExp(`(^|[^\\w.-])${escRe(base)}(${escRe(ext)})?(?![\\w-]|\\.\\w)`, 'i');
}

/** The first file name shown in a bit of text, or ''. */
export function fileNameIn(text) {
  return (String(text || '').match(/[^\s\\/"'<>|]+\.(pdf|docx?|rtf|txt|odt)\b/i) || [''])[0];
}

export const RESUME_UNCONFIRMED = "couldn't confirm the right resume is attached; check before sending";

// resume choices drawn as cards with a radio (LinkedIn, Indeed); tags each one
async function readResumeCards(scope, re) {
  return scope.evaluate((box, { src, flags }) => {
    const re = new RegExp(src, flags);
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    box.querySelectorAll('[data-jp-resume]').forEach((x) => x.removeAttribute('data-jp-resume'));
    const DOC = /\.(pdf|docx?|rtf|odt|txt)\b|\bindeed resume\b/i;
    const RADIO = 'input[type="radio"], [role="radio"]';
    const cards = [];
    for (const r of box.querySelectorAll(RADIO)) {
      // the card: the largest container around this radio alone, stopping once it names a file
      let card = null;
      for (let el = r.parentElement, h = 0; el && el !== box && h < 6; el = el.parentElement, h++) {
        if (el.querySelectorAll(RADIO).length > 1) break;
        card = el;
        if (DOC.test(el.innerText || '')) break;
      }
      const lab = r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
      const by = (r.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => (i && document.getElementById(i)?.innerText) || '').join(' ');
      const text = clean(`${card?.innerText || ''} ${r.innerText || ''} ${lab?.innerText || ''} ${by} ${r.getAttribute('aria-label') || ''} ${r.value || ''}`);
      if (!DOC.test(text)) continue;
      const selected = r.checked === true || r.getAttribute('aria-checked') === 'true' || /--selected|\bselected\b/i.test(card?.className || '');
      r.setAttribute('data-jp-resume', String(cards.length));
      cards.push({ text, wanted: re.test(text), selected });
    }
    return cards;
  }, { src: re.source, flags: re.flags }).catch(() => []);
}

/**
 * Resume cards: select the one that names exactly `file`, then read back which
 * card is selected. { state: 'none' (no resume cards here) | 'ok' |
 * 'unconfirmed', used: the selected file name, listed: whether `file` is a card }.
 */
export async function selectResumeCard(scope, file) {
  const re = fileNameRe(file);
  if (!re) return { state: 'none', used: null, listed: false };
  let cards = await readResumeCards(scope, re);
  if (!cards.length) return { state: 'none', used: null, listed: false };
  const i = cards.findIndex((c) => c.wanted);
  if (i >= 0 && !cards[i].selected) {
    const radio = scope.locator(`[data-jp-resume="${i}"]`);
    const id = await radio.getAttribute('id').catch(() => null);
    const lab = id ? scope.locator(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`).first() : null;
    if (lab && await lab.count()) await lab.click({ timeout: 3000 }).catch(() => {});
    else await radio.check({ force: true, timeout: 3000 }).catch(() => radio.click({ force: true, timeout: 3000 }).catch(() => {}));
    await sleep(400);
    cards = await readResumeCards(scope, re);
    if (!cards[i]?.selected) {
      await scope.locator(`[data-jp-resume="${i}"]`).check({ force: true, timeout: 3000 }).catch(() => {});
      await sleep(300);
      cards = await readResumeCards(scope, re);
    }
  }
  const sel = cards.find((c) => c.selected);
  if (sel?.wanted) return { state: 'ok', used: String(file).split(/[\\/]/).pop(), listed: true };
  return { state: 'unconfirmed', used: sel ? fileNameIn(sel.text) || sel.text.slice(0, 60) : null, listed: i >= 0 };
}

// ---- errors after Submit -----------------------------------------------------

/**
 * The questions a form flagged after Submit, by the label of each flagged
 * field ("Phone"), never the error text itself ("This field is required.").
 * `flagged` says whether any error showed at all.
 */
export async function flaggedQuestions(scope) {
  const res = await scope.locator('[class*="error" i], [role="alert"]').evaluateAll((nodes) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const shown = (n) => !!(n.offsetParent || n.getClientRects().length);
    const LBL = 'label, legend, [id$="-label"], [class*="label" i]';
    const MSG = /^(this (field|question)|please|required|invalid|must|enter|select|error)\b|\bis required\b|\bnot valid\b/i;
    // how many separate fields a container holds (a radio group counts once)
    const fieldCount = (el) => new Set([...el.querySelectorAll('input:not([type=hidden]), select, textarea')].map((x) => (x.type === 'radio' || x.type === 'checkbox') && x.name ? `n:${x.name}` : x)).size;
    let flagged = false;
    const out = [];
    for (const n of nodes) {
      const err = clean(n.innerText);
      if (!shown(n) || !err || err.length > 300) continue;
      flagged = true;
      for (let el = n, h = 0; el && el !== document.body && h < 6; h++, el = el.parentElement) {
        if (h > 0 && fieldCount(el) > 1) break; // reached a container with several fields: no single label
        const cands = el.matches(LBL) && el !== n ? [el] : [...el.querySelectorAll(LBL)];
        const l = cands.find((c) => c !== n && !n.contains(c) && clean(clean(c.textContent).replace(err, '')));
        const t = l ? clean(clean(l.textContent).replace(err, '')) : '';
        if (t && !MSG.test(t) && /\p{L}{2}/u.test(t)) { out.push(t); break; }
      }
    }
    return { flagged, questions: out };
  }).catch(() => ({ flagged: false, questions: [] }));
  const invalid = scope.locator('[aria-invalid="true"]');
  const n = Math.min(await invalid.count().catch(() => 0), 20);
  for (let i = 0; i < n; i++) {
    const c = invalid.nth(i);
    if (!await c.isVisible().catch(() => false)) continue;
    res.flagged = true;
    const t = await labelFor(c);
    if (t) res.questions.push(t);
  }
  res.questions = [...new Set(res.questions)];
  return res;
}
