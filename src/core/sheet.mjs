// applications.csv: one row per application attempt. Opens in Excel, Numbers
// or Google Sheets. Also the source of truth for "did I already apply here?".
import fs from 'node:fs';

export const HEADER = [
  'timestamp', 'source', 'job_id', 'title', 'company', 'location',
  'job_url', 'apply_url', 'resume', 'match_score', 'status', 'notes',
];

export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function csvField(v) {
  let s = String(v ?? '');
  // a scraped title like "=HYPERLINK(...)" must not run as a formula in Excel
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// The byte order mark tells Excel the file is UTF-8, so accented names show correctly.
export function ensureSheet(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) fs.writeFileSync(p, '\uFEFF' + HEADER.join(',') + '\n');
}

const cleanHeader = (h) => String(h).replace(/^\uFEFF/, '').trim();

/** Rows as objects keyed by the file's own header (so older sheets still read). */
export function readSheet(p) {
  if (!fs.existsSync(p)) return [];
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const head = (rows.shift() || []).map(cleanHeader);
  return rows
    .filter((r) => r.some((f) => f !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function appendRow(p, row) {
  ensureSheet(p);
  const first = parseCsv(fs.readFileSync(p, 'utf8').split('\n')[0] + '\n')[0];
  const head = first?.length ? first.map(cleanHeader) : HEADER;
  const line = head.map((k) => csvField(row[k] ?? '')).join(',');
  const size = fs.statSync(p).size;
  let prefix = '';
  if (size > 0) {
    const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, size - 1); fs.closeSync(fd);
    if (b.toString() !== '\n') prefix = '\n';
  }
  fs.appendFileSync(p, prefix + line + '\n');
}

export const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const dedupKey = (company, title) => `${norm(company)}::${norm(title)}`;

// Statuses that mean "don't apply here again".
export const DONE_STATUSES = new Set([
  'submitted', 'applied', 'filled_not_submitted', 'needs_review', 'interview', 'offer', 'rejected',
  'assessment_pending', 'assessment_submitted', 'role_closed', 'already_applied',
]);

// Statuses that mean the application really went out (not just filled in).
export const SENT_STATUSES = new Set([
  'submitted', 'applied', 'interview', 'offer', 'rejected', 'assessment_pending', 'assessment_submitted', 'already_applied',
]);

export function dedupIndex(rows) {
  const done = new Set();
  const ids = new Set();
  const sent = new Set();
  const sentIds = new Set();
  for (const r of rows) {
    const st = String(r.status || '').toLowerCase();
    if (!DONE_STATUSES.has(st)) continue;
    done.add(dedupKey(r.company, r.title));
    if (r.source && r.job_id) ids.add(`${r.source}:${r.job_id}`);
    if (SENT_STATUSES.has(st)) {
      sent.add(dedupKey(r.company, r.title));
      if (r.source && r.job_id) sentIds.add(`${r.source}:${r.job_id}`);
    }
  }
  return {
    isDone(job) {
      return (job.source && job.jobId && ids.has(`${job.source}:${job.jobId}`))
        || done.has(dedupKey(job.company, job.title));
    },
    /** True only when an application for this job actually went out. */
    isSent(job) {
      return (job.source && job.jobId && sentIds.has(`${job.source}:${job.jobId}`))
        || sent.has(dedupKey(job.company, job.title));
    },
    markDone(job) {
      done.add(dedupKey(job.company, job.title));
      if (job.source && job.jobId) ids.add(`${job.source}:${job.jobId}`);
    },
  };
}

// your own calendar day, not the UTC one (which flips mid afternoon in the US)
const localDay = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-CA'); };

/** Submitted rows today for one source, for the daily caps. */
export function submittedToday(rows, source, now = new Date()) {
  const day = localDay(now);
  return rows.filter((r) => r.source === source && String(r.status).toLowerCase() === 'submitted'
    && localDay(r.timestamp) === day).length;
}

/**
 * appendRow that never throws. Rows that could not be written (the file is open
 * in Excel on Windows, say) are kept in pendingPath and written first next time.
 */
export function appendRowSafe(p, pendingPath, row) {
  let pending = [];
  try { pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8')); } catch { /* none waiting */ }
  if (!Array.isArray(pending)) pending = [];
  const rows = row ? [...pending, row] : pending;
  try {
    ensureSheet(p);
    while (rows.length) { appendRow(p, rows[0]); rows.shift(); }
    fs.rmSync(pendingPath, { force: true });
    return { ok: true };
  } catch (e) {
    try {
      fs.mkdirSync(pendingPath.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
      fs.writeFileSync(pendingPath, JSON.stringify(rows, null, 2));
    } catch { /* nowhere to keep it */ }
    return { ok: false, code: e.code, error: String(e.message || e) };
  }
}
