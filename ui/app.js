'use strict';
/*
  JobPilot dashboard.
  Plain browser JavaScript: no framework, no build step, and no requests to
  anything except the JobPilot server on this computer.
  Everything that comes from a job site (titles, companies, questions, notes)
  is put on the page with textContent through h(), never as HTML.
*/

// =================================================================== helpers

const $ = (sel, root = document) => root.querySelector(sel);
const BOOL_PROPS = new Set(['disabled', 'hidden', 'readOnly', 'required', 'multiple', 'open', 'autofocus']);
const LATE_PROPS = new Set(['value', 'checked', 'selected', 'indeterminate']);

/** Builds an element. Strings become text nodes, so nothing is parsed as HTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  const late = [];
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === undefined || v === null || v === false) continue;
      if (key === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      else if (key === 'text') el.textContent = String(v);
      else if (key === 'style') Object.assign(el.style, v);
      else if (key === 'dataset') Object.assign(el.dataset, v);
      else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2), v);
      else if (LATE_PROPS.has(key)) late.push([key, v]);
      else if (BOOL_PROPS.has(key)) el[key] = true;
      else if (key === 'href') { const u = safeUrl(v); if (u) el.setAttribute('href', u); }
      else el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  addKids(el, kids);
  for (const [k, v] of late) el[k] = v;
  return el;
}

/** replaceChildren that skips null/false, which the DOM would print as "null". */
function setKids(el, ...kids) { el.replaceChildren(); addKids(el, kids); return el; }

function addKids(el, kids) {
  for (const k of kids) {
    if (k === undefined || k === null || k === false || k === true) continue;
    if (Array.isArray(k)) addKids(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

/** Only http(s) links and same-page paths. Blocks javascript: and friends. */
function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^(\/(?!\/)|#)/.test(s)) return s;
  return null;
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
  return el;
}

const ICONS = {
  flag: [['path', { d: 'M5 21V4' }], ['path', { d: 'M5 4h11l-2 4 2 4H5' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7' }]],
  file: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }], ['path', { d: 'M9 13h6M9 17h4' }]],
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.5-3.5' }]],
  briefcase: [['rect', { x: 3, y: 7, width: 18, height: 13, rx: 2 }], ['path', { d: 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2' }], ['path', { d: 'M3 13h18' }]],
  help: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.5v.5' }], ['path', { d: 'M12 17h.01' }]],
  table: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M3 15h18M9 10v10' }]],
  list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['path', { d: 'M4.5 6h.01M4.5 12h.01M4.5 18h.01' }]],
  sliders: [['path', { d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }], ['circle', { cx: 15, cy: 6, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 17, cy: 18, r: 2 }]],
  plane: [['path', { d: 'M21.5 2.5 10.5 13.5' }], ['path', { d: 'M21.5 2.5 14.5 21.5l-4-8-8-4z' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  checkCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm8 12.5 2.8 2.8L16 10' }]],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  trash: [['path', { d: 'M4 7h16' }], ['path', { d: 'M9 7V4h6v3' }], ['path', { d: 'M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13' }]],
  external: [['path', { d: 'M14 4h6v6' }], ['path', { d: 'M10 14 20 4' }], ['path', { d: 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }]],
  copy: [['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }], ['path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }]],
  upload: [['path', { d: 'M12 16V4' }], ['path', { d: 'm7 9 5-5 5 5' }], ['path', { d: 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }]],
  download: [['path', { d: 'M12 4v12' }], ['path', { d: 'm7 11 5 5 5-5' }], ['path', { d: 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }]],
  skip: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M5.7 5.7l12.6 12.6' }]],
  undo: [['path', { d: 'M9 14 4 9l5-5' }], ['path', { d: 'M4 9h11a5 5 0 0 1 0 10h-3' }]],
  shield: [['path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18' }], ['path', { d: 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18' }]],
  login: [['path', { d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4' }], ['path', { d: 'm10 17 5-5-5-5' }], ['path', { d: 'M15 12H3' }]],
  sparkle: [['path', { d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z' }], ['path', { d: 'M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z' }]],
  alert: [['path', { d: 'M10.3 4 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z' }], ['path', { d: 'M12 9v4M12 17h.01' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 16v-4M12 8h.01' }]],
  terminal: [['path', { d: 'm5 17 5-5-5-5' }], ['path', { d: 'M12 19h7' }]],
  refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.3-5.7L20 8.5' }], ['path', { d: 'M20 3.5v5h-5' }]],
  target: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], ['circle', { cx: 12, cy: 12, r: 1 }]],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  chevronRight: [['path', { d: 'm9 6 6 6-6 6' }]],
  arrowUp: [['path', { d: 'M12 19V5M6 11l6-6 6 6' }]],
  arrowDown: [['path', { d: 'M12 5v14M18 13l-6 6-6-6' }]],
  key: [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'm10.8 12.2 9.2-9.2M16 7l3 3M14 9l2 2' }]],
  tab: [['rect', { x: 3, y: 5, width: 18, height: 15, rx: 2 }], ['path', { d: 'M3 9h18M8 5v4' }]],
  inbox: [['path', { d: 'M3 13h5l1.5 3h5l1.5-3h5' }], ['path', { d: 'M5.5 5h13l2.5 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z' }]],
};

function icon(name, size = 16) {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico', focusable: 'false',
  });
  for (const [tag, attrs] of ICONS[name] || []) svg.append(svgEl(tag, attrs));
  return svg;
}

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const splitList = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const humanize = (s) => cap(String(s || '').replace(/_/g, ' '));
let idSeq = 0;
const nextId = (p = 'id') => `${p}-${++idSeq}`;

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtClock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Same normalizing the server uses before it tests answer patterns. */
function normalizeLabel(s) {
  return String(s || '')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\((optional|required)\)/g, ' ')
    .replace(/\b(required|optional)$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ================================================================= constants

const TASK_LABEL = { search: 'Searching', apply: 'Applying', check: 'Checking accounts', sync: 'Uploading resumes' };
const TASK_NAME = { search: 'Search', apply: 'Apply', check: 'Account check', sync: 'Resume upload' };

const STATUS = {
  saved: { label: 'Saved', tone: 'blue', tip: 'Found by a search and waiting for you to apply.' },
  applying: { label: 'Applying', tone: 'violet', tip: 'JobPilot is working on this one right now.' },
  needs_answer: { label: 'Needs an answer', tone: 'amber', tip: 'A form asked something new. Answer it on the Questions tab.' },
  needs_review: { label: 'Review AI answer', tone: 'amber', tip: 'AI wrote an answer and filled the form. Read it in the open tab, then submit it yourself.' },
  submitted: { label: 'Submitted', tone: 'green', tip: 'The application was sent.' },
  filled_not_submitted: { label: 'Filled, not sent', tone: 'teal', tip: 'The form was filled in but not sent, because Submit is off.' },
  external_manual: { label: 'Apply on company site', tone: 'purple', tip: 'This job uses a company site JobPilot cannot fill. Open it and apply yourself.' },
  skipped: { label: 'Skipped', tone: 'gray', tip: 'Skipped by you or by your settings.' },
  duplicate: { label: 'Already applied', tone: 'gray', tip: 'You already applied to this job.' },
  blocked: { label: 'Blocked', tone: 'orange', tip: 'A captcha or security check stopped JobPilot. Finish it in Chrome yourself.' },
  error: { label: 'Error', tone: 'red', tip: 'Something went wrong. The note says what.' },
  applied: { label: 'Applied', tone: 'green' },
  already_applied: { label: 'Already applied', tone: 'gray' },
  interview: { label: 'Interview', tone: 'blue' },
  offer: { label: 'Offer', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'gray' },
};
const JOB_FILTERS = ['saved', 'needs_answer', 'needs_review', 'submitted', 'filled_not_submitted', 'external_manual', 'skipped', 'duplicate', 'blocked', 'error'];
// statuses where JobPilot leaves the job's tab open for you to finish
const WAITING_STATUSES = new Set(['needs_review', 'filled_not_submitted', 'needs_answer', 'blocked', 'error']);
const CAN_MARK_SUBMITTED = new Set(['needs_review', 'needs_answer', 'filled_not_submitted', 'error']);

const PROFILE_SECTIONS = [
  { id: 'personal', title: 'Personal & contact', keys: ['firstName', 'lastName', 'preferredName', 'pronouns', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country'] },
  { id: 'links', title: 'Links', keys: ['linkedin', 'github', 'portfolio'] },
  { id: 'education', title: 'Education', keys: ['school', 'degree', 'major', 'gpa', 'gradMonth', 'gradYear'] },
  { id: 'work', title: 'Work', keys: ['currentCompany', 'currentTitle', 'yearsExperience', 'howHeard'] },
  { id: 'auth', title: 'Work authorization & visa', keys: ['workAuthorized', 'needsSponsorship', 'visaStatus', 'over18'] },
  { id: 'availability', title: 'Availability & pay', keys: ['startDate', 'noticePeriod', 'salary', 'willingToRelocate', 'openToRemote', 'openToOnsite'] },
  { id: 'about', title: 'About you, for AI answers', keys: ['aboutMe'], note: 'Only used when AI answers are on in Settings. A few honest lines about what you are good at and the work you want next help the answers sound like you.' },
  { id: 'eeo', title: 'Voluntary self-identification', keys: ['gender', 'transgender', 'orientation', 'hispanic', 'race', 'veteran', 'disability'], note: 'Each of these is optional. Anything you leave blank is answered with "Decline to self-identify", and choosing that yourself is fine too.' },
];
const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'city', 'workAuthorized', 'needsSponsorship'];
const EEO_FIELDS = new Set(PROFILE_SECTIONS.find((s) => s.id === 'eeo').keys);
const FIELD_INPUT = {
  email: { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' },
  phone: { type: 'tel', autocomplete: 'tel', placeholder: '(555) 123 4567' },
  firstName: { autocomplete: 'given-name' },
  lastName: { autocomplete: 'family-name' },
  address: { autocomplete: 'street-address' },
  city: { autocomplete: 'address-level2' },
  state: { autocomplete: 'address-level1' },
  zip: { autocomplete: 'postal-code', inputmode: 'numeric' },
  country: { autocomplete: 'country-name', placeholder: 'United States' },
  linkedin: { type: 'url', placeholder: 'https://www.linkedin.com/in/your-name' },
  github: { type: 'url', placeholder: 'https://github.com/your-name' },
  portfolio: { type: 'url', placeholder: 'https://your-site.com' },
  gpa: { inputmode: 'decimal', placeholder: 'For example 3.6' },
  gradYear: { inputmode: 'numeric', placeholder: 'For example 2026' },
  yearsExperience: { inputmode: 'decimal', placeholder: 'For example 1' },
  salary: { inputmode: 'numeric', placeholder: 'For example 85000' },
  startDate: { placeholder: 'Immediately, or a date' },
  noticePeriod: { placeholder: 'For example 2 weeks' },
  howHeard: { placeholder: 'LinkedIn' },
  pronouns: { placeholder: 'For example she/her' },
};

const ROLE_TAGS = {
  swe: 'general software', frontend: 'front end', backend: 'back end', fullstack: 'full stack', mobile: 'iOS and Android',
  ml: 'machine learning', ai: 'AI and LLMs', data: 'data engineering', devops: 'DevOps and cloud', security: 'security',
  fde: 'forward deployed and solutions', quant: 'quant and trading', annotation: 'data labeling and AI training',
};

const SITE_UPLOAD_HELP = {
  linkedin: 'In JobPilot\'s Chrome, go to LinkedIn Settings, then Job application settings (linkedin.com/jobs/application-settings), and upload each missing file. Keep the file names exactly the same.',
  handshake: 'In JobPilot\'s Chrome, go to your Handshake Profile, then Documents (app.joinhandshake.com/docs). Upload each missing file with Resume as the type. Keep the file names exactly the same.',
  indeed: 'In JobPilot\'s Chrome, open your Indeed profile (profile.indeed.com), then Resume. Indeed keeps one main resume, and JobPilot uploads the matched file during Indeed Apply when it can.',
};

// ===================================================================== state

const S = {
  state: null, profile: null, resumes: null, searches: null, jobs: null, review: null,
  sheet: null, answers: null, settings: null, ai: null,
  tab: null, dirty: {}, live: false, offline: false,
  log: [], logSeen: new Set(), logOpen: false, unread: { warn: 0, error: 0 },
  lastRunAt: undefined, setupSig: '', pendingAnchor: null, sync: null, booted: false,
};
const E = {}; // working copies for the editor tabs

let view;

const TABS = [
  { id: 'setup', label: 'Setup', icon: 'flag', group: 'Start', load: loadSetup, render: renderSetup },
  { id: 'profile', label: 'Profile', icon: 'user', group: 'About you', load: loadProfileTab, render: renderProfile },
  { id: 'resumes', label: 'Resumes', icon: 'file', group: 'About you', load: loadResumesTab, render: renderResumes },
  { id: 'searches', label: 'Searches', icon: 'search', group: 'About you', load: loadSearchesTab, render: renderSearches },
  { id: 'jobs', label: 'Jobs', icon: 'briefcase', group: 'Applying', load: loadJobsTab, render: renderJobs, fill: true },
  { id: 'questions', label: 'Questions', icon: 'help', group: 'Applying', load: loadQuestionsTab, render: renderQuestions },
  { id: 'sheet', label: 'Applications', icon: 'table', group: 'Applying', load: loadSheetTab, render: renderSheet, fill: true },
  { id: 'answers', label: 'Answers', icon: 'list', group: 'Advanced', load: loadAnswersTab, render: renderAnswers },
  { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Advanced', load: loadSettingsTab, render: renderSettings },
];
const TAB = Object.fromEntries(TABS.map((t) => [t.id, t]));

function siteLabel(id) {
  if (id === 'ats') return 'Company form';
  return S.state?.sources?.find((s) => s.id === id)?.label || cap(id);
}
const sources = () => S.state?.sources || [{ id: 'linkedin', label: 'LinkedIn' }, { id: 'handshake', label: 'Handshake' }, { id: 'indeed', label: 'Indeed' }];

// ======================================================================= API

class ApiError extends Error {}

async function api(method, url, body, { quiet = false } = {}) {
  const init = { method, headers: { Accept: 'application/json' }, cache: 'no-store' };
  if (method !== 'GET') {
    init.headers['X-JobPilot'] = '1';
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body === undefined ? {} : body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    setOffline(true);
    const err = new ApiError('JobPilot is not responding. Is it still running in your terminal?');
    if (!quiet) toast(err.message, 'error');
    throw err;
  }
  setOffline(false);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = cap(String(data?.error || `Something went wrong (error ${res.status}).`));
    if (!quiet) toast(msg, 'error');
    throw new ApiError(msg);
  }
  return data;
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    fr.onerror = () => reject(fr.error || new Error('could not read the file'));
    fr.readAsDataURL(file);
  });
}

const MAX_UPLOAD = 18 * 1024 * 1024; // the server takes 25 MB of JSON, and base64 adds a third

// ================================================================ UI pieces

function btn(label, { kind = '', icon: ic, onclick, disabled, size, tip, type = 'button', attrs = {}, count } = {}) {
  return h('button', { type, class: ['btn', kind && `btn-${kind}`, size && `btn-${size}`], onclick, disabled, 'data-tip': tip, ...attrs },
    ic && icon(ic, size === 'sm' ? 14 : 16), label && h('span', null, label), count != null && h('span', { class: 'btn-count' }, String(count)));
}
function iconBtn(ic, label, onclick, { kind, disabled } = {}) {
  return h('button', { type: 'button', class: ['icon-btn', kind && `icon-btn-${kind}`], 'aria-label': label, 'data-tip': label, onclick, disabled }, icon(ic, 16));
}
/** Disables a button and shows a spinner while fn runs. */
async function busy(button, fn) {
  if (!button || button.classList.contains('is-busy')) return undefined;
  const was = button.disabled;
  button.disabled = true;
  button.classList.add('is-busy');
  try { return await fn(); } finally { button.classList.remove('is-busy'); button.disabled = was; }
}
const onBusy = (fn) => (e) => busy(e.currentTarget, () => fn(e));

function pill(text, tone = 'gray', { tip, pulse } = {}) {
  return h('span', { class: ['pill', `pill-${tone}`, pulse && 'pill-pulse'], 'data-tip': tip }, h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), text);
}
function statusPill(status) {
  const s = STATUS[status] || { label: humanize(status) || 'Unknown', tone: 'gray' };
  return pill(s.label, s.tone, { tip: s.tip, pulse: status === 'applying' });
}
const CALLOUT_ICON = { info: 'info', warn: 'alert', danger: 'alert', success: 'checkCircle', neutral: 'info', shield: 'shield' };
function callout(tone, ...content) {
  return h('div', { class: `callout callout-${tone}` }, h('span', { class: 'callout-icon' }, icon(CALLOUT_ICON[tone] || 'info', 18)), h('div', { class: 'callout-body' }, content));
}
function pageHead(title, sub, actions) {
  return h('header', { class: 'page-head' },
    h('div', null, h('h1', { class: 'page-title' }, title), sub && h('p', { class: 'page-sub' }, sub)),
    actions && h('div', { class: 'page-actions' }, actions));
}
function cardHead(title, sub, actions) {
  return h('div', { class: 'card-head' },
    h('div', null, h('h2', { class: 'card-title' }, title), sub && h('p', { class: 'card-sub' }, sub)),
    actions && h('div', { class: 'card-actions' }, actions));
}
function emptyState({ icon: ic = 'inbox', title, text, actions, small }) {
  return h('div', { class: ['empty', small && 'empty-sm'] },
    h('div', { class: 'empty-icon' }, icon(ic, 26)),
    h('h2', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    actions && h('div', { class: 'empty-actions' }, actions));
}
function field(label, control, { hint, required, missing, wide, error } = {}) {
  const id = control.id || (control.id = nextId('f'));
  return h('div', { class: ['field', wide && 'field-wide', missing && 'is-missing'] },
    h('label', { class: 'field-label', for: id }, label, required && h('span', { class: 'req-tag' }, 'Required')),
    control,
    hint && h('p', { class: 'field-hint' }, hint),
    error && h('p', { class: 'field-error' }, error));
}
function switchRow(label, checked, onChange, { hint, disabled } = {}) {
  const id = nextId('sw');
  return h('div', { class: 'switch-row' },
    h('div', { class: 'switch-text' }, h('label', { class: 'switch-label', for: id }, label), hint && h('p', { class: 'field-hint' }, hint)),
    h('input', { type: 'checkbox', role: 'switch', class: 'switch', id, checked: !!checked, disabled, onchange: (e) => onChange(e.target.checked, e.target) }));
}
function checkGroup(legend, options, selected, onChange) {
  const set = new Set(selected || []);
  const opts = [...options];
  for (const v of set) if (!opts.some(([k]) => k === v)) opts.push([v, humanize(v)]);
  return h('fieldset', { class: 'fieldset' }, h('legend', { class: 'field-label' }, legend),
    h('div', { class: 'chip-group' }, opts.map(([value, label]) => h('label', { class: 'chip-check' },
      h('input', { type: 'checkbox', checked: set.has(value), onchange: (e) => { if (e.target.checked) set.add(value); else set.delete(value); onChange(opts.map(([k]) => k).filter((k) => set.has(k))); } }),
      h('span', null, label)))));
}
function segmented(legend, options, value, onChange) {
  const name = nextId('seg');
  return h('fieldset', { class: 'fieldset' }, h('legend', { class: 'field-label' }, legend),
    h('div', { class: 'segmented' }, options.map(([v, label]) => h('label', { class: 'seg' },
      h('input', { type: 'radio', name, value: v, checked: value === v, onchange: () => onChange(v) }),
      h('span', null, label)))));
}
function meter(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const tone = p >= 70 ? 'good' : p >= 40 ? 'mid' : 'low';
  return h('div', { class: `meter ${tone}`, 'aria-hidden': 'true' }, h('span', { style: { width: `${p}%` } }));
}
function siteBadge(id) { return h('span', { class: `site-badge site-${id}` }, siteLabel(id)); }
function code(text) { return h('code', null, text); }
function loadingView() { return h('div', { class: 'loading' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, 'Loading…')); }

/** A button that opens a file picker. */
function uploadButton(label, { accept, multiple, onFiles, kind = '', size, icon: ic = 'upload', disabled } = {}) {
  const input = h('input', { type: 'file', accept, multiple, hidden: true, onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) onFiles(files, b); } });
  const b = btn(label, { kind, size, icon: ic, disabled, onclick: () => input.click() });
  return [input, b];
}
/** Lets a block accept dropped files. */
function makeDropTarget(el, onFiles) {
  let depth = 0;
  el.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); depth++; el.classList.add('is-over'); });
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('is-over'); });
  el.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; el.classList.remove('is-over'); const files = [...(e.dataTransfer?.files || [])]; if (files.length) onFiles(files); });
  return el;
}

// =================================================================== toasts

const TOAST_ICON = { info: 'info', success: 'checkCircle', warn: 'alert', error: 'alert' };
function toast(message, kind = 'info', { timeout } = {}) {
  const box = $('#toasts');
  let timer;
  const close = () => { clearTimeout(timer); el.classList.add('is-leaving'); setTimeout(() => el.remove(), 180); };
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-icon' }, icon(TOAST_ICON[kind] || 'info', 18)),
    h('div', { class: 'toast-msg' }, message),
    h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss message', onclick: close }, icon('x', 14)));
  box.append(el);
  while (box.children.length > 4) box.firstElementChild.remove();
  timer = setTimeout(close, timeout ?? (kind === 'error' ? 9000 : 5000));
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
}

// =================================================================== dialog

function confirmDialog({ title, body, ok = 'Continue', cancel = 'Cancel', danger = false, icon: ic }) {
  const dlg = $('#dialog');
  if (dlg.open) dlg.close();
  return new Promise((resolve) => {
    const okBtn = h('button', { type: 'submit', value: 'ok', class: ['btn', danger ? 'btn-danger' : 'btn-primary'] }, ok);
    const cancelBtn = h('button', { type: 'submit', value: 'cancel', class: 'btn' }, cancel);
    const parts = body == null ? [] : Array.isArray(body) ? body : [body];
    dlg.replaceChildren(h('form', { method: 'dialog', class: 'dlg' },
      h('div', { class: ['dlg-icon', danger && 'is-danger'] }, icon(ic || (danger ? 'alert' : 'info'), 20)),
      h('h2', { class: 'dlg-title', id: 'dlgTitle' }, title),
      parts.length && h('div', { class: 'dlg-body' }, parts.map((p) => (typeof p === 'string' ? h('p', null, p) : p))),
      h('div', { class: 'dlg-actions' }, cancel && cancelBtn, okBtn)));
    dlg.setAttribute('aria-labelledby', 'dlgTitle');
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    (danger && cancel ? cancelBtn : okBtn).focus();
  });
}

// ================================================================== tooltip

function initTooltips() {
  const tip = h('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' });
  document.body.append(tip);
  let cur = null;
  const place = () => {
    if (!cur) return;
    const r = cur.getBoundingClientRect();
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  };
  const show = (el) => {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    cur = el; tip.textContent = text; tip.classList.add('is-on'); place();
  };
  const hide = () => { cur = null; tip.classList.remove('is-on'); };
  document.addEventListener('mouseover', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el && el !== cur) show(el); else if (!el && cur) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el && el.matches(':focus-visible')) show(el); else hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// ============================================================ navigation

function buildNav() {
  const nav = $('#sidebar');
  const groups = [];
  for (const t of TABS) {
    let g = groups.find((x) => x.name === t.group);
    if (!g) { g = { name: t.group, tabs: [] }; groups.push(g); }
    g.tabs.push(t);
  }
  nav.replaceChildren(
    ...groups.map((g) => h('div', { class: 'nav-group' },
      h('div', { class: 'nav-group-title' }, g.name),
      g.tabs.map((t) => h('a', { class: 'nav-item', href: `#${t.id}`, id: `nav-${t.id}`, 'data-tip-collapsed': t.label },
        icon(t.icon, 18), h('span', { class: 'nav-label' }, t.label),
        h('span', { class: 'nav-dirty', hidden: true, 'aria-hidden': 'true' }),
        h('span', { class: 'nav-badge', hidden: true }))))),
    h('div', { class: 'sidebar-foot' }, h('span', { class: 'live', id: 'liveFlag' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('span', { class: 'live-text', id: 'liveText' }, 'Connecting…'))),
  );
}

function renderNav() {
  const st = S.state;
  for (const t of TABS) {
    const a = $(`#nav-${t.id}`);
    if (!a) continue;
    if (S.tab === t.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    a.querySelector('.nav-dirty').hidden = !S.dirty[t.id];
    const badge = a.querySelector('.nav-badge');
    let text = ''; let cls = ''; let tip = '';
    if (st) {
      if (t.id === 'setup') {
        const steps = setupSteps();
        const n = steps.filter((s) => s.done).length;
        if (n === steps.length) { text = '✓'; cls = 'is-done'; tip = 'Setup is done'; } else { text = `${n}/${steps.length}`; cls = 'is-progress'; tip = `${n} of ${steps.length} setup steps done`; }
      } else if (t.id === 'questions' && st.questions) { text = String(st.questions); cls = 'is-alert'; tip = `${plural(st.questions, 'question')} to answer`; }
      else if (t.id === 'jobs') {
        const rev = st.counts?.needs_review || 0;
        if (rev) { text = String(rev); cls = 'is-alert'; tip = `${plural(rev, 'AI answer')} to review`; }
        else if (st.counts?.saved) { text = String(st.counts.saved); tip = `${plural(st.counts.saved, 'saved job')}`; }
      }
    }
    badge.hidden = !text;
    badge.textContent = text;
    badge.className = ['nav-badge', cls].filter(Boolean).join(' ');
    if (tip) badge.setAttribute('aria-label', tip); else badge.removeAttribute('aria-label');
    // collapsed sidebar shows labels as tooltips
    if (window.matchMedia('(max-width: 1100px)').matches) a.setAttribute('data-tip', t.label + (tip ? `: ${tip}` : ''));
    else a.removeAttribute('data-tip');
  }
}

const tabFromHash = () => { const id = decodeURIComponent(location.hash.slice(1)).split(':')[0]; return TAB[id] ? id : null; };

function go(tab, anchor) {
  S.pendingAnchor = anchor || null;
  if (location.hash === `#${tab}`) show(tab);
  else location.hash = tab;
}

let showToken = 0;
async function show(tab) {
  if (S.tab && S.tab !== tab && S.dirty[S.tab]) {
    const ok = await confirmDialog({
      title: 'Leave without saving?',
      body: `You have changes on ${TAB[S.tab].label} that are not saved yet.`,
      ok: 'Discard changes', cancel: 'Stay here', danger: true,
    });
    if (!ok) { history.replaceState(null, '', `#${S.tab}`); return; }
    S.dirty[S.tab] = false;
  }
  const t = TAB[tab];
  const token = ++showToken;
  S.tab = tab;
  document.title = `${t.label} · JobPilot`;
  renderNav();
  view.className = t.fill ? 'view view--fill' : 'view';
  view.replaceChildren(loadingView());
  try { await t.load(); } catch (e) {
    if (token !== showToken) return;
    view.replaceChildren(h('div', { class: 'view-inner' }, emptyState({ icon: 'alert', title: 'This page could not load', text: e.message, actions: [btn('Try again', { kind: 'primary', icon: 'refresh', onclick: () => show(tab) })] })));
    return;
  }
  if (token !== showToken) return;
  t.render();
  view.scrollTop = 0;
  if (S.pendingAnchor) {
    const el = document.getElementById(S.pendingAnchor);
    S.pendingAnchor = null;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}

/** Re-renders the current tab, keeping the scroll position. */
function rerender() {
  if (!S.tab) return;
  const top = view.scrollTop;
  TAB[S.tab].render();
  view.scrollTop = top;
}

function markDirty(tab, on = true) {
  S.dirty[tab] = on;
  const bar = $('#savebar');
  if (bar && S.tab === tab) {
    bar.classList.toggle('is-dirty', on);
    bar.querySelector('.savebar-msg').textContent = on ? 'You have unsaved changes' : 'All changes saved';
    for (const b of bar.querySelectorAll('button')) if (!b.classList.contains('is-busy')) b.disabled = !on;
  }
  renderNav();
}

function savebar(tab, onSave, onDiscard) {
  const on = !!S.dirty[tab];
  return h('div', { class: ['savebar', on && 'is-dirty'], id: 'savebar' },
    h('span', { class: 'savebar-text' }, h('span', { class: 'savebar-dot', 'aria-hidden': 'true' }), h('span', { class: 'savebar-msg', role: 'status' }, on ? 'You have unsaved changes' : 'All changes saved')),
    h('div', { class: 'savebar-actions' },
      btn('Discard', { kind: 'ghost', disabled: !on, onclick: async () => {
        const ok = await confirmDialog({ title: 'Discard your changes?', body: 'Your edits on this page go back to the last saved version.', ok: 'Discard', danger: true });
        if (!ok) return;
        S.dirty[tab] = false;
        onDiscard();
        markDirty(tab, false);
      } }),
      h('button', { type: 'button', class: 'btn btn-primary', disabled: !on, onclick: async (e) => {
        const b = e.currentTarget;
        b.classList.add('is-busy'); b.disabled = true;
        try { await onSave(); } finally { b.classList.remove('is-busy'); b.disabled = !S.dirty[tab]; }
      } }, icon('check', 16), h('span', null, 'Save changes'))));
}

// ================================================================ top bar

function renderTopbar() {
  const st = S.state;
  const r = st?.runner || {};
  const task = r.task;
  const chip = $('#statusChip');
  chip.className = ['status-chip', task ? 'is-running' : 'is-idle', r.stop && 'is-stopping'].filter(Boolean).join(' ');
  $('#statusLabel').textContent = !st ? 'Connecting' : task ? (r.stop ? 'Stopping' : TASK_LABEL[task] || humanize(task)) : 'Idle';
  const count = $('#statusCount');
  count.hidden = !(task && r.total);
  count.textContent = task && r.total ? `${r.done}/${r.total}` : '';
  const cur = $('#statusCurrent');
  if (task) cur.textContent = r.stop ? 'Finishing the current job' : (r.current || 'Starting…');
  else if (r.last) cur.textContent = `Last ${TASK_NAME[r.last.task]?.toLowerCase() || 'run'} ${r.last.ok ? 'finished' : 'stopped'} ${timeAgo(r.last.at)}`;
  else cur.textContent = '';
  const tipText = task ? `${TASK_LABEL[task] || task}${r.total ? ` ${r.done} of ${r.total}` : ''}${r.current ? `\n${r.current}` : ''}` : r.last ? `Last ${TASK_NAME[r.last.task] || 'run'}: ${r.last.summary || (r.last.ok ? 'finished' : 'stopped')}` : 'Nothing is running';
  chip.setAttribute('data-tip', tipText);
  $('#statusProgress').style.width = task && r.total ? `${Math.min(100, Math.round((r.done / r.total) * 100))}%` : '0';

  const on = !!st?.settings?.submit;
  const flag = $('#submitFlag');
  flag.classList.toggle('is-on', on);
  $('#submitFlagText').textContent = on ? 'Submit ON' : 'Submit OFF';
  $('#submitFlagSub').textContent = on ? 'sends applications' : 'fills forms, does not send';
  flag.setAttribute('data-tip', on ? 'Apply sends real applications. Click to change this in Settings.' : 'Apply fills in forms but does not send them. Click to change this in Settings.');

  const running = !!task;
  $('#btnSearch').disabled = running || !st;
  $('#btnApply').disabled = running || !st;
  $('#btnStop').hidden = !running;
  $('#btnStop').disabled = !!r.stop;
  const saved = st?.counts?.saved || 0;
  const applyBtn = $('#btnApply');
  let badge = applyBtn.querySelector('.btn-count');
  if (saved && !badge) { badge = h('span', { class: 'btn-count' }); applyBtn.append(badge); }
  if (badge) { badge.hidden = !saved; badge.textContent = String(saved); }
  syncRunButtons();
  applyBtn.setAttribute('data-tip', saved ? `Apply to your ${plural(saved, 'saved job')}, best matches first, up to 25 per run` : 'No saved jobs yet. Run Search & save first.');
}

/** Buttons that start a task follow the runner: off while anything runs. */
function syncRunButtons() {
  const busyNow = !!S.state?.runner?.task;
  for (const b of document.querySelectorAll('[data-runbtn]')) {
    if (b.classList.contains('is-busy')) continue;
    b.disabled = busyNow || b.dataset.blocked === '1';
  }
}
const runAttrs = (blocked) => ({ 'data-runbtn': '1', 'data-blocked': blocked ? '1' : null });

function bindTopbar() {
  $('#brandMark').append(icon('plane', 17));
  $('#btnSearch').prepend(icon('search', 16));
  $('#btnApply').prepend(icon('plane', 16));
  $('#btnStop').prepend(icon('stop', 16));
  $('#btnSearch').setAttribute('data-tip', 'Run every search that is turned on and save the jobs it finds');
  $('#btnSearch').addEventListener('click', () => startRun('search'));
  $('#btnApply').addEventListener('click', () => startRun('apply'));
  $('#btnStop').addEventListener('click', onBusy(async () => {
    await api('POST', '/api/run/stop');
    if (S.state?.runner) S.state.runner.stop = true;
    renderTopbar();
    toast('Stopping after the current job.', 'info');
  }));
  $('#submitFlag').addEventListener('click', () => go('settings'));
}

async function startRun(kind, body = {}) {
  const st = S.state;
  if (!st) return false;
  if (st.runner?.task) {
    toast(`JobPilot is busy ${TASK_LABEL[st.runner.task]?.toLowerCase() || 'with a task'}. Wait for it to finish or press Stop.`, 'warn');
    return false;
  }
  if (kind === 'search') {
    if (S.dirty.searches) {
      const ok = await confirmDialog({ title: 'Save your searches first?', body: 'You changed your searches but did not save yet. JobPilot searches with the saved version.', ok: 'Save and search' });
      if (!ok || !(await saveSearches())) return false;
    }
    if (!(S.state.setup?.searches)) {
      toast('Add a search on the Searches tab first.', 'warn');
      go('searches');
      return false;
    }
  }
  if (kind === 'sync') {
    if (!(st.setup?.resumes > 0)) { toast('Add your resumes first.', 'warn'); return false; }
    const ok = await confirmDialog({
      title: 'Upload resumes to sites?',
      body: [
        'JobPilot opens LinkedIn and Handshake in its Chrome window and uploads each resume that is missing or changed, with today\'s date and time in the name. Your transcript goes to Handshake too, if you added one.',
        'On Indeed it puts your default resume, and swaps it before each Indeed application.',
      ],
      ok: 'Upload resumes', icon: 'upload',
    });
    if (!ok) return false;
  }
  if (kind === 'apply') {
    if (!body.keys && !st.counts?.saved) { toast('There are no saved jobs to apply to yet. Press Search & save first.', 'warn'); return false; }
    if (st.settings?.submit) {
      const n = body.keys ? body.keys.length : Math.min(st.counts.saved, 25);
      const ok = await confirmDialog({
        title: 'Submit is ON',
        body: [`JobPilot will send real applications to up to ${plural(n, 'job')}.`, 'For a practice run, turn Submit off in Settings first.'],
        ok: 'Send applications', danger: true, icon: 'plane',
      });
      if (!ok) return false;
    }
  }
  try { await api('POST', `/api/run/${kind}`, body); } catch { return false; }
  S.state.runner = { ...(S.state.runner || {}), task: kind, done: 0, total: 0, current: 'Starting…', stop: false };
  renderTopbar();
  setLogOpen(true);
  if (S.tab === 'setup') maybeRerenderSetup(true);
  return true;
}

// ============================================================ live updates

function setOffline(off) {
  if (S.offline === off) return;
  S.offline = off;
  const b = $('#offline');
  b.hidden = !off;
  b.replaceChildren(icon('alert', 18), h('span', null, 'JobPilot is not responding. Make sure it is still running in your terminal. This page reconnects by itself.'));
}

function setLive(on) {
  S.live = on;
  const f = $('#liveFlag');
  if (!f) return;
  f.classList.toggle('is-live', on);
  $('#liveText').textContent = on ? 'Live updates on' : 'Reconnecting…';
  f.setAttribute('data-tip', on ? 'Connected to JobPilot. Updates appear as they happen.' : 'Trying to reconnect to JobPilot.');
}

function connectEvents() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => setLive(true));
  es.addEventListener('error', () => setLive(false));
  es.addEventListener('log', (e) => { try { addLog(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('state', (e) => { try { setRunner(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('sync', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (S.state?.setup) S.state.setup.sync = data;
      const up = (data.report || []).reduce((n, r) => n + (r.uploaded || []).length, 0);
      const bad = (data.report || []).reduce((n, r) => n + (r.failed || []).length, 0);
      toast(`Resume upload finished: ${plural(up, 'file')} uploaded${bad ? `, ${bad} failed` : ''}. Details are on the Setup tab.`, bad ? 'warn' : 'success');
      if (S.tab === 'setup') maybeRerenderSetup(true);
      if (S.tab === 'resumes') loadSyncRecords().then(() => { if (S.tab === 'resumes' && !S.dirty.resumes) rerender(); });
    } catch { /* ignore */ }
  });
  es.addEventListener('check', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (S.state?.setup) S.state.setup.accounts = data;
      toast('Account check finished. The results are on the Setup tab.', 'success');
      if (S.tab === 'setup') maybeRerenderSetup(true);
      renderNav();
    } catch { /* ignore */ }
  });
}

async function pollState() {
  try {
    const st = await api('GET', '/api/state', undefined, { quiet: true });
    applyState(st);
  } catch { /* offline banner shows */ }
}

function applyState(st) {
  const prevRunner = S.state?.runner;
  S.state = st;
  mergeLog(st.log || []);
  if (S.lastRunAt === undefined) S.lastRunAt = st.runner?.last?.at || null;
  handleRunner(prevRunner, st.runner);
  renderTopbar();
  renderNav();
  if (S.tab === 'setup') maybeRerenderSetup();
}

function setRunner(r) {
  if (!S.state) return;
  const prev = S.state.runner;
  S.state.runner = r;
  handleRunner(prev, r);
  renderTopbar();
}

let jobsTimer = null;
function handleRunner(prev, r) {
  if (!r) return;
  if (r.last && r.last.at !== S.lastRunAt && !r.task) {
    S.lastRunAt = r.last.at;
    onTaskFinished(r.last);
  }
  const progressed = r.task && (!prev || prev.done !== r.done);
  if (progressed && S.tab === 'jobs') scheduleJobsRefresh();
}

function onTaskFinished(last) {
  const name = TASK_NAME[last.task] || 'Task';
  if (last.ok) toast(`${name} finished: ${last.summary || 'done'}.`, 'success', { timeout: 7000 });
  else toast(`${name} stopped: ${last.summary || 'something went wrong'}`, 'error');
  pollState();
  if (['jobs', 'questions', 'sheet'].includes(S.tab) && !S.dirty[S.tab]) refreshCurrentData();
}

async function refreshCurrentData() {
  const tab = S.tab;
  try {
    await TAB[tab].load();
    if (S.tab === tab) rerender();
  } catch { /* the toast already said why */ }
}

function scheduleJobsRefresh() {
  if (jobsTimer) return;
  jobsTimer = setTimeout(async () => {
    jobsTimer = null;
    if (S.tab !== 'jobs') return;
    if (document.activeElement?.closest?.('.jobs-table select')) return;
    try {
      S.jobs = await api('GET', '/api/jobs', undefined, { quiet: true });
      if (S.tab === 'jobs') renderJobsBody();
    } catch { /* try again on the next tick */ }
  }, 2500);
}

// ===================================================================== log

function logKey(e) { return `${e.ts}|${e.level}|${e.msg}`; }

function mergeLog(list) {
  for (const e of list) addLog(e, { quietCount: !S.booted });
}

function addLog(e, { quietCount = false } = {}) {
  if (!e || !e.msg) return;
  const k = logKey(e);
  if (S.logSeen.has(k)) return;
  S.logSeen.add(k);
  S.log.push(e);
  if (S.log.length > 400) S.log.shift();
  if (S.logSeen.size > 2000) S.logSeen = new Set(S.log.map(logKey));
  if (!S.logOpen && !quietCount && (e.level === 'warn' || e.level === 'error')) S.unread[e.level]++;
  appendLogLine(e);
  renderLogHead();
}

function logLine(e) {
  const level = ['warn', 'error'].includes(e.level) ? e.level : 'info';
  return h('div', { class: `log-line lvl-${level}` },
    h('span', { class: 'log-time' }, fmtClock(e.ts)),
    h('span', { class: 'log-lvl' }, level === 'info' ? '' : level === 'warn' ? 'Warn' : 'Error'),
    h('span', { class: 'log-msg' }, e.msg));
}

function appendLogLine(e) {
  const body = $('#logBody');
  if (!S.logOpen) return; // drawn when the panel opens
  const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
  body.querySelector('.log-empty')?.remove();
  body.append(logLine(e));
  while (body.childElementCount > 400) body.firstElementChild.remove();
  if (atBottom) body.scrollTop = body.scrollHeight;
}

function drawLog() {
  const body = $('#logBody');
  body.replaceChildren(...(S.log.length ? S.log.map(logLine) : [h('div', { class: 'log-empty' }, 'Nothing has happened yet. Messages from searches and applications show up here as they happen.')]));
  body.scrollTop = body.scrollHeight;
}

function renderLogHead() {
  const last = S.log[S.log.length - 1];
  const prev = $('#logPreview');
  prev.textContent = last ? `${fmtClock(last.ts)}  ${last.msg}` : 'Nothing has happened yet.';
  prev.className = `log-preview${last && last.level !== 'info' ? ` lvl-${last.level}` : ''}`;
  prev.hidden = S.logOpen;
  const counts = $('#logCounts');
  setKids(counts, 
    S.unread.error ? pill(plural(S.unread.error, 'error'), 'red', { tip: 'New errors since you last opened the log' }) : null,
    S.unread.warn ? pill(plural(S.unread.warn, 'warning'), 'amber', { tip: 'New warnings since you last opened the log' }) : null,
  );
}

function setLogOpen(open) {
  S.logOpen = open;
  const panel = $('#logpanel');
  panel.classList.toggle('is-open', open);
  $('#logBody').hidden = !open;
  $('#logToggle').setAttribute('aria-expanded', String(open));
  $('#logChev').setAttribute('aria-expanded', String(open));
  $('#logClear').hidden = !open;
  if (open) { S.unread = { warn: 0, error: 0 }; drawLog(); }
  renderLogHead();
  try { localStorage.setItem('jobpilot.logOpen', open ? '1' : '0'); } catch { /* private mode */ }
}

function bindLog() {
  $('#logChev').append(icon('chevronDown', 16));
  $('#logTitle').prepend(icon('terminal', 15));
  $('#logToggle').addEventListener('click', () => setLogOpen(!S.logOpen));
  $('#logChev').addEventListener('click', () => setLogOpen(!S.logOpen));
  $('#logClear').addEventListener('click', () => { S.log = []; drawLog(); renderLogHead(); });
  let open = false;
  try { open = localStorage.getItem('jobpilot.logOpen') === '1'; } catch { /* private mode */ }
  setLogOpen(open);
}

// ================================================================ loaders

async function loadProfileData() {
  S.profile = await api('GET', '/api/profile');
  if (!S.dirty.profile || !E.profile) E.profile = profileDraft(S.profile);
}
async function loadResumesData() {
  S.resumes = await api('GET', '/api/resumes');
  if (!S.dirty.resumes || !E.resumes) E.resumes = resumesDraft(S.resumes);
}
async function loadSetup() {
  await Promise.all([loadProfileData().catch(() => {}), loadResumesData().catch(() => {})]);
}
async function loadProfileTab() {
  await Promise.all([loadProfileData(), S.resumes ? null : loadResumesData().catch(() => {})]);
}
async function loadSyncRecords() {
  try { S.sync = await api('GET', '/api/sync', undefined, { quiet: true }); } catch { /* the column just stays empty */ }
}
async function loadResumesTab() { await Promise.all([loadResumesData(), loadSyncRecords()]); }
async function loadSearchesTab() {
  S.searches = await api('GET', '/api/searches');
  if (!S.dirty.searches || !E.searches) E.searches = searchesDraft(S.searches);
}
async function loadJobsTab() {
  const [jobs] = await Promise.all([api('GET', '/api/jobs'), loadResumesData().catch(() => {})]);
  S.jobs = jobs;
}
async function loadQuestionsTab() { S.review = await api('GET', '/api/review'); }
async function loadSheetTab() { S.sheet = await api('GET', '/api/sheet'); }
async function loadAnswersTab() {
  S.answers = await api('GET', '/api/answers');
  if (!S.dirty.answers || !E.answers) E.answers = clone(Array.isArray(S.answers) ? S.answers : []);
}
async function loadSettingsTab() {
  const settings = await api('GET', '/api/settings');
  S.settings = settings;
  if (!S.dirty.settings || !E.settings) E.settings = clone(settings);
  fetchAiInfo(); // can take a few seconds while the server looks for Claude Code, so it fills in after the page shows
}
async function fetchAiInfo() {
  S.aiLoading = true;
  try { S.ai = await api('GET', '/api/ai', undefined, { quiet: true }); } catch { /* keep what we had */ }
  S.aiLoading = false;
  if (S.tab === 'settings') refreshAiCard();
}
function refreshAiCard() {
  const slot = document.getElementById('aiSlot');
  if (slot) slot.replaceChildren(aiCard());
}

// ================================================================== setup

function setupSteps() {
  const st = S.state;
  if (!st) return [];
  const su = st.setup || {};
  const report = su.accounts?.report || [];
  const bySrc = Object.fromEntries(report.map((r) => [r.source, r]));
  const skills = (S.profile?.profile?.skills || []).length;
  const c = st.counts || {};
  // the same order as the README's "First time setup", plus a practice run
  return [
    { id: 'signin', title: 'Sign in to each site in JobPilot\'s Chrome', done: report.length > 0 && sources().every((s) => bySrc[s.id]?.loggedIn) },
    { id: 'resumes', title: 'Add your resumes', done: su.resumes > 0 },
    { id: 'samefiles', title: 'Upload your resumes to each site', done: resumesCurrent(report) },
    { id: 'profile', title: 'Fill in your profile and documents', done: !!su.profile?.complete },
    { id: 'skills', title: 'Add your skills', done: skills > 0 },
    { id: 'search', title: 'Add a search', done: su.searches > 0 },
    { id: 'practice', title: 'Do a practice run', done: (c.filled_not_submitted || 0) + (c.submitted || 0) + (c.needs_review || 0) > 0 },
  ];
}
/** Every resume is "current" on LinkedIn and Handshake in the last check. */
function resumesCurrent(report) {
  const need = ['linkedin', 'handshake'].filter((id) => sources().some((s) => s.id === id));
  if (!need.length || !report.length) return false;
  return need.every((id) => {
    const r = report.find((x) => x.source === id);
    if (!r?.loggedIn) return false;
    if (Array.isArray(r.resumes)) return r.resumes.length > 0 && r.resumes.every((x) => x.state === 'current');
    return !(r.missing || []).length;
  });
}
const setupComplete = () => { const su = S.state?.setup; return !!(su && su.resumes > 0 && su.profile?.complete && su.searches > 0); };

function setupSig() {
  const st = S.state;
  return JSON.stringify([st?.setup, st?.chrome, st?.counts, st?.runner?.task, st?.settings?.submit, (S.profile?.profile?.skills || []).length, S.profile?.profile?.documents, (S.resumes || []).map((r) => r.file)]);
}
function maybeRerenderSetup(force) {
  if (S.tab !== 'setup' || !S.state) return;
  if (!force && setupSig() === S.setupSig) return;
  rerender();
}

function renderSetup() {
  const st = S.state;
  if (!st) { view.replaceChildren(loadingView()); return; }
  S.setupSig = setupSig();
  const steps = setupSteps();
  const doneN = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const body = { signin: stepSignin, resumes: stepResumes, samefiles: stepSameFiles, profile: stepProfile, skills: stepSkills, search: stepSearch, practice: stepPractice };
  view.replaceChildren(h('div', { class: 'view-inner narrow' },
    pageHead('Set up JobPilot', 'A one-time setup that takes about 10 minutes. Each step turns green when it is done.'),
    h('section', { class: 'card setup-progress' },
      progressRing(doneN, steps.length),
      h('div', { class: 'setup-progress-text' },
        h('div', { class: 'setup-progress-title' }, doneN === steps.length ? 'You are all set' : `${doneN} of ${steps.length} steps done`),
        h('div', { class: 'setup-progress-sub' }, next ? `Next up: ${next.title}.` : 'JobPilot is ready. Keep an eye on the Jobs and Questions tabs.')),
      next && btn('Go to next step', { kind: 'soft', icon: 'arrowDown', onclick: () => document.getElementById(`step-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })),
    h('ol', { class: 'steps' }, steps.map((s, i) => stepCard(i + 1, s, next?.id === s.id, body[s.id](s)))),
    h('div', { class: 'stack', style: { marginTop: '16px' } }, safetyNote())));
}

function progressRing(n, total) {
  const r = 22; const c = 2 * Math.PI * r;
  const svg = svgEl('svg', { viewBox: '0 0 54 54', 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { cx: 27, cy: 27, r, fill: 'none', 'stroke-width': 6, class: 'ring-track' }));
  svg.append(svgEl('circle', { cx: 27, cy: 27, r, fill: 'none', 'stroke-width': 6, 'stroke-linecap': 'round', class: 'ring-fill', 'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': (c * (1 - n / (total || 1))).toFixed(2) }));
  return h('div', { class: 'ring', role: 'img', 'aria-label': `${n} of ${total} steps done` }, svg, h('span', { class: 'ring-text', 'aria-hidden': 'true' }, `${Math.round((n / (total || 1)) * 100)}%`));
}

function stepCard(n, s, isNext, { body, actions, optional }) {
  return h('li', { class: ['step', s.done && 'is-done', isNext && 'is-next'], id: `step-${s.id}` },
    h('div', { class: 'step-marker', 'aria-hidden': 'true' }, s.done ? icon('check', 15) : String(n)),
    h('div', { class: 'step-main' },
      h('div', { class: 'step-head' },
        h('h2', { class: 'step-title' }, h('span', { class: 'sr-only' }, `Step ${n}: `), s.title),
        s.done ? pill('Done', 'green') : optional ? pill(optional, 'gray') : pill('To do', isNext ? 'violet' : 'gray')),
      h('div', { class: 'step-body' }, body),
      actions && h('div', { class: 'step-actions' }, actions)));
}


async function openChrome() {
  const res = await api('POST', '/api/chrome/open').catch(() => null);
  if (!res) return;
  if (res.running) toast('JobPilot\'s Chrome is open. Look for the new Chrome window.', 'success');
  else toast('Chrome did not start. Try again, or look at the terminal for an error.', 'error');
  pollState();
}

function accountRow(srcId) {
  const row = (S.state.setup?.accounts?.report || []).find((r) => r.source === srcId);
  if (!row) return pill('Not checked yet', 'gray');
  return row.loggedIn ? pill('Signed in', 'green') : pill('Not signed in', 'red', { tip: row.note || '' });
}

function stepSignin() {
  const ch = S.state.chrome || {};
  return {
    body: [
      h('p', null, 'JobPilot works in its own Chrome window, separate from the browser you use every day. Press Open Chrome, then sign in to LinkedIn, Handshake and Indeed there the way you normally do. That window keeps its own logins, so after the first time you stay signed in.'),
      !ch.found && callout('warn', 'Google Chrome was not found on this computer. Install Google Chrome, then reload this page.'),
      h('div', { class: 'site-row' },
        h('span', { class: 'site-row-name' }, 'Chrome'),
        ch.running ? pill('Open', 'green') : pill('Not open', 'gray'),
        h('span', { class: 'spacer' }),
        btn('Open Chrome', { size: 'sm', kind: ch.running ? '' : 'primary', icon: 'globe', disabled: !ch.found, onclick: onBusy(openChrome) })),
      h('div', { class: 'site-rows' }, sources().map((s) => h('div', { class: 'site-row' },
        h('span', { class: 'site-row-name' }, s.label),
        accountRow(s.id),
        h('span', { class: 'spacer' }),
        btn(`Sign in to ${s.label}`, { size: 'sm', icon: 'login', onclick: onBusy(() => openSiteLogin(s.id, s.label)) })))),
      h('p', { class: 'small muted' }, 'JobPilot confirms your sign-ins when you press Check accounts in step 3.'),
      h('p', { class: 'small muted' }, 'JobPilot never creates accounts, never types your passwords and never solves captchas.'),
    ],
  };
}

async function openSiteLogin(source, label) {
  const res = await api('POST', '/api/chrome/login', { source }).catch(() => null);
  if (res) toast(`${label} is open in JobPilot's Chrome. Sign in there, then come back here.`, 'success');
  pollState();
}

function namingHelp() {
  return callout('info',
    h('div', { class: 'callout-title' }, 'How naming works'),
    h('ul', null,
      h('li', null, 'Name each file by its role, for example ', code('Jane_Doe_Resume_Frontend.pdf'), ', ', code('Jane_Doe_Resume_Backend.pdf'), ' and ', code('Jane_Doe_Resume.pdf'), ' for your general one.'),
      h('li', null, 'JobPilot reads the role from the file name and matches it to job titles. Words it knows include Frontend, Backend, FullStack, Mobile, iOS, ML, AI, DevOps, Security, FDE and Quant. A file with no role word counts as general software engineering.'),
      h('li', null, 'In the next step, ', h('strong', null, 'Upload resumes to sites'), ' puts each one on LinkedIn, Handshake and Indeed with the date and time in its name, so JobPilot always picks the newest copy.')));
}

async function uploadResumes(files, button) {
  const ok = files.filter((f) => {
    if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) { toast(`${f.name} is not a file JobPilot can read. Use PDF, Word (.docx), .txt or .md.`, 'error'); return false; }
    if (f.size > MAX_UPLOAD) { toast(`${f.name} is too big. Resumes must be under 18 MB.`, 'error'); return false; }
    return true;
  });
  if (!ok.length) return;
  const run = async () => {
    let done = 0; let list = null;
    for (const f of ok) {
      try {
        const data = await readFileBase64(f);
        list = await api('POST', '/api/resumes/upload', { name: f.name, data });
        done++;
      } catch { /* toast shown */ }
    }
    if (list) {
      S.resumes = list;
      E.resumes = mergeResumesDraft(E.resumes, list);
    }
    if (done) toast(`Uploaded ${plural(done, 'resume')}.`, 'success');
    await pollState();
    rerender();
  };
  if (button) await busy(button, run); else await run();
}

function stepResumes() {
  const files = (S.resumes || []).map((r) => r.file);
  return {
    body: [
      h('p', null, 'Upload each version of your resume. JobPilot picks the best one for every job.'),
      files.length ? h('div', { class: 'file-list' }, files.map((f) => h('span', { class: 'tag tag-mono' }, f))) : null,
      namingHelp(),
    ],
    actions: [
      uploadButton(files.length ? 'Upload more resumes' : 'Upload resumes', { kind: files.length ? '' : 'primary', accept: '.pdf,.docx,.txt,.md', multiple: true, onFiles: uploadResumes }),
      btn('Open Resumes', { kind: 'ghost', icon: 'file', onclick: () => go('resumes') }),
    ],
  };
}

function fieldLabel(key) { return S.profile?.fields?.find((f) => f.key === key)?.label || humanize(key); }

function stepProfile(s) {
  const missing = S.state.setup?.profile?.missing || [];
  return {
    body: [
      h('p', null, 'Your name, contact details, school and work authorization. JobPilot uses them to answer the questions almost every form asks.'),
      !s.done && missing.length && h('div', null,
        h('div', { class: 'small', style: { marginBottom: '6px', fontWeight: '600' } }, 'Still needed on your profile:'),
        h('div', { class: 'tags' }, missing.map((k) => h('span', { class: 'tag tag-warn' }, fieldLabel(k))))),
      h('div', null,
        h('div', { class: 'small', style: { margin: '4px 0 8px', fontWeight: '600', color: 'var(--text)' } }, 'Documents'),
        docRow('transcript', 'Transcript (recommended for Handshake)'), docRow('coverLetter', 'Cover letter (optional)')),
      h('p', { class: 'small' }, 'Handshake asks for a transcript on some jobs. Add it here and Upload resumes to sites puts it in your Handshake Documents as a Transcript. If you skip this, JobPilot uses the newest transcript already on Handshake. The cover letter is attached when a form has a cover letter field.'),
    ],
    actions: [btn(s.done ? 'Review your profile' : 'Fill in your profile', { kind: s.done ? '' : 'primary', icon: 'user', onclick: () => go('profile') })],
  };
}

async function uploadDoc(kind, files, button) {
  const f = files[0];
  if (!/\.(pdf|docx?)$/i.test(f.name)) { toast(`${f.name} is not a PDF or Word file.`, 'error'); return; }
  if (f.size > MAX_UPLOAD) { toast(`${f.name} is too big. Files must be under 18 MB.`, 'error'); return; }
  await busy(button, async () => {
    const data = await readFileBase64(f);
    const docs = await api('POST', '/api/documents/upload', { kind, name: f.name, data }).catch(() => null);
    if (!docs) return;
    if (S.profile?.profile) S.profile.profile.documents = docs;
    toast(`${kind === 'transcript' ? 'Transcript' : 'Cover letter'} added.`, 'success');
    await pollState();
    rerender();
  });
}

function docRow(kind, label) {
  const name = S.profile?.profile?.documents?.[kind];
  const has = !!S.state.setup?.[kind];
  return h('div', { class: ['doc-row', has && 'has-file'] },
    h('span', { class: 'doc-icon' }, icon('file', 18)),
    h('div', { class: 'doc-text' }, h('div', { class: 'doc-label' }, label), h('div', { class: 'doc-file' }, has ? (name || 'Added') : 'Not added yet')),
    uploadButton(has ? 'Replace' : 'Upload', { size: 'sm', accept: '.pdf,.doc,.docx', onFiles: (files, b) => uploadDoc(kind, files, b) }),
    has && btn('Remove', { size: 'sm', kind: 'ghost', onclick: onBusy(async () => {
      const docs = await api('POST', '/api/documents/remove', { kind }).catch(() => null);
      if (!docs) return;
      if (S.profile?.profile) S.profile.profile.documents = docs;
      toast('Removed. JobPilot will stop attaching it. The file stays in your documents folder.', 'info');
      await pollState();
      rerender();
    }) }));
}

async function scanSkills() {
  const res = await api('POST', '/api/skills/scan').catch(() => null);
  if (!res) return;
  if (S.profile?.profile) S.profile.profile.skills = res.skills;
  let added = 0;
  if (E.profile && S.dirty.profile) {
    const have = new Set(E.profile.skills.map((s) => String(s.name).toLowerCase()));
    for (const s of res.skills) if (!have.has(String(s.name).toLowerCase())) { E.profile.skills.push(clone(s)); added++; }
  } else if (S.profile) {
    const before = (E.profile?.skills || []).length;
    E.profile = profileDraft(S.profile);
    added = Math.max(0, E.profile.skills.length - before);
  }
  if (!res.found.length) toast('No skills found in your resumes. You can add them by hand on the Profile tab.', 'warn');
  else if (added) toast(`Added ${plural(added, 'skill')} from your resumes. Check the years on the Profile tab.`, 'success');
  else toast('Every skill in your resumes is already on your list.', 'info');
  if (added && S.dirty.profile) markDirty('profile');
  rerender();
}

function stepSkills(s) {
  const n = (S.profile?.profile?.skills || []).length;
  const noResumes = !(S.state.setup?.resumes > 0);
  return {
    body: [
      h('p', null, 'Press Scan my resumes to pull skills like Python, React or AWS out of your resumes, then set your years for each one on the Profile tab. That answers questions like "How many years of experience do you have with React?" A skill you do not list is answered as 0 years, or No.'),
      n ? h('span', { class: 'status-line ok' }, icon('checkCircle', 16), `${plural(n, 'skill')} on your list.`) : noResumes && h('span', { class: 'status-line idle' }, icon('info', 16), 'Upload a resume first, then scan it.'),
    ],
    actions: [
      btn('Scan my resumes', { kind: s.done ? '' : 'primary', icon: 'sparkle', disabled: noResumes, onclick: onBusy(scanSkills) }),
      btn('Set your years on Profile', { kind: 'ghost', onclick: () => go('profile', 'sec-skills') }),
    ],
  };
}

function stepSearch(s) {
  const n = S.state.setup?.searches || 0;
  return {
    body: [
      h('p', null, 'Tell JobPilot what to look for: keywords, location, level, how recent and which sites. You can also paste a search URL from a site to use that exact search.'),
      n > 0 && h('span', { class: 'status-line ok' }, icon('checkCircle', 16), `${plural(n, 'search', 'searches')} saved.`),
    ],
    actions: [btn(s.done ? 'Open Searches' : 'Add a search', { kind: s.done ? '' : 'primary', icon: 'search', onclick: () => go('searches') })],
  };
}

function spinnerLine(text) {
  return h('span', { class: 'status-line warn' }, h('span', { class: 'spinner', style: { width: '15px', height: '15px', borderWidth: '2px' }, 'aria-hidden': 'true' }), text);
}

function stepSameFiles() {
  const task = S.state.runner?.task;
  const busyTip = task ? 'Wait for the current task to finish' : undefined;
  const noResumes = !(S.state.setup?.resumes > 0);
  return {
    body: [
      h('p', null, 'Uploads each resume to LinkedIn and Handshake with today\'s date and time in the name, so the newest copy is always clear. Indeed keeps one resume, so JobPilot swaps it before each Indeed application.'),
      h('p', { class: 'small muted' }, 'Then press Check accounts to confirm every resume is current on each site.'),
      task === 'sync' && spinnerLine('Uploading your resumes now. Keep JobPilot\'s Chrome window open.'),
      task === 'check' && spinnerLine('Checking your accounts now. This takes about a minute.'),
      syncReport(S.state.setup?.sync),
      accountReport(S.state.setup?.accounts),
      h('details', { class: 'by-hand' },
        h('summary', null, 'Prefer to upload them yourself?'),
        h('ul', { class: 'plain-list' },
          h('li', null, h('strong', null, 'LinkedIn: '), 'Settings, then Job application settings, then upload each resume.'),
          h('li', null, h('strong', null, 'Handshake: '), 'Profile, then Documents, then upload each resume. Upload your transcript there too, with Transcript as the type.'),
          h('li', null, h('strong', null, 'Indeed: '), 'your Indeed profile, then Resume. Indeed keeps one main resume.')),
        h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Files you upload yourself show as missing until they have the exact name JobPilot recorded, so the upload button is the easier way.')),
    ],
    actions: [
      btn('Upload resumes to sites', { kind: 'primary', icon: 'upload', attrs: runAttrs(noResumes), disabled: !!task || noResumes, tip: busyTip || (noResumes ? 'Add your resumes first' : 'Uploads each missing or changed resume in JobPilot\'s Chrome'), onclick: () => startRun('sync') }),
      btn('Check accounts', { icon: 'shield', attrs: runAttrs(false), disabled: !!task, tip: busyTip, onclick: () => startRun('check') }),
    ],
  };
}

/** The result of the last "Upload resumes to sites" run. */
function syncReport(sync) {
  if (!sync?.report?.length) return null;
  return h('div', { class: 'report-block' },
    h('div', { class: 'report-head' }, h('span', { class: 'report-title' }, 'Last upload'), h('span', { class: 'small muted' }, timeAgo(sync.at))),
    h('div', { class: 'acct-grid' }, sync.report.map((r) => {
      const uploaded = r.uploaded || []; const skipped = r.skipped || []; const failed = r.failed || [];
      const tone = failed.length || (r.note && !uploaded.length) ? 'is-warn' : 'is-ok';
      return h('div', { class: ['acct-card', tone] },
        h('div', { class: 'acct-head' }, h('span', { class: 'acct-name' }, r.label || siteLabel(r.source)),
          h('span', { class: 'tags' },
            uploaded.length > 0 && pill(`${uploaded.length} uploaded`, 'green'),
            failed.length > 0 && pill(`${failed.length} failed`, 'red'),
            !uploaded.length && !failed.length && skipped.length > 0 && pill('All current', 'green'))),
        r.note && callout('warn', cap(r.note)),
        uploaded.length > 0 && h('ul', { class: 'file-rows' }, uploaded.map((u) => h('li', null,
          icon('checkCircle', 14), h('span', { class: 'mono small file-cut', 'data-tip': u.file && u.file !== u.name ? `From ${u.file}` : null }, u.name || u.file),
          u.note && h('span', { class: 'small muted' }, u.note)))),
        failed.length > 0 && h('ul', { class: 'file-rows is-failed' }, failed.map((f) => h('li', null,
          icon('alert', 14), h('div', { style: { minWidth: '0' } }, h('div', { class: 'mono small file-cut' }, f.name || f.file), f.note && h('div', { class: 'small' }, f.note))))),
        skipped.length > 0 && h('details', null,
          h('summary', null, `${plural(skipped.length, 'file')} already current, so not uploaded again`),
          h('ul', { class: 'file-rows' }, skipped.map((s) => h('li', null, h('span', { class: 'mono small file-cut' }, s.file), s.note && h('span', { class: 'small muted' }, s.note))))));
    })));
}

const RESUME_STATE = {
  current: { label: 'Current', tone: 'green', tip: 'The copy JobPilot uploaded is on the site and your file has not changed since.' },
  outdated: { label: 'Outdated', tone: 'amber', tip: 'You changed this file after it was uploaded. Upload resumes to sites puts the new version up.' },
  missing: { label: 'Missing', tone: 'gray', tip: 'JobPilot did not find its copy of this resume on the site.' },
  'switch on apply': { label: 'Switch on apply', tone: 'blue', tip: 'Indeed holds one resume. JobPilot puts this one there right before an Indeed job that matches it.' },
};

function accountReport(acc) {
  if (!acc?.report?.length) return callout('neutral', 'No check yet. Sign in to the sites in step 1, then press Check accounts.');
  return h('div', { class: 'report-block' },
    h('div', { class: 'report-head' }, h('span', { class: 'report-title' }, 'Last check'), h('span', { class: 'small muted' }, timeAgo(acc.at))),
    h('div', { class: 'acct-grid' }, acc.report.map(acctCard)));
}

function acctCard(r) {
  const rows = Array.isArray(r.resumes) ? r.resumes : null;
  const notCurrent = rows ? rows.filter((x) => x.state !== 'current' && x.state !== 'switch on apply').length : (r.missing || []).length;
  const tr = r.source === 'handshake' && r.loggedIn ? r.transcript : undefined;
  const mineTranscript = S.profile?.profile?.documents?.transcript;
  const tone = !r.loggedIn ? 'is-bad' : notCurrent ? 'is-warn' : 'is-ok';
  return h('div', { class: ['acct-card', tone] },
    h('div', { class: 'acct-head' }, h('span', { class: 'acct-name' }, r.label || siteLabel(r.source)), r.loggedIn ? pill('Signed in', 'green') : pill('Not signed in', 'red')),
    !r.loggedIn && [
      r.note && h('p', { class: 'small' }, r.note),
      h('p', null, `Sign in to ${r.label || siteLabel(r.source)} in JobPilot's Chrome window, then check again.`),
      h('div', null, btn(`Sign in to ${r.label || siteLabel(r.source)}`, { size: 'sm', icon: 'login', onclick: onBusy(() => openSiteLogin(r.source, r.label || siteLabel(r.source))) })),
    ],
    r.loggedIn && rows && (rows.length
      ? h('table', { class: 'mini-table' },
        h('thead', null, h('tr', null, h('th', null, 'Resume and the file on the site'), h('th', null, 'State'))),
        h('tbody', null, rows.map((x) => {
          const st = RESUME_STATE[x.state] || { label: humanize(x.state), tone: 'gray' };
          return h('tr', null,
            h('td', null,
              h('div', { class: 'mono mini-file' }, x.file),
              r.source !== 'indeed' && (x.siteName
                ? h('div', { class: 'mini-site' }, h('span', { class: 'muted' }, 'On the site: '), h('span', { class: 'mono' }, x.siteName))
                : h('div', { class: 'mini-site muted' }, 'Not on the site')),
              x.olderCopies > 0 && h('div', { class: 'mini-site muted' }, `${plural(x.olderCopies, 'older copy', 'older copies')} on the site`)),
            h('td', null, pill(st.label, st.tone, { tip: st.tip })));
        })))
      : h('p', { class: 'small muted' }, 'You have no resumes in JobPilot yet.')),
    r.loggedIn && !rows && ((r.missing || []).length
      ? h('div', null, h('p', { class: 'small', style: { fontWeight: '600', color: 'var(--amber)' } }, `${plural(r.missing.length, 'resume')} missing:`), h('div', { class: 'tags' }, r.missing.map((f) => h('span', { class: 'tag tag-mono' }, f))))
      : h('span', { class: 'status-line ok' }, icon('checkCircle', 16), 'All your resumes are on the site.')),
    r.loggedIn && r.source !== 'indeed' && rows && notCurrent > 0 && h('p', { class: 'small' }, 'Press Upload resumes to sites to put up the missing and outdated ones.'),
    r.source === 'indeed' && r.loggedIn && h('div', { class: 'small' },
      h('strong', null, 'On Indeed now: '),
      r.indeedCurrent?.name ? h('span', { class: 'mono' }, r.indeedCurrent.name) : 'no resume file found',
      r.indeedCurrent?.name && h('span', { class: 'muted' }, r.indeedCurrent.resume ? ` (your ${r.indeedCurrent.resume})` : ' (not a copy JobPilot uploaded)')),
    r.source === 'handshake' && r.loggedIn && h('div', { class: 'small' },
      tr ? [h('strong', null, 'Newest transcript: '), h('span', { class: 'mono' }, tr.onSite), tr.date && h('span', { class: 'muted' }, ` (${tr.date})`)]
        : [h('strong', null, 'Transcript: '), mineTranscript ? 'none found on Handshake. Upload resumes to sites puts yours up too.' : 'none found on Handshake. Add one in step 4 if your jobs ask for it.']),
    r.source === 'handshake' && r.loggedIn && (r.documents || []).length > 0 && h('details', null,
      h('summary', null, `Documents on Handshake (${r.documents.length})`),
      h('table', { class: 'mini-table' },
        h('tbody', null, r.documents.slice(0, 30).map((d) => h('tr', null,
          h('td', null, h('span', { class: 'mono small file-cut' }, d.name)),
          h('td', { class: 'small muted' }, d.category || ''),
          h('td', { class: 'small muted', style: { whiteSpace: 'nowrap' } }, d.date || '')))))),
    r.source !== 'handshake' && r.loggedIn && (r.siteFiles || []).length > 0 && h('details', null,
      h('summary', null, `Files JobPilot saw on ${r.label || siteLabel(r.source)} (${r.siteFiles.length})`),
      h('div', { class: 'tags' }, r.siteFiles.map((f) => h('span', { class: 'tag tag-mono' }, f)))));
}

function stepPractice() {
  const on = !!S.state.settings?.submit;
  const running = !!S.state.runner?.task;
  const mini = (text, action) => h('li', null, h('div', { class: 'mini-step-body' }, h('p', null, text), action));
  return {
    body: [
      h('p', null, 'Try everything once with Submit OFF, so nothing is sent until you are happy with it.'),
      h('ol', { class: 'mini-steps' },
        mini('Press Search & save. JobPilot finds jobs and saves each one with the best resume.', btn('Search & save', { size: 'sm', icon: 'search', disabled: running, onclick: () => startRun('search') })),
        mini('Look over the Jobs tab. Skip anything you do not want and change resumes if needed.', btn('Open Jobs', { size: 'sm', kind: 'ghost', onclick: () => go('jobs') })),
        mini(['Make sure Submit is OFF, then press Apply to saved jobs. JobPilot fills in each form in its own tab and leaves it open without sending. ', on ? pill('Submit is ON right now', 'red') : pill('Submit is OFF', 'gray')], btn('Apply to saved jobs', { size: 'sm', icon: 'plane', disabled: running, onclick: () => startRun('apply') })),
        mini('Check the drafts in the open tabs. Answer anything new on the Questions tab.', btn('Open Questions', { size: 'sm', kind: 'ghost', onclick: () => go('questions') })),
        mini('When the drafts look right, turn on Submit applications in Settings.', btn('Open Settings', { size: 'sm', kind: 'ghost', onclick: () => go('settings') }))),
    ],
  };
}

function safetyNote() {
  return callout('shield',
    h('div', { class: 'callout-title' }, 'Staying safe'),
    h('ul', null,
      h('li', null, 'JobPilot never solves captchas or security checks. When one appears, it stops that site and asks you to finish it yourself in the Chrome window.'),
      h('li', null, 'Daily caps in Settings keep your accounts safe by limiting how many applications go out each day.'),
      h('li', null, 'Sites like LinkedIn do not allow automation in their terms, so keep your volumes modest.')));
}

// ================================================================ profile

function yesNo(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  const s = String(v ?? '');
  if (/^y/i.test(s)) return 'Yes';
  if (/^n/i.test(s)) return 'No';
  return s;
}

function profileDraft(p) {
  const prof = p?.profile || {};
  const values = {};
  for (const f of p?.fields || []) values[f.key] = f.kind === 'yesno' ? yesNo(prof[f.key]) : (prof[f.key] ?? '');
  const skills = (Array.isArray(prof.skills) ? prof.skills : []).map((s) => ({ ...s }));
  return { values, skills };
}

function renderProfile() {
  const fields = S.profile.fields || [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const used = new Set();
  const sections = PROFILE_SECTIONS.map((sec) => {
    const fs = sec.keys.map((k) => byKey.get(k)).filter(Boolean);
    fs.forEach((f) => used.add(f.key));
    return { ...sec, fields: fs };
  }).filter((s) => s.fields.length);
  const rest = fields.filter((f) => !used.has(f.key));
  if (rest.length) sections.splice(sections.length - 1, 0, { id: 'more', title: 'More', fields: rest });

  const progress = h('span');
  const updateProgress = () => {
    const filled = REQUIRED_FIELDS.filter((k) => String(E.profile.values[k] ?? '').trim()).length;
    progress.replaceChildren(pill(filled === REQUIRED_FIELDS.length ? 'All required fields filled' : `Required fields: ${filled} of ${REQUIRED_FIELDS.length}`, filled === REQUIRED_FIELDS.length ? 'green' : 'amber'));
  };
  updateProgress();

  view.replaceChildren(h('div', { class: 'view-inner' },
    pageHead('Profile', 'Fill this in once. JobPilot uses it to answer the questions almost every application asks.', [progress]),
    h('nav', { class: 'section-nav', 'aria-label': 'Profile sections' },
      [...sections, { id: 'skills', title: 'Skills' }].map((s) => h('a', { href: `#profile`, onclick: (e) => { e.preventDefault(); document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, s.title))),
    sections.map((sec) => h('section', { class: 'card', id: `sec-${sec.id}` },
      cardHead(sec.title, sec.note),
      h('div', { class: 'form-grid' }, sec.fields.map((f) => profileField(f, updateProgress))))),
    skillsCard(),
    savebar('profile', saveProfile, () => { E.profile = profileDraft(S.profile); rerender(); })));
}

function profileField(f, onAny) {
  const id = `pf-${f.key}`;
  const missingNow = () => REQUIRED_FIELDS.includes(f.key) && !String(E.profile.values[f.key] ?? '').trim();
  const set = (v) => {
    E.profile.values[f.key] = v;
    markDirty('profile');
    wrap.classList.toggle('is-missing', missingNow() && (S.state?.setup?.profile?.missing || []).includes(f.key));
    onAny();
  };
  const val = E.profile.values[f.key] ?? '';
  let control;
  if (f.kind === 'select' || f.kind === 'yesno') {
    const opts = f.kind === 'yesno' ? ['Yes', 'No'] : (f.options || []);
    const all = val && !opts.includes(val) ? [...opts, val] : opts;
    const blank = EEO_FIELDS.has(f.key) ? 'Leave blank (declines)' : 'Choose…';
    control = h('select', { id, class: 'input', value: String(val), onchange: (e) => set(e.target.value) },
      h('option', { value: '' }, blank), all.map((o) => h('option', { value: o }, o)));
  } else if (f.kind === 'textarea') {
    control = h('textarea', { id, class: 'input', rows: 4, value: String(val), maxlength: 1200, placeholder: 'For example: I like building tools people use every day, and I want my next role to be on a small product team.', oninput: (e) => set(e.target.value) });
  } else {
    const extra = FIELD_INPUT[f.key] || {};
    control = h('input', { id, class: 'input', type: extra.type || 'text', value: String(val), placeholder: extra.placeholder, autocomplete: extra.autocomplete || 'off', inputmode: extra.inputmode, oninput: (e) => set(e.target.value) });
  }
  const required = REQUIRED_FIELDS.includes(f.key);
  const wrap = field(f.label, control, {
    required,
    wide: f.kind === 'textarea' || (f.label.length > 44 && f.kind !== 'text'),
    missing: missingNow() && (S.state?.setup?.profile?.missing || []).includes(f.key),
  });
  return wrap;
}

function skillsCard() {
  const tbody = h('tbody');
  const suggestions = [...new Set((S.resumes || []).flatMap((r) => r.skills || []))].sort();
  const draw = () => {
    const rows = E.profile.skills;
    if (!rows.length) {
      tbody.replaceChildren(h('tr', null, h('td', { colspan: 4 }, emptyState({ small: true, icon: 'sparkle', title: 'No skills yet', text: 'Scan your resumes, or add skills by hand with Add a skill.' }))));
      return;
    }
    tbody.replaceChildren(...rows.map((s, i) => h('tr', null,
      h('td', null, h('input', { class: 'input input-sm', value: s.name || '', list: 'skillSuggestions', placeholder: 'For example React', 'aria-label': `Skill ${i + 1} name`, oninput: (e) => { s.name = e.target.value; markDirty('profile'); } })),
      h('td', { class: 'num' }, h('input', { class: 'input input-sm', type: 'number', min: 0, max: 60, step: 1, value: s.years ?? '', style: { width: '88px' }, 'aria-label': `Years with ${s.name || 'this skill'}`, oninput: (e) => { s.years = e.target.value === '' ? '' : Number(e.target.value); markDirty('profile'); } })),
      h('td', null, s.fromResume ? h('span', { class: 'tag', 'data-tip': 'Found by scanning your resumes' }, 'From resume') : h('span', { class: 'tag' }, 'Added by you')),
      h('td', { class: 'col-actions' }, iconBtn('trash', `Remove ${s.name || 'this skill'}`, () => { rows.splice(i, 1); markDirty('profile'); draw(); }, { kind: 'danger' })))));
  };
  draw();
  return h('section', { class: 'card', id: 'sec-skills' },
    cardHead('Skills', null, [
      btn('Scan my resumes', { icon: 'sparkle', disabled: !(S.state?.setup?.resumes > 0), tip: S.state?.setup?.resumes > 0 ? 'Adds skills found in your resumes. It never removes any.' : 'Upload a resume first', onclick: onBusy(scanSkills) }),
      btn('Add a skill', { kind: 'soft', icon: 'plus', onclick: () => { E.profile.skills.push({ name: '', years: Number(E.profile.values.yearsExperience) || 1 }); markDirty('profile'); draw(); tbody.querySelector('tr:last-child input')?.focus(); } }),
    ]),
    callout('info', 'Skill years answer questions like "How many years of experience do you have with React?" Any skill you do not list here is answered with 0, and "Do you have experience with it?" gets No.'),
    h('datalist', { id: 'skillSuggestions' }, suggestions.map((s) => h('option', { value: s }))),
    h('div', { class: 'table-wrap', style: { marginTop: '14px' } },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Skill'), h('th', { class: 'num' }, 'Years'), h('th', null, 'Source'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        tbody)));
}

async function saveProfile() {
  const seen = new Set();
  const skills = [];
  for (const s of E.profile.skills) {
    const name = String(s.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const years = Number(s.years);
    skills.push({ ...s, name, years: Number.isFinite(years) && years >= 0 ? years : 0 });
  }
  const res = await api('PUT', '/api/profile', { profile: { ...E.profile.values, skills } }).catch(() => null);
  if (!res) return;
  S.profile.profile = res.profile;
  E.profile = profileDraft(S.profile);
  markDirty('profile', false);
  toast(`Profile saved. JobPilot can now answer ${plural(res.answers, 'common question')} for you.`, 'success');
  await pollState();
  rerender();
}

// ================================================================ resumes

function resumesDraft(list) {
  return {
    default: (list || []).find((r) => r.isDefault)?.file || '',
    rows: (list || []).map((r) => ({ file: r.file, tagsText: (r.tags || []).join(', '), tagsCustom: !!r.customTags, keywordsText: (r.keywords || []).join(', '), autoTags: r.customTags ? null : [...(r.tags || [])] })),
  };
}
function mergeResumesDraft(draft, list) {
  if (!draft) return resumesDraft(list);
  const fresh = resumesDraft(list);
  const old = new Map(draft.rows.map((r) => [r.file, r]));
  fresh.rows = fresh.rows.map((r) => old.get(r.file) || r);
  fresh.default = list.some((r) => r.file === draft.default) ? draft.default : fresh.default;
  return fresh;
}

function renderResumes() {
  const list = S.resumes || [];
  const upload = uploadButton(list.length ? 'Upload resumes' : 'Upload your first resume', { kind: 'primary', accept: '.pdf,.docx,.txt,.md', multiple: true, onFiles: uploadResumes });
  const content = list.length ? resumesTableCard() : makeDropTarget(h('div', { class: 'dropzone' },
    emptyState({ icon: 'file', title: 'No resumes yet', text: 'Drop your resume files here, or press Upload. Name them by role, like Jane_Doe_Resume_Frontend.pdf, so JobPilot knows which jobs each one fits.', actions: [uploadButton('Upload resumes', { kind: 'primary', accept: '.pdf,.docx,.txt,.md', multiple: true, onFiles: uploadResumes })] })), uploadResumes);
  view.replaceChildren(h('div', { class: 'view-inner' },
    pageHead('Resumes', 'Your resume files. For each job, JobPilot picks the one whose role and words fit best.', [
      list.length ? btn('Upload resumes to sites', { icon: 'globe', attrs: runAttrs(false), disabled: !!S.state?.runner?.task, tip: 'Put each missing or changed resume on LinkedIn and Handshake, with the date and time in its name', onclick: () => startRun('sync') }) : null,
      upload,
    ]),
    content,
    h('div', { class: 'stack', style: { marginTop: '16px' } }, namingHelp()),
    matcherCard(),
    list.length ? savebar('resumes', saveRules, () => { E.resumes = resumesDraft(S.resumes); rerender(); }) : null));
}

/** The dated copy of a resume on each site, from GET /api/sync. */
function siteCopiesCell(file) {
  const rec = S.sync?.records;
  if (!rec) return h('span', { class: 'small muted' }, 'Not uploaded yet');
  const lines = [];
  for (const site of sources()) {
    if (site.id === 'indeed') {
      const cur = rec.indeed?.current;
      if (cur?.file === file) lines.push(h('div', { class: 'site-copy' }, h('span', { class: 'site-copy-label' }, `${site.label}:`), h('span', { class: 'mono site-copy-name', 'data-tip': `${cur.name}\nThe one resume on Indeed right now` }, cur.name)));
      continue;
    }
    const f = rec[site.id]?.files?.[file];
    lines.push(h('div', { class: 'site-copy' }, h('span', { class: 'site-copy-label' }, `${site.label}:`),
      f?.name ? h('span', { class: 'mono site-copy-name', 'data-tip': `${f.name}${f.at ? `\nUploaded ${timeAgo(f.at)}` : ''}` }, f.name) : h('span', { class: 'muted' }, 'not uploaded yet')));
  }
  return h('div', { class: 'site-copies' }, lines);
}

function tagChips(row) {
  const tags = row.tagsCustom ? splitList(row.tagsText).map((t) => t.toLowerCase()) : (row.autoTags || []);
  if (!tags.length) return h('span', { class: 'small muted' }, row.tagsCustom ? 'No tags. Saving uses the file name instead.' : 'Set from the file name after you save.');
  return h('div', { class: 'tags' }, tags.map((t) => (ROLE_TAGS[t]
    ? h('span', { class: 'tag tag-accent', 'data-tip': `Fits ${ROLE_TAGS[t]} jobs` }, t)
    : h('span', { class: 'tag tag-warn', 'data-tip': 'JobPilot does not know this role, so it never matches a job title. Known roles: ' + Object.keys(ROLE_TAGS).join(', ') }, t))));
}

function resumesTableCard() {
  const D = E.resumes;
  const byFile = new Map((S.resumes || []).map((r) => [r.file, r]));
  const rows = D.rows.map((row) => {
    const info = byFile.get(row.file) || { words: 0, skills: [] };
    const chips = h('div', null, tagChips(row));
    const caption = h('span', null, row.tagsCustom ? 'Set by you' : 'From the file name');
    const resetBtn = h('button', { type: 'button', class: 'link-btn', hidden: !row.tagsCustom, onclick: () => {
      row.tagsCustom = false; row.tagsText = (row.autoTags || []).join(', ');
      tagsInput.value = row.tagsText; caption.textContent = 'From the file name'; resetBtn.hidden = true;
      chips.replaceChildren(tagChips(row)); markDirty('resumes');
    } }, 'Use file name');
    const tagsInput = h('input', { class: 'input input-sm', value: row.tagsText, placeholder: 'For example frontend, fullstack', 'aria-label': `Role tags for ${row.file}`, oninput: (e) => {
      row.tagsText = e.target.value; row.tagsCustom = true;
      caption.textContent = 'Set by you'; resetBtn.hidden = false;
      chips.replaceChildren(tagChips(row)); markDirty('resumes');
    } });
    const skills = info.skills || [];
    return h('tr', null,
      h('td', { class: 'col-check' }, h('input', { type: 'radio', name: 'defaultResume', checked: D.default === row.file, 'aria-label': `Use ${row.file} as the default`, onchange: () => { D.default = row.file; markDirty('resumes'); } })),
      h('td', null,
        h('div', { class: 'file-name' }, row.file),
        h('div', { class: 'cell-sub' }, `${info.words.toLocaleString()} words`),
        info.words < 60 && h('div', { style: { marginTop: '6px' } }, pill('Little text found', 'amber', { tip: 'JobPilot could barely read this file. If it is a scanned PDF, export it again from Word or Google Docs so the text can be read.' }))),
      h('td', null, h('div', { class: 'tag-editor' }, tagsInput, chips, h('div', { class: 'tag-editor-foot' }, caption, resetBtn))),
      h('td', null, h('div', { class: 'tag-editor' },
        h('input', { class: 'input input-sm', value: row.keywordsText, placeholder: 'For example react, typescript', 'aria-label': `Keywords for ${row.file}`, oninput: (e) => { row.keywordsText = e.target.value; markDirty('resumes'); } }),
        h('span', { class: 'small muted' }, 'Extra words that pull matching jobs toward this resume'))),
      h('td', null, skills.length
        ? h('div', { class: 'tags', 'data-tip': skills.join(', ') }, skills.slice(0, 7).map((s) => h('span', { class: 'tag' }, s)), skills.length > 7 && h('span', { class: 'tag' }, `+${skills.length - 7} more`))
        : h('span', { class: 'small muted' }, 'None found')),
      h('td', null, siteCopiesCell(row.file)),
      h('td', { class: 'col-actions' }, iconBtn('trash', `Delete ${row.file}`, () => deleteResume(row.file), { kind: 'danger' })));
  });
  const card = h('section', { class: 'table-card drop-target' },
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table table-min-resumes' },
        h('thead', null, h('tr', null,
          h('th', { 'data-tip': 'Used when no resume clearly fits better' }, 'Default'), h('th', null, 'File'), h('th', null, 'Role tags'), h('th', null, 'Keywords'), h('th', null, 'Skills found'), h('th', { 'data-tip': 'The dated copy JobPilot uploaded to each site, from Upload resumes to sites' }, 'On the sites'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, rows))));
  const foot = h('div', { class: 'small muted', style: { padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
    h('span', null, 'Drop files on this table to upload them.'),
    D.default ? h('button', { type: 'button', class: 'link-btn', onclick: () => { D.default = ''; markDirty('resumes'); rerender(); } }, 'Clear the default') : h('span', null, 'No default picked. Ties go to the first file by name.'));
  card.append(foot);
  return makeDropTarget(card, uploadResumes);
}

async function deleteResume(file) {
  const ok = await confirmDialog({ title: `Delete ${file}?`, body: 'This removes the file from your JobPilot resumes folder on this computer. It does not touch copies on LinkedIn, Handshake or Indeed.', ok: 'Delete file', danger: true, icon: 'trash' });
  if (!ok) return;
  const list = await api('POST', '/api/resumes/delete', { file }).catch(() => null);
  if (!list) return;
  S.resumes = list;
  E.resumes = mergeResumesDraft(E.resumes, list);
  toast(`Deleted ${file}.`, 'success');
  await pollState();
  rerender();
}

async function saveRules() {
  const D = E.resumes;
  // The server merges this map into resumes.json, so entries for files not
  // listed here are kept as they are. An empty entry clears a file's rules.
  const map = {};
  for (const row of D.rows) {
    const e = {};
    if (row.tagsCustom) { const t = splitList(row.tagsText).map((x) => x.toLowerCase()); if (t.length) e.tags = t; }
    const k = splitList(row.keywordsText);
    if (k.length) e.keywords = k;
    map[row.file] = e;
  }
  const list = await api('PUT', '/api/resumes/rules', { default: D.default || '', resumes: map }).catch(() => null);
  if (!list) return;
  S.resumes = list;
  E.resumes = resumesDraft(list);
  markDirty('resumes', false);
  toast('Resume rules saved.', 'success');
  rerender();
}

const M = { title: '', description: '', result: null };
function matcherCard() {
  const has = (S.resumes || []).length > 0;
  const out = h('div', null, M.result ? matchResult(M.result) : null);
  const title = h('input', { class: 'input', value: M.title, placeholder: 'For example Frontend Engineer, New Grad', oninput: (e) => { M.title = e.target.value; } });
  const desc = h('textarea', { class: 'input', rows: 5, value: M.description, placeholder: 'Paste the job description here', oninput: (e) => { M.description = e.target.value; } });
  return h('section', { class: 'card', style: { marginTop: '16px' } },
    cardHead('Test a match', 'Paste a job to see how all your resumes rank for it, and which one JobPilot would pick.'),
    h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'There is no AI in this step. JobPilot reads role tags from each file name, like Frontend or Backend, and compares the words in the posting with the words in each resume. The score is 55% role fit plus 45% word overlap.'),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      if (!M.title.trim() && !M.description.trim()) { toast('Paste a job title or description first.', 'warn'); return; }
      const b = e.currentTarget.querySelector('button[type=submit]');
      await busy(b, async () => {
        const res = await api('POST', '/api/match', { title: M.title, description: M.description }).catch(() => null);
        if (!res) return;
        M.result = res;
        out.replaceChildren(matchResult(res));
      });
    } },
      field('Job title', title),
      field('Job description', desc),
      h('div', null, btn('Test a match', { kind: 'primary', icon: 'target', type: 'submit', disabled: !has, tip: has ? undefined : 'Upload a resume first' }))),
    out);
}

function matchResult(res) {
  if (!res.ranking?.length) return callout('warn', 'Upload at least one resume to test the matcher.');
  return h('div', null,
    h('div', { class: 'match-summary' },
      h('span', { class: 'match-best' }, 'Best match: ', h('span', { class: 'mono' }, res.best)),
      h('span', { class: 'score' }, `${Math.round((res.score || 0) * 100)}% fit`),
      h('span', { class: 'small muted' }, 'This title looks like:'),
      h('span', { class: 'tags' }, (res.jobTags || []).map((t) => h('span', { class: 'tag tag-accent' }, t))),
      res.why && h('span', { class: 'small muted', style: { flexBasis: '100%' } }, res.why)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table match-table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Resume'), h('th', null, 'Score'), h('th', { class: 'num', 'data-tip': 'How many of the job title\'s roles this resume covers' }, 'Role fit'), h('th', { class: 'num', 'data-tip': 'Word overlap between the posting and the resume, from 0 to 1' }, 'Content fit'), h('th', null, 'Top shared terms'))),
      h('tbody', null, res.ranking.map((r, i) => h('tr', null,
        h('td', null, h('span', { class: ['rank', i === 0 && 'first'] }, String(i + 1))),
        h('td', null, h('div', { class: 'file-name' }, r.file), h('div', { class: 'tags', style: { marginTop: '4px' } }, (r.tags || []).map((t) => h('span', { class: 'tag' }, t)))),
        h('td', null, h('div', { class: 'meter-cell' }, meter(r.score * 100), h('span', { class: 'meter-val' }, `${Math.round(r.score * 100)}%`))),
        h('td', { class: 'num' }, `${Math.round(r.role * 100)}%`),
        h('td', { class: 'num' }, r.content.toFixed(3)),
        h('td', null, r.topTerms?.length ? h('div', { class: 'tags' }, r.topTerms.map((t) => h('span', { class: 'tag' }, t))) : h('span', { class: 'small muted' }, 'None'))))))));
}

// =============================================================== searches

const UID = new WeakMap(); let uidN = 0;
const uid = (o) => { if (!UID.has(o)) UID.set(o, ++uidN); return UID.get(o); };

function searchesDraft(list) {
  return clone(Array.isArray(list) ? list : []).map((s) => ({
    ...s,
    experience: Array.isArray(s.experience) ? s.experience : s.experience ? [s.experience] : [],
    workplace: Array.isArray(s.workplace) ? s.workplace : s.workplace ? [s.workplace] : [],
    sources: Array.isArray(s.sources) ? s.sources : sources().map((x) => x.id),
    urls: { linkedin: '', handshake: '', indeed: '', ...(s.urls || {}) },
  }));
}

function newSearch() {
  const names = new Set(E.searches.map((s) => s.name));
  let name = 'New search'; let n = 2;
  while (names.has(name)) name = `New search ${n++}`;
  return { name, enabled: true, keywords: '', location: 'United States', experience: ['entry'], posted: 'week', workplace: [], easyApplyOnly: true, sources: sources().map((s) => s.id), limit: 25, urls: { linkedin: '', handshake: '', indeed: '' } };
}

function renderSearches() {
  const list = E.searches;
  view.replaceChildren(h('div', { class: 'view-inner' },
    pageHead('Searches', 'What JobPilot looks for. Search & save runs every search that is turned on.', [
      btn('Add a search', { kind: 'primary', icon: 'plus', onclick: () => { E.searches.push(newSearch()); markDirty('searches'); rerender(); requestAnimationFrame(() => { const cards = view.querySelectorAll('.search-card'); const last = cards[cards.length - 1]; last?.scrollIntoView({ behavior: 'smooth', block: 'center' }); last?.querySelector('.input-name')?.select(); }); } }),
    ]),
    callout('info', 'Not every site uses every filter. LinkedIn uses all of them. Indeed uses keywords, location, date posted, entry level, remote and Easy Apply only. Handshake uses keywords and internship. For anything else, paste your own search URL for that site.'),
    h('div', { class: 'search-list', style: { marginTop: '16px' } },
      list.length ? list.map((s, i) => searchCard(s, i)) : h('section', { class: 'card' }, emptyState({ icon: 'search', title: 'No searches yet', text: 'Add a search to tell JobPilot what jobs to look for. You can start with keywords like "software engineer" and a location.', actions: [btn('Add your first search', { kind: 'primary', icon: 'plus', onclick: () => { E.searches.push(newSearch()); markDirty('searches'); rerender(); } })] }))),
    savebar('searches', saveSearches, () => { E.searches = searchesDraft(S.searches); rerender(); })));
  validateSearchNames();
}

function validateSearchNames() {
  const counts = new Map();
  for (const s of E.searches) { const n = String(s.name || '').trim().toLowerCase(); counts.set(n, (counts.get(n) || 0) + 1); }
  let ok = true;
  for (const card of view.querySelectorAll('.search-card')) {
    const s = E.searches.find((x) => String(uid(x)) === card.dataset.uid);
    if (!s) continue;
    const n = String(s.name || '').trim().toLowerCase();
    const err = !n ? 'Give this search a name.' : counts.get(n) > 1 ? 'Another search has this name. Names need to be different.' : '';
    if (err) ok = false;
    card.querySelector('.input-name').classList.toggle('is-invalid', !!err);
    const msg = card.querySelector('.name-error');
    msg.textContent = err; msg.hidden = !err;
  }
  return ok;
}

function searchCard(s, i) {
  const dirty = () => markDirty('searches');
  const runBtn = btn('Run this search', { size: 'sm', icon: 'search', attrs: runAttrs(s.enabled === false), disabled: s.enabled === false || !!S.state?.runner?.task, tip: s.enabled === false ? 'Turn this search on to run it' : 'Search with just this one and save what it finds', onclick: () => startRun('search', { searches: [String(s.name || '').trim()] }) });
  const onLabel = h('span', null, s.enabled === false ? 'Off' : 'On');
  const card = h('section', { class: ['card', 'search-card', s.enabled === false && 'is-off'], dataset: { uid: String(uid(s)) }, 'aria-label': `Search: ${s.name || `number ${i + 1}`}` });
  const urlCount = () => sources().filter((x) => String(s.urls?.[x.id] || '').trim()).length;
  const urlCountEl = h('span', { class: 'url-count' });
  const updateUrlCount = () => { const n = urlCount(); urlCountEl.textContent = n ? `${n} in use` : ''; };
  updateUrlCount();

  card.append(
    h('div', { class: 'search-head' },
      h('input', { class: 'input input-name', value: s.name || '', placeholder: 'Name this search', maxlength: 80, 'aria-label': 'Search name', oninput: (e) => { s.name = e.target.value; dirty(); validateSearchNames(); } }),
      h('label', { class: 'switch-inline' },
        h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: s.enabled !== false, 'aria-label': 'Search is turned on', onchange: (e) => {
          s.enabled = e.target.checked; card.classList.toggle('is-off', !s.enabled); onLabel.textContent = s.enabled ? 'On' : 'Off';
          runBtn.dataset.blocked = s.enabled ? '' : '1'; runBtn.disabled = !s.enabled || !!S.state?.runner?.task; runBtn.setAttribute('data-tip', s.enabled ? 'Search with just this one and save what it finds' : 'Turn this search on to run it'); dirty();
        } }), onLabel),
      runBtn,
      iconBtn('copy', 'Duplicate this search', () => {
        const copy = clone(s); let name = `${s.name || 'Search'} (copy)`; let n = 2;
        while (E.searches.some((x) => x.name === name)) name = `${s.name || 'Search'} (copy ${n++})`;
        copy.name = name; E.searches.splice(i + 1, 0, copy); dirty(); rerender();
      }),
      iconBtn('trash', 'Delete this search', async () => {
        const ok = await confirmDialog({ title: `Delete "${s.name || 'this search'}"?`, body: 'Jobs it already found stay on the Jobs tab. The search is removed when you save.', ok: 'Delete', danger: true, icon: 'trash' });
        if (!ok) return;
        E.searches.splice(i, 1); dirty(); rerender();
      }, { kind: 'danger' })),
    h('p', { class: 'field-error name-error', hidden: true, style: { margin: '-8px 0 12px' } }),
    h('div', { class: 'search-body' },
      h('div', { class: 'grid-2' },
        field('Keywords', h('input', { class: 'input', value: s.keywords || '', placeholder: 'For example software engineer', oninput: (e) => { s.keywords = e.target.value; dirty(); } })),
        field('Location', h('input', { class: 'input', value: s.location || '', placeholder: 'For example United States, or Seattle, WA', oninput: (e) => { s.location = e.target.value; dirty(); } }), { hint: 'Handshake does not use this.' })),
      h('div', { class: 'grid-3' },
        checkGroup('Experience', [['internship', 'Internship'], ['entry', 'Entry level'], ['associate', 'Associate']], s.experience, (v) => { s.experience = v; dirty(); }),
        segmented('Date posted', [['any', 'Any time'], ['day', 'Past day'], ['week', 'Past week'], ['month', 'Past month']], ['day', 'week', 'month'].includes(s.posted) ? s.posted : 'any', (v) => { s.posted = v; dirty(); }),
        checkGroup('Workplace', [['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On site']], s.workplace, (v) => { s.workplace = v; dirty(); })),
      h('div', { class: 'grid-3' },
        checkGroup('Sites', sources().map((x) => [x.id, x.label]), s.sources, (v) => { s.sources = v; dirty(); }),
        h('div', { class: 'fieldset' },
          h('span', { class: 'field-label' }, 'Apply type'),
          h('label', { class: 'switch-inline' }, h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: s.easyApplyOnly !== false, onchange: (e) => { s.easyApplyOnly = e.target.checked; dirty(); } }), 'Easy Apply only'),
          h('p', { class: 'field-hint' }, 'Only jobs you can apply to on the site itself, like LinkedIn Easy Apply and Indeed Apply.')),
        field('Jobs per site', h('input', { class: 'input', type: 'number', min: 1, max: 200, step: 1, value: s.limit ?? '', placeholder: String(S.state?.settings?.perSearchLimit ?? 25), style: { maxWidth: '140px' }, oninput: (e) => { const v = e.target.value; if (v === '') delete s.limit; else s.limit = Math.max(1, Math.round(Number(v)) || 1); dirty(); } }), { hint: 'The most new jobs to read from each site. Blank uses the default from Settings.' })),
      h('details', { class: 'url-details', open: urlCount() > 0 },
        h('summary', null, icon('chevronRight', 15), 'Paste your own search URL (optional)', urlCountEl),
        h('div', { class: 'url-body' },
          h('p', { class: 'field-hint' }, 'This is the best way to use filters the site has. Set up the search on the site, copy the address from the address bar and paste it here. For that site, JobPilot then uses your URL instead of the fields above.'),
          h('div', { class: 'grid-3' }, sources().map((x) => {
            const input = h('input', { class: 'input input-mono', type: 'url', value: s.urls?.[x.id] || '', placeholder: `https://… (${x.label} search page)`, oninput: (e) => {
              s.urls = { ...(s.urls || {}), [x.id]: e.target.value.trim() };
              const bad = e.target.value.trim() && !/^https?:\/\//i.test(e.target.value.trim());
              input.classList.toggle('is-invalid', !!bad); dirty(); updateUrlCount();
            } });
            return field(`${x.label} URL`, input);
          }))))));
  return card;
}

async function saveSearches() {
  if (!validateSearchNames()) { toast('Each search needs its own name before you can save.', 'error'); return false; }
  const bad = E.searches.find((s) => Object.values(s.urls || {}).some((u) => u && !/^https?:\/\//i.test(u)));
  if (bad) { toast(`A pasted URL in "${bad.name}" does not start with https://. Fix it or clear it.`, 'error'); return false; }
  const body = E.searches.map((s) => ({ ...s, name: String(s.name || '').trim() }));
  const res = await api('PUT', '/api/searches', body).catch(() => null);
  if (!res) return false;
  S.searches = res;
  E.searches = searchesDraft(res);
  markDirty('searches', false);
  toast('Searches saved.', 'success');
  await pollState();
  if (S.tab === 'searches') rerender();
  return true;
}

// =================================================================== jobs

const J = { status: 'all', site: 'all', q: '', sort: 'newest', selected: new Set(), open: new Set(), els: {} };

function applyHow(j) {
  switch (j.applyType) {
    case 'easy': return j.source === 'indeed' ? 'Indeed Apply' : 'Easy Apply';
    case 'quick': return 'Quick Apply';
    case 'external': return 'Company site';
    case 'ats': return 'Company form';
    case 'applied': return 'Already applied';
    default: return 'Not sure yet';
  }
}
const APPLY_TIP = {
  easy: 'Applied right on the site', quick: 'Handshake Quick Apply',
  external: 'JobPilot fills Lever, Ashby and Greenhouse forms. Other company sites are left for you.',
  ats: 'A Lever, Ashby or Greenhouse form that JobPilot can fill',
};

function scoreFor(j, file) {
  if (!file) return null;
  const r = (j.ranking || []).find((x) => x.file === file);
  if (r) return r.score;
  if (!(j.ranking || []).length && file === j.resume && j.score != null) return j.score;
  return null;
}
const isWaitingTab = (j) => !!j.tabOpen && WAITING_STATUSES.has(j.status);

function filteredJobs() {
  const q = J.q.trim().toLowerCase();
  let list = (S.jobs || []).filter((j) => {
    if (J.status === 'tabs') { if (!isWaitingTab(j)) return false; } else if (J.status !== 'all' && j.status !== J.status) return false;
    if (J.site !== 'all' && j.source !== J.site) return false;
    if (q && ![j.title, j.company, j.location, j.note, j.resume, j.search].some((x) => String(x || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const by = {
    newest: null,
    match: (a, b) => (scoreFor(b, b.resume) ?? -1) - (scoreFor(a, a.resume) ?? -1),
    skills: (a, b) => (b.skills?.pct ?? -1) - (a.skills?.pct ?? -1),
    company: (a, b) => String(a.company || '').localeCompare(String(b.company || '')),
  }[J.sort];
  if (by) list = [...list].sort(by);
  return list;
}

function renderJobs() {
  const jobs = S.jobs || [];
  if (!jobs.length) {
    const hasSearch = (S.state?.setup?.searches || 0) > 0;
    view.replaceChildren(h('div', { class: 'view-inner' },
      pageHead('Jobs', 'Everything your searches found. Look them over, then apply.'),
      h('section', { class: 'card' }, emptyState({
        icon: 'briefcase', title: 'No jobs yet',
        text: hasSearch ? 'Press Search & save in the top bar. JobPilot runs your searches and lists every new job here with the best resume for it.' : 'First create a search on the Searches tab. Then press Search & save in the top bar and the jobs show up here.',
        actions: hasSearch ? [btn('Search & save', { kind: 'primary', icon: 'search', disabled: !!S.state?.runner?.task, onclick: () => startRun('search') })] : [btn('Create a search', { kind: 'primary', icon: 'plus', onclick: () => go('searches') })],
      })),
      howApplyingWorks(true)));
    return;
  }
  J.els.chips = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by status' });
  J.els.count = h('span', { class: 'toolbar-count', role: 'status' });
  J.els.bulk = h('div', { class: 'bulkbar', hidden: true });
  J.els.tabs = h('div');
  J.els.tbody = h('tbody');
  J.els.head = h('input', { type: 'checkbox', 'aria-label': 'Select all jobs shown', onchange: (e) => {
    for (const j of filteredJobs()) { if (e.target.checked) J.selected.add(j.key); else J.selected.delete(j.key); }
    renderJobsBody();
  } });
  const siteSel = h('select', { class: 'input', 'aria-label': 'Filter by site', value: J.site, onchange: (e) => { J.site = e.target.value; renderJobsBody(); } },
    h('option', { value: 'all' }, 'All sites'), sources().map((s) => h('option', { value: s.id }, s.label)));
  const sortSel = h('select', { class: 'input', 'aria-label': 'Sort jobs', value: J.sort, onchange: (e) => { J.sort = e.target.value; renderJobsBody(); } },
    h('option', { value: 'newest' }, 'Newest first'), h('option', { value: 'match' }, 'Best resume match'), h('option', { value: 'skills' }, 'Best skills match'), h('option', { value: 'company' }, 'Company A to Z'));

  view.replaceChildren(h('div', { class: 'view-inner' },
    pageHead('Jobs', 'Everything your searches found. Look them over, skip what you do not want, then apply.', [
      btn('How applying works', { kind: 'ghost', icon: 'info', onclick: () => confirmDialog({ title: 'How applying works', body: howApplyingList(), ok: 'Got it', cancel: null, icon: 'tab' }) }),
      btn('Refresh', { kind: 'ghost', icon: 'refresh', onclick: onBusy(async () => { S.jobs = await api('GET', '/api/jobs').catch(() => S.jobs); renderJobsBody(); }) }),
    ]),
    J.els.tabs,
    h('div', { class: 'toolbar' },
      J.els.chips,
      h('div', { class: 'toolbar-row' },
        h('div', { class: 'search-input' }, icon('search', 16), h('input', { class: 'input', type: 'search', value: J.q, placeholder: 'Search title, company, location or note', 'aria-label': 'Search jobs', oninput: (e) => { J.q = e.target.value; renderJobsBody(); } })),
        siteSel, sortSel, J.els.count)),
    J.els.bulk,
    h('section', { class: 'table-card' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table table-min-jobs jobs-table' },
          h('thead', null, h('tr', null,
            h('th', { class: 'col-check' }, J.els.head), h('th', null, 'Job'), h('th', null, 'Company'), h('th', null, 'Site'), h('th', null, 'How to apply'),
            h('th', null, 'Resume chosen'), h('th', { 'data-tip': 'How many of the skills the posting names are on your Profile skill list' }, 'Skills match'), h('th', null, 'Status'), h('th', null, 'Note'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
          J.els.tbody)))));
  renderJobsBody();
}

function howApplyingWorks(open) {
  return h('details', { class: 'card', style: { marginTop: '16px', flex: 'none' }, open },
    h('summary', { style: { cursor: 'pointer', fontWeight: '650' } }, 'How applying works'),
    howApplyingList());
}

function howApplyingList() {
  const max = S.state?.settings?.maxOpenTabs ?? 8;
  return h('ul', { class: 'plain-list', style: { margin: '10px 0 0', color: 'var(--text-2)', gap: '6px' } },
      h('li', null, 'JobPilot applies to one job at a time, best matches first. Each job gets its own background tab in JobPilot\'s Chrome.'),
      h('li', null, 'When the site confirms the application, that tab closes by itself.'),
      h('li', null, 'If anything is unsure, the tab stays open and JobPilot moves on to the next job. That happens when a question needs your answer, an AI answer is waiting for your review, Submit is off, something went wrong, or the site never confirmed.'),
      h('li', null, `Once ${max} tabs are waiting, the run stops and asks you to finish those first. You can change that number in Settings.`),
      h('li', null, 'After you finish a job in its tab, press "I submitted it" on that row so it goes into your applications sheet.'));
}

function renderJobsBody() {
  if (!J.els.tbody) return;
  const all = S.jobs || [];
  const keys = new Set(all.map((j) => j.key));
  for (const k of [...J.selected]) if (!keys.has(k)) J.selected.delete(k);

  // waiting tabs banner
  const waiting = all.filter(isWaitingTab);
  const max = S.state?.settings?.maxOpenTabs ?? 8;
  setKids(J.els.tabs, waiting.length ? h('div', { style: { marginBottom: '14px' } }, callout(waiting.length >= max ? 'warn' : 'info',
    h('div', { class: 'callout-title' }, `${plural(waiting.length, 'job')} waiting for you in open tabs`),
    h('p', null, `Finish each one in JobPilot's Chrome, then press "I submitted it" on its row, or Skip it. Apply stops once ${max} tabs are waiting.`),
    h('div', null, btn(J.status === 'tabs' ? 'Show all jobs' : 'Show only these', { size: 'sm', onclick: () => { J.status = J.status === 'tabs' ? 'all' : 'tabs'; renderJobsBody(); } })))) : null);

  // chips
  const counts = {};
  for (const j of all) counts[j.status] = (counts[j.status] || 0) + 1;
  const chip = (id, label, n, tone, tip) => h('button', { type: 'button', class: ['fchip', tone && `tone-${tone}`, !n && 'is-zero'], 'aria-pressed': String(J.status === id), 'data-tip': tip, onclick: () => { J.status = id; renderJobsBody(); } },
    tone && h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), label, h('span', { class: 'fchip-n' }, String(n)));
  const extra = Object.keys(counts).filter((s) => !JOB_FILTERS.includes(s));
  setKids(J.els.chips, 
    chip('all', 'All', all.length, null, 'Every job'),
    ...[...JOB_FILTERS, ...extra].map((s) => chip(s, STATUS[s]?.label || humanize(s), counts[s] || 0, STATUS[s]?.tone || 'gray', STATUS[s]?.tip)),
    waiting.length ? chip('tabs', 'Waiting in a tab', waiting.length, 'violet', 'Jobs whose tab JobPilot left open for you') : null);

  const list = filteredJobs();
  J.els.count.textContent = list.length === all.length ? plural(all.length, 'job') : `${list.length} of ${all.length} jobs`;
  const shownSel = list.filter((j) => J.selected.has(j.key)).length;
  J.els.head.checked = list.length > 0 && shownSel === list.length;
  J.els.head.indeterminate = shownSel > 0 && shownSel < list.length;

  renderBulkbar();

  if (!list.length) {
    J.els.tbody.replaceChildren(h('tr', null, h('td', { colspan: 10 }, emptyState({
      small: true, icon: 'search', title: 'No jobs match these filters',
      text: 'Try another status, site or search word.',
      actions: [btn('Clear filters', { onclick: () => { J.status = 'all'; J.site = 'all'; J.q = ''; renderJobs(); } })],
    }))));
    return;
  }
  const rows = [];
  for (const j of list) {
    rows.push(jobRow(j));
    if (J.open.has(j.key)) rows.push(jobDetailRow(j));
  }
  J.els.tbody.replaceChildren(...rows);
}

function renderBulkbar() {
  const n = J.selected.size;
  const bar = J.els.bulk;
  bar.hidden = !n;
  if (!n) { bar.replaceChildren(); return; }
  const keys = [...J.selected];
  const running = !!S.state?.runner?.task;
  setKids(bar, 
    h('span', null, `${plural(n, 'job')} selected`),
    h('span', { class: 'spacer' }),
    btn('Apply to selected', { kind: 'primary', size: 'sm', icon: 'plane', attrs: runAttrs(false), disabled: running, tip: running ? 'Wait for the current task to finish' : 'Apply to just these jobs, in any status', onclick: async () => {
      if (await startRun('apply', { keys, limit: keys.length })) { J.selected.clear(); renderJobsBody(); }
    } }),
    btn('Skip', { size: 'sm', icon: 'skip', onclick: onBusy(() => bulkStatus(keys, 'skipped')) }),
    btn('Retry', { size: 'sm', icon: 'undo', tip: 'Set back to Saved so the next Apply tries them again', onclick: onBusy(() => bulkStatus(keys, 'saved')) }),
    btn('Clear selection', { size: 'sm', kind: 'ghost', onclick: () => { J.selected.clear(); renderJobsBody(); } }));
}

async function bulkStatus(keys, status) {
  let n = 0;
  for (const key of keys) {
    const res = await api('POST', '/api/jobs/update', { key, patch: { status, note: status === 'skipped' ? 'skipped by you' : '' } }).catch(() => null);
    if (res) { replaceJob(res, key); n++; }
  }
  J.selected.clear();
  toast(status === 'skipped' ? `Skipped ${plural(n, 'job')}.` : `${plural(n, 'job')} set back to Saved. The next Apply tries them again.`, 'success');
  pollState();
  renderJobsBody();
}

function replaceJob(updated, key) {
  const i = (S.jobs || []).findIndex((j) => j.key === key);
  if (i >= 0) S.jobs[i] = { ...S.jobs[i], ...updated, key };
}

async function setJobStatus(j, status, note) {
  const patch = { status };
  if (note !== undefined) patch.note = note;
  const res = await api('POST', '/api/jobs/update', { key: j.key, patch }).catch(() => null);
  if (!res) return;
  replaceJob(res, j.key);
  pollState();
  renderJobsBody();
}

async function markSubmitted(j) {
  const ok = await confirmDialog({ title: 'Mark this job as submitted?', body: [`${j.title || 'This job'} at ${j.company || 'this company'}.`, 'Use this after you sent the application yourself in its tab. JobPilot adds it to your applications sheet so it never applies there again.'], ok: 'I submitted it', icon: 'checkCircle' });
  if (!ok) return;
  await setJobStatus(j, 'submitted', 'you finished it in the open tab');
  toast('Marked as submitted and added to your applications sheet.', 'success');
}

async function changeResume(j, file, select) {
  select.disabled = true;
  const res = await api('POST', '/api/jobs/update', { key: j.key, patch: { resume: file } }).catch(() => null);
  select.disabled = false;
  if (!res) { select.value = j.resume || ''; return; }
  replaceJob(res, j.key);
  toast(file ? `This job will use ${file}.` : 'JobPilot will pick the best resume when it applies.', 'success');
  renderJobsBody();
}

function resumeCell(j) {
  const files = (S.resumes || []).map((r) => r.file);
  const cur = j.resume || '';
  const options = [h('option', { value: '' }, 'Pick the best one at apply time'), ...files.map((f) => h('option', { value: f }, f))];
  if (cur && !files.includes(cur)) options.push(h('option', { value: cur }, `${cur} (file is gone)`));
  const select = h('select', { class: 'input input-sm', 'aria-label': `Resume for ${j.title || 'this job'}`, value: cur, onchange: (e) => changeResume(j, e.target.value, e.target) }, options);
  const score = scoreFor(j, cur);
  const original = j.ranking?.[0]?.file;
  const changed = cur && original && cur !== original;
  return h('div', { class: 'resume-cell' }, select,
    h('div', { class: 'resume-meta' },
      score != null && h('span', { class: 'score', 'data-tip': 'How well this resume fits, from role tags and shared words' }, `${Math.round(score * 100)}% fit`),
      changed ? h('span', null, 'Picked by you') : null),
    !changed && j.why && h('div', { class: 'resume-why clamp-2', 'data-tip': j.why }, j.why));
}

function skillsCell(j) {
  const s = j.skills;
  if (!s || s.pct == null) return h('span', { class: 'small muted', 'data-tip': 'The posting did not name any skills JobPilot knows.' }, 'Not listed');
  const missing = s.missing || [];
  const tip = missing.length ? `Missing: ${missing.join(', ')}${(s.have || []).length ? `\nYou have: ${s.have.join(', ')}` : ''}` : 'You have every skill this posting names.';
  return h('div', { class: 'meter-cell', 'data-tip': tip, tabindex: 0 }, meter(s.pct), h('span', { class: 'meter-val' }, `${s.pct}%`), h('span', { class: 'sr-only' }, tip));
}

function jobRow(j) {
  const sel = J.selected.has(j.key);
  const href = safeUrl(j.externalUrl) || safeUrl(j.url);
  const isOpen = J.open.has(j.key);
  const drafts = Array.isArray(j.drafts) ? j.drafts : [];
  const toggle = h('button', { type: 'button', class: 'icon-btn', 'aria-expanded': String(isOpen), 'aria-label': isOpen ? 'Hide details' : 'Show details', 'data-tip': isOpen ? 'Hide details' : 'Show details', onclick: () => { if (isOpen) J.open.delete(j.key); else J.open.add(j.key); renderJobsBody(); } }, icon(isOpen ? 'chevronDown' : 'chevronRight', 16));
  const meta = [j.location, j.search && `from "${j.search}"`].filter(Boolean).join(' · ');
  return h('tr', { class: sel && 'is-selected' },
    h('td', { class: 'col-check' }, h('input', { type: 'checkbox', checked: sel, 'aria-label': `Select ${j.title || 'job'}`, onchange: (e) => { if (e.target.checked) J.selected.add(j.key); else J.selected.delete(j.key); renderJobsBody(); } })),
    h('td', null, h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start' } }, toggle,
      h('div', { style: { minWidth: '0', maxWidth: '300px' } },
        href ? h('a', { class: 'cell-title', href: safeUrl(j.url) || href, target: '_blank', rel: 'noopener noreferrer' }, j.title || 'Untitled job') : h('div', { class: 'cell-title' }, j.title || 'Untitled job'),
        meta && h('div', { class: 'cell-sub' }, meta)))),
    h('td', null, h('div', { style: { fontWeight: '550', maxWidth: '180px' } }, j.company || 'Unknown company')),
    h('td', null, siteBadge(j.source)),
    h('td', null, h('span', { 'data-tip': APPLY_TIP[j.applyType] || null, class: 'small' }, applyHow(j))),
    h('td', null, resumeCell(j)),
    h('td', null, skillsCell(j)),
    h('td', null, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-start' } },
      statusPill(j.status),
      isWaitingTab(j) && h('span', { class: 'tag', 'data-tip': 'JobPilot left this job\'s tab open in its Chrome for you' }, icon('tab', 12), ' Tab open'),
      drafts.length > 0 && h('button', { type: 'button', class: 'link-btn small', onclick: () => { J.open.add(j.key); renderJobsBody(); } }, `Read ${plural(drafts.length, 'AI answer')}`))),
    h('td', null, j.note ? h('div', { class: 'cell-note clamp-2', 'data-tip': j.note }, j.note) : h('span', { class: 'small muted' }, ''),
      j.status === 'needs_answer' && h('button', { type: 'button', class: 'link-btn small', onclick: () => go('questions') }, 'Answer on Questions')),
    h('td', { class: 'col-actions' }, h('div', { class: 'row-actions' },
      href && h('a', { class: 'icon-btn', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': j.externalUrl ? 'Open the company application page' : 'Open the posting', 'data-tip': j.externalUrl ? 'Open the company application page' : 'Open the posting' }, icon('external', 16)),
      CAN_MARK_SUBMITTED.has(j.status) && iconBtn('checkCircle', 'I submitted it', () => markSubmitted(j)),
      j.status !== 'skipped' && j.status !== 'submitted' && iconBtn('skip', 'Skip this job', () => setJobStatus(j, 'skipped', 'skipped by you')),
      j.status !== 'saved' && j.status !== 'submitted' && j.status !== 'applying' && iconBtn('undo', 'Retry', () => setJobStatus(j, 'saved', '')),
      iconBtn('trash', 'Remove from the list', async () => {
        const ok = await confirmDialog({ title: 'Remove this job?', body: `${j.title || 'This job'} at ${j.company || 'this company'} leaves your list. If a later search finds it again, it comes back.`, ok: 'Remove', danger: true, icon: 'trash' });
        if (!ok) return;
        const res = await api('POST', '/api/jobs/remove', { key: j.key }).catch(() => null);
        if (!res) return;
        S.jobs = S.jobs.filter((x) => x.key !== j.key);
        J.selected.delete(j.key); J.open.delete(j.key);
        toast('Removed from your list.', 'success');
        pollState();
        renderJobsBody();
      }, { kind: 'danger' }))));
}

function jobDetailRow(j) {
  const drafts = Array.isArray(j.drafts) ? j.drafts : [];
  const s = j.skills || {};
  const facts = [
    ['Found', j.firstSeen ? fmtDateTime(j.firstSeen) : ''],
    ['Search', j.search],
    ['Applied with', j.appliedWith],
    ['Last tried', j.appliedAt ? fmtDateTime(j.appliedAt) : ''],
    ['Saved on the site too', j.savedOnSite === 'saved' || j.savedOnSite === 'already' ? 'Yes' : ''],
  ].filter(([, v]) => v);
  return h('tr', { class: 'detail-row' }, h('td', { colspan: 10 },
    h('div', { class: 'job-detail' },
      drafts.length > 0 && h('div', { class: 'detail-block detail-drafts' },
        h('h3', { class: 'detail-title' }, icon('sparkle', 15), `What AI wrote (${drafts.length})`),
        h('p', { class: 'small muted' }, j.status === 'needs_review' ? 'These answers are already typed into the form. Read them in the open tab, edit anything you like there, then submit.' : 'These answers were typed into the form for this job.'),
        drafts.map((d) => h('div', { class: 'draft' }, h('div', { class: 'draft-q' }, d.question || 'Question'), h('div', { class: 'draft-a' }, d.answer || '')))),
      h('div', { class: 'detail-grid' },
        h('div', { class: 'detail-block' },
          h('h3', { class: 'detail-title' }, 'Why this resume'),
          j.why ? h('p', { class: 'small' }, j.why) : h('p', { class: 'small muted' }, 'No match details for this job.'),
          (j.ranking || []).length > 0 && h('div', { class: 'detail-rank' }, j.ranking.map((r, i) => h('div', { class: 'detail-rank-row' },
            h('span', { class: ['rank', i === 0 && 'first'] }, String(i + 1)), h('span', { class: 'mono small detail-file' }, r.file), meter(r.score * 100), h('span', { class: 'meter-val' }, `${Math.round(r.score * 100)}%`))))),
        h('div', { class: 'detail-block' },
          h('h3', { class: 'detail-title' }, 'Skills in the posting'),
          s.pct == null ? h('p', { class: 'small muted' }, 'The posting did not name any skills JobPilot knows.') : [
            (s.have || []).length > 0 && h('div', { class: 'tags' }, s.have.map((x) => h('span', { class: 'tag tag-accent' }, x))),
            (s.missing || []).length > 0 && h('div', null, h('div', { class: 'small muted', style: { margin: '8px 0 4px' } }, 'Not on your skill list'), h('div', { class: 'tags' }, s.missing.map((x) => h('span', { class: 'tag tag-warn' }, x)))),
          ]),
        h('div', { class: 'detail-block' },
          h('h3', { class: 'detail-title' }, 'Details'),
          facts.length ? h('dl', { class: 'detail-facts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : h('p', { class: 'small muted' }, 'Nothing else yet.'),
          j.note && h('p', { class: 'small', style: { marginTop: '8px' } }, j.note),
          h('div', { class: 'detail-actions' },
            safeUrl(j.url) && h('a', { class: 'btn btn-sm', href: j.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), h('span', null, 'Open posting')),
            safeUrl(j.externalUrl) && h('a', { class: 'btn btn-sm', href: j.externalUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), h('span', null, 'Open company page')),
            CAN_MARK_SUBMITTED.has(j.status) && btn('I submitted it', { size: 'sm', icon: 'checkCircle', onclick: () => markSubmitted(j) }),
            j.status !== 'saved' && j.status !== 'submitted' && j.status !== 'applying' && btn('Retry', { size: 'sm', icon: 'undo', onclick: () => setJobStatus(j, 'saved', '') })))))));
}

// ============================================================== questions

const Q = { drafts: {} };

function renderQuestions() {
  const list = S.review || [];
  view.replaceChildren(h('div', { class: 'view-inner narrow' },
    pageHead('Questions', 'Questions a form asked that JobPilot could not answer yet.', list.length ? [pill(plural(list.length, 'question') + ' waiting', 'amber')] : null),
    callout('info', 'Answer each one once. JobPilot saves your answer to your Answers list and reuses it on every form that asks the same thing. Jobs that were only waiting on these go back to Saved, so the next Apply tries them again.'),
    h('div', { class: 'q-list', style: { marginTop: '16px' } },
      list.length ? list.map(questionCard) : h('section', { class: 'card' }, emptyState({ icon: 'checkCircle', title: 'No questions waiting', text: 'You are all caught up. When a form asks something new during Apply, it shows up here for you to answer.' })))));
}

function questionCard(q) {
  const d = Q.drafts[q.id] || (Q.drafts[q.id] = { answer: '', type: '' });
  const options = Array.isArray(q.options) ? q.options : [];
  const isCheckbox = options.length === 1 && options[0] === '(checkbox)';
  const saveBtn = btn('Save answer', { kind: 'primary', icon: 'check', disabled: !String(d.answer).trim(), onclick: onBusy(() => answerQuestion(q, d.answer, d.type)) });
  const refresh = () => { saveBtn.disabled = !String(d.answer).trim(); };
  let input;
  if (isCheckbox) {
    const choices = [['Yes', 'check', 'Tick the box'], ['No', '', 'Leave it unticked']];
    input = h('div', { class: 'q-options', role: 'group', 'aria-label': 'Your answer' }, choices.map(([ans, type, label]) => h('button', {
      type: 'button', class: 'opt-btn', 'aria-pressed': String(d.answer === ans), onclick: (e) => {
        d.answer = ans; d.type = type;
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        refresh();
      },
    }, label)));
  } else if (options.length) {
    input = h('div', { class: 'q-options', role: 'group', 'aria-label': 'Pick an answer' }, options.map((o) => h('button', {
      type: 'button', class: 'opt-btn', 'aria-pressed': String(d.answer === o), onclick: (e) => {
        d.answer = o; d.type = '';
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        refresh();
      },
    }, o)));
  } else {
    const long = q.question.length > 70 || /why|describe|tell us|explain/i.test(q.question);
    const props = { class: 'input', value: d.answer, placeholder: 'Type your answer', 'aria-label': 'Your answer', oninput: (e) => { d.answer = e.target.value; d.type = ''; refresh(); } };
    input = h('div', { class: 'q-input' }, long
      ? h('textarea', { ...props, rows: 4, onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && String(d.answer).trim()) saveBtn.click(); } })
      : h('input', { ...props, onkeydown: (e) => { if (e.key === 'Enter' && String(d.answer).trim()) saveBtn.click(); } }));
  }
  const jobs = q.jobs || [];
  return h('section', { class: 'card q-card' },
    h('div', { class: 'q-meta' },
      q.required ? pill('Required', 'amber') : pill('Optional', 'gray'),
      q.runner && h('span', null, `Asked on ${q.runner === 'ats' ? 'a company form' : siteLabel(q.runner)}`),
      q.ts && h('span', null, `· ${timeAgo(q.ts)}`)),
    h('h2', { class: 'q-text' }, q.question),
    input,
    jobs.length > 0 && h('div', { class: 'q-jobs' },
      h('div', { style: { fontWeight: '600' } }, `Asked by ${plural(jobs.length, 'job')}:`),
      h('ul', null, jobs.slice(0, 6).map((j) => h('li', null, icon('briefcase', 14),
        safeUrl(j.url) ? h('a', { href: j.url, target: '_blank', rel: 'noopener noreferrer' }, `${j.title || 'Job'} at ${j.company || 'unknown company'}`) : h('span', null, `${j.title || 'Job'} at ${j.company || 'unknown company'}`))),
      jobs.length > 6 && h('li', { class: 'muted' }, `and ${jobs.length - 6} more`))),
    h('div', { class: 'q-foot' },
      saveBtn,
      btn('Skip this question', { kind: 'ghost', tip: 'JobPilot leaves this question blank from now on', onclick: onBusy(() => answerQuestion(q, '', 'skip')) }),
      h('span', { class: 'spacer' }),
      btn('Dismiss', { kind: 'ghost', tip: 'Remove it from this list without saving an answer. It comes back if a form asks it again.', onclick: onBusy(async () => {
        const res = await api('POST', '/api/review/dismiss', { id: q.id }).catch(() => undefined);
        if (res === undefined) return;
        S.review = S.review.filter((x) => x.id !== q.id);
        delete Q.drafts[q.id];
        toast('Dismissed. It comes back if a form asks it again.', 'info');
        await pollState();
        rerender();
      }) })));
}

async function answerQuestion(q, answer, type) {
  const body = { id: q.id, answer: String(answer ?? '') };
  if (type) body.type = type;
  const res = await api('POST', '/api/review/answer', body).catch(() => null);
  if (!res) return;
  const others = new Set((S.review || []).filter((x) => x.id !== q.id).flatMap((x) => (x.jobs || []).map((j) => j.key)));
  const ready = (q.jobs || []).filter((j) => !others.has(j.key)).length;
  S.review = S.review.filter((x) => x.id !== q.id);
  delete Q.drafts[q.id];
  const head = type === 'skip' ? 'Skipped. JobPilot will leave this question blank from now on.' : 'Saved. JobPilot will use this answer from now on.';
  toast(ready ? `${head} ${plural(ready, 'job')} went back to Saved and will be retried on the next Apply.` : head, 'success', { timeout: 7000 });
  await pollState();
  rerender();
}

// ================================================================== sheet

const SH = { q: '', status: 'all', source: 'all' };
const SHEET_SPECIAL = new Set(['timestamp', 'source', 'title', 'company', 'location', 'resume', 'match_score', 'status', 'notes', 'job_url', 'apply_url', 'job_id']);

function renderSheet() {
  const { header = [], rows = [] } = S.sheet || {};
  const ws = S.state?.workspace || 'your JobPilot folder';
  const sep = /\\/.test(ws) ? '\\' : '/';
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))].sort();
  const srcs = [...new Set(rows.map((r) => r.source).filter(Boolean))].sort();
  const tbody = h('tbody');
  const count = h('span', { class: 'toolbar-count', role: 'status' });
  const extra = header.filter((k) => !SHEET_SPECIAL.has(k));

  const draw = () => {
    const q = SH.q.trim().toLowerCase();
    const list = rows.filter((r) => (SH.status === 'all' || r.status === SH.status)
      && (SH.source === 'all' || r.source === SH.source)
      && (!q || Object.values(r).some((v) => String(v).toLowerCase().includes(q))));
    count.textContent = list.length === rows.length ? plural(rows.length, 'row') : `${list.length} of ${rows.length} rows`;
    if (!list.length) {
      tbody.replaceChildren(h('tr', null, h('td', { colspan: 10 + extra.length }, emptyState({ small: true, icon: 'search', title: 'No rows match', text: 'Try another status, site or search word.' }))));
      return;
    }
    tbody.replaceChildren(...list.map((r) => {
      const score = Number(r.match_score);
      const links = [['job_url', 'Posting'], ['apply_url', 'Apply page']].filter(([k]) => safeUrl(r[k]));
      return h('tr', null,
        h('td', { style: { whiteSpace: 'nowrap' } }, h('span', { 'data-tip': r.timestamp }, fmtDateTime(r.timestamp))),
        h('td', null, siteBadge(r.source)),
        h('td', null, h('div', { class: 'cell-title', style: { maxWidth: '280px' } }, r.title)),
        h('td', null, r.company),
        h('td', { class: 'small' }, r.location),
        h('td', { class: 'mono small' }, r.resume),
        h('td', { class: 'num' }, r.match_score === '' || r.match_score == null ? '' : Number.isFinite(score) && score <= 1 ? `${Math.round(score * 100)}%` : r.match_score),
        h('td', null, statusPill(r.status)),
        h('td', null, r.notes ? h('div', { class: 'cell-note clamp-2', 'data-tip': r.notes }, r.notes) : ''),
        ...extra.map((k) => h('td', { class: 'small' }, r[k] || '')),
        h('td', { class: 'col-actions' }, h('div', { class: 'row-actions' }, links.map(([k, label]) => h('a', { class: 'icon-btn', href: r[k], target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open the ${label.toLowerCase()}`, 'data-tip': `Open the ${label.toLowerCase()}` }, icon('external', 16))))));
    }));
  };

  view.replaceChildren(h('div', { class: 'view-inner' },
    pageHead('Applications', 'Every application attempt, newest first.', [
      h('a', { class: 'btn btn-primary', href: '/api/sheet.csv', download: 'applications.csv' }, icon('download', 16), h('span', null, 'Download CSV')),
    ]),
    h('div', { style: { marginBottom: '14px', flex: 'none' } }, callout('neutral',
      h('p', null, 'This list is the file ', code('applications.csv'), ' in your workspace folder. It opens in Excel, Numbers or Google Sheets. JobPilot also reads it so it never applies to the same job twice.'),
      h('p', { class: 'small muted mono', style: { wordBreak: 'break-all' } }, `${ws}${sep}applications.csv`))),
    rows.length ? [
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-row' },
        h('div', { class: 'search-input' }, icon('search', 16), h('input', { class: 'input', type: 'search', value: SH.q, placeholder: 'Search any column', 'aria-label': 'Search applications', oninput: (e) => { SH.q = e.target.value; draw(); } })),
        h('select', { class: 'input', value: SH.status, 'aria-label': 'Filter by status', onchange: (e) => { SH.status = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All statuses'), statuses.map((s) => h('option', { value: s }, STATUS[s]?.label || humanize(s)))),
        h('select', { class: 'input', value: SH.source, 'aria-label': 'Filter by site', onchange: (e) => { SH.source = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All sites'), srcs.map((s) => h('option', { value: s }, siteLabel(s)))),
        count)),
      h('section', { class: 'table-card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table table-min-sheet' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Site'), h('th', null, 'Job'), h('th', null, 'Company'), h('th', null, 'Location'), h('th', null, 'Resume'), h('th', { class: 'num' }, 'Match'), h('th', null, 'Status'), h('th', null, 'Notes'), extra.map((k) => h('th', null, humanize(k))), h('th', null, h('span', { class: 'sr-only' }, 'Links')))),
        tbody))),
    ] : h('section', { class: 'card' }, emptyState({ icon: 'table', title: 'No applications yet', text: 'Each time JobPilot applies to a job, or fills a form for you to send, a row is added here. Press Apply to saved jobs in the top bar to start.' }))));
  if (rows.length) draw();
}

// ================================================================ answers

function patternError(p) {
  if (!String(p || '').trim()) return 'Add a pattern. An empty one would match every question.';
  try { new RegExp(p, 'i'); return ''; } catch (e) { return `This is not a valid pattern: ${e.message}`; }
}

const A = { test: '' };
function renderAnswers() {
  const rows = E.answers;
  const tbody = h('tbody');
  const result = h('div', { class: 'tester-result', role: 'status' });

  const runTest = () => {
    const n = normalizeLabel(A.test);
    for (const tr of tbody.querySelectorAll('tr')) tr.classList.remove('is-hit');
    if (!A.test.trim()) { result.replaceChildren(); return; }
    let hit = -1;
    for (let i = 0; i < rows.length; i++) {
      if (patternError(rows[i].pattern)) continue;
      if (new RegExp(rows[i].pattern, 'i').test(n)) { hit = i; break; }
    }
    if (hit >= 0) {
      tbody.querySelector(`tr[data-i="${hit}"]`)?.classList.add('is-hit');
      const e = rows[hit];
      result.replaceChildren(h('span', { class: 'status-line ok' }, icon('checkCircle', 16), `Row ${hit + 1} answers it: `, e.type === 'skip' ? 'the question is skipped.' : e.type === 'check' ? 'the checkbox is ticked.' : `"${e.answer}"`));
    } else {
      result.replaceChildren(h('span', { class: 'status-line idle' }, icon('info', 16), 'No row matches. Your profile or skills may answer it. If not, it goes to the Questions tab.'));
    }
    result.append(h('div', { class: 'tester-norm' }, 'JobPilot checks this text: ', h('span', { class: 'mono' }, n || '(empty)')));
  };

  const draw = () => {
    if (!rows.length) {
      tbody.replaceChildren(h('tr', null, h('td', { colspan: 6 }, emptyState({ small: true, icon: 'list', title: 'No answers yet', text: 'Answers you give on the Questions tab are added here. You can also add your own.' }))));
      return;
    }
    tbody.replaceChildren(...rows.map((e, i) => {
      const err = h('div', { class: 'ans-err', hidden: true });
      const pat = h('input', { class: 'input input-sm input-mono', value: e.pattern || '', placeholder: '^why do you want to work here', 'aria-label': `Pattern for row ${i + 1}`, spellcheck: 'false', oninput: (ev) => {
        e.pattern = ev.target.value; const msg = patternError(e.pattern); pat.classList.toggle('is-invalid', !!msg); err.textContent = msg; err.hidden = !msg; markDirty('answers'); runTest();
      } });
      const msg = patternError(e.pattern);
      if (msg) { pat.classList.add('is-invalid'); err.textContent = msg; err.hidden = false; }
      return h('tr', { dataset: { i: String(i) } },
        h('td', { class: 'col-n' }, String(i + 1)),
        h('td', { style: { minWidth: '240px' } }, pat, err),
        h('td', { style: { minWidth: '220px' } }, h('input', { class: 'input input-sm', value: e.answer ?? '', placeholder: e.type === 'skip' ? 'Not needed when skipping' : 'The answer to fill in', 'aria-label': `Answer for row ${i + 1}`, oninput: (ev) => { e.answer = ev.target.value; markDirty('answers'); runTest(); } })),
        h('td', { class: 'col-type' }, h('select', { class: 'input input-sm', value: e.type || '', 'aria-label': `Type for row ${i + 1}`, onchange: (ev) => { if (ev.target.value) e.type = ev.target.value; else delete e.type; markDirty('answers'); draw(); runTest(); } },
          h('option', { value: '' }, 'Fill in the answer'), h('option', { value: 'skip' }, 'Skip the question'), h('option', { value: 'check' }, 'Tick the checkbox'))),
        h('td', { style: { minWidth: '180px' } }, h('input', { class: 'input input-sm', value: e.q ?? '', placeholder: 'A note for you', 'aria-label': `Note for row ${i + 1}`, oninput: (ev) => { e.q = ev.target.value; markDirty('answers'); } })),
        h('td', { class: 'col-actions' }, h('div', { class: 'row-actions' },
          iconBtn('arrowUp', 'Move up', () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; markDirty('answers'); draw(); runTest(); }, { disabled: i === 0 }),
          iconBtn('arrowDown', 'Move down', () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; markDirty('answers'); draw(); runTest(); }, { disabled: i === rows.length - 1 }),
          iconBtn('trash', 'Delete this answer', () => { rows.splice(i, 1); markDirty('answers'); draw(); runTest(); }, { kind: 'danger' }))));
    }));
  };

  view.replaceChildren(h('div', { class: 'view-inner' },
    pageHead('Answers', 'Your own answers for questions your profile does not cover. This is an advanced page.', [
      btn('Add an answer', { kind: 'primary', icon: 'plus', onclick: () => { rows.push({ q: '', pattern: '', answer: '' }); markDirty('answers'); draw(); tbody.querySelector('tr:last-child input')?.focus(); } }),
    ]),
    callout('info',
      h('p', null, 'Each pattern is a regular expression. JobPilot checks it against the question in lowercase with punctuation removed. The first row that matches wins, and these rows come before your profile answers.'),
      h('p', null, 'For example ', code('^why do you want'), ' matches any question that starts with "Why do you want". Answers you give on the Questions tab are added here for you.')),
    h('section', { class: 'card', style: { marginTop: '16px' } },
      cardHead('Try a question', 'See which row would answer it.'),
      h('div', { class: 'tester' }, h('div', { class: 'search-input' }, icon('search', 16), h('input', { class: 'input', value: A.test, placeholder: 'Paste a question from a form', 'aria-label': 'Question to test', oninput: (e) => { A.test = e.target.value; runTest(); } }))),
      result),
    h('section', { class: 'table-card', style: { marginTop: '16px' } }, h('div', { class: 'table-wrap' }, h('table', { class: 'table ans-table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Pattern'), h('th', null, 'Answer'), h('th', null, 'Type'), h('th', null, 'Note'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
      tbody))),
    savebar('answers', saveAnswers, () => { E.answers = clone(S.answers || []); rerender(); })));
  draw();
  runTest();
}

async function saveAnswers() {
  const bad = E.answers.findIndex((e) => patternError(e.pattern));
  if (bad >= 0) { toast(`Row ${bad + 1}: ${patternError(E.answers[bad].pattern)}`, 'error'); return; }
  const res = await api('PUT', '/api/answers', E.answers).catch(() => null);
  if (!res) return;
  S.answers = res;
  E.answers = clone(res);
  markDirty('answers', false);
  toast('Answers saved.', 'success');
  rerender();
}

// =============================================================== settings

const AIT = { question: '', title: '', company: '', result: null, keyInput: '' };

function renderSettings() {
  const s = E.settings;
  const dirty = () => markDirty('settings');
  const numInput = (value, onSet, { min = 0, max = 9999, step = 1, width = '120px', label } = {}) => h('input', {
    class: 'input', type: 'number', min, max, step, value: value ?? '', style: { maxWidth: width }, 'aria-label': label,
    oninput: (e) => { onSet(e.target.value === '' ? '' : Number(e.target.value)); dirty(); },
  });
  const caps = s.dailyCaps || {};
  const capLabels = { linkedin: 'LinkedIn', handshake: 'Handshake', indeed: 'Indeed', ats: 'Company forms' };
  const capKeys = [...new Set([...Object.keys(capLabels), ...Object.keys(caps)])];
  const ws = S.state?.workspace || '';

  view.replaceChildren(h('div', { class: 'view-inner narrow' },
    pageHead('Settings', 'How JobPilot searches and applies.'),
    submitCard(),
    h('div', { id: 'aiSlot' }, aiCard()),
    h('section', { class: 'card' },
      cardHead('Searching'),
      switchRow('Also press Save on the job site', s.saveOnSite, (v) => { s.saveOnSite = v; dirty(); }, { hint: 'Each job a search finds is also saved in your list on LinkedIn, Handshake or Indeed.' }),
      switchRow('Skip senior roles', s.skipSenior, (v) => { s.skipSenior = v; dirty(); }, { hint: 'Leaves out titles like Senior, Staff, Principal or Lead, and roles asking for 5 or more years.' }),
      h('div', { class: 'stack', style: { marginTop: '8px' } },
        field('Jobs per search, per site', numInput(s.perSearchLimit, (v) => { s.perSearchLimit = v; }, { min: 1, max: 200 }), { hint: 'Used when a search does not set its own number.' }),
        field('Companies to leave out', h('textarea', { class: 'input', rows: 2, value: (s.excludeCompanies || []).join(', '), placeholder: 'For example Acme, Globex', oninput: (e) => { s.excludeCompanies = splitList(e.target.value); dirty(); } }), { hint: 'Separate names with commas. Any company whose name contains one of these is skipped.' }),
        field('Title words to leave out', h('textarea', { class: 'input', rows: 2, value: (s.excludeTitleWords || []).join(', '), placeholder: 'For example manager, clearance', oninput: (e) => { s.excludeTitleWords = splitList(e.target.value); dirty(); } }), { hint: 'Separate words with commas. Jobs with any of these in the title are skipped.' }))),
    h('section', { class: 'card' },
      cardHead('Pace and daily limits', 'Going slowly keeps your accounts in good standing.'),
      h('div', { class: 'field-label', style: { marginBottom: '8px' } }, 'Most applications sent per day'),
      h('div', { class: 'grid-4' }, capKeys.map((k) => field(capLabels[k] || humanize(k), numInput(caps[k], (v) => { s.dailyCaps = { ...(s.dailyCaps || {}), [k]: v }; }, { min: 0, max: 500, width: '100%' })))),
      h('p', { class: 'field-hint', style: { marginTop: '8px' } }, 'Counted from today\'s submitted rows in your applications sheet. Company forms are Lever, Ashby and Greenhouse.'),
      h('div', { class: 'grid-2', style: { marginTop: '18px' } },
        field('Shortest pause between jobs (seconds)', numInput(s.pauseSeconds?.[0], (v) => { s.pauseSeconds = [v, s.pauseSeconds?.[1] ?? 12]; }, { min: 0, max: 600, width: '100%' })),
        field('Longest pause between jobs (seconds)', numInput(s.pauseSeconds?.[1], (v) => { s.pauseSeconds = [s.pauseSeconds?.[0] ?? 6, v]; }, { min: 0, max: 600, width: '100%' }))),
      h('p', { class: 'field-hint', style: { marginTop: '8px' } }, 'JobPilot waits a random time in this range after each job.'),
      h('div', { style: { marginTop: '18px' } },
        field('Open tabs before Apply pauses', numInput(s.maxOpenTabs, (v) => { s.maxOpenTabs = v; }, { min: 1, max: 50 }), { hint: 'Jobs that need you stay open in their own tab. Once this many are waiting, the run stops so you can finish them.' }))),
    h('section', { class: 'card' },
      cardHead('Resumes on the sites'),
      switchRow('Upload new or edited resumes before applying', s.autoSyncResumes !== false, (v) => { s.autoSyncResumes = v; dirty(); }, { hint: 'Before Apply starts, any resume you added or changed is uploaded to LinkedIn and Handshake with today\'s date and time in its name, so the newest copy is always the one picked. Indeed is switched per job either way.' })),
    h('section', { class: 'card' },
      cardHead('Advanced'),
      field('Chrome debugging port', numInput(s.cdpPort, (v) => { s.cdpPort = v; }, { min: 1024, max: 65535 }), { hint: 'The port JobPilot uses to talk to its Chrome window. Leave it at 9222 unless something else uses that port.' }),
      h('div', { style: { marginTop: '16px' } },
        field('Workspace folder', h('div', { class: 'copy-field' },
          h('input', { class: 'input', readonly: 'readonly', value: ws, 'aria-label': 'Workspace folder' }),
          btn('Copy', { icon: 'copy', onclick: async () => {
            try { await navigator.clipboard.writeText(ws); toast('Copied the folder path.', 'success'); } catch { toast('Could not copy. Select the path and copy it yourself.', 'warn'); }
          } })), { hint: 'Your resumes, profile, answers, jobs and applications sheet all live here. To use another folder, start JobPilot with JOBPILOT_HOME set to it.' }))),
    savebar('settings', saveSettingsNow, () => { E.settings = clone(S.settings); rerender(); })));
}

function submitCard() {
  const on = !!S.settings?.submit;
  return h('section', { class: ['card', 'submit-card', on && 'is-on'] },
    h('div', { class: 'submit-row' },
      h('div', null,
        h('div', { class: 'submit-state' }, on ? 'ON: applications are sent' : 'OFF: forms are filled, not sent'),
        h('h2', { class: 'submit-title' }, h('label', { for: 'submitSwitch' }, 'Submit applications')),
        h('p', { class: 'submit-desc' }, on ? 'Apply fills in each form and presses the final Submit button. Daily caps still apply.' : 'Apply fills in every form and stops before the final Submit button, leaving the tab open for you. This is the safe way to practice.')),
      h('span', { class: 'big-switch' }, h('input', { type: 'checkbox', role: 'switch', id: 'submitSwitch', checked: on, onchange: (e) => toggleSubmit(e.target) }))),
    h('p', { class: 'small muted' }, 'This switch saves right away.'));
}

async function toggleSubmit(input) {
  const want = input.checked;
  if (want) {
    const ok = await confirmDialog({
      title: 'Turn Submit ON?',
      body: ['From now on, Apply sends real applications to employers.', 'Make sure you checked a few drafts from a practice run first.'],
      ok: 'Turn Submit ON', cancel: 'Keep it off', danger: true, icon: 'plane',
    });
    if (!ok) { input.checked = false; return; }
  }
  input.disabled = true;
  const res = await api('PUT', '/api/settings', { submit: want }).catch(() => null);
  input.disabled = false;
  if (!res) { input.checked = !want; return; }
  applySavedSettings(res, ['submit']);
  toast(want ? 'Submit is ON. Apply now sends applications.' : 'Submit is OFF. Forms get filled but not sent.', want ? 'warn' : 'success');
}

/** Puts freshly saved settings into place without losing unsaved edits to other fields. */
function applySavedSettings(res, keys) {
  S.settings = res;
  if (S.state) S.state.settings = res;
  if (E.settings) for (const k of keys) E.settings[k] = clone(res[k]);
  renderTopbar();
  if (S.tab === 'settings') rerender();
}

const DEFAULT_PROVIDERS = [
  { id: 'claude-code', label: 'My Claude Code sign-in (uses my Claude plan, no API key)' },
  { id: 'api', label: 'Anthropic API key (billed per answer)' },
];
const DEFAULT_MODELS = [
  { id: 'opus', label: 'Opus (best writing)' },
  { id: 'sonnet', label: 'Sonnet (lighter on your usage)' },
  { id: 'haiku', label: 'Haiku (lightest, fastest)' },
];

/** "Name (detail)" becomes a title and a smaller line under it. */
function splitLabel(label) {
  const m = String(label || '').match(/^(.*?)\s*\((.*)\)\s*$/);
  return m ? [m[1], cap(m[2])] : [String(label || ''), ''];
}

function claudeCodeLine(cc) {
  if (cc?.found) {
    const ver = String(cc.version || '').replace(/\(?\s*claude code\s*\)?/i, '').trim();
    return h('div', { class: 'status-line ok' }, icon('checkCircle', 16), `Claude Code ${ver ? `${ver} ` : ''}found`,
      cc.path && h('span', { class: 'small muted mono', style: { fontWeight: '400' } }, cc.path));
  }
  return h('div', { class: 'status-line bad' }, icon('alert', 16), 'Claude Code not found: install it and run ', code('claude'), ' once to sign in.');
}

function aiCard() {
  const s = E.settings;
  const ai = { enabled: false, provider: 'claude-code', model: 'opus', effort: 'low', autoSubmit: false, ...(s.ai || {}) };
  s.ai = ai;
  const info = S.ai || {};
  const key = info.key || { hasKey: false, hint: '', source: null };
  const cc = info.claudeCode || { found: false, path: null, version: null };
  const providers = [...(info.providers?.length ? info.providers : DEFAULT_PROVIDERS)].sort((a, b) => (a.id === 'claude-code' ? -1 : b.id === 'claude-code' ? 1 : 0));
  const provider = providers.some((p) => p.id === ai.provider) ? ai.provider : 'claude-code';
  ai.provider = provider;
  const models = info.models?.length ? info.models : DEFAULT_MODELS;
  const modelOpts = models.some((m) => m.id === ai.model) ? models : [...models, { id: ai.model, label: ai.model }];
  const ready = provider === 'api' ? !!key.hasKey : !!cc.found;
  const checking = S.aiLoading && !info.claudeCode;
  const dirty = () => markDirty('settings');
  const statusPillEl = !ai.enabled ? pill('Off', 'gray') : checking ? pill('Checking', 'gray') : ready ? pill('On', 'green')
    : pill('On, but not ready', 'amber', { tip: 'Open-ended questions go to the Questions tab until this is ready' });

  // provider choice, Claude Code first
  const groupName = nextId('provider');
  const providerChoice = h('fieldset', { class: 'fieldset' },
    h('legend', { class: 'field-label' }, 'How JobPilot reaches Claude'),
    h('div', { class: 'choice-cards' }, providers.map((p) => {
      const [title, sub] = splitLabel(p.label);
      return h('label', { class: 'choice' },
        h('input', { type: 'radio', name: groupName, value: p.id, checked: provider === p.id, onchange: () => { ai.provider = p.id; dirty(); refreshAiCard(); } }),
        h('span', { class: 'choice-body' },
          h('span', { class: 'choice-title' }, title, p.id === 'claude-code' && h('span', { class: 'tag tag-accent', style: { marginLeft: '8px' } }, 'Default')),
          sub && h('span', { class: 'choice-sub' }, sub)));
    })));

  // Claude Code status, or the API key box
  let access;
  if (provider === 'api') {
    const keyInput = h('input', { class: 'input', type: 'password', id: nextId('key'), value: AIT.keyInput, placeholder: key.hasKey ? 'Paste a new key to replace it' : 'sk-ant-…', autocomplete: 'off', spellcheck: 'false', oninput: (e) => { AIT.keyInput = e.target.value; } });
    const saveKey = async () => {
      const v = AIT.keyInput.trim();
      if (!v) { toast('Paste your API key first.', 'warn'); keyInput.focus(); return; }
      if (!v.startsWith('sk-ant-')) { toast('That does not look like an Anthropic API key. It should start with sk-ant-.', 'error'); return; }
      const res = await api('PUT', '/api/ai/key', { apiKey: v }).catch(() => null);
      if (!res) return;
      AIT.keyInput = '';
      S.ai = { ...(S.ai || {}), key: res };
      toast('API key saved on this computer.', 'success');
      refreshAiCard();
    };
    access = h('div', { class: 'field' },
      h('label', { class: 'field-label', for: keyInput.id }, icon('key', 14), 'Anthropic API key'),
      key.hasKey && h('div', { class: 'status-line ok small' }, icon('checkCircle', 15),
        key.source === 'env' ? 'Using the ANTHROPIC_API_KEY from your terminal: ' : 'Saved: ', h('span', { class: 'mono' }, key.hint || 'hidden')),
      h('div', { class: 'copy-field' }, keyInput,
        btn('Save', { kind: 'primary', onclick: onBusy(saveKey) }),
        key.hasKey && key.source === 'dashboard' && btn('Remove', { kind: 'danger-ghost', onclick: onBusy(async () => {
          const ok = await confirmDialog({ title: 'Remove your API key?', body: 'JobPilot stops writing AI answers with the API until you add a key again.', ok: 'Remove key', danger: true, icon: 'key' });
          if (!ok) return;
          const res = await api('POST', '/api/ai/key/remove').catch(() => null);
          if (!res) return;
          S.ai = { ...(S.ai || {}), key: res };
          toast(res.hasKey ? 'Removed the saved key. JobPilot still sees a key in your terminal settings.' : 'API key removed.', 'success');
          refreshAiCard();
        }) })),
      h('p', { class: 'field-hint' }, 'Billed per answer, about 2 to 3 cents each with Opus. The key is saved only in your workspace folder, and the full key is never shown again.'));
  } else if (S.aiLoading && !info.claudeCode) {
    access = h('div', { class: 'status-line idle' }, h('span', { class: 'spinner', style: { width: '15px', height: '15px', borderWidth: '2px' }, 'aria-hidden': 'true' }), 'Looking for Claude Code on this computer…');
  } else {
    access = h('div', { class: 'provider-status' },
      claudeCodeLine(cc),
      h('p', { class: 'field-hint' }, cc.found
        ? 'Answers come out of your Claude plan\'s usage, with no API key and no separate bill. Each answer takes about 5 seconds.'
        : 'Install Claude Code, then run claude once in your terminal to sign in. Answers then come out of your Claude plan with no API key.'),
      !cc.found && btn('Check again', { size: 'sm', icon: 'refresh', onclick: onBusy(async () => {
        const res = await api('GET', '/api/ai').catch(() => null);
        if (!res) return;
        S.ai = res;
        toast(res.claudeCode?.found ? 'Found Claude Code.' : 'Claude Code is still not found.', res.claudeCode?.found ? 'success' : 'warn');
        refreshAiCard();
      }) }));
  }

  const out = h('div', null, AIT.result ? aiTestResult(AIT.result) : null);
  const tryIt = async (e) => {
    e.preventDefault();
    const b = e.currentTarget.querySelector('button[type=submit]');
    await busy(b, async () => {
      if (S.dirty.settings) {
        const ok = await confirmDialog({ title: 'Save your settings first?', body: 'Try it uses your saved settings, like the way to reach Claude and the model.', ok: 'Save and try it' });
        if (!ok) return;
        if (!(await saveSettingsNow())) return;
      }
      const body = { question: AIT.question.trim() || 'Why do you want to work here?' };
      if (AIT.title.trim()) body.title = AIT.title.trim();
      if (AIT.company.trim()) body.company = AIT.company.trim();
      const res = await api('POST', '/api/ai/test', body).catch(() => null);
      if (!res) return;
      if (res.error) { toast(cap(res.error), 'error'); return; }
      AIT.result = { ...res, question: body.question };
      out.replaceChildren(aiTestResult(AIT.result));
    });
  };
  const notReady = provider === 'api' ? 'Save your API key first' : 'Install Claude Code and sign in first';

  return h('section', { class: 'card', id: 'sec-ai' },
    cardHead('AI answers', 'Let Claude draft answers to open-ended questions like "Why do you want to work here?", using only facts from your resume and profile.', [statusPillEl]),
    switchRow('Use AI for open-ended questions', ai.enabled, (v) => { ai.enabled = v; dirty(); refreshAiCard(); }, { hint: 'When this is off, those questions go to your Questions tab for you to answer.' }),
    h('div', { class: 'stack', style: { marginTop: '8px' } },
      providerChoice,
      access,
      field('Model', h('select', { class: 'input', value: ai.model, onchange: (e) => { ai.model = e.target.value; dirty(); } }, modelOpts.map((m) => h('option', { value: m.id }, m.label)))),
    ),
    h('div', { style: { marginTop: '10px' } },
      switchRow('Submit AI answers without review', ai.autoSubmit, async (v, input) => {
        if (v) {
          const ok = await confirmDialog({ title: 'Send AI answers without your review?', body: ['JobPilot will submit forms that contain AI written answers without showing them to you first.', 'This only happens when Submit applications is also ON.'], ok: 'Yes, submit them', cancel: 'Keep reviewing', danger: true, icon: 'sparkle' });
          if (!ok) { input.checked = false; return; }
        }
        ai.autoSubmit = v; dirty();
      }, { hint: 'Off: JobPilot types in the AI answer and leaves the tab open so you can read it and submit. On: it submits by itself, but only when Submit applications is also ON.' })),
    h('form', { class: 'ai-try', onsubmit: tryIt },
      h('div', { class: 'field-label' }, 'See a sample answer'),
      h('div', { class: 'grid-3' },
        field('Question', h('input', { class: 'input', value: AIT.question, placeholder: 'Why do you want to work here?', oninput: (e) => { AIT.question = e.target.value; } }), { wide: true }),
        field('Job title (optional)', h('input', { class: 'input', value: AIT.title, placeholder: 'Software Engineer', oninput: (e) => { AIT.title = e.target.value; } })),
        field('Company (optional)', h('input', { class: 'input', value: AIT.company, placeholder: 'Example Co', oninput: (e) => { AIT.company = e.target.value; } }))),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        btn('Try it', { kind: 'soft', icon: 'sparkle', type: 'submit', disabled: !ready, tip: ready ? undefined : notReady }),
        h('span', { class: 'small muted' }, provider === 'api'
          ? 'Writes one sample answer with your best resume. Each try costs a few cents.'
          : 'Writes one sample answer with your best resume. It takes about 5 seconds and uses your Claude plan.')),
      out),
    callout('neutral', 'Only open-ended questions (like "Why do you want to work here?") use AI. It writes only from your resume and profile. Claude Code runs with every tool turned off, so nothing in a job posting can make it act on your computer.'));
}

function aiTestResult(r) {
  const via = r.provider === 'api' ? 'API key' : r.provider ? 'Claude Code' : '';
  return h('div', { class: 'ai-result' },
    h('div', { class: 'draft' },
      h('div', { class: 'draft-q' }, r.question),
      h('div', { class: 'draft-a' }, r.answer)),
    h('div', { class: 'small muted', style: { marginTop: '6px' } }, [
      via && `Through ${via}`,
      r.model && `Model: ${r.model}`,
      r.resume && `Resume: ${r.resume}`,
      r.ms != null && `${(r.ms / 1000).toFixed(1)} seconds`,
    ].filter(Boolean).join(' · ')));
}

async function saveSettingsNow() {
  const s = E.settings;
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  const problems = [];
  const caps = {};
  for (const [k, v] of Object.entries(s.dailyCaps || {})) { const n = num(v); if (!Number.isFinite(n) || n < 0) problems.push(`Daily limit for ${k} needs a number of 0 or more.`); caps[k] = Math.round(n); }
  const pMin = num(s.pauseSeconds?.[0]); const pMax = num(s.pauseSeconds?.[1]);
  if (!Number.isFinite(pMin) || !Number.isFinite(pMax) || pMin < 0 || pMax < 0) problems.push('Both pause times need a number of 0 or more.');
  else if (pMin > pMax) problems.push('The shortest pause cannot be longer than the longest pause.');
  const per = num(s.perSearchLimit);
  if (!Number.isFinite(per) || per < 1) problems.push('Jobs per search needs a number of 1 or more.');
  const tabs = num(s.maxOpenTabs);
  if (!Number.isFinite(tabs) || tabs < 1) problems.push('Open tabs before Apply pauses needs a number of 1 or more.');
  const port = num(s.cdpPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) problems.push('The Chrome port needs to be a whole number from 1024 to 65535.');
  if (problems.length) { toast(problems[0], 'error'); return false; }
  const patch = {
    saveOnSite: !!s.saveOnSite, skipSenior: !!s.skipSenior, perSearchLimit: Math.round(per),
    excludeCompanies: s.excludeCompanies || [], excludeTitleWords: s.excludeTitleWords || [],
    dailyCaps: caps, pauseSeconds: [pMin, pMax], maxOpenTabs: Math.round(tabs), cdpPort: port,
    autoSyncResumes: s.autoSyncResumes !== false,
    ai: { ...(s.ai || {}) },
  };
  const res = await api('PUT', '/api/settings', patch).catch(() => null);
  if (!res) return false;
  S.settings = res;
  if (S.state) S.state.settings = res;
  E.settings = clone(res);
  markDirty('settings', false);
  toast('Settings saved.', 'success');
  renderTopbar();
  if (S.tab === 'settings') rerender();
  fetchAiInfo();
  return true;
}

// =================================================================== boot

async function boot() {
  view = $('#view');
  initTooltips();
  buildNav();
  bindTopbar();
  bindLog();
  renderTopbar();

  let st = null;
  while (!st) {
    try { st = await api('GET', '/api/state', undefined, { quiet: true }); } catch {
      view.replaceChildren(h('div', { class: 'view-inner' }, emptyState({ icon: 'alert', title: 'Waiting for JobPilot', text: 'This page could not reach JobPilot. Start it in your terminal with npm start. This page connects as soon as it is running.' })));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  applyState(st);
  S.booted = true;
  connectEvents();
  setInterval(pollState, 4000);
  setInterval(() => { if (!S.state?.runner?.task) renderTopbar(); }, 30000);
  loadProfileData().then(() => renderNav()).catch(() => {});

  window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t && t !== S.tab) show(t); else if (!t) go('setup'); });
  window.addEventListener('beforeunload', (e) => { if (Object.values(S.dirty).some(Boolean)) { e.preventDefault(); e.returnValue = ''; } });
  window.matchMedia('(max-width: 1100px)').addEventListener?.('change', renderNav);

  const first = tabFromHash() || (setupComplete() ? 'jobs' : 'setup');
  if (location.hash !== `#${first}`) history.replaceState(null, '', `#${first}`);
  show(first);
}

boot();
