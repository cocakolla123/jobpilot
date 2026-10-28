// Skills: a fixed vocabulary of common technical skills with their aliases.
// Used to (1) pull your skills out of your resumes, (2) see which skills a
// posting asks for, and (3) answer "How many years of experience do you have
// with X?" from the years you set per skill in the dashboard.

// canonical name -> aliases (lowercase, matched as whole words)
export const SKILLS = {
  'Python': ['python'], 'Java': ['java'], 'JavaScript': ['javascript', 'js', 'ecmascript'],
  'TypeScript': ['typescript', 'ts'], 'C': ['c language', 'ansi c'], 'C++': ['c++', 'cpp', 'cplusplus'],
  'C#': ['c#', 'csharp'], 'Go': ['golang', 'go lang'], 'Rust': ['rust'], 'Ruby': ['ruby'], 'PHP': ['php'],
  'Swift': ['swift'], 'Kotlin': ['kotlin'], 'Scala': ['scala'], 'R': ['r language', 'rstudio'], 'MATLAB': ['matlab'],
  'SQL': ['sql'], 'Bash': ['bash', 'shell scripting', 'shell'], 'HTML': ['html', 'html5'], 'CSS': ['css', 'css3', 'sass', 'scss'],
  'React': ['react', 'reactjs', 'react.js'], 'React Native': ['react native'], 'Next.js': ['next.js', 'nextjs', 'next js'],
  'Vue': ['vue', 'vue.js', 'vuejs'], 'Angular': ['angular'], 'Svelte': ['svelte'], 'Redux': ['redux'], 'Tailwind': ['tailwind', 'tailwindcss'],
  'Node.js': ['node', 'node.js', 'nodejs', 'node js'], 'Express': ['express', 'express.js'], 'Django': ['django'], 'Flask': ['flask'],
  'FastAPI': ['fastapi'], 'Spring Boot': ['spring boot', 'spring'], 'Rails': ['rails', 'ruby on rails'], '.NET': ['.net', 'dotnet', 'asp.net'],
  'GraphQL': ['graphql'], 'REST APIs': ['rest', 'rest api', 'rest apis', 'restful'], 'gRPC': ['grpc'],
  'PostgreSQL': ['postgresql', 'postgres'], 'MySQL': ['mysql'], 'MongoDB': ['mongodb', 'mongo'], 'Redis': ['redis'],
  'DynamoDB': ['dynamodb'], 'Elasticsearch': ['elasticsearch', 'opensearch'], 'Snowflake': ['snowflake'], 'BigQuery': ['bigquery'],
  'Kafka': ['kafka'], 'RabbitMQ': ['rabbitmq'], 'Spark': ['spark', 'pyspark'], 'Airflow': ['airflow'], 'dbt': ['dbt'], 'Dagster': ['dagster'],
  'AWS': ['aws', 'amazon web services', 'ec2', 's3', 'lambda'], 'GCP': ['gcp', 'google cloud'], 'Azure': ['azure'],
  'Docker': ['docker'], 'Kubernetes': ['kubernetes', 'k8s'], 'Terraform': ['terraform'], 'Linux': ['linux', 'unix'],
  'Git': ['git'], 'GitHub Actions': ['github actions'], 'Jenkins': ['jenkins'], 'CI/CD': ['ci/cd', 'ci cd', 'continuous integration'],
  'Machine Learning': ['machine learning', 'ml'], 'Deep Learning': ['deep learning'], 'PyTorch': ['pytorch'], 'TensorFlow': ['tensorflow'],
  'scikit-learn': ['scikit-learn', 'sklearn', 'scikit learn'], 'pandas': ['pandas'], 'NumPy': ['numpy'], 'LLMs': ['llm', 'llms', 'large language models'],
  'RAG': ['rag', 'retrieval augmented generation'], 'NLP': ['nlp', 'natural language processing'], 'Computer Vision': ['computer vision', 'opencv'],
  'OpenAI API': ['openai', 'openai api', 'gpt-4'], 'LangChain': ['langchain'], 'Hugging Face': ['hugging face', 'huggingface', 'transformers'],
  'Figma': ['figma'], 'Jest': ['jest'], 'Playwright': ['playwright'], 'Cypress': ['cypress'], 'JUnit': ['junit'], 'pytest': ['pytest'],
  'Selenium': ['selenium'], 'Excel': ['excel'], 'Tableau': ['tableau'], 'Power BI': ['power bi', 'powerbi'], 'Salesforce': ['salesforce'],
  'iOS': ['ios'], 'Android': ['android'], 'Firebase': ['firebase'], 'Supabase': ['supabase'], 'WordPress': ['wordpress'], 'Shopify': ['shopify'],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = Object.entries(SKILLS).map(([name, aliases]) => [
  name,
  new RegExp(`(^|[^a-z0-9+#.])(${aliases.map(esc).join('|')})(?=$|[^a-z0-9+#])`, 'i'),
]);

/** Canonical skills mentioned in a text, in vocabulary order. */
export function extractSkills(text) {
  const t = ' ' + String(text || '').replace(/\s+/g, ' ') + ' ';
  return MATCHERS.filter(([name, re]) => {
    // single letters / common words need a tech context to count
    if (name === 'Go') return /\bgolang\b|\bgo lang\b|\bgo\b(?= ?(,|\/|and|or) ?(python|java|rust|c\+\+))/i.test(t);
    if (name === 'R') return /\br language\b|\brstudio\b|(python|sql)\s*,\s*r\s*,/i.test(t);
    if (name === 'C') return /\bc language\b|\bansi c\b|(^|[\s,(])c\s*,\s*c\+\+/i.test(t);
    return re.test(t);
  }).map(([name]) => name);
}

/** Look up a skill named inside a form question, e.g. "...experience with Node.js?". */
export function skillInQuestion(question) {
  const found = extractSkills(question);
  return found.length ? found[found.length - 1] : null;
}

export const YEARS_Q = /how many years.*(experience|worked|using|with|in)|years of (work |professional |hands on )?experience (with|in|using|doing)|years.*experience.*\?/i;
export const HAVE_Q = /(do|have) you (have )?(any |professional |hands on )?(experience|worked|familiar|proficient|knowledge) (with|in|using)|are you (familiar|comfortable|proficient) with/i;

/**
 * Answer for a skill question from profile.skills ([{name, years}]).
 * Returns null when the question is not about one known skill.
 */
export function skillAnswer(question, profileSkills = []) {
  const skill = skillInQuestion(question);
  if (!skill) return null;
  const mine = profileSkills.find((s) => String(s.name).toLowerCase() === skill.toLowerCase());
  if (YEARS_Q.test(question)) {
    const years = mine ? Math.max(0, Math.round(Number(mine.years) || 1)) : 0;
    return { q: `years with ${skill}`, answer: String(years), options: [], source: 'skills' };
  }
  if (HAVE_Q.test(question)) {
    return { q: `experience with ${skill}`, answer: mine ? 'Yes' : 'No', options: mine ? ['^yes'] : ['^no'], source: 'skills' };
  }
  return null;
}

/** How many of the skills a posting asks for you have. */
export function skillCoverage(jobText, profileSkills = []) {
  const wanted = extractSkills(jobText);
  const mine = new Set(profileSkills.map((s) => String(s.name).toLowerCase()));
  const have = wanted.filter((s) => mine.has(s.toLowerCase()));
  return { wanted, have, missing: wanted.filter((s) => !mine.has(s.toLowerCase())), pct: wanted.length ? Math.round(100 * have.length / wanted.length) : null };
}
