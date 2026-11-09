const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'Sidebar/Sidebar_employeedetails.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'Sidebar/employees.js'), 'utf8');
const employee = (id = 1001, extra = {}) => ({ EmployeeID: id, EmployeeName: `Employee ${id}`, Contact: '+92 3001234567',
  EmailID: `employee${id}@example.com`, Address: 'Fictional office', HireDate: '2024-01-01', DateOfBirth: '1995-01-01', MgrID: 1001, ...extra });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let count = 0; count < 4; count++) await new Promise(resolve => setImmediate(resolve)); };

async function page(t, fetch) {
  const dom = new JSDOM(html, { url: 'http://localhost/Sidebar/Sidebar_employeedetails.html', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.fetch = fetch;
  window.confirm = () => false;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  if (window.document.readyState === 'loading') await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  window.eval(script);
  await flush();
  return { window, document: window.document };
}

function fill(window, overrides = {}) {
  const values = { empId: '2001', empName: 'Fictional New Employee', countryCode: '+92', contactNo: '3001234567', email: 'new.employee@example.com',
    address: 'Fictional office', hireDate: '2025-01-01', dob: '1998-02-01', mgrId: '1001', ...overrides };
  for (const [id, value] of Object.entries(values)) {
    const input = window.document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
}

test('failed initial read has an actionable retry and enables editing only after recovery', async t => {
  let calls = 0;
  const { window, document } = await page(t, async () => {
    if (++calls === 1) throw new Error('Connection unavailable');
    return response([employee()]);
  });
  assert.match(document.getElementById('directoryMessage').textContent, /Connection unavailable/);
  assert.equal(document.getElementById('retryDirectory').hidden, false);
  assert.equal(document.getElementById('saveButton').disabled, true);
  assert.equal(document.getElementById('totalEmployeesStat').textContent, '—');
  document.getElementById('retryDirectory').click();
  await flush();
  assert.equal(calls, 2);
  assert.equal(document.getElementById('saveButton').disabled, false);
  assert.match(document.getElementById('tableBody').textContent, /Employee 1001/);
  assert.equal(document.getElementById('retryDirectory').hidden, true);
  assert.equal(typeof window.fetchEmployees, 'function');
});

test('out-of-order reads cannot replace the most recently requested directory', async t => {
  const older = deferred(), newer = deferred();
  let calls = 0;
  const { window, document } = await page(t, () => (++calls === 1 ? older.promise : newer.promise));
  const latest = window.fetchEmployees();
  newer.resolve(response([employee(3001, { EmployeeName: 'Latest record' })]));
  await latest;
  older.resolve(response([employee(1001, { EmployeeName: 'Obsolete record' })]));
  await flush();
  assert.match(document.getElementById('tableBody').textContent, /Latest record/);
  assert.doesNotMatch(document.getElementById('tableBody').textContent, /Obsolete record/);
  assert.equal(document.getElementById('saveButton').disabled, false);
});

test('refresh failure retains confirmed records and unsaved form values until retry succeeds', async t => {
  let calls = 0;
  const { window, document } = await page(t, async () => {
    if (++calls === 2) throw new Error('Refresh failed');
    return response([employee()]);
  });
  window.editEmployee(1001);
  const name = document.getElementById('empName');
  name.value = 'Unsaved employee name';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  await window.fetchEmployees();
  assert.match(document.getElementById('tableBody').textContent, /Employee 1001/);
  assert.equal(name.value, 'Unsaved employee name');
  assert.equal(name.disabled, true);
  await window.fetchEmployees();
  assert.equal(name.value, 'Unsaved employee name');
  assert.equal(name.disabled, false);
  assert.equal(document.getElementById('empId').readOnly, true);
});

test('double submission dispatches one write and displays changes only after server confirmation', async t => {
  const pending = deferred();
  let writes = 0;
  const { window, document } = await page(t, async (_url, options = {}) => {
    if (options.method === 'POST') { writes++; return pending.promise; }
    return response([employee()]);
  });
  fill(window);
  const first = window.saveEmployee();
  assert.equal(await window.saveEmployee(), false);
  assert.equal(writes, 1);
  assert.equal(document.getElementById('saveButton').disabled, true);
  assert.equal(document.getElementById('email').disabled, true);
  assert.equal(document.querySelector('[data-employee-id="2001"]'), null);
  pending.resolve(response({ employee: employee(2001, { EmployeeName: 'Server-confirmed employee' }) }, 201));
  assert.equal(await first, true);
  assert.match(document.querySelector('[data-employee-id="2001"]').textContent, /Server-confirmed employee/);
  assert.equal(document.getElementById('empId').value, '');
  assert.equal(document.getElementById('saveButton').disabled, false);
});

test('email and chronological date errors are inline, focused and never submitted', async t => {
  let writes = 0;
  const { window, document } = await page(t, async (_url, options = {}) => {
    if (options.method) writes++;
    return response([employee()]);
  });
  fill(window, { email: 'invalid-email', hireDate: '1990-01-01', dob: '1998-02-01' });
  assert.equal(await window.saveEmployee(), false);
  assert.equal(document.activeElement.id, 'email');
  assert.equal(document.getElementById('email').getAttribute('aria-invalid'), 'true');
  assert.equal(document.getElementById('emailError').hidden, false);
  document.getElementById('email').value = 'valid@example.com';
  assert.equal(await window.saveEmployee(), false);
  assert.equal(document.activeElement.id, 'hireDate');
  assert.match(document.getElementById('hireDateError').textContent, /on or after/);
  assert.equal(writes, 0);
});

test('unconfirmed network writes preserve the form and require reconciliation before another attempt', async t => {
  let writes = 0, reads = 0;
  const { window, document } = await page(t, async (_url, options = {}) => {
    if (options.method === 'POST') { writes++; throw new Error('Response lost'); }
    reads++;
    return response([employee()]);
  });
  fill(window);
  assert.equal(await window.saveEmployee(), false);
  assert.equal(document.getElementById('empName').value, 'Fictional New Employee');
  assert.equal(document.getElementById('saveButton').disabled, true);
  assert.equal(await window.saveEmployee(), false);
  assert.equal(writes, 1);
  assert.match(document.getElementById('directoryMessage').textContent, /may have reached the server/);
  await window.fetchEmployees();
  assert.equal(reads, 2);
  assert.equal(document.getElementById('saveButton').disabled, false);
  assert.equal(document.getElementById('empName').value, 'Fictional New Employee');
});

test('delete requires confirmation and preserves active search while clamping an emptied last page', async t => {
  const rows = Array.from({ length: 11 }, (_, index) => employee(index + 1));
  let writes = 0;
  const { window, document } = await page(t, async (_url, options = {}) => {
    if (options.method === 'DELETE') { writes++; return response({ message: 'Deleted' }); }
    return response(rows);
  });
  assert.equal(await window.removeEmployee(11), false);
  assert.equal(writes, 0);
  document.getElementById('searchInput').value = 'Employee';
  window.searchEmployees();
  window.changePage('next');
  assert.match(document.getElementById('pageNum').textContent, /Page 2 of 2/);
  window.confirm = () => true;
  assert.equal(await window.removeEmployee(11), true);
  assert.equal(writes, 1);
  assert.equal(document.getElementById('searchInput').value, 'Employee');
  assert.match(document.getElementById('pageNum').textContent, /Page 1 of 1/);
  assert.equal(document.getElementById('totalEmployeesStat').textContent, '10');
  assert.equal(document.querySelector('[data-employee-id="11"]'), null);
  document.getElementById('searchInput').value = 'No such name';
  window.searchEmployees();
  assert.match(document.getElementById('tableBody').textContent, /No employees match your search/);
  assert.equal(document.getElementById('pageNum').textContent, 'Page 0 of 0');
  assert.equal(document.getElementById('nextPage').disabled, true);
});

test('cancel editing protects dirty fields, then restores new-record mode after explicit discard', async t => {
  const { window, document } = await page(t, async () => response([employee()]));
  window.editEmployee(1001);
  document.getElementById('empName').value = 'Unsaved change';
  document.getElementById('empName').dispatchEvent(new window.Event('input', { bubbles: true }));
  const leaving = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, true);
  assert.equal(window.clearForm(), false);
  assert.equal(document.getElementById('empName').value, 'Unsaved change');
  window.confirm = () => true;
  assert.equal(window.clearForm(), true);
  assert.equal(document.getElementById('empId').readOnly, false);
  assert.equal(document.getElementById('empName').value, '');
  assert.equal(document.getElementById('saveButton').textContent, 'Add Employee');
  const cleanLeaving = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanLeaving);
  assert.equal(cleanLeaving.defaultPrevented, false);
});

test('refresh detects server changes to a dirty edit rather than silently overwriting it', async t => {
  let reads = 0;
  const { window, document } = await page(t, async () => response([employee(1001, { EmployeeName: ++reads === 1 ? 'Original server name' : 'New server name' })]));
  window.editEmployee(1001);
  document.getElementById('empName').value = 'My unsaved name';
  document.getElementById('empName').dispatchEvent(new window.Event('input', { bubbles: true }));
  await window.fetchEmployees();
  assert.equal(document.getElementById('empName').value, 'My unsaved name');
  assert.equal(document.getElementById('saveButton').disabled, true);
  assert.match(document.getElementById('formStatus').textContent, /changed on the server/);
});

test('employee values remain text and exports neutralize spreadsheet formulas', async t => {
  const { window, document } = await page(t, async () => response([employee(1001, { EmployeeName: '=HYPERLINK("example")', Address: '<img src=x onerror=alert(1)>' })]));
  assert.equal(document.querySelector('#tableBody img'), null);
  assert.match(document.getElementById('tableBody').textContent, /<img src=x/);
  let exported;
  window.Blob = Blob;
  window.URL.createObjectURL = blob => { exported = blob; return 'blob:directory-export'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  window.exportToCSV();
  const content = await exported.text();
  assert.match(content, /"'=HYPERLINK\(""example""\)"/);
  assert.match(content, /"'\+92 3001234567"/);
});
