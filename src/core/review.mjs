// review-queue.json: questions a form asked that the answer bank could not
// answer. The dashboard shows them; one answer saves to answers.json and the
// job can be retried.
import { readJson, writeJson } from './config.mjs';
import { normalizeLabel } from './answers.mjs';

export function readQueue(ws) { const q = readJson(ws.review, []); return Array.isArray(q) ? q : []; }
export function writeQueue(ws, q) { writeJson(ws.review, q); }

export function queueUnknowns(ws, job, unknowns, runner) {
  const q = readQueue(ws);
  let added = 0;
  for (const u of unknowns) {
    if (!u.question) continue;
    const n = normalizeLabel(u.question);
    const same = q.find((e) => normalizeLabel(e.question) === n);
    if (same) {
      if (!same.jobs.some((j) => j.key === job.key)) same.jobs.push({ key: job.key, title: job.title, company: job.company, url: job.url });
      if (u.options?.length) same.options = u.options;
      continue;
    }
    q.push({
      id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date().toISOString(), runner, question: u.question, options: u.options || [],
      required: !!u.required, essay: !!u.essay, jobs: [{ key: job.key, title: job.title, company: job.company, url: job.url }],
    });
    added++;
  }
  writeQueue(ws, q);
  return added;
}

export function resolveQuestion(ws, id) {
  const q = readQueue(ws);
  const hit = q.find((e) => e.id === id);
  writeQueue(ws, q.filter((e) => e.id !== id));
  return hit || null;
}
