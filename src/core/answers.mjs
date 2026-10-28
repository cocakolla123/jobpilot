// The answer bank: how a form question becomes an answer.
//
// Two layers, checked in order:
//   1. answers.json: your own entries ({pattern, answer, options?, type?}),
//      for company-specific or unusual questions. First match wins.
//   2. Answers built from profile.json: name, contact, links, school, work
//      authorization, sponsorship, start date, salary, and the voluntary
//      self-identification questions. You fill the profile once in the
//      dashboard; these patterns cover the questions almost every form asks.
// A question that matches neither is never guessed: it goes to the review
// queue, you answer it once in the dashboard, and it is saved to answers.json.
import fs from 'node:fs';
import { readJson, writeJson } from './config.mjs';
import { skillAnswer } from './skills.mjs';

export function normalizeLabel(s) {
  return String(s || '')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\((optional|required)\)/g, ' ')
    .replace(/\b(required|optional)$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const DECLINE = 'Decline to self-identify';
const DECLINE_OPTS = ['decline', 'prefer not', 'do not wish', "don't wish", 'not wish to', 'choose not', 'not to (say|answer|disclose|identify)'];

export const PROFILE_FIELDS = [
  // [key, label, kind, extra]
  ['firstName', 'First name', 'text'],
  ['lastName', 'Last name', 'text'],
  ['preferredName', 'Preferred name', 'text'],
  ['email', 'Email', 'text'],
  ['phone', 'Phone', 'text'],
  ['city', 'City', 'text'],
  ['state', 'State / province', 'text'],
  ['country', 'Country', 'text'],
  ['zip', 'ZIP / postal code', 'text'],
  ['address', 'Street address', 'text'],
  ['linkedin', 'LinkedIn URL', 'text'],
  ['github', 'GitHub URL', 'text'],
  ['portfolio', 'Portfolio / website', 'text'],
  ['school', 'School', 'text'],
  ['degree', 'Degree', 'select', ["Bachelor's", "Master's", 'PhD', "Associate's", 'High school', 'Other']],
  ['major', 'Major / field of study', 'text'],
  ['gpa', 'GPA', 'text'],
  ['gradMonth', 'Graduation month', 'select', ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']],
  ['gradYear', 'Graduation year', 'text'],
  ['currentCompany', 'Current or most recent employer', 'text'],
  ['currentTitle', 'Current or most recent title', 'text'],
  ['yearsExperience', 'Years of professional experience', 'text'],
  ['workAuthorized', 'Authorized to work in the US?', 'yesno'],
  ['needsSponsorship', 'Will you need visa sponsorship now or later?', 'yesno'],
  ['visaStatus', 'Citizenship / visa status', 'select', ['US citizen', 'Green card holder', 'F-1 OPT', 'F-1 STEM OPT', 'H-1B', 'TN', 'Other']],
  ['over18', 'Are you 18 or older?', 'yesno'],
  ['willingToRelocate', 'Willing to relocate?', 'yesno'],
  ['openToRemote', 'Open to remote work?', 'yesno'],
  ['openToOnsite', 'Open to working on site / hybrid?', 'yesno'],
  ['startDate', 'Earliest start date', 'text'],
  ['noticePeriod', 'Notice period', 'text'],
  ['salary', 'Desired salary (number)', 'text'],
  ['pronouns', 'Pronouns', 'text'],
  ['howHeard', 'How did you hear about us? (default answer)', 'text'],
  ['aboutMe', 'A few lines about you and the work you want next (only used to write AI answers)', 'textarea'],
  ['gender', 'Gender', 'select', ['Male', 'Female', 'Non-binary', DECLINE]],
  ['transgender', 'Do you identify as transgender?', 'select', ['Yes', 'No', DECLINE]],
  ['orientation', 'Sexual orientation', 'select', ['Heterosexual', 'Gay or lesbian', 'Bisexual', 'Other', DECLINE]],
  ['hispanic', 'Hispanic or Latino?', 'select', ['Yes', 'No', DECLINE]],
  ['race', 'Race / ethnicity', 'select', ['Asian', 'Black or African American', 'White', 'Hispanic or Latino', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander', 'Two or more races', DECLINE]],
  ['veteran', 'Veteran status', 'select', ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', DECLINE]],
  ['disability', 'Disability status', 'select', ['No, I do not have a disability', 'Yes, I have a disability', DECLINE]],
];

const yn = (v) => (v === true || /^y/i.test(String(v)) ? 'Yes' : v === false || /^n/i.test(String(v)) ? 'No' : '');

// option regexes for picking among a select/radio's choices
const OPT = {
  Yes: ['^yes', '^y$', 'i am authorized', 'i will', '^true'],
  No: ['^no\\b', '^n$', 'i do not', 'i will not', '^false'],
};

function optionsFor(value) {
  if (value === DECLINE || /decline|prefer not/i.test(String(value))) return DECLINE_OPTS;
  if (value === 'Yes') return OPT.Yes;
  if (value === 'No') return OPT.No;
  return [];
}

/** Turns profile.json into answer entries. Empty profile fields add nothing. */
export function profileAnswers(p = {}) {
  const out = [];
  const add = (q, pattern, answer, extra = {}) => {
    if (answer === undefined || answer === null || String(answer).trim() === '') return;
    out.push({ q, pattern, answer: String(answer), options: extra.options || optionsFor(String(answer)), ...extra, source: 'profile' });
  };
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const city = [p.city, p.state].filter(Boolean).join(', ');

  add('first name', '^(legal )?first name|^given name|^first$', p.firstName);
  add('last name', '^(legal )?last name|^family name|^surname|^last$', p.lastName);
  add('preferred name', 'preferred (first )?name|name you go by|nickname', p.preferredName || p.firstName);
  add('full name', '^(full |legal |your )?name$|^full name|^legal name|signature', full);
  add('email', '\\be ?mail\\b', p.email);
  add('phone type', 'phone (device )?type|type of phone', 'Mobile', { options: ['mobile', 'cell'] });
  add('phone', 'phone|mobile|cell', p.phone);
  add('city', '^city$|^current city|city and state|^location$|current location|where are you (currently )?(located|based)|^city of residence', city, { typeaheadAnswer: p.city, first: true });
  add('state', '^state$|^state (or )?province|^province|^region$|state of residence', p.state);
  add('country', '^country', p.country);
  add('zip', 'zip|postal', p.zip);
  add('address', '^(street )?address(?! 2)|address line 1', p.address);
  add('linkedin', 'linkedin', p.linkedin);
  add('github', 'github', p.github);
  add('portfolio', 'portfolio|personal (web)?site|^website|other website|^url', p.portfolio || p.github);
  add('school', 'school|university|college|institution', p.school);
  add('degree', '^degree|highest (level of )?(education|degree)|education level', p.degree);
  add('major', 'major|field of study|discipline|concentration', p.major);
  add('gpa', '\\bgpa\\b|grade point', p.gpa);
  add('grad month', 'graduation month|month of graduation', p.gradMonth);
  add('grad year', 'graduation year|year of graduation|expected graduation|graduation date|when do you graduate', [p.gradMonth, p.gradYear].filter(Boolean).join(' ') || p.gradYear);
  add('current company', 'current (company|employer)|most recent (company|employer)|^company$|^employer', p.currentCompany);
  add('current title', 'current (title|role|position)|most recent (title|role)|^title$|job title', p.currentTitle);
  add('years of experience', 'years of (professional |relevant |work )?experience|how many years', p.yearsExperience);

  const auth = yn(p.workAuthorized);
  add('work authorization', 'authori[sz]ed to work|legally (authorized|eligible|able) to work|work authori[sz]ation|eligible to work|right to work', auth);
  const spon = yn(p.needsSponsorship);
  add('sponsorship', 'sponsor|visa (support|status change)|require (a )?visa|h ?1 ?b', spon);
  add('visa status', 'citizenship|visa status|immigration status|work permit|what is your (current )?status', p.visaStatus);
  add('over 18', '18 years|over 18|at least 18|legal age', yn(p.over18));
  add('relocate', 'relocat', yn(p.willingToRelocate));
  add('remote', 'open to remote|work remotely|remote work', yn(p.openToRemote));
  add('onsite', 'on ?site|in office|in person|hybrid|commute|days a week in', yn(p.openToOnsite));
  add('start date', 'start date|when can you start|available to start|earliest (start|availability)', p.startDate);
  add('notice', 'notice period', p.noticePeriod);
  add('salary', 'salary|compensation|pay (expectation|requirement)|desired (pay|rate)', p.salary);
  add('pronouns', 'pronoun', p.pronouns);
  add('how heard', 'how did you (hear|find|learn)|where did you (hear|find)|referral source|^source$', p.howHeard || 'LinkedIn');

  // voluntary self-identification: default to declining unless the user chose
  const eeo = (v) => v || DECLINE;
  add('gender', '^gender|gender identity|^sex$', eeo(p.gender));
  add('transgender', 'transgender', eeo(p.transgender));
  add('orientation', 'sexual orientation', eeo(p.orientation));
  add('hispanic', 'hispanic|latino|latinx', eeo(p.hispanic));
  add('race', '\\brace\\b|ethnicity|ethnic background', eeo(p.race));
  add('veteran', 'veteran', eeo(p.veteran));
  add('disability', 'disabilit', eeo(p.disability));
  return out;
}

function compile(entries, from) {
  return entries.map((e, i) => {
    let re;
    try { re = new RegExp(e.pattern, 'i'); }
    catch (err) { throw new Error(`${from} entry ${i} ("${e.q || e.pattern}") has a bad pattern: ${err.message}`); }
    return { ...e, re };
  });
}

/**
 * The bank in priority order: answers.json (your overrides), then skill
 * questions ("years with React?") from profile.skills, then profile answers.
 */
export function loadAnswerBank(ws) {
  const own = readJson(ws.answers, []);
  const profile = readJson(ws.profile, {});
  const bank = [...compile(Array.isArray(own) ? own : [], 'answers.json'), ...compile(profileAnswers(profile), 'profile')];
  bank.skills = Array.isArray(profile.skills) ? profile.skills : [];
  return bank;
}

export function matchAnswer(bank, label) {
  const n = normalizeLabel(label);
  if (!n) return null;
  for (const a of bank) if (a.source !== 'profile' && a.re.test(n)) return a;
  const sk = skillAnswer(String(label), bank.skills || []);
  if (sk) return sk;
  for (const a of bank) if (a.source === 'profile' && a.re.test(n)) return a;
  return null;
}

/** Index of the option to pick for this answer, or -1. */
export function pickOption(optionTexts, entry) {
  const normed = optionTexts.map(normalizeLabel);
  for (const p of entry.options || []) {
    let re; try { re = new RegExp(p, 'i'); } catch { continue; }
    const i = normed.findIndex((t) => re.test(t));
    if (i >= 0) return i;
  }
  const ans = normalizeLabel(entry.answer || '');
  if (!ans) return -1;
  let i = normed.findIndex((t) => t === ans);
  if (i >= 0) return i;
  i = normed.findIndex((t) => t && (t.startsWith(ans) || ans.startsWith(t)));
  if (i >= 0) return i;
  return normed.findIndex((t) => t && t.length > 2 && (t.includes(ans) || ans.includes(t)));
}

/** Saves an answer the user typed in the dashboard for a queued question. */
export function addAnswer(ws, { question, answer, type }) {
  const own = readJson(ws.answers, []);
  const n = normalizeLabel(question);
  const pattern = '^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').slice(0, 12).join(' ');
  const entry = { q: question.slice(0, 80), pattern, answer: String(answer) };
  if (type) entry.type = type;
  const left = own.filter((e) => e.pattern !== pattern);
  left.unshift(entry);
  writeJson(ws.answers, left);
  return entry;
}

export function hasFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
