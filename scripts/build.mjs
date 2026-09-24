import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, validateDigest, prepareDigest, dateWindow } from './content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function build({ root = ROOT, today, demo = false } = {}) {
  const config = validateConfig(JSON.parse(await fs.readFile(path.join(root, 'site.config.json'), 'utf8')));
  today ??= new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dates = dateWindow(today, config.display_days);
  const digests = [];
  for (const date of dates) {
    let raw;
    try { raw = await fs.readFile(path.join(root, 'content', `${date}.json`), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    try { digests.push(prepareDigest(validateDigest(JSON.parse(raw), date, config))); }
    catch (error) { throw new Error(`${date}.json: ${error.message}`, { cause: error }); }
  }
  if (demo) {
    const example = JSON.parse(await fs.readFile(path.join(ROOT, 'examples/daily.example.json'), 'utf8'));
    delete example.example;
    example.date = today;
    for (const paper of example.papers) paper.submitted = paper.updated = today;
    digests.splice(0, digests.length, prepareDigest(validateDigest(example, today, config)));
    if (dates[1]) digests.push({ date: dates[1], status: 'complete', frontiers_status: 'no_matches', papers: [] });
    if (dates[2]) digests.push({ date: dates[2], status: 'incomplete', frontiers_status: 'incomplete', papers: [] });
    if (dates[3]) {
      const regularOnly = structuredClone(example);
      regularOnly.date = dates[3];
      regularOnly.frontiers_status = 'no_matches';
      regularOnly.highlights = [];
      regularOnly.papers = [regularOnly.papers[0]];
      regularOnly.papers[0].arxiv_id = '2609.00004';
      regularOnly.papers[0].arxiv_url = 'https://arxiv.org/abs/2609.00004v1';
      regularOnly.papers[0].submitted = regularOnly.papers[0].updated = dates[3];
      digests.push(prepareDigest(validateDigest(regularOnly, dates[3], config)));
    }
  }
  const previous = new Map();
  for (const digest of [...digests].reverse()) for (const paper of digest.papers) {
    const old = previous.get(paper.arxiv_id);
    if (old && (paper.version <= old.version || !paper.update_note)) throw new Error(`Repeated recommendation needs a newer version and update_note: ${paper.arxiv_id}`);
    previous.set(paper.arxiv_id, paper);
  }
  const payload = JSON.stringify({ config, dates, digests, demo }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const template = await fs.readFile(path.join(ROOT, 'site/index.html'), 'utf8');
  const staging = await fs.mkdtemp(path.join(root, '.build-'));
  const output = path.join(root, demo ? '.preview' : 'dist');
  const backup = `${staging}-previous`;
  let moved = false;
  try {
    await fs.mkdir(path.join(staging, 'assets/katex'), { recursive: true });
    for (const file of ['style.css', 'app.js']) await fs.copyFile(path.join(ROOT, 'site', file), path.join(staging, 'assets', file));
    const katexDir = path.join(ROOT, 'node_modules/katex');
    await fs.copyFile(path.join(katexDir, 'dist/katex.min.css'), path.join(staging, 'assets/katex/katex.min.css'));
    await fs.cp(path.join(katexDir, 'dist/fonts'), path.join(staging, 'assets/katex/fonts'), { recursive: true });
    await fs.copyFile(path.join(katexDir, 'LICENSE'), path.join(staging, 'assets/katex/LICENSE'));
    await fs.writeFile(path.join(staging, 'index.html'), template.replace('__DAILY_PAPER_DATA__', () => payload));
    await fs.writeFile(path.join(staging, '.nojekyll'), '');
    try { await fs.rename(output, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(staging, output); } catch (error) { if (moved) await fs.rename(backup, output); throw error; }
    if (moved) await fs.rm(backup, { recursive: true });
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  return { output, dates, digestCount: digests.length, paperCount: digests.reduce((n, d) => n + d.papers.length, 0) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let today, demo = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--demo') demo = true;
      else if (args[i] === '--date' && args[i + 1]) today = args[++i];
      else throw new Error(`Unknown argument: ${args[i]}`);
    }
    console.log(JSON.stringify(await build({ today, demo }), null, 2));
  } catch (error) { console.error(`Build failed: ${error.message}`); process.exitCode = 1; }
}
