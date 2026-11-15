const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('../frontend/node_modules/jsdom');
const { storageKey } = require('./adapter.js');
const dist = path.resolve(__dirname, '../dist');
const base = process.env.DEMO_BASE_PATH || '/foodheaven/';

function asset(url) {
  const parsed = new URL(url, 'https://portfolio.example' + base);
  if (parsed.origin !== 'https://portfolio.example' || !parsed.pathname.startsWith(base)) return null;
  const relative = decodeURIComponent(parsed.pathname.slice(base.length));
  const file = path.resolve(dist, relative);
  assert.ok(file.startsWith(dist + path.sep), 'Asset remains inside the generated site');
  return file;
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
test('generated HTML references existing static assets at exactly one deployment base', () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Run node scripts/build-demo.mjs before these tests');
  for (const file of files(dist).filter(file => file.endsWith('.html'))) {
    const relative = path.relative(dist, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'utf8');
    assert.equal(html.includes(base + base.slice(1)), false, relative + ' must not contain a duplicated base path');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const href = match[1];
      if (href.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/.test(href)) continue;
      const url = new URL(href, 'https://portfolio.example' + base + relative);
      const resolved = asset(url.href);
      if (resolved && /\.(?:html|css|js|svg|png|jpe?g|webp|ico)$/i.test(resolved)) assert.ok(fs.existsSync(resolved), relative + ' references missing ' + url.pathname);
    }
  }
});

test('generated anonymous login loads adapter then real API wrapper and signs in without CSRF failure', async t => {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => { if (!error.message.includes('navigation')) errors.push(error.message); });
  const loaded = [];
  const localAssets = requestInterceptor(request => {
      const url = request.url;
      const file = asset(url);
      if (!file || !fs.existsSync(file)) return new Response('Missing generated asset', { status: 404 });
      loaded.push(new URL(url).pathname);
      const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      return new Response(fs.readFileSync(file), { headers: { 'Content-Type': contentType } });
  });
  let nativeCalls = 0;
  const html = fs.readFileSync(path.join(dist, 'Portal_login/Portal Page.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://portfolio.example' + base + 'Portal_login/Portal%20Page.html', runScripts: 'dangerously',
    resources: { interceptors: [localAssets] }, virtualConsole: console, pretendToBeVisual: true,
    beforeParse(win) {
      for (const key of ['Request', 'Response', 'Headers', 'AbortController']) win[key] = globalThis[key];
      win.fetch = async () => { nativeCalls++; throw Error('No real API is deployed in the static preview.'); };
    },
  });
  t.after(() => dom.window.close());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Generated login did not finish loading')), 10000);
    dom.window.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  assert.ok(loaded.includes(base + 'app.js'), 'Actual shared API wrapper was loaded');
  assert.ok(loaded.includes(base + 'demo-adapter.js'), 'Browser demo adapter was loaded');
  const doc = dom.window.document;
  doc.getElementById('loginForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let attempt = 0; attempt < 100 && !doc.getElementById('loginStatus').textContent.includes('Signed in.'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(doc.getElementById('loginStatus').textContent, /Signed in\./);
  assert.equal(JSON.parse(dom.window.sessionStorage.getItem(storageKey)).authenticated, true);
  assert.equal(nativeCalls, 0);
  assert.deepEqual(errors, []);
});
