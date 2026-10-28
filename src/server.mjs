// The local dashboard: a small HTTP server on 127.0.0.1 that serves the UI
// and a JSON API, and streams the runner's log over Server-Sent Events.
// It only answers requests from this computer, and every request that changes
// something must carry the X-JobPilot header, which a web page on another site
// cannot add, so no other website can start a run in your browser.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_DIR, loadSettings, saveSettings, readJson, writeJson } from './core/config.mjs';
import { loadJobs, updateJob, removeJob, jobKey } from './core/jobs.mjs';
import { readSheet, appendRow, ensureSheet, HEADER } from './core/sheet.mjs';
import { listResumes, RESUME_EXT } from './core/resumes.mjs';
import { buildMatcher, resumeTags } from './core/matcher.mjs';
import { PROFILE_FIELDS, addAnswer, profileAnswers } from './core/answers.mjs';
import { extractSkills } from './core/skills.mjs';
import { readQueue, resolveQuestion } from './core/review.mjs';
import { chromeIsUp, findChrome, launchChrome } from './core/chrome.mjs';
import { Runner, SOURCES, PLATFORMS } from './runner.mjs';
import { loadSync } from './core/resumeSync.mjs';
import { AI_MODELS, AI_PROVIDERS, aiSettings, keyStatus, saveApiKey, removeApiKey, draftAnswer, claudeCodeStatus } from './core/ai.mjs';

const UI_DIR = path.join(APP_DIR, 'ui');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const MAX_BODY = 25 * 1024 * 1024;

const safeName = (n) => path.basename(String(n || '')).replace(/[^\w.\- ()]+/g, '_').slice(0, 120);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('upload too large (25 MB max)')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); try { resolve(t ? JSON.parse(t) : {}); } catch { reject(new Error('body is not JSON')); } });
    req.on('error', reject);
  });
}

export async function startServer(ws, { port = 4123 } = {}) {
  const runner = new Runner(ws);
  const clients = new Set();
  const history = [];
  let lastCheck = readJson(path.join(ws.dir, '.cache', 'account-check.json'), null);
  let lastSync = readJson(path.join(ws.dir, '.cache', 'resume-sync-report.json'), null);
  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  runner.on('log', (e) => { history.push(e); if (history.length > 400) history.shift(); broadcast('log', e); });
  runner.on('state', (st) => broadcast('state', st));

  const background = (p, after) => p.then((out) => after?.(out)).catch(() => { /* already logged */ });

  async function resumesInfo() {
    const list = await listResumes(ws);
    const rules = readJson(ws.resumeRules, {});
    return list.map((r) => ({ file: r.file, tags: resumeTags(r), customTags: !!r.tags, keywords: r.keywords, isDefault: rules.default === r.file, words: r.text.split(/\s+/).filter(Boolean).length, skills: extractSkills(r.text) }));
  }

  function profileStatus(p) {
    const need = ['firstName', 'lastName', 'email', 'phone', 'city', 'workAuthorized', 'needsSponsorship'];
    const missing = need.filter((k) => p[k] === undefined || p[k] === null || String(p[k]).trim() === '');
    return { complete: !missing.length, missing };
  }

  const busy = () => { if (runner.state.task) throw new Error(`JobPilot is busy: ${runner.state.task} is running. Stop it or wait for it to finish.`); };

  const routes = {
    'GET /api/state': async () => {
      const jobs = loadJobs(ws);
      const counts = {};
      for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
      const settings = loadSettings(ws);
      const profile = readJson(ws.profile, {});
      const resumes = fs.existsSync(ws.resumes) ? fs.readdirSync(ws.resumes).filter((f) => RESUME_EXT.test(f)) : [];
      return {
        workspace: ws.dir, sources: SOURCES.map((s) => ({ id: s, label: PLATFORMS[s].label })), settings, runner: runner.state,
        counts, totalJobs: jobs.length, questions: readQueue(ws).length,
        chrome: { found: !!findChrome(), running: await chromeIsUp(settings.cdpPort) },
        setup: {
          resumes: resumes.length, profile: profileStatus(profile),
          searches: (readJson(ws.searches, []) || []).length,
          transcript: !!profile.documents?.transcript, coverLetter: !!profile.documents?.coverLetter,
          accounts: lastCheck,
          sync: lastSync,
        },
        log: history.slice(-200),
      };
    },
    'GET /api/profile': async () => ({ profile: readJson(ws.profile, {}), fields: PROFILE_FIELDS.map(([key, label, kind, options]) => ({ key, label, kind, options: options || null })) }),
    'PUT /api/profile': async (b) => { const cur = readJson(ws.profile, {}); const next = { ...cur, ...(b.profile || {}) }; writeJson(ws.profile, next); return { profile: next, answers: profileAnswers(next).length }; },
    'POST /api/skills/scan': async () => {
      const list = await listResumes(ws);
      const found = [...new Set(list.flatMap((r) => extractSkills(r.text)))];
      const p = readJson(ws.profile, {});
      const have = new Map((p.skills || []).map((s) => [s.name.toLowerCase(), s]));
      const merged = [...(p.skills || [])];
      for (const name of found) if (!have.has(name.toLowerCase())) merged.push({ name, years: Number(p.yearsExperience) || 1, fromResume: true });
      p.skills = merged;
      writeJson(ws.profile, p);
      return { skills: merged, found };
    },
    'GET /api/settings': async () => loadSettings(ws),
    'PUT /api/settings': async (b) => saveSettings(ws, b || {}),
    'GET /api/searches': async () => readJson(ws.searches, []),
    'PUT /api/searches': async (b) => { if (!Array.isArray(b)) throw new Error('expected a list of searches'); writeJson(ws.searches, b); return b; },
    'GET /api/answers': async () => readJson(ws.answers, []),
    'PUT /api/answers': async (b) => {
      if (!Array.isArray(b)) throw new Error('expected a list');
      for (const [i, e] of b.entries()) {
        if (!String(e.pattern || '').trim()) throw new Error(`Entry ${i + 1} has no pattern, so it would answer every question.`);
        try { new RegExp(e.pattern, 'i'); } catch (err) { throw new Error(`Entry ${i + 1}: ${err.message}`); }
      }
      writeJson(ws.answers, b); return b;
    },
    'GET /api/jobs': async () => loadJobs(ws).map(({ description, ranking, ...j }) => ({ ...j, key: jobKey(j), ranking, descLen: (description || '').length })).reverse(),
    'GET /api/sheet': async () => ({ header: HEADER, rows: readSheet(ws.sheet).reverse() }),
    'GET /api/review': async () => readQueue(ws),
    'GET /api/resumes': async () => resumesInfo(),
    'GET /api/resumes/rules': async () => readJson(ws.resumeRules, {}),
    'PUT /api/resumes/rules': async (b = {}) => {
      const cur = readJson(ws.resumeRules, {});
      const next = { ...cur, ...b, resumes: { ...(cur.resumes || {}), ...(b.resumes || {}) } };
      writeJson(ws.resumeRules, next);
      return resumesInfo();
    },
    'POST /api/resumes/upload': async (b) => {
      const name = safeName(b.name);
      if (!RESUME_EXT.test(name)) throw new Error('resumes must be .pdf, .docx, .txt or .md');
      fs.writeFileSync(path.join(ws.resumes, name), Buffer.from(String(b.data || ''), 'base64'));
      return resumesInfo();
    },
    'POST /api/resumes/delete': async (b) => { const f = path.join(ws.resumes, safeName(b.file)); if (fs.existsSync(f)) fs.unlinkSync(f); return resumesInfo(); },
    'POST /api/documents/upload': async (b) => {
      if (!['transcript', 'coverLetter'].includes(b.kind)) throw new Error('kind must be transcript or coverLetter');
      const name = safeName(b.name);
      if (!/\.(pdf|docx?)$/i.test(name)) throw new Error('documents must be PDF or Word files');
      fs.mkdirSync(ws.documents, { recursive: true });
      fs.writeFileSync(path.join(ws.documents, name), Buffer.from(String(b.data || ''), 'base64'));
      const p = readJson(ws.profile, {});
      p.documents = { ...(p.documents || {}), [b.kind]: name };
      writeJson(ws.profile, p);
      return p.documents;
    },
    'POST /api/documents/remove': async (b) => { const p = readJson(ws.profile, {}); if (p.documents) delete p.documents[b.kind]; writeJson(ws.profile, p); return p.documents || {}; },
    'POST /api/match': async (b) => {
      const m = buildMatcher(await listResumes(ws))({ title: b.title || '', description: b.description || '' });
      return { best: m.resume?.file || null, score: m.score, why: m.why, jobTags: m.jobTags, ranking: (m.ranking || []).map((r) => ({ file: r.file, score: r.score, role: Math.round(r.role * 100) / 100, content: Math.round(r.cos * 1000) / 1000, topTerms: r.topTerms, tags: r.tags })) };
    },
    'POST /api/jobs/update': async (b) => {
      const patch = Object.fromEntries(Object.entries(b.patch || {}).filter(([k]) => ['status', 'resume', 'note'].includes(k)));
      if (patch.status) patch.tabOpen = false;
      const before = loadJobs(ws).find((j) => jobKey(j) === b.key);
      const job = updateJob(ws, b.key, patch);
      // "I submitted it" from the dashboard goes into the sheet too
      if (job && patch.status === 'submitted' && before?.status !== 'submitted') {
        ensureSheet(ws.sheet);
        appendRow(ws.sheet, {
          timestamp: new Date().toISOString(), source: job.applyType === 'external' ? 'ats' : job.source, job_id: job.jobId || '',
          title: job.title, company: job.company, location: job.location || '', job_url: job.url, apply_url: job.externalUrl || '',
          resume: job.appliedWith || job.resume || '', match_score: job.score ?? '', status: 'submitted', notes: 'you finished it in the open tab',
        });
      }
      return job;
    },
    'GET /api/ai': async () => ({ ...aiSettings(loadSettings(ws)), providers: AI_PROVIDERS, models: AI_MODELS, claudeCode: await claudeCodeStatus(), key: keyStatus(ws) }),
    'PUT /api/ai/key': async (b) => saveApiKey(ws, b?.apiKey),
    'POST /api/ai/key/remove': async () => removeApiKey(ws),
    'POST /api/ai/test': async (b = {}) => {
      const cfg = aiSettings(loadSettings(ws));
      if (cfg.provider === 'api' && !keyStatus(ws).hasKey) throw new Error('Save your Anthropic API key first, or switch to your Claude Code sign-in.');
      if (cfg.provider !== 'api' && !(await claudeCodeStatus()).found) throw new Error('Claude Code is not installed. Install it and sign in once with `claude`, or use an API key.');
      const list = await listResumes(ws);
      const job = { title: b.title || 'Software Engineer', company: b.company || 'Example Co', description: b.description || '' };
      const best = list.length ? buildMatcher(list)(job).resume : null;
      const t0 = Date.now();
      const settings = loadSettings(ws);
      const answer = await draftAnswer(ws, settings, { question: b.question || 'Why do you want to work here?', job, resumeText: best?.text || '', profile: readJson(ws.profile, {}) });
      return { answer: answer || '(the AI said this cannot be answered honestly from your resume)', provider: cfg.provider, model: cfg.model, resume: best?.file || null, ms: Date.now() - t0 };
    },
    'POST /api/jobs/remove': async (b) => ({ removed: removeJob(ws, b.key) }),
    'POST /api/review/answer': async (b) => {
      const q = readQueue(ws).find((e) => e.id === b.id);
      if (!q) throw new Error('question not found');
      const entry = addAnswer(ws, { question: q.question, answer: b.answer, type: b.type });
      resolveQuestion(ws, b.id);
      // jobs that were waiting only on questions go back to "saved" so the next apply retries them
      const waiting = new Set(readQueue(ws).flatMap((e) => e.jobs.map((j) => j.key)));
      for (const j of q.jobs) if (!waiting.has(j.key)) updateJob(ws, j.key, { status: 'saved', note: 'answered; ready to retry' });
      return entry;
    },
    'POST /api/review/dismiss': async (b) => resolveQuestion(ws, b.id),
    'POST /api/run/search': async (b) => { busy(); background(runner.searchAndSave(b || {})); return { started: true }; },
    'POST /api/run/apply': async (b) => { busy(); background(runner.applySaved(b || {})); return { started: true }; },
    'POST /api/run/check': async (b) => {
      busy();
      background(runner.checkAccounts(b || {}), (out) => { lastCheck = { at: new Date().toISOString(), report: out.report }; writeJson(path.join(ws.dir, '.cache', 'account-check.json'), lastCheck); broadcast('check', lastCheck); });
      return { started: true };
    },
    'POST /api/run/sync': async (b) => {
      busy();
      background(runner.syncResumes(b || {}), (out) => { lastSync = { at: new Date().toISOString(), report: out.report }; writeJson(path.join(ws.dir, '.cache', 'resume-sync-report.json'), lastSync); broadcast('sync', lastSync); });
      return { started: true };
    },
    'GET /api/sync': async () => ({ records: loadSync(ws), last: lastSync }),
    'POST /api/run/stop': async () => { runner.stop(); return { stopping: true }; },
    'POST /api/chrome/open': async () => ({ running: await launchChrome(ws, loadSettings(ws).cdpPort) }),
    'POST /api/chrome/login': async (b) => ({ opened: await runner.openLogin(b.source) }),
  };

  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'JobPilot only answers on localhost' });
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(runner.state)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (url.pathname === '/api/sheet.csv') {
      const csv = fs.existsSync(ws.sheet) ? fs.readFileSync(ws.sheet) : HEADER.join(',') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="applications.csv"' });
      return res.end(csv);
    }
    if (url.pathname.startsWith('/api/')) {
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return send(res, 404, { error: 'no such endpoint' });
      if (req.method !== 'GET' && req.headers['x-jobpilot'] !== '1') return send(res, 403, { error: 'missing X-JobPilot header' });
      try {
        const body = req.method === 'GET' ? null : await readBody(req);
        return send(res, 200, await route(body));
      } catch (e) {
        return send(res, 400, { error: String(e.message || e) });
      }
    }
    // static UI
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(UI_DIR, rel));
    if (!file.startsWith(UI_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, runner, url: `http://127.0.0.1:${server.address().port}/` };
}
