// Workspace layout and settings. Everything a user owns (sheet, resumes,
// profile, answers, saved jobs, Chrome profile) lives in ONE folder outside the
// code, so the app can be updated or shared without carrying anyone's data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATES_DIR = path.join(APP_DIR, 'templates');

export function defaultWorkspaceDir() {
  return process.env.JOBPILOT_HOME || path.join(os.homedir(), 'JobPilot');
}

export function workspacePaths(dir = defaultWorkspaceDir()) {
  const d = path.resolve(dir);
  return {
    dir: d,
    sheet: path.join(d, 'applications.csv'),
    resumes: path.join(d, 'resumes'),
    documents: path.join(d, 'documents'),
    resumeRules: path.join(d, 'resumes', 'resumes.json'),
    resumeCache: path.join(d, '.cache', 'resume-text.json'),
    profile: path.join(d, 'profile.json'),
    answers: path.join(d, 'answers.json'),
    searches: path.join(d, 'searches.json'),
    settings: path.join(d, 'settings.json'),
    jobs: path.join(d, 'jobs.json'),
    review: path.join(d, 'review-queue.json'),
    chromeProfile: path.join(d, '.chrome-profile'),
    logs: path.join(d, 'logs'),
  };
}

// ---- JSON helpers (atomic writes: a crash never leaves a half-written file) --
// Files that could not be read because of a typo (usually a hand edit). Each
// one was copied aside first, so the next save can never lose what was in it.
const brokenFiles = [];
export const brokenJsonFiles = () => brokenFiles.map(({ file, savedAs, error }) => ({ file, savedAs, error }));

export function readJson(p, fallback) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return fallback; }   // not created yet
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    // the dashboard reads these files every few seconds, so copy each broken version once
    const known = brokenFiles.find((b) => b.file === p && b.text === text);
    if (!known) {
      const keep = `${p}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      try { fs.writeFileSync(keep, text); } catch { /* still return the fallback */ }
      brokenFiles.push({ file: p, savedAs: keep, text, error: String(e.message || e).split('\n')[0] });
      console.warn(`JobPilot: ${path.basename(p)} has a typo and could not be read (${e.message}). A copy was saved as ${path.basename(keep)}.`);
    }
    return fallback;
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  // Windows antivirus or search indexing can hold the file for a moment
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } throw e; }
      sleepSync(100 * (i + 1));
    }
  }
}

export const DEFAULT_SETTINGS = {
  cdpPort: 9222,
  // Fill forms but stop before the final submit, until the user turns this on.
  submit: false,
  // Also press the site's own Save button on each job found by a search.
  saveOnSite: true,
  // Daily ceilings per source, counted from the sheet. LinkedIn throttles
  // Easy Apply accounts that go much past this.
  dailyCaps: { linkedin: 25, handshake: 30, indeed: 10, ats: 30 },
  pauseSeconds: [6, 12],
  perSearchLimit: 25,
  skipSenior: true,
  excludeCompanies: [],
  excludeTitleWords: [],
  // Before applying, upload new or edited resumes to LinkedIn and Handshake
  // under dated names, so the newest copy is always the one picked.
  autoSyncResumes: true,
  // Each job runs in its own tab. Tabs for jobs that need you (a question,
  // an AI answer to review, no confirmation) stay open; the run pauses once
  // this many are waiting.
  maxOpenTabs: 8,
  // The job sites you use. Searches, Apply and the account check skip the rest.
  sites: ['linkedin', 'handshake', 'indeed'],
  // AI answers for open-ended questions only, off until you switch it on.
  // provider 'claude-code' uses your Claude Code sign-in (your Claude plan),
  // 'api' uses an Anthropic API key. autoSubmit false: fill the AI answer and
  // leave the tab open for you to review.
  ai: { enabled: false, provider: 'claude-code', model: 'opus', effort: 'low', autoSubmit: false },
};

const SITES = ['linkedin', 'handshake', 'indeed'];
const num = (v, fallback, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Settings with defaults filled in and hand edited values kept in range, so a typo can't crash a run. */
export function cleanSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const out = { ...d, ...s };
  const caps = { ...d.dailyCaps, ...(s.dailyCaps && typeof s.dailyCaps === 'object' ? s.dailyCaps : {}) };
  out.dailyCaps = Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, num(v, d.dailyCaps[k] ?? 25, 0, 500)]));
  const pause = Array.isArray(s.pauseSeconds) ? s.pauseSeconds : [s.pauseSeconds, s.pauseSeconds];
  const lo = num(pause[0], d.pauseSeconds[0], 0, 600);
  out.pauseSeconds = [lo, Math.max(lo, num(pause[1], d.pauseSeconds[1], 0, 600))];
  out.maxOpenTabs = Math.round(num(s.maxOpenTabs, d.maxOpenTabs, 1, 50));
  out.perSearchLimit = Math.round(num(s.perSearchLimit, d.perSearchLimit, 1, 200));
  const port = Math.round(num(s.cdpPort, d.cdpPort, 0, 65535));
  out.cdpPort = port === 0 || port >= 1024 ? port : d.cdpPort;
  out.sites = Array.isArray(s.sites) ? SITES.filter((x) => s.sites.includes(x)) : d.sites.slice();
  for (const k of ['excludeCompanies', 'excludeTitleWords']) out[k] = Array.isArray(s[k]) ? s[k].map(String) : (typeof s[k] === 'string' ? s[k].split(',').map((x) => x.trim()).filter(Boolean) : d[k].slice());
  for (const k of ['submit', 'saveOnSite', 'skipSenior', 'autoSyncResumes']) out[k] = s[k] === undefined ? d[k] : s[k] === true || s[k] === 'true';
  out.ai = { ...d.ai, ...(s.ai && typeof s.ai === 'object' ? s.ai : {}) };
  return out;
}

export function loadSettings(ws) {
  return cleanSettings(readJson(ws.settings, {}));
}

export function saveSettings(ws, patch = {}) {
  const cur = loadSettings(ws);
  const next = { ...cur, ...patch };
  if (patch.ai) next.ai = { ...cur.ai, ...patch.ai };
  if (patch.dailyCaps) next.dailyCaps = { ...cur.dailyCaps, ...patch.dailyCaps };
  const clean = cleanSettings(next);
  writeJson(ws.settings, clean);
  return clean;
}

/** Creates the workspace on first run and copies the starter files in. */
export function ensureWorkspace(dir = defaultWorkspaceDir()) {
  const ws = workspacePaths(dir);
  for (const d of [ws.dir, ws.resumes, ws.documents, ws.logs, path.dirname(ws.resumeCache)]) fs.mkdirSync(d, { recursive: true });
  const copies = [
    ['profile.example.json', ws.profile],
    ['answers.example.json', ws.answers],
    ['searches.example.json', ws.searches],
    ['resumes.example.json', ws.resumeRules],
  ];
  for (const [src, dst] of copies) {
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(TEMPLATES_DIR, src), dst);
  }
  if (!fs.existsSync(ws.settings)) writeJson(ws.settings, DEFAULT_SETTINGS);
  if (!fs.existsSync(ws.jobs)) writeJson(ws.jobs, []);
  if (!fs.existsSync(ws.review)) writeJson(ws.review, []);
  return ws;
}
