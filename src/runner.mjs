// The runner: the three jobs the dashboard starts.
//   searchAndSave  run your saved searches, read each new posting, pick its
//                  resume, store it in jobs.json, and press Save on the site
//   applySaved     go through saved jobs and apply with the right flow
//   checkAccounts  confirm you are signed in everywhere and that the resumes
//                  on each site match the files in your resumes folder
// One task runs at a time. Events: 'log', 'progress', 'state'.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadSettings, readJson } from './core/config.mjs';
import { launchChrome, attach } from './core/chrome.mjs';
import { readSheet, appendRow, ensureSheet, dedupIndex, submittedToday } from './core/sheet.mjs';
import { loadJobs, upsertJob, updateJob, jobKey } from './core/jobs.mjs';
import { listResumes } from './core/resumes.mjs';
import { buildMatcher } from './core/matcher.mjs';
import { loadAnswerBank } from './core/answers.mjs';
import { skillCoverage } from './core/skills.mjs';
import { queueUnknowns } from './core/review.mjs';
import { aiReady, aiSettings, makeDrafter } from './core/ai.mjs';
import { loadSync, resumeState, datedName, datedCopy, docFor, recordUpload, recordSite, baseKey, fileHash } from './core/resumeSync.mjs';
import { SecurityStop, pause, skipReason, sleep } from './core/safety.mjs';
import * as linkedin from './platforms/linkedin.mjs';
import * as handshake from './platforms/handshake.mjs';
import * as indeed from './platforms/indeed.mjs';
import * as ats from './platforms/ats.mjs';

export const PLATFORMS = { linkedin, handshake, indeed };
export const SOURCES = Object.keys(PLATFORMS);

export class Runner extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.state = { task: null, startedAt: null, done: 0, total: 0, current: '', stop: false, last: null };
    this.session = null;
    // tabs left open for you, kept across runs; closing one frees its slot
    this.waiting = [];
  }

  log(msg, level = 'info') {
    const entry = { ts: new Date().toISOString(), level, msg };
    this.emit('log', entry);
    try {
      fs.mkdirSync(this.ws.logs, { recursive: true });
      fs.appendFileSync(path.join(this.ws.logs, `${entry.ts.slice(0, 10)}.log`), `${entry.ts} [${level}] ${msg}\n`);
    } catch { /* logging must never break a run */ }
  }

  setState(patch) { Object.assign(this.state, patch); this.emit('state', { ...this.state }); }
  stop() { if (this.state.task) { this.state.stop = true; this.log('Stopping after the current job...'); } }

  async connect() {
    const settings = loadSettings(this.ws);
    if (this.session) { try { await this.session.context.pages(); return this.session; } catch { this.session = null; } }
    const up = await launchChrome(this.ws, settings.cdpPort);
    if (!up) throw new Error(`Chrome did not start on port ${settings.cdpPort}.`);
    this.session = await attach(settings.cdpPort);
    this.session.browser.on('disconnected', () => { this.session = null; });
    return this.session;
  }

  async run(task, fn) {
    if (this.state.task) throw new Error(`Busy: ${this.state.task} is running.`);
    this.setState({ task, startedAt: new Date().toISOString(), done: 0, total: 0, current: '', stop: false });
    try {
      const out = await fn();
      this.setState({ last: { task, ok: true, at: new Date().toISOString(), summary: out?.summary || '' } });
      return out;
    } catch (e) {
      this.log(`${task} stopped: ${e.message}`, 'error');
      this.setState({ last: { task, ok: false, at: new Date().toISOString(), summary: e.message } });
      throw e;
    } finally {
      this.setState({ task: null, current: '', stop: false });
    }
  }

  /** Opens a site in Chrome and brings it forward so you can sign in. */
  async openLogin(src) {
    const p = PLATFORMS[src];
    if (!p) throw new Error(`unknown site ${src}`);
    const s = await this.connect();
    const page = await s.newTab();
    await page.goto(p.home, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.bringToFront().catch(() => {});
    return true;
  }

  // ------------------------------------------------------------------------
  searchAndSave({ searches: names = null, sources = SOURCES } = {}) {
    return this.run('search', async () => {
      const ws = this.ws;
      const settings = loadSettings(ws);
      const all = readJson(ws.searches, []);
      const list = (Array.isArray(all) ? all : []).filter((s) => s.enabled !== false && (!names || names.includes(s.name)));
      if (!list.length) throw new Error('No searches yet. Add one on the Searches tab.');
      const resumes = await listResumes(ws, { log: (m) => this.log(m, 'warn') });
      if (!resumes.length) this.log('No resumes in your resumes folder yet, so jobs are saved without a resume match.', 'warn');
      const match = buildMatcher(resumes);
      const profile = readJson(ws.profile, {});
      ensureSheet(ws.sheet);
      const done = dedupIndex(readSheet(ws.sheet));
      const known = new Set(loadJobs(ws).map(jobKey));
      const s = await this.connect();
      const stopped = new Set();
      let saved = 0, skipped = 0;
      for (const search of list) {
        for (const src of (search.sources || SOURCES).filter((x) => sources.includes(x) && PLATFORMS[x])) {
          if (this.state.stop || stopped.has(src)) continue;
          const P = PLATFORMS[src];
          const page = await s.workTab(src);
          this.log(`${P.label}: searching "${search.name || search.keywords}"`);
          let refs = [];
          try { refs = await P.search(page, search, { limit: search.limit || settings.perSearchLimit, log: (m) => this.log(m) }); }
          catch (e) { this.handleSiteError(e, src, stopped); continue; }
          this.setState({ total: this.state.total + refs.length });
          for (const ref of refs) {
            if (this.state.stop || stopped.has(src)) break;
            this.setState({ current: `${ref.title || ref.jobId} (${P.label})`, done: this.state.done + 1 });
            const key = jobKey(ref);
            if (known.has(key)) continue;
            if (done.isDone(ref)) { skipped++; continue; }
            const why = skipReason(ref, settings);
            if (why) { upsertJob(ws, { ...ref, status: 'skipped', note: why }); known.add(key); skipped++; continue; }
            try {
              const d = await P.details(page, ref, { log: (m) => this.log(m) });
              if (d.gone) { skipped++; continue; }
              const job = { ...ref, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)) };
              const why2 = skipReason(job, settings);
              if (why2 || job.applyType === 'applied' || done.isDone(job)) {
                upsertJob(ws, { ...job, status: job.applyType === 'applied' ? 'duplicate' : 'skipped', note: why2 || 'already applied' });
                known.add(key); skipped++; continue;
              }
              const m = match(job);
              const cov = skillCoverage(`${job.title} ${job.description || ''}`, profile.skills || []);
              let savedOnSite = '';
              if (settings.saveOnSite && P.save) savedOnSite = await P.save(page, job).catch(() => 'not-found');
              upsertJob(ws, {
                ...job, description: (job.description || '').slice(0, 6000),
                resume: m.resume?.file || '', score: m.score, why: m.why || '', jobTags: m.jobTags,
                ranking: (m.ranking || []).slice(0, 4).map((r) => ({ file: r.file, score: r.score })),
                skills: { pct: cov.pct, have: cov.have, missing: cov.missing }, savedOnSite, search: search.name || '',
              });
              known.add(key); saved++;
              this.log(`Saved: ${job.title} at ${job.company} -> ${m.resume?.file || 'no resume'}${savedOnSite === 'saved' ? ' (saved on the site too)' : ''}`);
            } catch (e) { if (this.handleSiteError(e, src, stopped)) break; }
            await pause(settings, 0.4);
          }
        }
      }
      // a site that stopped on a login or security page keeps its tab open for you
      await s.closeWorkTabs([...stopped]);
      const summary = `${saved} new job(s) saved, ${skipped} skipped`;
      this.log(`Search finished: ${summary}.`);
      return { summary, saved, skipped };
    });
  }

  handleSiteError(e, src, stopped) {
    if (e instanceof SecurityStop) {
      stopped.add(src);
      this.log(e.message, 'error');
      this.log(`Skipping ${PLATFORMS[src]?.label || src} for the rest of this run.`, 'warn');
      return true;
    }
    this.log(`${PLATFORMS[src]?.label || src}: ${String(e.message || e).split('\n')[0]}`, 'warn');
    return false;
  }

  // ------------------------------------------------------------------------
  applySaved({ keys = null, sources = [...SOURCES, 'ats'], limit = 25 } = {}) {
    return this.run('apply', async () => {
      const ws = this.ws;
      const settings = loadSettings(ws);
      const profile = readJson(ws.profile, {});
      const bank = loadAnswerBank(ws);
      const resumes = await listResumes(ws);
      if (!resumes.length) throw new Error('Add at least one resume to your resumes folder first.');
      const match = buildMatcher(resumes);
      const docPath = (f) => (f && fs.existsSync(path.join(ws.documents, f)) ? path.join(ws.documents, f) : null);
      const extraDocs = { transcript: docPath(profile.documents?.transcript), coverLetter: docPath(profile.documents?.coverLetter) };
      ensureSheet(ws.sheet);
      let rows = readSheet(ws.sheet);
      const done = dedupIndex(rows);
      const queue = loadJobs(ws).filter((j) => (keys ? keys.includes(jobKey(j)) : j.status === 'saved')
        && (sources.includes(j.source) || (j.applyType === 'external' && sources.includes('ats'))))
        .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
      if (!queue.length) throw new Error('No saved jobs to apply to. Run a search first.');
      this.setState({ total: queue.length });
      this.log(`Applying to ${queue.length} job(s), one at a time, each in its own tab. Submit is ${settings.submit ? 'ON' : 'OFF (forms are filled and left open for you)'}.`);
      const ai = aiReady(ws, settings) ? aiSettings(settings) : null;
      if (settings.ai?.enabled && !ai) {
        this.log(settings.ai.provider === 'api'
          ? 'AI answers are switched on but no Anthropic API key is saved, so open-ended questions go to your Questions tab.'
          : 'AI answers are switched on but Claude Code was not found, so open-ended questions go to your Questions tab.', 'warn');
      } else if (ai) {
        this.log(`AI answers are on (${ai.provider === 'api' ? 'API key' : 'your Claude Code sign-in'}, ${ai.model}); ${ai.autoSubmit ? 'forms with AI answers are submitted' : 'forms with AI answers are left open for you to review'}.`);
      }
      const aiState = {};
      const s = await this.connect();
      // upload new or edited resumes first, so the dated copies are the ones picked
      if (settings.autoSyncResumes !== false) {
        const sites = ['linkedin', 'handshake'].filter((src) => queue.some((j) => j.source === src && j.applyType !== 'external' && j.applyType !== 'ats'));
        for (const src of sites) {
          const stale = resumes.filter((r) => resumeState(loadSync(ws), src, r).state !== 'current');
          if (!stale.length) continue;
          this.log(`${PLATFORMS[src].label}: uploading ${stale.length} new or edited resume(s) first, with today's date in the name.`);
          const page = await s.workTab(src);
          try {
            if ((await PLATFORMS[src].loginState(page)).loggedIn) await this.uploadToSite(page, src, stale, { uploaded: [], skipped: [], failed: [] }, { settings, profile });
            else this.log(`${PLATFORMS[src].label}: not signed in, so resumes were not uploaded.`, 'warn');
          } catch (e) { this.log(`${PLATFORMS[src].label}: ${String(e.message || e).split('\n')[0]}`, 'warn'); }
        }
        await s.closeWorkTabs();
      }
      const sync = loadSync(ws);
      const warnedSync = new Set();
      const stopped = new Set();
      const counts = {};
      this.waiting = this.waiting.filter((t) => !t.isClosed());
      const waiting = this.waiting;
      for (const job of queue) {
        if (this.state.stop) break;
        for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].isClosed()) waiting.splice(i, 1);
        if (waiting.length >= settings.maxOpenTabs) {
          this.log(`${waiting.length} tabs are waiting for you in JobPilot's Chrome. Finish or close them, then run Apply again.`, 'warn');
          break;
        }
        const key = jobKey(job);
        this.setState({ current: `${job.title} at ${job.company}`, done: this.state.done + 1 });
        if (stopped.has(job.source)) continue;
        if (done.isDone(job)) { updateJob(ws, key, { status: 'duplicate', note: 'already in your sheet' }); continue; }
        const external = job.applyType === 'external' || job.applyType === 'ats';
        if (!external && submittedToday(rows, job.source) >= (settings.dailyCaps[job.source] ?? 25)) {
          this.log(`${PLATFORMS[job.source].label}: daily cap of ${settings.dailyCaps[job.source]} reached; skipping the rest for today.`, 'warn');
          stopped.add(job.source);
          continue;
        }
        // resume: the one chosen at search time, or re-match if it was removed
        let resume = resumes.find((r) => r.file === job.resume);
        if (!resume) resume = match(job).resume;
        const docs = { resume: resume.path, ...extraDocs };
        // on LinkedIn and Handshake, use the dated copy you uploaded with Upload resumes
        let resumeFile = resume.file;
        if (!external && ['linkedin', 'handshake'].includes(job.source)) {
          const d = docFor(ws, job.source, resume, sync);
          if (d.synced) { docs.resume = d.path; resumeFile = d.name; }
          else if (!warnedSync.has(job.source)) {
            warnedSync.add(job.source);
            this.log(`${PLATFORMS[job.source].label}: ${resume.file} has not been uploaded with Upload resumes yet (or changed since), so an older copy may be picked. Run Upload resumes to sites first.`, 'warn');
          }
        }
        if (job.source === 'handshake' && !docs.transcript && sync.handshake?.transcript?.name) docs.transcript = sync.handshake.transcript.name;
        const draft = ai ? makeDrafter(ws, settings, { job, resumeText: resume.text, profile, log: (m) => this.log(m), state: aiState }) : null;
        const ctx = { bank, submit: settings.submit, aiAutoSubmit: !!ai?.autoSubmit, draft, docs, resumeFile, log: (m) => this.log(m) };
        let flow = job.source;
        let res;
        let tab = null;
        updateJob(ws, key, { status: 'applying' });
        try {
          const P = PLATFORMS[job.source];
          tab = await s.newTab();
          if (external) {
            flow = 'ats';
            let url = job.externalUrl;
            if (!url && P?.externalUrl) {
              await tab.goto(job.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
              await sleep(2500);
              url = await P.externalUrl(tab);
            }
            url = url ? ats.unwrapRedirect(url) : null;
            if (url) updateJob(ws, key, { externalUrl: url });
            if (!url || !ats.detectAts(url)) {
              res = { status: 'external_manual', note: url ? 'apply on the company site (link saved)' : 'could not read the external link' };
            } else if (!sources.includes('ats')) {
              res = { status: 'saved', note: 'company form; run with company forms on' };
            } else if (submittedToday(rows, 'ats') >= settings.dailyCaps.ats) {
              res = { status: 'saved', note: 'daily cap for company forms reached' };
            } else {
              res = await ats.apply(tab, { ...job, url }, ctx);
            }
          } else {
            if (job.source === 'indeed') {
              // Indeed holds one resume: put this job's resume there first
              const sw = await this.switchIndeed(tab, resume);
              if (sw.ok) { ctx.resumeFile = sw.name; ctx.docs.resume = datedCopy(ws, resume.path, sw.name); }
            }
            res = await P.apply(tab, job, ctx);
          }
        } catch (e) {
          if (e instanceof SecurityStop) {
            stopped.add(job.source);
            this.log(e.message, 'error');
            res = { status: 'blocked', note: e.message };
          } else {
            res = { status: 'error', note: String(e.message || e).split('\n')[0].slice(0, 160) };
          }
        }
        const status = res.status === 'already_applied' ? 'duplicate' : res.status;
        // the tab closes once the site confirmed; anything unsure stays open for you
        const keep = res.keepTab !== undefined ? res.keepTab : ['blocked', 'error'].includes(status);
        if (tab) {
          if (keep && res.formPage && res.formPage !== tab) { await tab.close().catch(() => {}); waiting.push(res.formPage); }
          else if (keep) waiting.push(tab);
          else await tab.close().catch(() => {});
        }
        const drafted = res.drafted || [];
        const aiNote = drafted.length ? ` AI answered: ${drafted.map((d) => d.question.slice(0, 60)).join('; ')}` : '';
        updateJob(ws, key, {
          status, note: res.note || '', appliedWith: resume.file, appliedAt: new Date().toISOString(), tabOpen: !!(tab && keep),
          ...(drafted.length ? { drafts: drafted } : {}),
        });
        if (res.unknowns?.length) {
          const n = queueUnknowns(ws, { key, title: job.title, company: job.company, url: job.url }, res.unknowns, flow);
          this.log(`${job.title}: ${res.unknowns.length} question(s) to answer on the Questions tab${n ? ` (${n} new)` : ''}`, 'warn');
        }
        if (status !== 'saved') {
          appendRow(ws.sheet, {
            timestamp: new Date().toISOString(), source: flow === 'ats' ? 'ats' : job.source, job_id: job.jobId || '',
            title: job.title, company: job.company, location: job.location || '', job_url: job.url,
            apply_url: job.externalUrl || '', resume: resume.file, match_score: job.score ?? '', status, notes: `${res.note || ''}${aiNote}`.trim(),
          });
          rows = readSheet(ws.sheet);
          if (['submitted', 'filled_not_submitted', 'needs_review'].includes(status)) done.markDone(job);
        }
        counts[status] = (counts[status] || 0) + 1;
        this.log(`${status.replace(/_/g, ' ')}: ${job.title} at ${job.company}${res.note ? ` (${res.note})` : ''}${tab && keep ? ' [tab left open]' : ''}`, status === 'error' || status === 'blocked' ? 'warn' : 'info');
        await pause(settings);
      }
      const left = waiting.filter((t) => !t.isClosed()).length;
      if (left) this.log(`${left} tab(s) are open in JobPilot's Chrome for you to finish.`);
      const summary = Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') || 'nothing to do';
      this.log(`Apply finished: ${summary}.`);
      return { summary, counts };
    });
  }

  // ------------------------------------------------------------------------
  /**
   * Where each of your resumes stands on each site: current (the dated copy
   * JobPilot uploaded is there and your file has not changed), outdated or
   * missing. Also finds your newest transcript on Handshake.
   */
  async siteReport(page, src, resumes, sync) {
    const P = PLATFORMS[src];
    const row = { source: src, label: P.label, loggedIn: false, note: '', siteFiles: [], resumes: [], missing: [], transcript: null };
    const st = await P.loginState(page);
    Object.assign(row, st);
    if (!st.loggedIn) return row;
    if (src === 'handshake') {
      const docs = await handshake.siteDocuments(page);
      row.siteFiles = docs.map((d) => d.name);
      row.documents = docs.slice(0, 100);
      const t = docs.find((d) => /transcript/i.test(d.category));
      row.transcript = t ? { onSite: t.name, date: t.date } : null;
      if (t) recordSite(this.ws, 'handshake', { transcript: { name: t.name, date: t.date } });
    } else {
      row.siteFiles = await P.siteResumes(page);
    }
    if (src === 'indeed') {
      const cur = row.siteFiles[0] || null;
      const on = resumes.find((r) => sync.indeed?.current?.file === r.file && sync.indeed.current.name === cur);
      row.indeedCurrent = { name: cur, resume: on?.file || null };
      row.resumes = resumes.map((r) => ({ file: r.file, state: on?.file === r.file ? 'current' : 'switch on apply' }));
      return row;
    }
    row.resumes = resumes.map((r) => {
      const { state, rec } = resumeState(sync, src, r, row.siteFiles);
      const older = row.siteFiles.filter((n) => baseKey(n) === baseKey(r.file) && n !== rec?.name);
      return { file: r.file, state, siteName: state === 'missing' ? null : rec?.name, olderCopies: older.length };
    });
    row.missing = row.resumes.filter((x) => x.state !== 'current').map((x) => x.file);
    return row;
  }

  checkAccounts({ sources = SOURCES } = {}) {
    return this.run('check', async () => {
      const resumes = await listResumes(this.ws);
      const sync = loadSync(this.ws);
      const s = await this.connect();
      const report = [];
      for (const src of sources) {
        const page = await s.workTab(src);
        this.setState({ current: PLATFORMS[src].label });
        let row;
        try { row = await this.siteReport(page, src, resumes, sync); }
        catch (e) { row = { source: src, label: PLATFORMS[src].label, loggedIn: false, note: String(e.message || e).split('\n')[0], resumes: [], missing: [] }; }
        report.push(row);
        const tail = src === 'indeed'
          ? `, Indeed has ${row.siteFiles?.[0] || 'no file'} (JobPilot switches it to the matched resume before each Indeed application)`
          : row.missing.length ? `, ${row.missing.length} of ${resumes.length} resume(s) need uploading: ${row.missing.join(', ')}` : ', all resumes are current';
        this.log(`${row.label}: ${row.loggedIn ? `signed in${tail}` : `not signed in${row.note ? ` (${row.note})` : ''}`}${row.transcript ? `. Newest transcript: ${row.transcript.onSite} (${row.transcript.date})` : ''}`);
      }
      await s.closeWorkTabs(report.filter((r) => !r.loggedIn).map((r) => r.source));
      return { summary: report.map((r) => `${r.label}: ${r.loggedIn ? (r.missing?.length ? `${r.missing.length} to upload` : 'ok') : 'sign in'}`).join(', '), report };
    });
  }

  /**
   * Uploads each resume that is missing or changed to LinkedIn and Handshake
   * under a dated name, and puts your default resume on Indeed (Indeed holds
   * one file, so it is switched per job when applying). Also uploads your
   * transcript to Handshake if you added one in Documents.
   */
  syncResumes({ sources = SOURCES, files = null } = {}) {
    return this.run('sync', async () => {
      const ws = this.ws;
      const settings = loadSettings(ws);
      let resumes = await listResumes(ws);
      if (files) resumes = resumes.filter((r) => files.includes(r.file));
      if (!resumes.length) throw new Error('Add your resumes to the resumes folder first.');
      const profile = readJson(ws.profile, {});
      const rules = readJson(ws.resumeRules, {});
      const s = await this.connect();
      const report = [];
      this.setState({ total: resumes.length * sources.length });
      for (const src of sources) {
        if (this.state.stop) break;
        const P = PLATFORMS[src];
        const page = await s.workTab(src);
        const row = { source: src, label: P.label, uploaded: [], skipped: [], failed: [], note: '' };
        report.push(row);
        try {
          const st = await P.loginState(page);
          if (!st.loggedIn) { row.note = 'not signed in'; this.log(`${P.label}: not signed in, so nothing was uploaded.`, 'warn'); continue; }
          if (src === 'indeed') {
            const def = resumes.find((r) => r.file === rules.default) || resumes.find((r) => /swe|software|general|main/i.test(r.file)) || resumes[0];
            const res = await this.switchIndeed(page, def);
            (res.ok ? row.uploaded : row.failed).push({ file: def.file, name: res.name, note: res.note });
            continue;
          }
          await this.uploadToSite(page, src, resumes, row, { settings, profile, progress: true });
        } catch (e) {
          row.note = String(e.message || e).split('\n')[0];
          this.log(`${P.label}: ${row.note}`, e instanceof SecurityStop ? 'error' : 'warn');
        }
        this.log(`${P.label}: ${row.uploaded.length} uploaded, ${row.skipped.length} already current, ${row.failed.length} failed.`);
      }
      await s.closeWorkTabs(report.filter((r) => r.note && !r.uploaded.length).map((r) => r.source));
      const summary = report.map((r) => `${r.label}: ${r.uploaded.length} uploaded${r.failed.length ? `, ${r.failed.length} failed` : ''}`).join('; ');
      return { summary, report };
    });
  }

  /**
   * Uploads the resumes that are missing or changed on LinkedIn or Handshake
   * (plus your transcript on Handshake) and records the dated names.
   * `page` must already be signed in on that site.
   */
  async uploadToSite(page, src, resumes, row, { settings, profile, progress = false }) {
    const ws = this.ws;
    const P = PLATFORMS[src];
    const sync = loadSync(ws);
    const onSite = src === 'handshake' ? (await handshake.siteDocuments(page)).map((d) => d.name) : await P.siteResumes(page);
    for (const r of resumes) {
      if (this.state.stop) break;
      if (progress) this.setState({ current: `${r.file} to ${P.label}`, done: this.state.done + 1 });
      const { state } = resumeState(sync, src, r, onSite);
      if (state === 'current') { row.skipped.push({ file: r.file, note: 'already current' }); continue; }
      const name = datedName(r.file);
      const file = datedCopy(ws, r.path, name);
      const res = src === 'handshake' ? await handshake.uploadDocument(page, file, 'Resume') : await linkedin.uploadResume(page, file);
      if (res.ok) {
        recordUpload(ws, src, r, name);
        row.uploaded.push({ file: r.file, name, note: res.note || '' });
        this.log(`${P.label}: uploaded ${name}${res.note ? ` (${res.note})` : ''}`);
      } else {
        row.failed.push({ file: r.file, name, note: res.note });
        this.log(`${P.label}: could not upload ${name}: ${res.note}`, 'warn');
        if (res.full) { row.note = `${P.label} looks full. Delete old resumes in its Resumes section, then run this again.`; this.log(row.note, 'warn'); break; }
      }
      await pause(settings, 0.3);
    }
    // the transcript goes to Handshake too, if you added one
    const t = profile.documents?.transcript && path.join(ws.documents, profile.documents.transcript);
    if (src === 'handshake' && t && fs.existsSync(t)) {
      const tr = { file: `transcript:${profile.documents.transcript}`, path: t };
      if (resumeState(loadSync(ws), src, tr, onSite).state !== 'current') {
        const name = datedName(profile.documents.transcript);
        const res = await handshake.uploadDocument(page, datedCopy(ws, t, name), 'Transcript');
        if (res.ok) { recordUpload(ws, src, tr, name); recordSite(ws, 'handshake', { transcript: { name, date: new Date().toDateString() } }); row.uploaded.push({ file: profile.documents.transcript, name }); }
        else row.failed.push({ file: profile.documents.transcript, name, note: res.note });
      }
    }
    return row;
  }

  /** Puts a resume's dated copy on Indeed, unless it is already the one there. */
  async switchIndeed(page, resume) {
    const sync = loadSync(this.ws);
    const cur = sync.indeed?.current;
    if (cur && cur.file === resume.file && cur.hash === fileHash(resume.path)) {
      const onSite = await indeed.currentFile(page);
      if (onSite === cur.name) return { ok: true, name: cur.name, note: 'already on Indeed' };
    }
    const name = datedName(resume.file);
    const res = await indeed.replaceResume(page, datedCopy(this.ws, resume.path, name));
    if (res.ok) {
      recordUpload(this.ws, 'indeed', resume, name);
      const rec = loadSync(this.ws).indeed.files[resume.file];
      recordSite(this.ws, 'indeed', { current: { file: resume.file, ...rec } });
      this.log(`Indeed: switched your resume to ${name}`);
    } else this.log(`Indeed: could not switch to ${name}: ${res.note}`, 'warn');
    return { ...res, name };
  }
}
