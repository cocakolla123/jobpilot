// Guard rails. JobPilot never solves or works around a captcha, login wall or
// security check: it stops that site and tells you, and you handle it in the
// browser yourself. It also paces itself and respects daily caps.

export class SecurityStop extends Error {
  constructor(message, source = '') { super(message); this.source = source; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (min, max) => min + Math.floor(Math.random() * Math.max(1, max - min));
export async function pause(settings, factor = 1) {
  const [a, b] = settings?.pauseSeconds || [6, 12];
  await sleep(jitter(a * 1000 * factor, b * 1000 * factor));
}

const CAPTCHA_SEL = 'iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="turnstile" i], '
  + 'iframe[src*="challenge" i], iframe[src*="arkoselabs" i], iframe[src*="funcaptcha" i], .g-recaptcha, .h-captcha, '
  + 'div[data-sitekey], #challenge-form, #challenge-stage';

/**
 * True when a "prove you're human" check is actually showing: a checkbox
 * widget or a picture puzzle you would have to solve. Many forms (Greenhouse,
 * Lever) carry an invisible reCAPTCHA or hCaptcha that only scores the visit
 * in the background and shows a small "protected by reCAPTCHA" badge; that is
 * not a check, so it doesn't count. When the site does pop up a puzzle, its
 * frame becomes visible and this returns true.
 */
export async function detectCaptcha(page) {
  return page.evaluate((sel) => {
    const passive = (el) => /[?&#]size=invisible\b/i.test(el.getAttribute('src') || '')
      || el.getAttribute('data-size') === 'invisible' || !!el.closest('.grecaptcha-badge');
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return false;
      // reCAPTCHA parks its hidden puzzle far above the page
      if (r.bottom + window.scrollY < 0 || r.right + window.scrollX < 0) return false;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    return [...document.querySelectorAll(sel)].some((el) => !passive(el) && shown(el));
  }, CAPTCHA_SEL).catch(() => false);
}

const WALL_URL = /checkpoint|authwall|uas\/login|\/login\b|\/signin\b|security-verification|\/challenge\/|cdn-cgi\/challenge/i;
const WALL_TEXT = /let's do a quick security check|verify you('| a)re (a )?human|unusual activity|additional verification required|are you a robot|press (and|&) hold/i;

/** Throws SecurityStop when the page is a login wall, captcha or bot check. */
const SITE_NAME = { linkedin: 'LinkedIn', handshake: 'Handshake', indeed: 'Indeed', ats: 'The company site' };

export async function assertNoWall(page, source) {
  const site = SITE_NAME[source] || source;
  const url = page.url();
  if (WALL_URL.test(url)) throw new SecurityStop(`${site} wants you to sign in or finish a security check. Do it in the open tab in JobPilot's Chrome, then run again.`, source);
  if (await detectCaptcha(page)) throw new SecurityStop(`${site} is showing a "prove you're human" check. JobPilot never solves these, so finish it in the open tab in JobPilot's Chrome and run again.`, source);
  const t = await page.getByText(WALL_TEXT).first().isVisible({ timeout: 300 }).catch(() => false);
  if (t) throw new SecurityStop(`${site} is showing a security check. Finish it in the open tab in JobPilot's Chrome, then run again.`, source);
}

export const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|director|distinguished|head\s+of)\b|\b([5-9]|1\d)\s*\+?\s*years?\b/i;
export const ENTRY_RE = /\b(intern|internship|new\s*grad|entry[-\s]?level|junior|associate|early\s*career|apprentice|graduate|university)\b|\b[0-2]\s*[-–+]\s*\d?\s*years?\b/i;
export const isSenior = (title) => SENIOR_RE.test(title || '') && !ENTRY_RE.test(title || '');

/** Reasons to skip a job before opening it, from settings. */
export function skipReason(job, settings) {
  if (settings.skipSenior && isSenior(job.title)) return 'senior title';
  const co = String(job.company || '').toLowerCase();
  if ((settings.excludeCompanies || []).some((c) => c && co.includes(String(c).toLowerCase()))) return 'company on your exclude list';
  const ti = String(job.title || '').toLowerCase();
  const w = (settings.excludeTitleWords || []).find((x) => x && ti.includes(String(x).toLowerCase()));
  if (w) return `title has "${w}"`;
  return '';
}
