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
import { skillAnswer, isSkillQuestion } from './skills.mjs';

/** Lowercase words and numbers only. Letters in any language are kept, so a question in Chinese or Spanish still has words to match. */
export function normalizeLabel(s) {
  return String(s || '')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\((optional|required)\)/g, ' ')
    .replace(/\b(required|optional)$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const DECLINE = 'Decline to self-identify';
// written the way normalizeLabel leaves option text ("I don't wish" becomes "i don t wish")
const DECLINE_OPTS = ['decline', 'prefer not', 'prefer to not', 'rather not', 'choose not', 'do not wish', 'don t wish', 'not wish to', 'do not want', 'don t want', 'wish to answer', 'not to (say|answer|disclose|identify)'];

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DEGREES = ["Bachelor's", "Master's", 'PhD', "Associate's", 'High school', 'Certificate', 'Other'];

// Sections you can add as many entries to as you like. The first entry is the
// one single-answer questions use ("School", "Current employer"), so put your
// highest degree and your current or most recent job first.
export const PROFILE_LISTS = [
  { key: 'education', title: 'Education', item: 'education', fields: [
    ['school', 'School', 'text'], ['degree', 'Degree', 'select', DEGREES], ['major', 'Major / field of study', 'text'],
    ['gpa', 'GPA', 'text'], ['startYear', 'Start year', 'text'], ['gradMonth', 'Graduation month', 'select', MONTHS],
    ['gradYear', 'Graduation year', 'text']] },
  { key: 'experience', title: 'Experience', item: 'job', fields: [
    ['company', 'Company', 'text'], ['title', 'Title', 'text'], ['location', 'Location', 'text'],
    ['start', 'Start date', 'text'], ['end', 'End date', 'text'], ['description', 'What you did', 'textarea']] },
  { key: 'projects', title: 'Projects', item: 'project', fields: [
    ['name', 'Project name', 'text'], ['link', 'Link', 'text'], ['description', 'What it does', 'textarea']] },
  { key: 'certifications', title: 'Certifications', item: 'certification', fields: [
    ['name', 'Certification', 'text'], ['issuer', 'Issued by', 'text'], ['year', 'Year', 'text']] },
  { key: 'links', title: 'Other links', item: 'link', fields: [['label', 'What it is', 'text'], ['url', 'URL', 'text']] },
];

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Profile with every list present and cleaned (empty entries dropped), plus the
 * single fields older code and forms read (school, currentCompany, ...) kept in
 * step with the first entries. A profile saved before lists existed is moved
 * into them once, so nothing anyone filled in is lost.
 */
export function normalizeProfile(p = {}) {
  const out = { ...p };
  if (!Array.isArray(out.education) && ['school', 'degree', 'major', 'gpa', 'gradMonth', 'gradYear'].some((k) => !blank(p[k]))) {
    out.education = [{ school: p.school, degree: p.degree, major: p.major, gpa: p.gpa, gradMonth: p.gradMonth, gradYear: p.gradYear }];
  }
  if (!Array.isArray(out.experience) && (!blank(p.currentCompany) || !blank(p.currentTitle))) {
    out.experience = [{ company: p.currentCompany, title: p.currentTitle }];
  }
  for (const list of PROFILE_LISTS) {
    const keys = list.fields.map(([k]) => k);
    out[list.key] = (Array.isArray(out[list.key]) ? out[list.key] : [])
      .filter((e) => e && typeof e === 'object')
      .map((e) => Object.fromEntries(keys.map((k) => [k, blank(e[k]) ? '' : String(e[k]).trim()])))
      .filter((e) => keys.some((k) => e[k]));
  }
  const edu = out.education[0] || {};
  const job = out.experience[0] || {};
  Object.assign(out, {
    school: edu.school || '', degree: edu.degree || '', major: edu.major || '', gpa: edu.gpa || '',
    gradMonth: edu.gradMonth || '', gradYear: edu.gradYear || '',
    currentCompany: job.company || '', currentTitle: job.title || '',
  });
  return out;
}

const yn = (v) => (v === true || /^y/i.test(String(v)) ? 'Yes' : v === false || /^n/i.test(String(v)) ? 'No' : '');

// option regexes for picking among a select/radio's choices (option text is normalized first)
const OPT = {
  Yes: ['^yes\\b', '^y$', 'i am authorized(?!.*\\b(but|require|requires|sponsor\\w*)\\b)', '\\bi will(?! not\\b)', '^true$'],
  No: ['^no\\b', '^n$', '\\bi do not\\b', '\\bi don t\\b', '\\bi will not\\b', '\\bi won t\\b', '\\bi am not\\b', '^false$'],
};
const OPT_RE = { Yes: OPT.Yes.map((p) => new RegExp(p, 'i')), No: OPT.No.map((p) => new RegExp(p, 'i')) };

function optionsFor(value) {
  if (value === DECLINE || /decline|prefer not/i.test(String(value))) return DECLINE_OPTS;
  if (value === 'Yes') return OPT.Yes;
  if (value === 'No') return OPT.No;
  return [];
}

// Questions longer than this many words only match profile answers whose
// pattern is written for long questions (or that must start the question), so
// "Tell us about an excellent project" never gets your phone number.
const LONG_WORDS = 8;
// your education entries are college ones: "High school GPA" or "High school
// graduation year" is not answered from them
const notHighSchool = (pattern) => `^(?!.*\\bhigh school\\b).*?(?:${pattern})`;

/**
 * Turns profile.json into answer entries. Empty profile fields add nothing.
 * Each entry: `pattern` for short labels; `long` is the pattern used for labels
 * over LONG_WORDS words (true: same pattern; omitted: only its ^ parts);
 * `fact` marks the yes/no facts a consent box must never contradict.
 */
export function profileAnswers(profile = {}) {
  const p = normalizeProfile(profile);
  const out = [];
  const add = (q, pattern, answer, extra = {}) => {
    if (answer === undefined || answer === null || String(answer).trim() === '') return;
    out.push({ q, pattern, answer: String(answer), options: extra.options || optionsFor(String(answer)), ...extra, source: 'profile' });
  };
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const city = [p.city, p.state].filter(Boolean).join(', ');

  add('first name', '^(legal )?first name|^given name|^first$', p.firstName);
  add('last name', '^(legal )?last name|^family name|^surname|^last$', p.lastName);
  add('preferred name', '\\bpreferred (first )?name\\b|\\bname you go by\\b|\\bnickname\\b', p.preferredName || p.firstName, { long: true });
  add('full name', '^(full |legal |your )?name$|^full name|^legal name|\\bsignature\\b', full,
    { long: '^full name|^legal name|^signature\\b|\\b(type|enter|sign) your (full |legal )?name\\b|\\b(electronic|digital|e) signature\\b' });
  add('email', '\\be ?mail\\b', p.email, { long: '^e ?mail\\b|\\be ?mail address\\b|\\byour e ?mail\\b' });
  add('phone type', '\\bphone (device )?type\\b|\\btype of phone\\b', 'Mobile', { options: ['mobile', 'cell'], long: true });
  add('phone', '\\b(tele|cell)?phone\\b|^(mobile|cell)( number| no)?$|\\b(mobile|cell|contact) number\\b', p.phone,
    { long: '^(tele|cell)?phone\\b|\\b(tele|cell)?phone number\\b|\\b(mobile|cell|contact) number\\b' });
  add('city', '^city$|^current city|\\bcity (and |or )?state\\b|^location$|\\bcurrent location\\b|\\bwhere are you (currently )?(located|based)\\b|^city of residence', city,
    { typeaheadAnswer: p.city, first: true, long: '\\bcurrent (city|location)\\b|\\bwhere are you (currently )?(located|based|living)\\b|\\bcity (and |or )?state\\b|\\bcity of residence\\b' });
  add('state', '^state$|^state (or )?province|^province|^region$|\\bstate of residence\\b', p.state, { long: true });
  add('country', '^country', p.country);
  add('zip', '\\bzip( ?code)?\\b|\\bpostal\\b|\\bpostcode\\b', p.zip, { long: true });
  add('address', '^(street )?address(?! line 2| 2)|\\baddress line 1\\b', p.address,
    { long: '^(street )?address(?! line 2| 2)|\\baddress line 1\\b|\\b(street|home|mailing|residential) address\\b' });
  add('linkedin', '\\blinkedin\\b', p.linkedin, { long: '^linkedin\\b|\\blinkedin (profile|url|link|page|account)\\b|\\b(url|link) (to|for) your linkedin\\b' });
  add('github', '\\bgithub\\b', p.github, { long: '^github\\b|\\bgithub (profile|url|link|page|account|username)\\b|\\b(url|link) (to|for) your github\\b' });
  add('portfolio', '\\bportfolio\\b|\\bpersonal (web)?site\\b|^website|\\bother website\\b|^url', p.portfolio || p.github, { long: true });
  // major before school, so "College major" is the major and not the college
  add('major', '^majors?\\b|\\b(your|intended|declared|primary|academic|college|university) majors?\\b|\\bmajor (or |and )?(minor|field|concentration)\\b|\\bfield of study\\b|\\barea of study\\b|^discipline\\b|\\bacademic discipline\\b|^concentration\\b', p.major, { long: true });
  add('school', notHighSchool('\\b(school|university|college|institution)\\b'), p.school,
    { long: notHighSchool('^(school|university|college)\\b|\\b(which|what) (school|university|college)\\b|\\bname of (your |the )?(school|university|college|institution)\\b|\\b(school|university|college) (do|did) you (attend|go to)\\b') });
  add('degree', '^degree|\\bhighest (level of )?(education|degree)\\b|\\beducation level\\b|\\blevel of education\\b', p.degree, { long: true });
  add('gpa', notHighSchool('\\bgpa\\b|\\bgrade point\\b'), p.gpa, { long: true });
  // a graduation "date" gets month and year; a graduation "year" gets the year only
  add('grad date', notHighSchool('\\bgraduation (date|month and year|month year|term)\\b|\\b(month and year|date) of graduation\\b|\\b(expected|anticipated|estimated) graduation\\b(?! (year|month)\\b)|\\bwhen (do|will) you (expect to )?graduate\\b|^graduation$'),
    [p.gradMonth, p.gradYear].filter(Boolean).join(' ') || p.gradYear, { long: true });
  add('grad month', notHighSchool('\\bgraduation month\\b|\\bmonth of graduation\\b'), p.gradMonth, { long: true });
  add('grad year', notHighSchool('\\bgraduation year\\b|\\byear of graduation\\b|\\bgrad(uating)? year\\b|\\bclass year\\b|\\bwhat year (do|will) you (expect to )?graduate\\b'), p.gradYear, { long: true });
  add('current company', '\\b(current|most recent|present) (company|employer)\\b|^company( name)?$|^(current )?employer\\b', p.currentCompany,
    { long: '^(current |most recent )?(company|employer)\\b|\\b(current|most recent) (company|employer)( name)?$|\\b(what is|enter|name of) (your |the )?(current|most recent) (company|employer)\\b|\\bcurrent or most recent (company|employer)\\b' });
  add('current title', '\\b(current|most recent|present) (job )?(title|role|position)\\b|^title$|^job title\\b|\\byour (current )?job title\\b', p.currentTitle,
    { long: '^(current |most recent )?(job )?title\\b|\\b(what is|enter) your (current |most recent )?(job )?title\\b|\\bcurrent or most recent (job )?title\\b' });
  add('certifications', '\\bcertifications?\\b|\\blicen[cs]es? (and|or) certifications?\\b', p.certifications.map((c) => [c.name, c.issuer && `(${c.issuer})`].filter(Boolean).join(' ')).join(', '),
    { long: '^(list )?(your )?(relevant |professional )?certifications?\\b|\\blicen[cs]es? (and|or) certifications?\\b|\\b(list|what are) (any |all )?(of )?your (relevant |professional )?certifications\\b' });
  add('years of experience', '\\byears of (professional |relevant |work |total )?experience\\b|\\bhow many years\\b', p.yearsExperience,
    { long: '\\byears of (professional |relevant |work |total )?experience\\b|\\bhow many years (of|have you)\\b' });

  const auth = yn(p.workAuthorized);
  add('work authorization', '\\bauthori[sz]ed to work\\b|\\blegally (authori[sz]ed|eligible|able|permitted) to work\\b|\\bwork authori[sz]ation\\b|\\beligible to work\\b|\\bright to work\\b', auth, { long: true, fact: true });
  const spon = yn(p.needsSponsorship);
  add('sponsorship', '\\bsponsor(s|ed|ing|ship)?\\b|\\bvisa (support|status change)\\b|\\brequire (a )?visa\\b|\\bh ?1 ?b\\b', spon, { long: true, fact: true });
  add('visa status', '\\bcitizenship\\b|\\bvisa status\\b|\\bimmigration status\\b|\\bwork permit\\b|\\bwhat is your (current )?status\\b', p.visaStatus, { long: true, fact: true });
  add('over 18', '\\b18 years\\b|\\bover 18\\b|\\bat least 18\\b|\\b18 or older\\b|\\bage of 18\\b|\\blegal age\\b', yn(p.over18), { long: true, fact: true });
  add('relocate', '\\brelocat', yn(p.willingToRelocate), { long: true });
  add('remote', '\\bopen to remote\\b|\\bwork remotely\\b|\\bremote work\\b', yn(p.openToRemote), { long: true });
  add('onsite', '\\bon ?site\\b|\\bin office\\b|\\bin person\\b|\\bhybrid\\b|\\bcommut|\\bdays (a|per) week in\\b', yn(p.openToOnsite), {
    long: '\\b(work|working|be|being|come|report|commute|able|available|willing|comfortable)\\b.{0,30}\\b(on ?site|in (the |our )?office|in person)\\b'
      + '|\\b(on ?site|in (the |our )?office|in person)\\b.{0,60}\\b(able|willing|comfortable|ok|okay)\\b'
      + '|\\bhybrid (role|position|schedule|work|model|arrangement)\\b|\\bwork(ing)? hybrid\\b|\\bcommut|\\bdays (a|per) week in\\b',
  });
  add('start date', '\\bstart date\\b|\\bwhen can you start\\b|\\bavailable to start\\b|\\bearliest (start|availability)\\b', p.startDate, { long: true });
  add('notice', '\\bnotice period\\b', p.noticePeriod, { long: true });
  add('salary', '\\bsalary\\b|\\bcompensation\\b|\\bpay (expectation|requirement)s?\\b|\\bdesired (pay|rate)\\b', p.salary, { long: true });
  add('pronouns', '\\bpronouns?\\b', p.pronouns, { long: true });
  add('how heard', '^how did you hear\\b|\\bhow did you (hear|find out|learn) about\\b|\\bhow did you find (us|this)\\b|\\bwhere did you (hear|find|see|learn) (about )?(us|this|the)\\b|\\breferral source\\b|^source$', p.howHeard || 'LinkedIn', { long: true });

  // voluntary self-identification: default to declining unless the user chose
  const eeo = (v) => v || DECLINE;
  add('gender', '^gender|\\bgender identity\\b|\\byour gender\\b|^sex$', eeo(p.gender), { long: true });
  add('transgender', '\\btransgender\\b', eeo(p.transgender), { long: true });
  add('orientation', '\\bsexual orientation\\b', eeo(p.orientation), { long: true });
  add('hispanic', '\\bhispanic\\b|\\blatin[oax]\\b|\\blatinx\\b', eeo(p.hispanic), { long: true });
  add('race', '\\brace\\b|\\bethnicit|\\bethnic background\\b', eeo(p.race), { long: '^race\\b|\\b(your|which|what) race\\b|\\brace (or |and )?ethnicity\\b|\\bethnicit|\\bethnic background\\b' });
  add('veteran', '\\bveteran', eeo(p.veteran), { long: true });
  add('disability', '\\bdisabilit', eeo(p.disability), { long: true });
  return out;
}

/** The top-level alternatives of a pattern that begin with ^, or null. */
function anchoredPart(pattern) {
  const parts = [];
  let cur = '', depth = 0, inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { cur += c + (pattern[i + 1] || ''); i++; continue; }
    if (inClass) { if (c === ']') inClass = false; } else if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const kept = parts.filter((x) => x.startsWith('^'));
  return kept.length ? kept.join('|') : null;
}

function compile(entries, from) {
  return entries.map((e, i) => {
    let re, longRe = null;
    try {
      re = new RegExp(e.pattern, 'i');
      if (e.source === 'profile') {
        const src = e.long === true ? e.pattern : typeof e.long === 'string' ? e.long : anchoredPart(e.pattern);
        longRe = src ? new RegExp(src, 'i') : null;
      }
    } catch (err) { throw new Error(`${from} entry ${i} ("${e.q || e.pattern}") has a bad pattern: ${err.message}`); }
    return { ...e, re, longRe };
  });
}

/** False for entries that would answer every question: no pattern, just "^", or one that matches anything. */
function usableEntry(e) {
  if (!e || typeof e !== 'object') return false;
  const p = String(e.pattern ?? '').trim();
  if (!p || p === '^') return false;
  try { const re = new RegExp(p, 'i'); return !(re.test('') && re.test('zq unrelated words 42')); } catch { return true; } // compile reports bad ones
}

/**
 * The bank in priority order: answers.json (your overrides), then skill
 * questions ("years with React?") from profile.skills, then profile answers.
 */
export function loadAnswerBank(ws) {
  const own = readJson(ws.answers, []);
  const profile = readJson(ws.profile, {});
  const bank = [...compile((Array.isArray(own) ? own : []).filter(usableEntry), 'answers.json'), ...compile(profileAnswers(profile), 'profile')];
  bank.skills = Array.isArray(profile.skills) ? profile.skills : [];
  return bank;
}

// A tick box that also states a fact ("I confirm I will not need sponsorship",
// "I am at least 18") or signs you up for messages. A tick-the-box answer only
// covers it when that answer's own pattern names the topic, and never when a
// profile fact (work authorization, sponsorship, visa, age) answers it.
const STATEMENT_TOPIC = /\b(sponsor\w*|visa|authori[sz]\w*|citizen\w*|eligib\w*|18|age|sms|text messag\w*|marketing|promotional|newsletter)\b/;
function tickCovers(entry, n, bank) {
  if (bank.some((a) => a.source === 'profile' && a.fact && a.re.test(n))) return false;
  return !STATEMENT_TOPIC.test(n) || STATEMENT_TOPIC.test(String(entry.pattern).toLowerCase());
}

// "I do not require sponsorship" states the opposite of the question a Yes/No
// answer is for, so it is never answered from Yes/No; it goes to Questions.
const FIRST_PERSON = /^(i|i m|by (checking|clicking|ticking|selecting|submitting))\b/;
const NEGATION = /\b(not|never|no longer|don t|won t|can t|cannot|isn t|aren t|doesn t|didn t|haven t|wouldn t)\b/;
const negatedStatement = (n) => FIRST_PERSON.test(n) && NEGATION.test(n);

/**
 * The answer for a question, or null. opts.essay (an open-ended question or a
 * long text box): only your own answers.json entries and skills are used,
 * never profile facts, so AI or you can write the answer instead.
 */
export function matchAnswer(bank, label, { essay = false } = {}) {
  const n = normalizeLabel(label);
  if (!n) return null;
  for (const a of bank) {
    if (a.source === 'profile' || !a.re.test(n)) continue;
    if (a.type === 'check' && !tickCovers(a, n, bank)) continue;
    return a;
  }
  const sk = skillAnswer(String(label), bank.skills || []);
  if (sk) return sk;
  // a skill question with no skills in the profile is unknown, not "0 years"
  if (isSkillQuestion(String(label))) return null;
  if (essay) return null;
  const long = n.split(' ').length > LONG_WORDS;
  for (const a of bank) {
    if (a.source !== 'profile') continue;
    const re = long ? a.longRe : a.re;
    if (!re || !re.test(n)) continue;
    if (/^(yes|no)$/i.test(a.answer) && negatedStatement(n)) return null;
    return a;
  }
  return null;
}

// one-word answers where a looser "contains" match picks the wrong option ("male" is inside "female")
const SHORT_ANSWER = /^(yes|no|y|n|true|false|male|female|man|woman|other|none|na|n a)$/;
const startsWords = (a, b) => a === b || a.startsWith(b + ' ');
const hasWords = (a, b) => ` ${a} `.includes(` ${b} `);
const readsBothWays = (t) => OPT_RE.Yes.some((re) => re.test(t)) && OPT_RE.No.some((re) => re.test(t));

/** Index of the option to pick for this answer, or -1. */
export function pickOption(optionTexts, entry) {
  const normed = optionTexts.map(normalizeLabel);
  const ans = normalizeLabel(entry.answer || '');
  // an option that reads as both Yes and No ("Yes, I will not need it") is never a Yes/No pick
  const yesNo = ans === 'yes' || ans === 'no';
  const fits = (t) => t && !(yesNo && readsBothWays(t));
  for (const p of entry.options || []) {
    let re; try { re = new RegExp(p, 'i'); } catch { continue; }
    const i = normed.findIndex((t) => fits(t) && re.test(t));
    if (i >= 0) return i;
  }
  if (!ans) return -1;
  let i = normed.findIndex((t) => t === ans);
  if (i >= 0) return i;
  // whole words only: "No" never picks "Not applicable"
  i = normed.findIndex((t) => fits(t) && (startsWords(t, ans) || startsWords(ans, t)));
  if (i >= 0) return i;
  if (SHORT_ANSWER.test(ans) || ans.length < 4) return -1;
  return normed.findIndex((t) => fits(t) && t.length > 2 && (hasWords(t, ans) || hasWords(ans, t)));
}

/** Saves an answer the user typed in the dashboard for a queued question. */
export function addAnswer(ws, { question, answer, type }) {
  const saved = readJson(ws.answers, []);
  const own = Array.isArray(saved) ? saved : [];
  const n = normalizeLabel(question);
  // an empty pattern ("^") would answer every question on every form
  if (!n) throw new Error('This question has no words to match on, so the answer was not saved. Add it on the Answers tab with your own pattern.');
  const pattern = '^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').slice(0, 12).join(' ');
  const entry = { q: String(question).slice(0, 80), pattern, answer: String(answer) };
  if (type) entry.type = type;
  const left = own.filter((e) => e.pattern !== pattern);
  left.unshift(entry);
  writeJson(ws.answers, left);
  return entry;
}

export function hasFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
