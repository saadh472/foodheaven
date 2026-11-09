const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'records.js'), 'utf8');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const record = (id = 1, extra = {}) => ({ EmployeeID: id, EmployeeName: `Employee ${id}`, AttendDate: '2025-01-01', Status: 'Present', Performance: 'Good', ...extra });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };

async function page(t, kind, fetch) {
  const html = fs.readFileSync(path.join(root, `Sidebar/Sidebar_${kind}.html`), 'utf8');
  const dom = new JSDOM(html, { url: `http://localhost/Sidebar/Sidebar_${kind}.html`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.fetch = fetch;
  dom.window.alert = () => assert.fail('Read-only page must use persistent status, not alerts.');
  if (dom.window.document.readyState === 'loading') await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  dom.window.eval(script);
  await flush();
  return { window: dom.window, document: dom.window.document };
}

for (const kind of ['attendance', 'performance']) {
  const capital = kind[0].toUpperCase() + kind.slice(1);
  test(`${kind}: failed load and refresh recover without erasing confirmed records`, async t => {
    let calls = 0;
    const { window, document } = await page(t, kind, async () => {
      if ([1, 3].includes(++calls)) throw new Error('Server unavailable');
      return response([record()]);
    });
    assert.equal(document.getElementById('recordsStatus').dataset.kind, 'error');
    assert.equal(document.getElementById('retryRecords').hidden, false);
    assert.match(document.querySelector('tbody').textContent, /could not be loaded/);
    assert.doesNotMatch(document.querySelector('tbody').textContent, /No .* records are available/);
    document.getElementById('retryRecords').click();
    await flush();
    assert.match(document.querySelector('tbody').textContent, /Employee 1/);
    assert.equal(document.getElementById('retryRecords').hidden, true);
    assert.equal(await window[`fetch${capital}`](), false);
    assert.match(document.querySelector('tbody').textContent, /Employee 1/);
    assert.match(document.getElementById('recordsMessage').textContent, /last confirmed records/);
    assert.match(document.getElementById('recordCount').textContent, /Last confirmed data/);
    assert.equal(await window[`fetch${capital}`](), true);
    assert.equal(document.getElementById('recordsStatus').dataset.kind, 'success');
    assert.equal(calls, 4);
  });

  test(`${kind}: latest requested read wins even when an aborted older request completes`, async t => {
    const old = deferred(), latest = deferred();
    let calls = 0, oldSignal;
    const { window, document } = await page(t, kind, (_url, options) => {
      calls++;
      if (calls === 1) { oldSignal = options.signal; return old.promise; }
      return latest.promise;
    });
    assert.equal(document.getElementById('recordsRegion').getAttribute('aria-busy'), 'true');
    assert.match(document.querySelector('tbody').textContent, /Loading/);
    const pending = window[`fetch${capital}`]();
    assert.equal(oldSignal.aborted, true);
    latest.resolve(response([record(2, { EmployeeName: 'Latest record' })]));
    await pending;
    old.resolve(response([record(1, { EmployeeName: 'Stale record' })]));
    await flush();
    assert.match(document.querySelector('tbody').textContent, /Latest record/);
    assert.doesNotMatch(document.querySelector('tbody').textContent, /Stale record/);
    assert.equal(document.getElementById('recordsRegion').getAttribute('aria-busy'), 'false');
  });

  test(`${kind}: refresh preserves query and clamps pagination after results shrink`, async t => {
    let calls = 0;
    const { window, document } = await page(t, kind, async () => response(Array.from({ length: ++calls === 1 ? 23 : 12 }, (_, index) => record(index + 1))));
    document.getElementById('employeeId').value = 'Employee';
    window[`search${capital}`]();
    window.changePage('next');
    window.changePage('next');
    assert.equal(document.getElementById('pageNum').textContent, 'Page 3 of 3');
    assert.equal(document.querySelectorAll('tbody tr[data-employee-id]').length, 3);
    await window[`fetch${capital}`]();
    assert.equal(document.getElementById('employeeId').value, 'Employee');
    assert.equal(document.getElementById('pageNum').textContent, 'Page 2 of 2');
    assert.equal(document.querySelectorAll('tbody tr[data-employee-id]').length, 2);
    assert.match(document.getElementById('recordCount').textContent, /Showing 11–12 of 12/);
    assert.equal(document.getElementById('nextPage').disabled, true);
  });

  test(`${kind}: empty database and no search matches have distinct states`, async t => {
    let calls = 0;
    const { window, document } = await page(t, kind, async () => response(++calls === 1 ? [] : [record()]));
    assert.match(document.querySelector('tbody').textContent, /No .* records are available yet/);
    assert.equal(document.getElementById('pageNum').textContent, 'Page 0 of 0');
    assert.equal(document.getElementById('prevPage').disabled, true);
    await window[`fetch${capital}`]();
    document.getElementById('employeeId').value = 'Nonexistent employee';
    window[`search${capital}`]();
    assert.match(document.querySelector('tbody').textContent, /match your search/);
    assert.equal(document.getElementById('pageNum').textContent, 'Page 0 of 0');
    window.clearSearch();
    assert.match(document.querySelector('tbody').textContent, /Employee 1/);
    assert.equal(document.getElementById('pageNum').textContent, 'Page 1 of 1');
  });

  test(`${kind}: API names and feedback remain text`, async t => {
    const unsafe = '<img src=x onerror=alert(1)>';
    const { document } = await page(t, kind, async () => response([record(1, { EmployeeName: unsafe, Status: unsafe, Performance: unsafe })]));
    assert.equal(document.querySelector('tbody img'), null);
    assert.match(document.querySelector('tbody').textContent, /<img src=x onerror=alert\(1\)>/);
  });
}

test('attendance date-only display stays on its original day in a negative-offset timezone', async t => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  const { document } = await page(t, 'attendance', async () => response([record(1, { AttendDate: '2025-01-01T00:00:00' }), record(2, { AttendDate: null })]));
  const time = document.querySelector('tbody time');
  assert.equal(time.dateTime, '2025-01-01');
  assert.equal(time.textContent, new Date('2025-01-01T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }));
  assert.match(document.querySelector('tbody').textContent, /Not recorded/);
});

test('unexpected API records retain the previous snapshot and zero feedback stays visible', async t => {
  let calls = 0;
  const { window, document } = await page(t, 'performance', async () => response(++calls === 1 ? [record(1, { Performance: 0 })] : [record(1, { Performance: { invalid: true } })]));
  assert.equal(document.querySelector('tbody tr td:last-child').textContent, '0');
  assert.equal(await window.fetchPerformance(), false);
  assert.equal(document.querySelector('tbody tr td:last-child').textContent, '0');
  assert.equal(document.getElementById('recordsStatus').dataset.kind, 'error');
});
