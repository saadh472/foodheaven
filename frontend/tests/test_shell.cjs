const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'workspace-shell.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const token = 'a'.repeat(43);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const manager = { EmployeeName: 'Demo Manager', EmailID: 'manager@example.com' };

function page(t, handler, options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const html = '<!doctype html><head><style>' + css + '</style></head><body class="app-page dashboard-page directory-page" data-page="employees" data-page-title="Employees"><main id="main-content" class="directory-content"><h1>Employees</h1><button id="pageAction">Edit</button></main><aside id="employeeDrawer" hidden></aside></body>';
  const dom = new JSDOM(html, { url: 'http://localhost:5000/Sidebar/Sidebar_employeedetails.html', runScripts: 'outside-only', virtualConsole });
  const { window } = dom;
  Object.assign(window, { Request, Response, Headers, AbortController, DOMException });
  if (options.dark) window.localStorage.setItem('theme', 'dark');
  const calls = [];
  window.fetch = async request => {
    calls.push(request);
    const url = new URL(request.url).pathname;
    if (url === '/api/session') return json({ authenticated: true, user: { MgrID: 1001 }, csrf_token: token });
    if (handler) return handler(request, url);
    return json({ employees: [manager] });
  };
  const originalMain = window.document.getElementById('main-content');
  // app.js is parser-blocking in the head; workspace-shell.js is deferred.
  // Model that order rather than evaluating the head script as a late import.
  Object.defineProperty(window.document, 'readyState', { configurable: true, get: () => 'loading' });
  window.eval(client);
  delete window.document.readyState;
  window.eval(shell);
  t.after(() => dom.window.close());
  return { window, calls, errors, originalMain, byId: id => window.document.getElementById(id) };
}

test('the shell preserves the component main and marks only Employees active', async t => {
  const env = page(t);
  await env.window.FoodHeavenShell.ready;
  assert.equal(env.byId('main-content'), env.originalMain);
  assert.equal(env.byId('main-content').parentElement.id, 'workspace');
  assert.equal(env.byId('shellPageTitle').textContent, 'Employees');
  const active = env.window.document.querySelectorAll('.workspace-menu [aria-current="page"]');
  assert.equal(active.length, 1);
  assert.equal(active[0].getAttribute('href'), '/Sidebar/Sidebar_employeedetails.html');
  assert.equal(env.window.document.querySelector('.skip-link').getAttribute('href'), '#main-content');
  env.window.eval(shell);
  assert.equal(env.window.document.querySelectorAll('#workspace').length, 1);
  assert.equal(env.window.document.querySelectorAll('#profilePanel').length, 1);
  assert.equal(env.window.document.querySelectorAll('#employeeDrawer').length, 1);
});

test('profile fields are text-only and compact header controls use the overview CSS', async t => {
  const name = '<img src=x onerror=alert(1)> Manager';
  const env = page(t, () => json({ employees: [{ EmployeeName: name, EmailID: 'demo@example.com' }] }));
  await env.window.FoodHeavenShell.ready;
  assert.equal(env.byId('shellAccountName').textContent, name);
  assert.equal(env.byId('shellManagerName').textContent, name);
  assert.equal(env.byId('profilePanel').querySelector('img'), null);
  const style = env.window.getComputedStyle(env.byId('accountTrigger'));
  assert.equal(style.width, 'auto');
  assert.equal(style.maxWidth, '220px');
  assert.match(style.display, /^(?:inline-)?flex$/);
  assert.equal(env.window.getComputedStyle(env.byId('refreshWorkspace')).width, '34px');
});

test('shared theme controls preserve the Appearance label and synchronize dark mode', async t => {
  const env = page(t, null, { dark: true });
  await env.window.FoodHeavenShell.ready;
  await nextTurn();
  const button = env.window.document.querySelector('.theme-toggle');
  assert.equal(env.window.document.body.classList.contains('dark-theme'), true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.match(button.textContent, /Appearance/);
  button.click();
  assert.equal(env.window.document.body.classList.contains('dark-theme'), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.querySelectorAll('svg').length, 1);
});

test('account drawer supports focus trapping, Escape, backdrop dismissal, and focus restoration', async t => {
  const env = page(t);
  await env.window.FoodHeavenShell.ready;
  await nextTurn();
  const trigger = env.byId('accountTrigger');
  trigger.click();
  assert.equal(env.byId('profilePanel').hidden, false);
  assert.equal(env.byId('workspace').inert, true);
  assert.equal(env.byId('sidebar').inert, true);
  assert.equal(env.window.document.activeElement.id, 'closeProfile');
  env.byId('signOutBtn').focus();
  env.byId('signOutBtn').dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(env.window.document.activeElement.id, 'closeProfile');
  env.byId('closeProfile').dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(env.window.document.activeElement.id, 'signOutBtn');
  env.byId('signOutBtn').dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(env.byId('profilePanel').hidden, true);
  assert.equal(env.byId('workspace').inert, false);
  assert.equal(env.window.document.activeElement, trigger);
  trigger.click();
  env.byId('accountBackdrop').click();
  assert.equal(env.byId('profilePanel').hidden, true);
  assert.equal(env.window.document.activeElement, trigger);
});

test('the compact refresh control dispatches a read-refresh event for the component page', async t => {
  const env = page(t);
  await env.window.FoodHeavenShell.ready;
  const observed = [];
  env.window.addEventListener('foodheaven:refresh', event => observed.push(event.detail.page));
  env.byId('refreshWorkspace').click();
  assert.deepEqual(observed, ['employees']);
  assert.equal(env.calls.filter(request => request.method !== 'GET').length, 0);
});

test('opening account respects a dirty editor and keeps only one modal active', async t => {
  const env = page(t);
  await env.window.FoodHeavenShell.ready;
  await nextTurn();
  const employee = env.byId('employeeDrawer');
  employee.hidden = false;
  env.window.closeEmployeeDrawer = () => false;
  env.byId('accountTrigger').click();
  assert.equal(employee.hidden, false);
  assert.equal(env.byId('profilePanel').hidden, true);
  env.window.closeEmployeeDrawer = () => { employee.hidden = true; return true; };
  env.byId('accountTrigger').click();
  assert.equal(employee.hidden, true);
  assert.equal(env.byId('profilePanel').hidden, false);
});

test('failed profiles can recover when the account panel is reopened', async t => {
  let profiles = 0;
  const env = page(t, () => ++profiles === 1 ? json({ error: 'Unavailable' }, 503) : json({ employees: [manager] }));
  assert.equal(await env.window.FoodHeavenShell.ready, false);
  await nextTurn();
  assert.match(env.byId('shellManagerEmail').textContent, /unavailable/);
  env.byId('accountTrigger').click();
  await env.window.FoodHeavenShell.refreshProfile();
  assert.equal(env.byId('shellManagerName').textContent, 'Demo Manager');
  assert.equal(profiles, 2);
});

test('sign out is guarded while pending and recovers its controls after a failed request', async t => {
  let resolveLogout;
  const pending = new Promise(resolve => { resolveLogout = resolve; });
  let posts = 0;
  const env = page(t, (request, url) => {
    if (url === '/logout') { posts++; return pending; }
    return json({ employees: [manager] });
  });
  await env.window.FoodHeavenShell.ready;
  await nextTurn();
  env.byId('signOutBtn').click();
  env.byId('signOutBtn').click();
  await nextTurn();
  assert.equal(posts, 1);
  assert.equal(env.byId('signOutBtn').disabled, true);
  resolveLogout(json({ error: 'Unavailable' }, 503));
  await nextTurn();
  await nextTurn();
  assert.equal(env.byId('signOutBtn').disabled, false);
  assert.match(env.byId('clientNotice').textContent, /sign out/i);
});
