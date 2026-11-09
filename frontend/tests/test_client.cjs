const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const token = 'a'.repeat(43);
const session = (csrf = token) => ({ authenticated: true, user: { MgrID: 1001 }, csrf_token: csrf });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function environment(t, handler, options = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(options.html || '<!doctype html><body><main></main></body>', {
    url: options.url || 'http://localhost:5000/interface.html', runScripts: 'outside-only', virtualConsole: console,
  });
  const { window } = dom;
  Object.assign(window, { Request, Response, Headers, AbortController, DOMException });
  const calls = [];
  window.fetch = async request => { calls.push(request); return handler(request, calls); };
  if (options.blockStorage) {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException('Storage is disabled', 'SecurityError'); } });
  }
  if (options.shortTimeout) {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 12000 ? 10 : delay, ...args);
  }
  window.eval(source);
  const ready = window.FoodHeaven.ready;
  t.after(() => dom.window.close());
  return { window, ready, calls, errors };
}

test('a failed bootstrap can recover through Retry without reloading or replaying data writes', async t => {
  let attempts = 0;
  const env = environment(t, request => {
    if (new URL(request.url).pathname === '/api/session') {
      if (++attempts === 1) throw new TypeError('offline');
      return json(session());
    }
    return json([{ EmployeeID: 1 }]);
  });
  await assert.rejects(env.ready, error => error.code === 'NETWORK' && !error.uncertain);
  const notice = env.window.document.getElementById('clientNotice');
  assert.equal(notice.getAttribute('role'), 'status');
  assert.equal(notice.hidden, false);
  let restored = 0;
  env.window.addEventListener('foodheaven:connection-restored', () => restored++);
  await env.window.FoodHeaven.retrySession();
  const response = await env.window.fetch('/api/employees');
  assert.equal(response.status, 200);
  assert.equal(restored, 1);
  assert.equal(attempts, 2);
  assert.equal(env.calls.filter(request => request.method !== 'GET').length, 0);
});

test('blocked storage does not break sessions, theme changes, or busy-state restoration', async t => {
  const markup = '<!doctype html><body><button class="theme-toggle" data-preserve-label><svg></svg><span>Appearance</span></button><button id="locked" disabled aria-busy="false">Save</button></body>';
  const env = environment(t, () => json(session()), { blockStorage: true, html: markup });
  await env.ready;
  await nextTurn();
  assert.equal(env.window.FoodHeaven.storageGet('theme'), null);
  assert.equal(env.window.FoodHeaven.storageSet('theme', 'dark'), false);
  const button = env.window.document.querySelector('.theme-toggle');
  const children = button.innerHTML;
  button.click();
  assert.equal(button.innerHTML, children);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  const locked = env.window.document.getElementById('locked');
  env.window.FoodHeaven.setBusy(locked, true);
  env.window.FoodHeaven.setBusy(locked, true);
  env.window.FoodHeaven.setBusy(locked, false);
  assert.equal(locked.disabled, true);
  assert.equal(locked.getAttribute('aria-busy'), 'false');
});

test('Request inputs preserve method, JSON body, custom headers, and add the current CSRF token', async t => {
  let received;
  const env = environment(t, async request => {
    if (request.url.endsWith('/api/session')) return json(session());
    received = { method: request.method, body: await request.text(), audit: request.headers.get('X-Audit'), csrf: request.headers.get('X-CSRF-Token'), credentials: request.credentials };
    return json({ message: 'Saved' }, 201);
  });
  await env.ready;
  const request = new Request('http://localhost:5000/employees/add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Audit': 'kept' }, body: JSON.stringify({ EmployeeID: 17 }) });
  const response = await env.window.fetch(request);
  assert.equal(response.status, 201);
  assert.deepEqual(received, { method: 'POST', body: '{"EmployeeID":17}', audit: 'kept', csrf: token, credentials: 'same-origin' });
});

test('URL objects and non-API fetches keep their ordinary response types', async t => {
  const env = environment(t, request => request.url.endsWith('/api/session') ? json(session()) : new Response('body {}', { headers: { 'Content-Type': 'text/css' } }));
  await env.ready;
  const response = await env.window.fetch(new env.window.URL('/styles.css', env.window.location.href));
  assert.equal(response.headers.get('Content-Type'), 'text/css');
  assert.equal(await response.text(), 'body {}');
});

test('cancelling a caller waiting for bootstrap does not cancel the shared session request', async t => {
  let resolveSession;
  const pending = new Promise(resolve => { resolveSession = resolve; });
  const env = environment(t, request => request.url.endsWith('/api/session') ? pending : json([]));
  const controller = new AbortController();
  const response = env.window.fetch('/api/employees', { signal: controller.signal });
  controller.abort();
  await assert.rejects(response, error => error.name === 'AbortError');
  assert.equal(env.calls.length, 1);
  resolveSession(json(session()));
  await env.ready;
  assert.equal(env.calls[0].signal.aborted, false);
});

test('an already cancelled mutation is never sent', async t => {
  const env = environment(t, () => json(session()));
  await env.ready;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(env.window.fetch('/employees/add', { method: 'POST', body: '{}', signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(env.calls.length, 1);
});

test('transport timeouts identify an uncertain mutation and never replay it', async t => {
  const env = environment(t, request => {
    if (request.url.endsWith('/api/session')) return json(session());
    return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
  }, { shortTimeout: true });
  await env.ready;
  await assert.rejects(env.window.fetch('/employees/add', { method: 'POST', body: '{}' }), error => error.code === 'TIMEOUT' && error.uncertain === true);
  assert.equal(env.calls.filter(request => request.method === 'POST').length, 1);
  assert.match(env.window.document.getElementById('clientNotice').textContent, /Refresh the records/);
});

test('caller abort after dispatch preserves AbortError and flags an uncertain write', async t => {
  let dispatched;
  const observed = new Promise(resolve => { dispatched = resolve; });
  const env = environment(t, request => {
    if (request.url.endsWith('/api/session')) return json(session());
    dispatched();
    return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
  });
  await env.ready;
  const controller = new AbortController();
  const response = env.window.fetch('/employees/add', { method: 'POST', body: '{}', signal: controller.signal });
  await observed;
  controller.abort();
  await assert.rejects(response, error => error.name === 'AbortError' && error.uncertain === true);
  assert.equal(env.calls.filter(request => request.method === 'POST').length, 1);
});

test('a custom immutable abort reason cannot hide an uncertain mutation result', async t => {
  let dispatched;
  const observed = new Promise(resolve => { dispatched = resolve; });
  const env = environment(t, request => {
    if (request.url.endsWith('/api/session')) return json(session());
    dispatched();
    return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
  });
  await env.ready;
  const controller = new AbortController();
  const response = env.window.fetch('/employees/add', { method: 'POST', body: '{}', signal: controller.signal });
  await observed;
  controller.abort(Object.freeze(new Error('Cancelled by caller')));
  await assert.rejects(response, error => error.name === 'AbortError' && error.uncertain === true && error.cause.message === 'Cancelled by caller');
});

test('the timeout also covers a JSON body that stops arriving after response headers', async t => {
  const env = environment(t, request => {
    if (request.url.endsWith('/api/session')) return json(session());
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('['));
        request.signal.addEventListener('abort', () => controller.error(request.signal.reason), { once: true });
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  }, { shortTimeout: true });
  await env.ready;
  await assert.rejects(env.window.fetch('/api/employees'), error => error.code === 'TIMEOUT' && error.uncertain === false);
});

test('only the explicit pre-mutation CSRF rejection refreshes the session; the rejected write is not replayed', async t => {
  let sessions = 0, posts = 0;
  const tokens = [];
  const env = environment(t, request => {
    if (request.url.endsWith('/api/session')) return json(session(++sessions === 1 ? token : 'b'.repeat(43)));
    posts++;
    tokens.push(request.headers.get('X-CSRF-Token'));
    return posts === 1 ? json({ error: 'Refresh the page and try again with a valid CSRF token.' }, 403) : json({ message: 'Saved' });
  });
  await env.ready;
  const first = await env.window.fetch('/employees/add', { method: 'POST', body: '{}' });
  assert.equal(first.status, 403);
  assert.equal((await first.json()).code, 'CSRF_REFRESHED');
  assert.equal(posts, 1);
  assert.equal(sessions, 2);
  await env.window.fetch('/employees/add', { method: 'POST', body: '{}' });
  assert.deepEqual(tokens, [token, 'b'.repeat(43)]);
});

test('an ordinary forbidden response never triggers a session refresh or request replay', async t => {
  const env = environment(t, request => request.url.endsWith('/api/session') ? json(session()) : json({ error: 'Access denied.' }, 403));
  await env.ready;
  const response = await env.window.fetch('/employees/delete/1001', { method: 'DELETE' });
  assert.equal(response.status, 403);
  assert.equal(env.calls.length, 2);
});

test('an unreadable mutation result stays uncertain and is never resubmitted', async t => {
  const env = environment(t, request => request.url.endsWith('/api/session') ? json(session()) : new Response('<html>Unavailable</html>', { headers: { 'Content-Type': 'text/html' } }));
  await env.ready;
  await assert.rejects(env.window.fetch('/employees/add', { method: 'POST', body: '{}' }), error => error.code === 'INVALID_RESPONSE' && error.uncertain === true);
  assert.equal(env.calls.filter(request => request.method === 'POST').length, 1);
});

test('simultaneous expired-session responses trigger a single sign-in redirect', async t => {
  const env = environment(t, request => request.url.endsWith('/api/session') ? json(session()) : json({ error: 'Sign in to continue.' }, 401));
  await env.ready;
  await Promise.all([env.window.fetch('/api/employees'), env.window.fetch('/payroll/get/')]);
  assert.equal(env.errors.filter(error => /navigation/i.test(error.message)).length, 1);
});

test('status text is accessible and treats server-like HTML as text', async t => {
  const env = environment(t, () => json(session()));
  await env.ready;
  env.window.FoodHeaven.reportStatus('<img src=x onerror=alert(1)>', { kind: 'warning' });
  const notice = env.window.document.getElementById('clientNotice');
  assert.equal(notice.querySelector('img'), null);
  assert.match(notice.textContent, /<img/);
  assert.equal(notice.getAttribute('aria-live'), 'polite');
  env.window.FoodHeaven.clearStatus();
  assert.equal(notice.hidden, true);
});
