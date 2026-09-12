import katex from 'katex';

export const FRONTIERS = 'optimization-frontiers';
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function keys(value, required, optional = []) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  for (const key of required) requireThat(Object.hasOwn(value, key), `Missing field: ${key}`);
  for (const key of Object.keys(value)) requireThat([...required, ...optional].includes(key), `Unknown field: ${key}`);
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function dateWindow(today, count) {
  requireThat(validDate(today), 'Build date must be YYYY-MM-DD');
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(today) - i * 86400000).toISOString().slice(0, 10));
}
export function validateConfig(config) {
  keys(config, ['title', 'archive_url', 'display_days', 'timezone', 'directions']);
  requireThat(text(config.title) && /^https:\/\/github\.com\//.test(config.archive_url), 'Invalid site title or archive URL');
  requireThat(Number.isInteger(config.display_days) && config.display_days >= 1 && config.display_days <= 31, 'display_days must be 1–31');
  new Intl.DateTimeFormat('en', { timeZone: config.timezone });
  requireThat(Array.isArray(config.directions) && config.directions.length > 0, 'Directions must be configured');
  const ids = new Set(), names = new Set();
  for (const direction of config.directions) {
    keys(direction, ['id', 'name']);
    requireThat(typeof direction.id === 'string' && /^[a-z][a-z0-9-]*$/.test(direction.id) && direction.id !== 'all', 'Invalid direction ID');
    requireThat(text(direction.name) && !ids.has(direction.id) && !names.has(direction.name), 'Duplicate or empty direction');
    ids.add(direction.id); names.add(direction.name);
  }
  requireThat(config.directions[0].id === FRONTIERS, 'Optimization Frontiers must be first');
  return config;
}

// Input is plain text with TeX delimiters. HTML from content is always escaped.
export function renderText(input) {
  let output = '', index = 0;
  const starts = [['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false], ['$', '$', false]];
  while (index < input.length) {
    if (input.startsWith('\\$', index)) { output += '$'; index += 2; continue; }
    const delimiter = starts.find(([open]) => input.startsWith(open, index));
    if (!delimiter) { output += escapeHTML(input[index++]); continue; }
    const [open, close, displayMode] = delimiter;
    let end = input.indexOf(close, index + open.length);
    while (end > 0 && input[end - 1] === '\\') end = input.indexOf(close, end + close.length);
    requireThat(end !== -1, `Unclosed math delimiter ${open}`);
    const expression = input.slice(index + open.length, end);
    requireThat(expression.trim(), 'Empty math expression');
    output += katex.renderToString(expression, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, output: 'htmlAndMathml' });
    index = end + close.length;
  }
  return output;
}

export function validateDigest(digest, fileDate, config) {
  keys(digest, ['date', 'status', 'frontiers_status', 'papers']);
  requireThat(validDate(digest.date) && digest.date === fileDate, 'Digest date must match its filename');
  requireThat(['complete', 'incomplete'].includes(digest.status), 'Invalid digest status');
  requireThat(['recommendations', 'no_matches', 'incomplete'].includes(digest.frontiers_status), 'Invalid frontiers_status');
  requireThat(digest.status !== 'complete' || digest.frontiers_status !== 'incomplete', 'A complete digest cannot have incomplete Frontiers');
  requireThat(Array.isArray(digest.papers), 'papers must be an array');
  const directions = new Set(config.directions.map(d => d.id));
  const ids = new Set(), orders = new Set();
  for (const paper of digest.papers) {
    keys(paper, ['arxiv_id', 'version', 'title', 'authors', 'submitted', 'updated', 'directions', 'arxiv_url', 'abstract', 'summary', 'reason', 'order'], ['update_note']);
    requireThat(typeof paper.arxiv_id === 'string' && /^(\d{4}\.\d{4,5}|[a-zA-Z][a-zA-Z.-]*\/\d{7})$/.test(paper.arxiv_id), 'Invalid base arXiv ID');
    requireThat(!ids.has(paper.arxiv_id), `Duplicate paper: ${paper.arxiv_id}`); ids.add(paper.arxiv_id);
    requireThat(Number.isInteger(paper.version) && paper.version >= 1, 'Invalid arXiv version');
    requireThat([`https://arxiv.org/abs/${paper.arxiv_id}`, `https://arxiv.org/abs/${paper.arxiv_id}v${paper.version}`].includes(paper.arxiv_url), 'arXiv URL does not match ID and version');
    for (const field of ['title', 'abstract', 'summary', 'reason']) requireThat(text(paper[field]), `Empty ${field}: ${paper.arxiv_id}`);
    requireThat(Array.isArray(paper.authors) && paper.authors.length && paper.authors.every(text), 'Authors must be a nonempty string array');
    requireThat(validDate(paper.submitted) && validDate(paper.updated) && paper.submitted <= paper.updated && paper.updated <= digest.date, 'Invalid paper dates');
    requireThat(Array.isArray(paper.directions) && paper.directions.length && paper.directions.every(d => directions.has(d)) && new Set(paper.directions).size === paper.directions.length, `Unknown or duplicate paper direction: ${paper.arxiv_id}`);
    requireThat(Number.isInteger(paper.order) && paper.order > 0 && !orders.has(paper.order), 'Reading order must be unique positive integers'); orders.add(paper.order);
    if (Object.hasOwn(paper, 'update_note')) requireThat(text(paper.update_note), 'update_note must be nonempty');
  }
  const hasFrontiers = digest.papers.some(p => p.directions.includes(FRONTIERS));
  requireThat(digest.frontiers_status !== 'no_matches' || !hasFrontiers, 'Frontiers has papers but says no_matches');
  requireThat(digest.frontiers_status !== 'recommendations' || hasFrontiers, 'Frontiers says recommendations but has no papers');
  return digest;
}

export function prepareDigest(digest) {
  return { ...digest, papers: [...digest.papers].sort((a, b) => a.order - b.order).map(p => {
    const html = {};
    for (const field of ['title', 'abstract', 'summary', 'reason', 'update_note']) if (p[field]) html[field] = renderText(p[field]);
    return { ...p, html };
  }) };
}
