import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '../scripts/build.mjs';
import { validateConfig, validateDigest, renderText, dateWindow } from '../scripts/content.mjs';

const config = JSON.parse(await fs.readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../examples/daily.example.json', import.meta.url), 'utf8'));
delete example.example;
const copy = () => structuredClone(example);

test('rolling window uses calendar days across month and year boundaries', () => {
  assert.deepEqual(dateWindow('2027-01-03', 7), ['2027-01-03', '2027-01-02', '2027-01-01', '2026-12-31', '2026-12-30', '2026-12-29', '2026-12-28']);
  assert.throws(() => dateWindow('2026-02-30', 7));
});
test('new directions require config only, and duplicate IDs are rejected', () => {
  const changed = structuredClone(config);
  changed.directions.push({ id: 'new-topic', name: 'New Optimization Topic' });
  validateConfig(changed);
  const digest = copy(); digest.papers[0].directions.push('new-topic');
  validateDigest(digest, digest.date, changed);
  assert.throws(() => validateDigest(digest, digest.date, config), /direction/);
  changed.directions.push({ id: 'new-topic', name: 'Another name' });
  assert.throws(() => validateConfig(changed), /Duplicate/);
});
test('duplicate paper, conflicting dates, unrecognized fields, and URL mismatches fail', () => {
  const duplicate = copy(); duplicate.papers.push(structuredClone(duplicate.papers[0]));
  assert.throws(() => validateDigest(duplicate, duplicate.date, config), /Duplicate paper/);
  const future = copy(); future.papers[0].updated = '2026-09-13';
  assert.throws(() => validateDigest(future, future.date, config), /dates/);
  const privateData = copy(); privateData.internal_notes = 'must not leak';
  assert.throws(() => validateDigest(privateData, privateData.date, config), /Unknown field/);
  const wrongURL = copy(); wrongURL.papers[0].arxiv_url = 'https://arxiv.org/abs/2609.00099';
  assert.throws(() => validateDigest(wrongURL, wrongURL.date, config), /URL/);
});
test('missing, empty and incomplete recommendation results cannot be confused', () => {
  const digest = copy(); digest.frontiers_status = 'no_matches';
  assert.throws(() => validateDigest(digest, digest.date, config), /Frontiers/);
  digest.papers = []; validateDigest(digest, digest.date, config);
  digest.frontiers_status = 'incomplete';
  assert.throws(() => validateDigest(digest, digest.date, config), /complete/);
  digest.status = 'incomplete'; validateDigest(digest, digest.date, config);
});
test('text is escaped and invalid TeX fails before publication', () => {
  assert.equal(renderText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.match(renderText('$\\nabla f(x)$'), /katex/);
  assert.match(renderText('$$x_{k+1}=x_k-\\alpha_k\\nabla f(x_k)$$'), /katex-display/);
  assert.throws(() => renderText('$\\notARealCommand{x}$'));
  assert.throws(() => renderText('An unclosed $x'));
  assert.equal(renderText('Cost \\$5'), 'Cost $5');
});

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-paper-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'content'));
  await fs.writeFile(path.join(root, 'site.config.json'), JSON.stringify(config));
  return root;
}
test('build keeps archive source, excludes expired content and removes stale output', async t => {
  const root = await workspace(t);
  await fs.writeFile(path.join(root, 'content/2026-09-12.json'), JSON.stringify(copy()));
  await fs.writeFile(path.join(root, 'content/2026-09-05.json'), 'Expired files are not even parsed');
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist/stale.html'), 'old page');
  const result = await build({ root, today: '2026-09-12' });
  assert.equal(result.digestCount, 1);
  await assert.rejects(fs.stat(path.join(root, 'dist/stale.html')), { code: 'ENOENT' });
  assert.match(await fs.readFile(path.join(root, 'content/2026-09-05.json'), 'utf8'), /Expired/);
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(!html.includes('2026-09-05'));
  await build({ root, today: '2026-09-19' });
  assert.ok(!(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).includes('Delay-adaptive'));
});
test('failed validation preserves the last successful output; fixing permits retry', async t => {
  const root = await workspace(t);
  const filename = path.join(root, 'content/2026-09-12.json');
  await fs.writeFile(filename, JSON.stringify(copy()));
  await build({ root, today: '2026-09-12' });
  const before = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const broken = copy(); broken.papers[0].summary = '$\\notARealCommand$';
  await fs.writeFile(filename, JSON.stringify(broken));
  await assert.rejects(build({ root, today: '2026-09-12' }), /2026-09-12.json/);
  assert.equal(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8'), before);
  broken.papers[0].summary = 'Corrected summary';
  await fs.writeFile(filename, JSON.stringify(broken));
  await build({ root, today: '2026-09-12' });
  assert.match(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8'), /Corrected summary/);
});
test('repeat recommendations in the window require a newer version and update note', async t => {
  const root = await workspace(t);
  const first = copy();
  await fs.writeFile(path.join(root, 'content/2026-09-12.json'), JSON.stringify(first));
  const next = copy(); next.date = '2026-09-13'; next.papers = [next.papers[1]];
  await fs.writeFile(path.join(root, 'content/2026-09-13.json'), JSON.stringify(next));
  await assert.rejects(build({ root, today: next.date }), /newer version/);
  next.papers[0].version = 2;
  next.papers[0].arxiv_url = `https://arxiv.org/abs/${next.papers[0].arxiv_id}v2`;
  next.papers[0].update_note = 'A substantive change verified in the paper';
  await fs.writeFile(path.join(root, 'content/2026-09-13.json'), JSON.stringify(next));
  await build({ root, today: next.date });
});
