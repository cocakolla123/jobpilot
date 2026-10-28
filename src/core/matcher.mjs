// Picks the best resume for a job with plain code, no AI.
//
// Two signals, both explainable:
//   1. Role fit: the job title is mapped to role tags (frontend, backend, ml,
//      fde, ...) with a fixed lexicon, and each resume carries tags from its
//      file name (Resume_Frontend.pdf -> frontend) or from resumes.json.
//   2. Content fit: TF-IDF cosine similarity between the posting text and each
//      resume's text, over words and known multiword skills. Terms that every
//      resume shares get little weight, so what separates the resumes counts.
// The final score is 0.55 * role fit + 0.45 * content fit (content scaled to
// the best resume for this job). Ties go to the default resume.

export const ROLE_LEXICON = {
  quant: /\bquant(itative)?\b|\btrading\b|\btrader\b|\balgo(rithmic)? trad/,
  fde: /forward[\s-]?deploy|\bfde\b|solutions? (engineer|architect|consultant)|deployment (engineer|strategist)|implementation (engineer|specialist)|customer (success )?engineer|field engineer|sales engineer|technical consultant/,
  ml: /machine learning|\bml\b|\bmle\b|deep learning|computer vision|\bnlp\b|research (engineer|scientist)|applied scientist|data scien/,
  ai: /\bai\b|\bllm\b|gen ?ai|generative|\bagents?\b|agentic|prompt engineer/,
  frontend: /front[\s-]?end|\bui\b|user interface|web (developer|engineer)|react|javascript (developer|engineer)|design engineer/,
  mobile: /\bios\b|android|mobile|swift|kotlin|react native|flutter/,
  backend: /back[\s-]?end|\bplatform\b|infrastructure|distributed|\bapis?\b|server|microservice/,
  data: /data engineer|analytics engineer|\betl\b|data platform|data pipeline/,
  devops: /devops|\bsre\b|site reliability|cloud engineer|platform engineer|kubernetes/,
  security: /security|appsec|penetration|\bsoc\b|cyber/,
  fullstack: /full[\s-]?stack/,
  annotation: /annotat|data label|ai trainer|rater|evaluat/,
  swe: /software (engineer|developer)|\bswe\b|developer|programmer|engineer/,
};

// file-name hints -> tags (Resume_FDE.pdf, frontend_resume.docx, ...).
// `w(x)` matches x as its own word between _ - . or spaces ("_ML." but not "html").
const w = (x) => new RegExp(`(^|[^a-z0-9])(${x})([^a-z0-9]|$)`, 'i');
const NAME_HINTS = [
  [/quant/i, 'quant'], [w('fde|forward|solutions|deploy(ed|ment)?'), 'fde'], [w('ml|mle|machine'), 'ml'],
  [w('ai|llm|agents?|genai'), 'ai'], [/front/i, 'frontend'], [/backend|back[\s_-]end/i, 'backend'],
  [/ios|android|mobile/i, 'mobile'], [/data[\s_-]?eng/i, 'data'], [/devops|sre|cloud/i, 'devops'],
  [/secur/i, 'security'], [/full[\s_-]?stack/i, 'fullstack'], [/annot|label|rater/i, 'annotation'],
  [/swe|software|general|main/i, 'swe'],
];

// multiword skills kept as single terms
const PHRASES = [
  'machine learning', 'deep learning', 'computer vision', 'natural language processing', 'large language model',
  'react native', 'spring boot', 'ruby on rails', 'google cloud', 'github actions',
  'rest api', 'rest apis', 'data pipeline', 'data pipelines', 'unit test', 'unit tests', 'full stack',
  'front end', 'back end', 'forward deployed', 'distributed systems', 'system design', 'ci cd',
  'feature engineering', 'model evaluation', 'fine tuning', 'vector database', 'prompt engineering',
  'customer facing', 'technical support', 'product management', 'object oriented', 'test driven',
];

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its '
  + 'may me more most my no not of on or our out over own she should so some such than that the their them then there these they this '
  + 'those through to too under up very was we were what when where which while who will with would you your about above after again '
  + 'all also am any because before being below between both during each few further here how just like make many much must new now '
  + 'off once only other same see should since still take than those us use used using via want well work working years year team '
  + 'teams role roles job jobs company including include includes etc plus strong ability experience required preferred responsibilities '
  + 'requirements qualifications skills knowledge understanding looking join help build building across within').split(/\s+/));

// order matters: "node.js" must become "node js" before bare "js" -> javascript
const SYNONYMS = [
  [/\bnode\.?js\b/g, 'nodejs'], [/\bnext\.?js\b/g, 'nextjs'], [/\bvue\.?js\b/g, 'vue'], [/\breact\.?js\b/g, 'react'],
  [/\bjs\b/g, 'javascript'], [/\bts\b/g, 'typescript'], [/\bk8s\b/g, 'kubernetes'], [/\bpostgres\b/g, 'postgresql'],
  [/\bgolang\b/g, 'go'], [/\bc\+\+/g, 'cplusplus'], [/\bc#/g, 'csharp'], [/\.net\b/g, 'dotnet'],
  [/\bci\/cd\b/g, 'ci cd'], [/\bml\b/g, 'machine learning'], [/\bllms?\b/g, 'large language model'],
  [/\bnlp\b/g, 'natural language processing'], [/\bgcp\b/g, 'google cloud'], [/\bfrontend\b/g, 'front end'],
  [/\bbackend\b/g, 'back end'], [/\bfullstack\b/g, 'full stack'],
];

export function tokenize(text) {
  let t = ' ' + String(text || '').toLowerCase() + ' ';
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9+#.\s-]/g, ' ').replace(/-/g, ' ');
  const tokens = [];
  for (const ph of PHRASES) {
    const re = new RegExp(`\\b${ph.replace(/ /g, '\\s+')}\\b`, 'g');
    const hits = t.match(re);
    if (hits) { for (let i = 0; i < hits.length; i++) tokens.push(ph.replace(/ /g, '_')); t = t.replace(re, ' '); }
  }
  for (const w of t.split(/\s+/)) {
    const word = w.replace(/^[.]+|[.]+$/g, '');
    if (word.length < 2 || STOP.has(word) || /^\d+$/.test(word)) continue;
    tokens.push(word);
  }
  return tokens;
}

export function titleTags(title) {
  const t = ' ' + String(title || '').toLowerCase().replace(/[^a-z0-9+#\s-]/g, ' ') + ' ';
  let tags = Object.entries(ROLE_LEXICON).filter(([, re]) => re.test(t)).map(([k]) => k);
  // the most specific role wins: "AI Data Annotator" is annotation work, and
  // "Forward Deployed Engineer" is FDE, not general software engineering
  if (tags.includes('annotation')) tags = tags.filter((x) => !['ai', 'ml', 'data', 'swe'].includes(x));
  if (tags.length > 1) tags = tags.filter((x) => x !== 'swe');
  return tags.length ? tags : ['swe'];
}

export function resumeTags(resume) {
  if (resume.tags?.length) return resume.tags.map((s) => String(s).toLowerCase());
  const tags = NAME_HINTS.filter(([re]) => re.test(resume.file)).map(([, tag]) => tag);
  return tags.length ? [...new Set(tags)] : ['swe'];
}

function tf(tokens) {
  const m = new Map();
  for (const tok of tokens) m.set(tok, (m.get(tok) || 0) + 1);
  return m;
}

// role score for a specialized resume when the job title is just "Software Engineer"
const GENERIC_ROLE = 0.85;

/** Build the matcher once per run from the resumes folder. */
export function buildMatcher(resumes) {
  const docs = resumes.map((r) => ({ ...r, tf: tf(tokenize(`${r.text} ${(r.keywords || []).join(' ')}`)), tagsResolved: resumeTags(r) }));
  const df = new Map();
  for (const d of docs) for (const k of d.tf.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = docs.length || 1;
  const idf = (k) => Math.log((N + 1) / ((df.get(k) || 0) + 1)) + 1;
  const vec = (m) => {
    const v = new Map(); let norm = 0;
    for (const [k, c] of m) { const w = (1 + Math.log(c)) * idf(k); v.set(k, w); norm += w * w; }
    return { v, norm: Math.sqrt(norm) || 1 };
  };
  for (const d of docs) d.vec = vec(d.tf);

  return function match(job) {
    if (!docs.length) return { resume: null, score: 0, ranking: [], jobTags: [] };
    const jobTags = titleTags(job.title);
    const generic = jobTags.length === 1 && jobTags[0] === 'swe';
    const jv = vec(tf(tokenize(`${job.title} ${job.title} ${job.description || ''}`)));
    const rows = docs.map((d) => {
      let dot = 0; const shared = [];
      for (const [k, w] of jv.v) {
        const rw = d.vec.v.get(k);
        if (rw) { dot += w * rw; shared.push([k, w * rw]); }
      }
      const cos = dot / (jv.norm * d.vec.norm);
      // role fit: share of the job's tags this resume covers; a plain
      // software engineer resume is a soft fallback for any engineering title
      const hits = jobTags.filter((t) => d.tagsResolved.includes(t));
      let role = hits.length ? hits.length / jobTags.length : 0;
      if (!hits.length) {
        // A plain "Software Engineer" title says nothing about the kind of
        // work, so any engineering resume gets most of the role score and the
        // posting's text decides. The general resume keeps an edge for close calls.
        if (generic && d.tagsResolved.some((t) => t !== 'annotation')) role = GENERIC_ROLE;
        else if (d.tagsResolved.includes('swe') && jobTags.some((t) => t !== 'annotation')) role = 0.35;
      }
      return {
        file: d.file, path: d.path, name: d.name, isDefault: d.isDefault, cos, role, tags: d.tagsResolved,
        roleHits: hits,
        topTerms: shared.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k.replace(/_/g, ' ')),
      };
    });
    const maxCos = Math.max(...rows.map((r) => r.cos), 1e-9);
    for (const r of rows) r.score = Math.round((0.55 * r.role + 0.45 * (r.cos / maxCos)) * 100) / 100;
    rows.sort((a, b) => (b.score - a.score) || (Number(b.isDefault) - Number(a.isDefault)) || a.file.localeCompare(b.file));
    const best = rows[0];
    const why = [
      best.roleHits.length ? `title fits ${best.roleHits.join(', ')}`
        : generic ? 'general title, so the posting decided' : `no role tag matched (${jobTags.join(', ')})`,
      best.topTerms.length ? `shared: ${best.topTerms.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    return { resume: best, score: best.score, ranking: rows, jobTags, why };
  };
}
