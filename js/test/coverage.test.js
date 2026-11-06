// The CRITERIA coverage check: every automated row owns a test/R-n/ with a case, and vice versa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const INSTRUMENTS = [/^automated$/, /^manual — .+/, /^not yet covered$/, /^retired$/];

const rows = () => fs.readFileSync(path.join(ROOT, 'CRITERIA.md'), 'utf8').split('\n')
  .filter((line) => /^\| R-\d+ /.test(line))
  .map((line) => {
    const cells = line.split('|').map((c) => c.trim());
    return { id: cells[1], instrument: cells[cells.length - 2] };
  });

const ruleDirs = () => fs.readdirSync(path.join(ROOT, 'test')).filter((d) => /^R-\d+$/.test(d));

test('every instrument is one of the four forms', () => {
  for (const { id, instrument } of rows()) {
    assert.ok(INSTRUMENTS.some((re) => re.test(instrument)), `${id}: ${instrument}`);
  }
});

test('every automated row has a case, and the case has a source', () => {
  for (const { id, instrument } of rows().filter((r) => r.instrument === 'automated')) {
    const dir = path.join(ROOT, 'test', id);
    assert.ok(fs.existsSync(dir), `${id} has no directory`);
    const cases = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(cases.length > 0, `${id} has no case`);
    for (const c of cases) assert.ok(fs.existsSync(path.join(dir, c.replace(/\.json$/, '.md'))), `${id}/${c} has no source`);
  }
});

test('every rule directory belongs to an automated row', () => {
  const automated = new Set(rows().filter((r) => r.instrument === 'automated').map((r) => r.id));
  for (const d of ruleDirs()) assert.ok(automated.has(d), `${d} has no automated row`);
});
