const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'Portal_login', 'Portal Page.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const csrf = 'a'.repeat(43);

function page(t, respond, { blockedStorage = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'http://localhost:5000/Portal_login/Portal%20Page.html', runScripts: 'outside-only', virtualConsole });
  const { window } = dom;
  Object.assign(window, { Request, Response, Headers, AbortController, DOMException });
  if (blockedStorage) {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new DOMException('Disabled', 'SecurityError'); } });
  }
  const posts = [];
  window.fetch = async request => {
    if (new URL(request.url).pathname === '/api/session') return json({ authenticated: false, user: null, csrf_token: csrf });
    posts.push({ body: JSON.parse(await request.text()), csrf: request.headers.get('X-CSRF-Token') });
    return respond ? respond(request, posts) : json({ error: 'Invalid login ID or password.' }, 401);
  };
  window.eval(source);
  inline.forEach(script => window.eval(script));
  t.after(() => dom.window.close());
  const byId = id => window.document.getElementById(id);
  const submit = () => byId('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  return { window, posts, errors, byId, submit };
}

test('public demo values are prefilled but neither page load nor refill signs in automatically', async t => {
  const env = page(t);
  await env.window.FoodHeaven.ready;
  await nextTurn();
  assert.equal(env.byId('employee-id').value, '1001');
  assert.equal(env.byId('password').value, 'DemoPass123!');
  assert.equal(env.posts.length, 0);
  env.byId('employee-id').value = 'saad';
  env.byId('password').value = '';
  env.byId('toggle-password').click();
  env.byId('useDemoAccount').click();
  assert.equal(env.byId('employee-id').value, '1001');
  assert.equal(env.byId('password').value, 'DemoPass123!');
  assert.equal(env.byId('password').type, 'password');
  assert.equal(env.posts.length, 0);
  assert.match(env.byId('loginStatus').textContent, /Choose Sign in/);
});

test('names, zero, and out-of-range IDs explain numeric login IDs without posting', async t => {
  const env = page(t);
  await env.window.FoodHeaven.ready;
  for (const invalid of ['saad', '0', '2147483648', '1.5', '']) {
    env.byId('employee-id').value = invalid;
    env.submit();
    await nextTurn();
    assert.equal(env.posts.length, 0);
    assert.equal(env.byId('employee-id').getAttribute('aria-invalid'), 'true');
    assert.match(env.byId('loginStatus').textContent, /numeric manager ID/);
  }
});

test('empty passwords are rejected and the demo button restores usable values', async t => {
  const env = page(t);
  await env.window.FoodHeaven.ready;
  env.byId('password').value = '';
  env.submit();
  assert.equal(env.posts.length, 0);
  assert.equal(env.byId('password').getAttribute('aria-invalid'), 'true');
  env.byId('useDemoAccount').click();
  assert.equal(env.byId('password').hasAttribute('aria-invalid'), false);
  assert.equal(env.byId('password').value, 'DemoPass123!');
});

test('rapid submits dispatch one login request and a failed login restores the controls', async t => {
  let resolveLogin;
  const pending = new Promise(resolve => { resolveLogin = resolve; });
  const env = page(t, () => pending);
  await env.window.FoodHeaven.ready;
  env.submit();
  env.submit();
  await nextTurn();
  assert.equal(env.posts.length, 1);
  assert.equal(env.byId('loginSubmit').disabled, true);
  assert.equal(env.byId('useDemoAccount').disabled, true);
  assert.deepEqual(env.posts[0].body, { LoginID: 1001, Password: 'DemoPass123!' });
  assert.equal(env.posts[0].csrf, csrf);
  resolveLogin(json({ error: 'Invalid login ID or password.' }, 401));
  await nextTurn();
  await nextTurn();
  assert.equal(env.byId('loginSubmit').disabled, false);
  assert.equal(env.byId('useDemoAccount').disabled, false);
  assert.equal(env.byId('loginForm').getAttribute('aria-busy'), 'false');
  assert.match(env.byId('loginStatus').textContent, /Invalid login/);
});

test('blocked browser storage does not turn a successful login into a failure', async t => {
  const env = page(t, () => json({ message: 'Login successful.', MgrID: 1001, user: { MgrID: 1001 }, csrf_token: 'b'.repeat(43) }), { blockedStorage: true });
  await env.window.FoodHeaven.ready;
  env.submit();
  await nextTurn();
  await nextTurn();
  assert.equal(env.posts.length, 1);
  assert.equal(env.byId('loginStatus').dataset.kind, 'success');
  assert.match(env.byId('loginStatus').textContent, /Signed in/);
  assert.equal(env.byId('loginSubmit').disabled, true);
  env.submit();
  await nextTurn();
  assert.equal(env.posts.length, 1);
  assert.equal(env.errors.filter(error => !/navigation/i.test(error.message)).length, 0);
});

test('show password remains operable from the keyboard without submitting the form', async t => {
  const env = page(t);
  await env.window.FoodHeaven.ready;
  await nextTurn();
  env.byId('toggle-password').dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(env.byId('password').type, 'text');
  assert.equal(env.byId('toggle-password').getAttribute('aria-pressed'), 'true');
  assert.equal(env.posts.length, 0);
});
