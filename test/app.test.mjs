import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { prepareDigest } from '../scripts/content.mjs';

const source = await fs.readFile(new URL('../site/app.js', import.meta.url), 'utf8');
const config = JSON.parse(await fs.readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../examples/daily.example.json', import.meta.url), 'utf8'));

function fixture() {
  const digest = structuredClone(example);
  delete digest.example;
  digest.papers = [4, 2, 5, 1, 3].map(order => ({
    ...structuredClone(example.papers[0]),
    arxiv_id: `2609.0000${order}`,
    order,
    directions: [order === 3 ? 'optimization-frontiers' : config.directions[1].id]
  }));
  digest.highlights = [5, 3].map(order => ({ arxiv_id: `2609.0000${order}`, label: 'Highlight', text: 'Important result' }));
  return digest;
}

// Exercise the actual app renderer with only the DOM surfaces it uses.
function mountPage(digest, hash = '', { digests = [digest], dates = digests.map(item => item.date) } = {}) {
  const elements = new Map();
  const rootEvents = new Map(), windowEvents = new Map();
  const location = { hash };
  const root = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        innerHTML: '',
        addEventListener() {},
        focus() {}
      });
      return elements.get(selector);
    },
    addEventListener(type, handler) { rootEvents.set(type, handler); },
    contains() { return true; }
  };
  const payload = { config, dates, digests, demo: false };
  const document = {
    getElementById(id) {
      if (id === 'dp-design') return root;
      if (id === 'daily-paper-data') return { textContent: JSON.stringify(payload) };
      return null;
    }
  };
  vm.runInNewContext(source, {
    document, location,
    history: { replaceState(_state, _title, url) { location.hash = url; } },
    window: {
      addEventListener(type, handler) { windowEvents.set(type, handler); }
    },
    URLSearchParams, Intl
  });
  return {
    get html() { return root.querySelector('#dp-results').innerHTML; },
    location,
    click(dataset) { rootEvents.get('click')({ target: { closest: () => ({ dataset }) } }); },
    navigate(hash) { location.hash = hash; windowEvents.get('hashchange')(); }
  };
}
const page = (digest, hash = '') => mountPage(digest, hash).html;
const paperIds = html => [...html.matchAll(/<article class="dp-paper" id="paper-([^"]+)"/g)].map(match => match[1]);
const numbers = html => [...html.matchAll(/class="dp-number">(\d+)</g)].map(match => match[1]);

test('highlight papers come first, each group retains reading order and input is unchanged', () => {
  const digest = fixture();
  const original = structuredClone(digest);
  const prepared = prepareDigest(digest);
  assert.deepEqual(prepared.papers.map(p => p.order), [3, 5, 1, 2, 4]);
  assert.deepEqual(digest, original);
  const html = page(prepared);
  assert.deepEqual(paperIds(html), ['2609-00003', '2609-00005', '2609-00001', '2609-00002', '2609-00004']);
  assert.deepEqual(numbers(html), ['01', '02', '03', '04', '05']);
  const cards = html.match(/<article\b[\s\S]*?<\/article>/g);
  assert.deepEqual(cards.map(card => card.includes('dp-tag-highlight')), [true, true, false, false, false]);
  assert.doesNotMatch(html, /dp-highlights|dp-highlight-grid/);
});

test('direction filtering keeps highlights first and numbers the visible list consecutively', () => {
  const prepared = prepareDigest(fixture());
  const html = page(prepared, `#direction=${config.directions[1].id}`);
  assert.deepEqual(paperIds(html), ['2609-00005', '2609-00001', '2609-00002', '2609-00004']);
  assert.deepEqual(numbers(html), ['01', '02', '03', '04']);
  assert.equal((html.match(/dp-tag-highlight/g) || []).length, 1);
});

test('empty and absent highlights preserve the ordinary list without badges', () => {
  for (const legacy of [false, true]) {
    const digest = fixture();
    if (legacy) delete digest.highlights;
    else digest.highlights = [];
    const prepared = prepareDigest(digest);
    assert.deepEqual(prepared.papers.map(p => p.order), [1, 2, 3, 4, 5]);
    assert.doesNotMatch(page(prepared), /dp-tag-highlight|dp-highlights/);
  }
});

test('all papers can be highlighted without duplicate entries or a count cap', () => {
  const digest = fixture();
  digest.highlights = digest.papers.map(p => ({ arxiv_id: p.arxiv_id, label: 'Highlight', text: 'Important result' }));
  const html = page(prepareDigest(digest));
  assert.equal(paperIds(html).length, digest.papers.length);
  assert.equal(new Set(paperIds(html)).size, digest.papers.length);
  assert.equal((html.match(/dp-tag-highlight/g) || []).length, digest.papers.length);
});

test('field highlights precede group highlights and remaining recommendations; dual types appear once', () => {
  const digest = fixture();
  digest.highlights = [
    { arxiv_id: '2609.00005', label: 'Group', text: 'Group result', types: ['group'] },
    { arxiv_id: '2609.00004', label: 'Both', text: 'Shared result', types: ['field', 'group'] },
    { arxiv_id: '2609.00003', label: 'Field', text: 'Field result', types: ['field'] }
  ];
  const original = structuredClone(digest);
  const prepared = prepareDigest(digest);
  assert.deepEqual(prepared.papers.map(paper => paper.order), [3, 4, 5, 1, 2]);
  assert.deepEqual(digest, original);
  const html = page(prepared);
  assert.deepEqual(paperIds(html), ['2609-00003', '2609-00004', '2609-00005', '2609-00001', '2609-00002']);
  assert.deepEqual(numbers(html), ['01', '02', '03', '04', '05']);
  const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(match => match[1]);
  assert.deepEqual(headings, ['前沿亮点', '课题相关亮点', '剩余推荐']);
  const cards = html.match(/<article\b[\s\S]*?<\/article>/g);
  assert.doesNotMatch(cards[0], /dp-highlight-group/);
  assert.match(cards[0], /dp-highlight-field/);
  assert.match(cards[1], /dp-highlight-field/);
  assert.match(cards[1], /dp-highlight-group/);
  assert.match(cards[2], /dp-highlight-group/);
  assert.doesNotMatch(cards[2], /dp-highlight-field/);
  assert.doesNotMatch(cards[3] + cards[4], /dp-tag-highlight/);

  const filtered = page(prepared, `#direction=${config.directions[1].id}`);
  assert.deepEqual(paperIds(filtered), ['2609-00004', '2609-00005', '2609-00001', '2609-00002']);
  assert.deepEqual(numbers(filtered), ['01', '02', '03', '04']);
  assert.match(filtered, /id="dp-group-0"/);
  assert.match(filtered, /id="dp-group-1"/);
  assert.match(filtered, /剩余推荐/);
  const fieldOnly = page(prepared, '#direction=optimization-frontiers');
  assert.deepEqual(paperIds(fieldOnly), ['2609-00003']);
  assert.doesNotMatch(fieldOnly, /课题相关亮点|剩余推荐/);
});

test('group-only highlights work and empty sections are omitted', () => {
  const digest = fixture();
  digest.highlights = digest.papers.map(paper => ({ arxiv_id: paper.arxiv_id, label: 'Group', text: 'Result', types: ['group'] }));
  const html = page(prepareDigest(digest));
  assert.match(html, /课题相关亮点/);
  assert.doesNotMatch(html, /前沿亮点|剩余推荐/);
  assert.equal(new Set(paperIds(html)).size, digest.papers.length);
});

test('Chinese summary and recommendation precede the collapsed original abstract', () => {
  const html = page(prepareDigest(fixture()));
  for (const card of html.match(/<article\b[\s\S]*?<\/article>/g)) {
    assert.ok(card.indexOf('class="dp-abstract"') < card.indexOf('class="dp-reason"'));
    assert.ok(card.indexOf('class="dp-reason"') < card.indexOf('class="dp-original"'));
    assert.match(card, /<details class="dp-original"><summary>Abstract<\/summary>/);
  }
});

test('paper lists have no separate directory before or after filtering', () => {
  const digest = prepareDigest(fixture());
  for (const hash of ['', `#direction=${config.directions[1].id}`]) {
    const html = page(digest, hash);
    assert.doesNotMatch(html, /dp-toc|data-paper=|当天论文目录/);
    assert.equal(paperIds(html).length, hash ? 4 : 5);
  }
});

test('date and direction changes still refresh the paper list', () => {
  const digest = prepareDigest(fixture());
  const empty = { date: '2026-09-11', status: 'complete', frontiers_status: 'no_matches', papers: [] };
  const app = mountPage(digest, '', { digests: [digest, empty], dates: [digest.date, empty.date, '2026-09-10'] });
  app.click({ direction: 'optimization-frontiers' });
  assert.deepEqual(paperIds(app.html), ['2609-00003']);
  assert.equal(app.location.hash, `#date=${digest.date}&direction=optimization-frontiers`);
  app.click({ date: empty.date });
  assert.deepEqual(paperIds(app.html), []);
  app.navigate('#date=2026-09-10'); // Missing digest.
  assert.deepEqual(paperIds(app.html), []);
  app.navigate('#date=2020-01-01'); // Expired date.
  assert.deepEqual(paperIds(app.html), []);
  app.navigate(`#date=${digest.date}`);
  assert.equal(paperIds(app.html).length, digest.papers.length);
});
