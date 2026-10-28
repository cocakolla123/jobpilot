// Keeps the resumes on LinkedIn, Handshake and Indeed in step with your
// resumes folder. Each upload gets your file name plus the date and time,
// like Jane_Doe_Resume_SWE_2026-10-28_0915.pdf, so you can always tell which
// copy is newest. JobPilot remembers the name it uploaded for each resume on
// each site (resume-sync.json) and uses exactly that copy when it applies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './config.mjs';

export const syncPath = (ws) => path.join(ws.dir, 'resume-sync.json');
export function loadSync(ws) { return readJson(syncPath(ws), {}); }
export function saveSync(ws, data) { writeJson(syncPath(ws), data); }

export function fileHash(p) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 16); } catch { return ''; }
}

const pad = (n) => String(n).padStart(2, '0');
/** 2026-10-28_0915 in local time. */
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const DATED = /_\d{4}-\d{2}-\d{2}(?:_\d{4})?$/;
/** Jane_Doe_Resume_SWE.pdf -> Jane_Doe_Resume_SWE_2026-10-28_0915.pdf */
export function datedName(file, d = new Date()) {
  const ext = path.extname(file);
  return `${path.basename(file, ext).replace(DATED, '')}_${stamp(d)}${ext}`;
}

/** The resume a site file came from, ignoring the date, " (2)" copies and case. */
export function baseKey(name) {
  return String(name || '').replace(/\.(pdf|docx?|txt|md)$/i, '').replace(/\s*\(\d+\)$/, '').replace(DATED, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The date inside a dated name, for picking the newest copy. */
export function nameDate(name) {
  const m = String(name || '').match(/_(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})(\d{2}))?\.[a-z]+$/i);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}

/** A copy of the resume under the dated name, ready to upload or attach. */
export function datedCopy(ws, srcPath, name) {
  const dir = path.join(ws.dir, '.cache', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name);
  if (!fs.existsSync(out) || fileHash(out) !== fileHash(srcPath)) fs.copyFileSync(srcPath, out);
  return out;
}

/** Where a resume stands on a site: current, outdated (file changed since) or missing. */
export function resumeState(sync, site, resume, siteNames = null) {
  const rec = sync?.[site]?.files?.[resume.file];
  if (!rec) return { state: 'missing', rec: null };
  if (siteNames && !siteNames.includes(rec.name)) return { state: 'missing', rec };
  if (rec.hash !== fileHash(resume.path)) return { state: 'outdated', rec };
  return { state: 'current', rec };
}

/**
 * The file to use for a resume on a site when applying: the uploaded dated
 * copy if it is current, otherwise the plain file from your folder.
 */
export function docFor(ws, site, resume, sync = loadSync(ws)) {
  const { state, rec } = resumeState(sync, site, resume);
  if (state === 'current') return { name: rec.name, path: datedCopy(ws, resume.path, rec.name), synced: true };
  return { name: resume.file, path: resume.path, synced: false };
}

export function recordUpload(ws, site, resume, name, extra = {}) {
  const sync = loadSync(ws);
  sync[site] = sync[site] || {};
  sync[site].files = sync[site].files || {};
  sync[site].files[resume.file] = { name, hash: fileHash(resume.path), at: new Date().toISOString(), ...extra };
  saveSync(ws, sync);
  return sync;
}

export function recordSite(ws, site, patch) {
  const sync = loadSync(ws);
  sync[site] = { ...(sync[site] || {}), ...patch };
  saveSync(ws, sync);
  return sync;
}
