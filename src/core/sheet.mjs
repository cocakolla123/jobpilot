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
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function ensureSheet(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) fs.writeFileSync(p, HEADER.join(',') + '\n');
}

/** Rows as objects keyed by the file's own header (so older sheets still read). */
export function readSheet(p) {
  if (!fs.existsSync(p)) return [];
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((f) => f !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function appendRow(p, row) {
  ensureSheet(p);
  const head = parseCsv(fs.readFileSync(p, 'utf8').split('\n')[0] + '\n')[0] || HEADER;
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

export function dedupIndex(rows) {
  const done = new Set();
  const ids = new Set();
  for (const r of rows) {
    if (!DONE_STATUSES.has(String(r.status || '').toLowerCase())) continue;
    done.add(dedupKey(r.company, r.title));
    if (r.source && r.job_id) ids.add(`${r.source}:${r.job_id}`);
  }
  return {
    isDone(job) {
      return (job.source && job.jobId && ids.has(`${job.source}:${job.jobId}`))
        || done.has(dedupKey(job.company, job.title));
    },
    markDone(job) {
      done.add(dedupKey(job.company, job.title));
      if (job.source && job.jobId) ids.add(`${job.source}:${job.jobId}`);
    },
  };
}

/** Submitted rows today for one source, for the daily caps. */
export function submittedToday(rows, source, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return rows.filter((r) => r.source === source && String(r.status).toLowerCase() === 'submitted'
    && String(r.timestamp || '').slice(0, 10) === day).length;
}
