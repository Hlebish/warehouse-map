const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing application source boundary: ${start}`);
  return html.slice(a, b);
}
function singleLineFunction(name) {
  const line = html.split(/\r?\n/).find(value => value.startsWith(`function ${name}(`));
  assert.ok(line, `Missing application helper: ${name}`);
  return line;
}

function harness() {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];
  const data = {}, search = { value: '' }, results = { innerHTML: '' };
  for (let s = 1; s <= 5; s++) {
    data[`S${s}`] = {};
    for (const shelf of letters) {
      data[`S${s}`][shelf] = {};
      for (let n = 1; n <= 10; n++) data[`S${s}`][shelf][n] = '';
    }
  }
  let cells;
  function rebuildCells() {
    cells = [];
    for (let s = 1; s <= 5; s++) for (const shelf of s === 1 ? letters.slice(0, 5) : letters) {
      for (let n = 1; n <= 10; n++) {
        const classes = new Set();
        cells.push({ id: `cell-S${s}-${shelf}-${n}`, classes,
          classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } });
      }
    }
  }
  rebuildCells();
  const context = vm.createContext({
    data, letters, leftLetters: letters.slice(0, 5),
    specialData: { resale: '', defect: '' }, unaddressedItems: {},
    document: {
      getElementById(id) { return id === 'search' ? search : id === 'results' ? results : null; },
      querySelectorAll(selector) { return selector === '.cell' ? cells : []; },
    },
  });
  vm.runInContext([
    singleLineFunction('address'), singleLineFunction('esc'), singleLineFunction('linesOf'),
    between('const normalizedSearchCache=', 'function parseExcelLocations('),
    between('function splitExportLine(', 'function exportExcel('),
    between('function syncSearchHighlights(', 'function clearMapTarget('),
    between('function normalizeArticleQuery(', 'const searchInput = document.getElementById("search");'),
    'const renderPlan = renderMiniMap; renderMiniMap = found => { globalThis.latestResults = found; renderPlan(found); };',
  ].join('\n'), context);
  return {
    data, context, results, rebuildCells,
    search(query) {
      search.value = query;
      vm.runInContext('doSearch()', context);
      return Array.from(context.latestResults);
    },
    highlights() { return cells.filter(cell => cell.classes.has('search-hit')).map(cell => cell.id); },
  };
}

test('spaced articles keep every matching line while list and grid point at the same cell', () => {
  const app = harness();
  app.data.S2.A[3] = 'APMZ1402C — Крыло\nAP MZ 1402 C — Крыло, другой вариант\nAPMZ0903 — Капот';
  const found = app.search('AP MZ 1402 C');
  assert.equal(found.length, 2);
  assert.ok(found.every(result => result.a === 'S2-A-3'));
  assert.deepEqual(app.highlights(), ['cell-S2-A-3']);
  assert.doesNotMatch(app.results.innerHTML, /APMZ0903/);
});

test('a full storage address locates exactly one cell, including an empty cell', () => {
  const app = harness();
  app.data.S2.A[4] = 'APMZ1402C';
  for (const query of ['S2-A-3', 'S2, A3', 's2 a3', 'S2A3']) {
    const found = app.search(query);
    assert.deepEqual(found.map(result => result.a), ['S2-A-3']);
    assert.deepEqual(app.highlights(), ['cell-S2-A-3']);
    assert.match(app.results.innerHTML, /пусто/);
  }
  assert.equal(app.search('S1-F-1').length, 0, 'S1 has no right-side shelves');
  assert.deepEqual(app.highlights(), []);
});

test('article search includes defect, resale and unaddressed stock without inventing map cells', () => {
  const app = harness();
  app.context.specialData.defect = 'APBM2802 — Брак\nAPMZ0903 — Другой товар';
  app.context.specialData.resale = 'AP BM 2802 — Перекупной товар';
  app.context.unaddressedItems.sample = { article: 'APBM2802', description: 'Без ячейки' };
  const found = app.search('APBM2802');
  assert.equal(found.length, 3);
  assert.deepEqual(found.map(result => result.special || 'unaddressed').sort(), ['defect', 'resale', 'unaddressed']);
  assert.deepEqual(app.highlights(), []);
  assert.match(app.results.innerHTML, /openSpecial\('defect'\)/);
  assert.match(app.results.innerHTML, /openSpecial\('resale'\)/);
  assert.doesNotMatch(app.results.innerHTML, /openModal\('undefined'/);
});

test('part aliases use part matching before brand matching and retain the requested vehicle brand', () => {
  const app = harness();
  app.data.S2.A[3] = 'APMZ0903';
  app.data.S2.A[4] = 'APFD1403';
  app.data.S2.A[5] = 'APMZ1402C';
  for (const query of ['капот мазда', 'hood mazda', 'bonnet mazda']) {
    const found = app.search(query);
    assert.deepEqual(found.map(result => result.a), ['S2-A-3']);
    assert.deepEqual(app.highlights(), ['cell-S2-A-3']);
  }
});

test('rebuilding the grid after a remote move reapplies semantic matches to the new cell', () => {
  const app = harness();
  app.data.S2.A[3] = 'APMZ0903';
  app.search('капот мазда');
  app.data.S2.A[3] = '';
  app.data.S4.B[2] = 'APMZ0903';
  app.rebuildCells();
  const found = app.search('капот мазда');
  assert.deepEqual(found.map(result => result.a), ['S4-B-2']);
  assert.deepEqual(app.highlights(), ['cell-S4-B-2']);
  app.search('несуществующая деталь');
  assert.deepEqual(app.highlights(), []);
  app.search('');
  assert.deepEqual(app.highlights(), []);
  assert.equal(app.results.innerHTML, '');
});

test('results provide native keyboard actions and escape imported descriptions', () => {
  const app = harness();
  app.data.S2.A[3] = 'APMZ0903 — <img src=x onerror=alert(1)>';
  app.search('APMZ0903');
  assert.match(app.results.innerHTML, /<button type="button" class="search-result-info" aria-label="Открыть ячейку S2-A-3">/);
  assert.match(app.results.innerHTML, /aria-label="Показать ячейку S2-A-3 на карте"/);
  assert.match(app.results.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(app.results.innerHTML, /<img/);
});
