// jobs.json: every job a search found, with its resume match and where it is
// in the pipeline (saved -> applied / needs_answer / skipped / failed).
import { readJson, writeJson } from './config.mjs';

export const STATUSES = [
  'saved', 'applying', 'submitted', 'filled_not_submitted', 'needs_answer',
  'external_manual', 'skipped', 'duplicate', 'blocked', 'error',
];

export const jobKey = (j) => `${j.source}:${j.jobId || j.url}`;

export function loadJobs(ws) {
  const list = readJson(ws.jobs, []);
  return Array.isArray(list) ? list : [];
}

export function saveJobs(ws, list) { writeJson(ws.jobs, list); }

/** Insert or merge one job (fields from a newer scrape win, status is kept). */
export function upsertJob(ws, job) {
  const list = loadJobs(ws);
  const key = jobKey(job);
  const i = list.findIndex((j) => jobKey(j) === key);
  const now = new Date().toISOString();
  if (i >= 0) {
    const keep = list[i];
    list[i] = { ...keep, ...job, status: keep.status, firstSeen: keep.firstSeen, updated: now };
  } else {
    list.push({ status: 'saved', firstSeen: now, updated: now, ...job });
  }
  saveJobs(ws, list);
  return list[i >= 0 ? i : list.length - 1];
}

export function updateJob(ws, key, patch) {
  const list = loadJobs(ws);
  const i = list.findIndex((j) => jobKey(j) === key);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, updated: new Date().toISOString() };
  saveJobs(ws, list);
  return list[i];
}

export function removeJob(ws, key) {
  const list = loadJobs(ws);
  const left = list.filter((j) => jobKey(j) !== key);
  saveJobs(ws, left);
  return list.length - left.length;
}
