const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };
const employee = { EmployeeID: 1001, EmployeeName: 'Fictional Manager' };
const profile = { ...employee, MgrID: 1001, Contact: '+00 000000001', EmailID: 'manager@example.com', Address: 'Demo office', DateOfBirth: '1990-01-01' };

async function page(t, relative, fetch, configure = () => {}) {
  const html = fs.readFileSync(path.join(root, relative), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' + relative, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.fetch = fetch;
  dom.window.alert = () => assert.fail('Persistent status must replace alerts.');
  configure(dom.window);
  if (dom.window.document.readyState === 'loading') await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  if (relative.includes('analytics')) dom.window.eval(fs.readFileSync(path.join(root, 'Sidebar/analytics.js'), 'utf8'));
  else for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc\s*=/.test(match[1])) dom.window.eval(match[2]);
  await flush();
  return { window: dom.window, document: dom.window.document };
}

function analyticsResponse(url, salary = 12345.67, count = 1) {
  if (url.includes('employees')) return response(Array.from({ length: count }, (_, index) => ({ ...employee, EmployeeID: 1001 + index })));
  if (url.includes('payroll')) return response([{ EmployeeID: 1001, Salary: salary }]);
  return response([{ EmployeeID: 1001, ShiftName: 'Morning' }]);
}

test('analytics keeps confirmed summaries/charts on failed reads and destroys charts before successful recreation', async t => {
  let failure = false, salary = 12345.67;
  const charts = [];
  const { window, document } = await page(t, 'Sidebar/Sidebar_analytics.html', async url => {
    if (failure && url.includes('payroll')) return response({ error: 'Payroll offline' }, 503);
    return analyticsResponse(url, salary);
  }, window => {
    window.Chart = class {
      static defaults = {};
      constructor(canvas, settings) { this.canvas = canvas; this.settings = settings; this.destroyed = false; charts.push(this); }
      destroy() { this.destroyed = true; }
    };
  });
  assert.equal(charts.length, 2);
  const confirmedTotal = document.getElementById('totalPayroll').textContent;
  failure = true;
  assert.equal(await window.loadAnalyticsData(), false);
  assert.equal(document.getElementById('totalPayroll').textContent, confirmedTotal);
  assert.equal(charts.length, 2);
  assert.equal(charts.some(chart => chart.destroyed), false);
  assert.match(document.getElementById('analyticsMessage').textContent, /last confirmed summaries and charts/);
  failure = false; salary = 20000;
  assert.equal(await window.loadAnalyticsData(), true);
  assert.equal(charts.length, 4);
  assert.equal(charts.slice(0, 2).every(chart => chart.destroyed), true);
  assert.match(document.getElementById('totalPayroll').textContent, /20,000/);
});

test('analytics failure never invents zero values and offline chart warning remains a single element', async t => {
  let failure = true, calls = 0;
  const { window, document } = await page(t, 'Sidebar/Sidebar_analytics.html', async url => {
    calls++;
    if (failure) throw new Error('Connection unavailable');
    return analyticsResponse(url);
  });
  assert.equal(calls, 3, 'independent reads start in parallel');
  assert.equal(document.getElementById('totalEmployees').textContent, '-');
  assert.equal(document.getElementById('retryAnalytics').hidden, false);
  failure = false;
  document.getElementById('retryAnalytics').click();
  await flush();
  assert.equal(document.getElementById('totalEmployees').textContent, '1');
  assert.match(document.getElementById('chartStatus').textContent, /unavailable offline/);
  await window.loadAnalyticsData();
  assert.equal(document.querySelectorAll('#chartStatus').length, 1);
  assert.equal(document.getElementById('retryAnalytics').hidden, true);
});

test('analytics ignores stale read batches and rejects malformed salaries without replacing its snapshot', async t => {
  const older = [];
  let phase = 'pending';
  const { window, document } = await page(t, 'Sidebar/Sidebar_analytics.html', url => {
    if (phase === 'pending') { const pending = deferred(); older.push({ pending, url }); return pending.promise; }
    return Promise.resolve(analyticsResponse(url, phase === 'invalid' ? 'invalid amount' : 20000, 2));
  });
  phase = 'latest';
  await window.loadAnalyticsData();
  assert.equal(document.getElementById('totalEmployees').textContent, '2');
  for (const { pending, url } of older) pending.resolve(analyticsResponse(url, 500, 1));
  await flush();
  assert.equal(document.getElementById('totalEmployees').textContent, '2');
  phase = 'invalid';
  assert.equal(await window.loadAnalyticsData(), false);
  assert.match(document.getElementById('totalPayroll').textContent, /20,000/);
  assert.equal(document.getElementById('analyticsStatus').dataset.kind, 'error');
});

test('profile uses real loading placeholders, text-only fields, retry, and retained data on refresh failure', async t => {
  let calls = 0;
  const unsafeName = '<img src=x onerror=alert(1)>';
  const { window, document } = await page(t, 'Canvas/Canvas_viewprofile.html', async () => {
    if (++calls !== 2) throw new Error('Profile unavailable');
    return response({ details: [{ ...profile, EmployeeName: unsafeName }] });
  });
  assert.equal(document.querySelector('.empName').textContent, '—');
  assert.equal(document.getElementById('retryProfile').hidden, false);
  assert.doesNotMatch(document.querySelector('.profile-container').textContent, /John Doe|MGR12345/);
  document.getElementById('retryProfile').click();
  await flush();
  assert.equal(document.querySelector('.empName').textContent, unsafeName);
  assert.equal(document.querySelector('.empName img'), null);
  assert.equal(await window.loadManagerProfile(), false);
  assert.equal(document.querySelector('.empName').textContent, unsafeName);
  assert.match(document.getElementById('profileMessage').textContent, /last confirmed profile/);
});

function passwordValues(window, overrides = {}) {
  for (const [id, value] of Object.entries({ 'current-password': 'CurrentPassword123!', 'new-password': 'ReplacementPassword456!', 'confirm-password': 'ReplacementPassword456!', ...overrides })) {
    const input = window.document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
}
const submit = window => window.document.getElementById('changePasswordForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

test('password change validates inline and focuses errors without sending a request', async t => {
  let calls = 0;
  const { window, document } = await page(t, 'Canvas/Canvas_changepassword.html', async () => { calls++; return response({}); });
  passwordValues(window, { 'current-password': '', 'new-password': 'short', 'confirm-password': 'different' });
  submit(window);
  await flush();
  assert.equal(calls, 0);
  assert.equal(document.activeElement.id, 'current-password');
  assert.equal(document.getElementById('current-password').getAttribute('aria-invalid'), 'true');
  assert.equal(document.getElementById('newPasswordError').hidden, false);
});

test('programmatic duplicate password submits dispatch one request and lock all controls', async t => {
  let calls = 0;
  const pending = deferred();
  const { window, document } = await page(t, 'Canvas/Canvas_changepassword.html', () => { calls++; return pending.promise; });
  passwordValues(window);
  submit(window); submit(window);
  assert.equal(calls, 1);
  assert.equal(document.getElementById('changePasswordButton').disabled, true);
  assert.equal(document.getElementById('new-password').disabled, true);
  pending.resolve(response({ message: 'Password updated' }));
  await flush();
  assert.equal(document.getElementById('changePasswordButton').disabled, false);
  assert.equal(document.getElementById('new-password').value, '');
  assert.equal(document.getElementById('error-message').dataset.kind, 'success');
});

test('known password rejection restores controls and focuses current password', async t => {
  const { window, document } = await page(t, 'Canvas/Canvas_changepassword.html', async () => response({ error: 'Current password is incorrect.' }, 403));
  passwordValues(window);
  submit(window);
  await flush();
  assert.equal(document.getElementById('changePasswordButton').disabled, false);
  assert.equal(document.getElementById('current-password').disabled, false);
  assert.equal(document.activeElement.id, 'current-password');
  assert.equal(document.getElementById('current-password').getAttribute('aria-invalid'), 'true');
});

test('unconfirmed password transport or server failures block blind resubmission', async t => {
  for (const mode of ['transport', 'server']) {
    await t.test(mode, async t => {
      let calls = 0;
      const { window, document } = await page(t, 'Canvas/Canvas_changepassword.html', async () => {
        calls++;
        if (mode === 'server') return response({ error: 'Database unavailable' }, 503);
        const error = new Error('Response lost'); error.uncertain = true; throw error;
      });
      passwordValues(window);
      submit(window);
      await flush();
      assert.equal(document.getElementById('changePasswordButton').disabled, true);
      assert.equal(document.getElementById('error-message').dataset.kind, 'warning');
      assert.match(document.getElementById('error-message').textContent, /could not be confirmed/);
      submit(window);
      await flush();
      assert.equal(calls, 1);
    });
  }
});
