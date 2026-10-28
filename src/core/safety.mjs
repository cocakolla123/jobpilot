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

export async function detectCaptcha(page) {
  const sel = 'iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="turnstile" i], '
    + 'iframe[src*="challenge" i], iframe[src*="arkoselabs" i], .g-recaptcha, .h-captcha, div[data-sitekey], #challenge-form';
  return page.locator(sel).first().isVisible({ timeout: 400 }).catch(() => false);
}

const WALL_URL = /checkpoint|authwall|uas\/login|\/login\b|\/signin\b|security-verification|\/challenge\/|cdn-cgi\/challenge/i;
const WALL_TEXT = /let's do a quick security check|verify you('| a)re (a )?human|unusual activity|additional verification required|are you a robot|press (and|&) hold/i;

/** Throws SecurityStop when the page is a login wall, captcha or bot check. */
export async function assertNoWall(page, source) {
  const url = page.url();
  if (WALL_URL.test(url)) throw new SecurityStop(`${source}: login or security page (${new URL(url).pathname}). Sign in or finish the check in the browser, then run again.`, source);
  if (await detectCaptcha(page)) throw new SecurityStop(`${source}: a captcha is showing. JobPilot never solves captchas, so finish it in the browser and run again.`, source);
  const t = await page.getByText(WALL_TEXT).first().isVisible({ timeout: 300 }).catch(() => false);
  if (t) throw new SecurityStop(`${source}: a security check is showing. Finish it in the browser, then run again.`, source);
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
