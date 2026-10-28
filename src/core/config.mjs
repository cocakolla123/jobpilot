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
export function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, p);
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
  // AI answers for open-ended questions only, off until you switch it on.
  // provider 'claude-code' uses your Claude Code sign-in (your Claude plan),
  // 'api' uses an Anthropic API key. autoSubmit false: fill the AI answer and
  // leave the tab open for you to review.
  ai: { enabled: false, provider: 'claude-code', model: 'opus', effort: 'low', autoSubmit: false },
};

export function loadSettings(ws) {
  const s = readJson(ws.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    dailyCaps: { ...DEFAULT_SETTINGS.dailyCaps, ...(s.dailyCaps || {}) },
    ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai || {}) },
  };
}

export function saveSettings(ws, patch = {}) {
  const cur = loadSettings(ws);
  const next = { ...cur, ...patch };
  if (patch.ai) next.ai = { ...cur.ai, ...patch.ai };
  if (patch.dailyCaps) next.dailyCaps = { ...cur.dailyCaps, ...patch.dailyCaps };
  writeJson(ws.settings, next);
  return next;
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
