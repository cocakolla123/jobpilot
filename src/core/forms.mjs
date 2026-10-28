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
  if (!n) { await page.keyboard.press('Enter').catch(() => {}); return true; }
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
    const wrap = el.closest('[class*="_fieldEntry"], [class*="fieldEntry"], .field, .application-question, .custom-question, .fb-dash-form-element, [data-test-form-element], fieldset, [class*="field" i], [class*="question" i]');
    if (wrap) {
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
    const entry = matchAnswer(bank, label);
    if (!entry) {
      // open-ended question: let AI draft it when that is switched on
      if (opts.draft && label) {
        const meta = await inp.evaluate((el) => ({ textarea: el.tagName === 'TEXTAREA', max: el.maxLength > 0 ? el.maxLength : 0 })).catch(() => ({}));
        if (isEssayQuestion(label, meta)) {
          const text = await opts.draft(label, { maxChars: meta.max || 0 });
          if (text) { await fillLongText(inp, text); opts.drafted?.push({ question: label, answer: text }); continue; }
        }
      }
      if (label) unknowns.push({ question: label, options: [], required, essay: isEssayQuestion(label) });
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

/** Radios grouped by QUESTION (some sites reuse one name across questions). */
export async function fillRadios(root, bank, unknowns, { force = false } = {}) {
  const flat = await root.locator('input[type="radio"]').evaluateAll((els) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return els.map((el, idx) => {
      let option = '';
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) option = clean(l.textContent); }
      if (!option) option = clean(el.closest('label')?.textContent || el.value || '');
      let question = '';
      const fs = el.closest('fieldset');
      const lg = fs?.querySelector('legend');
      if (lg) question = clean(lg.textContent);
      for (let n = el.parentElement, hops = 0; n && hops < 8 && !question; hops++, n = n.parentElement) {
        for (const l of n.querySelectorAll('legend, label, [class*="label" i], h3, h4')) {
          const t = clean(l.textContent);
          if (t && t !== option && !l.querySelector('input')) { question = t; break; }
        }
      }
      el.setAttribute('data-jp-radio', String(idx));
      return { idx, question, option, checked: el.checked, visible: !!(el.offsetParent || el.closest('label')?.offsetParent) };
    });
  }).catch(() => []);
  const groups = new Map();
  for (const r of flat) {
    const k = r.question || '(unlabeled choice)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [question, radios] of groups) {
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
    if (entry.type === 'check' || /^yes/i.test(entry.answer || '')) {
      const id = await cb.getAttribute('id').catch(() => null);
      const lab = id ? root.locator(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`).first() : null;
      if (lab && await lab.count()) await lab.click({ timeout: 3000 }).catch(() => cb.check({ force: true }).catch(() => {}));
      else await cb.check({ force: true }).catch(() => {});
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
