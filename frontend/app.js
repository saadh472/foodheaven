/* Shared API/session handling. Mutating requests are never automatically replayed. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const loginPath = '/Portal_login/Portal%20Page.html';
  const publicPage = location.pathname === '/' || location.pathname === '/index.html' || location.pathname.startsWith('/Portal_login/');
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const apiPath = /^\/(?:api(?:\/|$)|employees?(?:\/|$)|manager(?:\/|$)|payroll(?:\/|$)|shift(?:\/|$)|attendance(?:\/|$)|performance(?:\/|$)|login(?:\/|$)|logout(?:\/|$))/;
  const csrfMessage = 'Refresh the page and try again with a valid CSRF token.';
  let csrfToken = '';
  let sessionState = null;
  let sessionInFlight = null;
  let redirecting = false;
  let noticeState = null;
  const busyStates = new WeakMap();

  function storageGet(key, area = 'local') {
    try { return window[area === 'session' ? 'sessionStorage' : 'localStorage'].getItem(key); }
    catch { return null; }
  }
  function storageSet(key, value, area = 'local') {
    try { window[area === 'session' ? 'sessionStorage' : 'localStorage'].setItem(key, String(value)); return true; }
    catch { return false; }
  }
  function storageRemove(key, area = 'local') {
    try { window[area === 'session' ? 'sessionStorage' : 'localStorage'].removeItem(key); return true; }
    catch { return false; }
  }

  function setBusy(element, busy) {
    if (!element) return;
    if (busy) {
      if (!busyStates.has(element)) busyStates.set(element, { disabled: element.disabled, aria: element.getAttribute('aria-busy') });
      if ('disabled' in element) element.disabled = true;
      element.setAttribute('aria-busy', 'true');
    } else if (busyStates.has(element)) {
      const previous = busyStates.get(element);
      if ('disabled' in element) element.disabled = previous.disabled;
      if (previous.aria === null) element.removeAttribute('aria-busy');
      else element.setAttribute('aria-busy', previous.aria);
      busyStates.delete(element);
    }
  }

  function renderNotice() {
    if (!document.body) return;
    let notice = document.getElementById('clientNotice');
    if (!notice && !noticeState) return;
    if (!notice) {
      notice = document.createElement('section');
      notice.id = 'clientNotice';
      notice.className = 'client-notice';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.setAttribute('aria-atomic', 'true');
      document.body.prepend(notice);
    }
    notice.hidden = !noticeState;
    notice.replaceChildren();
    if (!noticeState) return;
    notice.dataset.kind = noticeState.kind;
    const message = document.createElement('span');
    message.className = 'client-notice-message';
    message.textContent = noticeState.message;
    notice.appendChild(message);
    if (noticeState.onAction) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = noticeState.actionLabel || 'Retry connection';
      const action = noticeState.onAction;
      button.addEventListener('click', async () => {
        setBusy(button, true);
        try { await action(); }
        catch (error) { reportStatus(error.message || 'The connection is still unavailable.', { kind: 'error', source: 'connection', onAction: retrySession }); }
        finally { setBusy(button, false); }
      });
      notice.appendChild(button);
    }
  }
  function reportStatus(message, options = {}) {
    noticeState = { message: String(message), kind: options.kind || 'info', ...options };
    renderNotice();
  }
  function clearStatus() { noticeState = null; renderNotice(); }

  function failure(message, code, uncertain = false, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.name = 'FoodHeavenError';
    error.code = code;
    error.uncertain = uncertain;
    return error;
  }
  function abortReason(signal) {
    return signal.reason || new DOMException('The request was cancelled.', 'AbortError');
  }
  function announceFailure(error) {
    if (error?.name === 'AbortError') return;
    reportStatus(error.message, { kind: error.uncertain ? 'warning' : 'error', source: 'connection', onAction: retrySession });
  }
  function redirectToLogin() {
    storageRemove('MgrID', 'session');
    if (redirecting || publicPage) return;
    redirecting = true;
    reportStatus('Your session has ended. Sign in again to continue.', { kind: 'warning' });
    location.replace(loginPath);
  }
  function normalizeRequest(input, options = {}) {
    const source = input instanceof Request ? input : new URL(input, document.baseURI).href;
    return new Request(source, options);
  }
  function copyResponse(response, text, method) {
    const empty = method === 'HEAD' || [204, 205, 304].includes(response.status);
    const result = new Response(empty ? null : text, { status: response.status, statusText: response.statusText, headers: response.headers });
    // Rebuilding the already-read API body keeps JSON reads inside the timeout.
    // Preserve the useful response metadata for callers.
    for (const property of ['url', 'redirected', 'type']) {
      try { Object.defineProperty(result, property, { value: response[property] }); } catch { /* Metadata is optional. */ }
    }
    return result;
  }

  async function send(request, expectJson) {
    if (request.signal.aborted) throw abortReason(request.signal);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    const mutation = !safeMethods.has(request.method);
    try {
      const response = await nativeFetch(new Request(request, { signal: controller.signal }));
      if (!expectJson) return { response, payload: null };
      const text = await response.text();
      const empty = request.method === 'HEAD' || [204, 205, 304].includes(response.status);
      let payload = null;
      if (!empty) {
        if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
          throw failure('FoodHeaven returned an unexpected response. Check the local server before retrying.', 'INVALID_RESPONSE', mutation);
        }
        try { payload = JSON.parse(text); }
        catch { throw failure(mutation
          ? 'The server response could not be read. Refresh the records before submitting another change.'
          : 'The server response could not be read. Check the local server and retry loading.', 'INVALID_RESPONSE', mutation); }
      }
      return { response: copyResponse(response, text, request.method), payload };
    } catch (error) {
      if (timedOut) {
        throw failure(mutation
          ? 'The request timed out before its result could be confirmed. Refresh the records before submitting again.'
          : 'FoodHeaven took too long to respond. Check the local server and retry loading.', 'TIMEOUT', mutation, error);
      }
      if (request.signal.aborted) {
        const reason = abortReason(request.signal);
        try { reason.uncertain = mutation; } catch { /* Abort reasons may be immutable. */ }
        if (mutation && reason?.uncertain !== true) {
          const wrapped = new DOMException('The request was cancelled before its result could be confirmed.', 'AbortError');
          wrapped.cause = reason;
          wrapped.uncertain = true;
          throw wrapped;
        }
        throw reason;
      }
      if (error.name === 'FoodHeavenError') throw error;
      throw failure(mutation
        ? 'The connection was interrupted before the result could be confirmed. Refresh the records before submitting again.'
        : 'Cannot reach FoodHeaven. Start the local server or check its connection, then retry.', 'NETWORK', mutation, error);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }

  function updateSession(state) {
    if (!state || typeof state.authenticated !== 'boolean' || typeof state.csrf_token !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(state.csrf_token) ||
        (state.authenticated && (!state.user || typeof state.user !== 'object' || Array.isArray(state.user)))) {
      throw failure('FoodHeaven could not validate the session response. Check the local server and retry.', 'SESSION');
    }
    sessionState = state;
    csrfToken = state.csrf_token;
    if (state.authenticated && state.user.MgrID != null) storageSet('MgrID', state.user.MgrID, 'session');
    else storageRemove('MgrID', 'session');
    if (!state.authenticated) redirectToLogin();
    return state;
  }
  function ensureSession(force = false) {
    if (sessionInFlight) return sessionInFlight;
    if (!force && sessionState) return Promise.resolve(sessionState);
    sessionInFlight = (async () => {
      try {
        const request = normalizeRequest('/api/session', { credentials: 'same-origin', cache: 'no-store' });
        const result = await send(request, true);
        if (!result.response.ok) throw failure('FoodHeaven could not load your session. Check the local server and retry.', 'SESSION');
        return updateSession(result.payload);
      } catch (error) {
        sessionState = null;
        csrfToken = '';
        announceFailure(error);
        throw error;
      } finally { sessionInFlight = null; }
    })();
    return sessionInFlight;
  }
  function awaitWithAbort(promise, signal) {
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(abortReason(signal)); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
  async function retrySession() {
    const state = await ensureSession(true);
    reportStatus('Connection restored. Retry loading the records you need.', { kind: 'success' });
    window.dispatchEvent(new CustomEvent('foodheaven:connection-restored', { detail: state }));
    return state;
  }

  window.fetch = async (input, options = {}) => {
    let request = normalizeRequest(input, options);
    const url = new URL(request.url);
    const managed = url.origin === location.origin && apiPath.test(url.pathname);
    if (!managed) return (await send(request, false)).response;
    if (request.signal.aborted) throw abortReason(request.signal);
    const mutation = !safeMethods.has(request.method);
    try {
      if (url.pathname === '/api/session' && request.method === 'GET') {
        // Finish bootstrap first so concurrent anonymous session cookies cannot race.
        if (sessionInFlight) await awaitWithAbort(sessionInFlight.catch(() => {}), request.signal);
      } else {
        const state = await awaitWithAbort(ensureSession(), request.signal);
        if (mutation && !state.authenticated && !url.pathname.startsWith('/login')) {
          redirectToLogin();
          throw failure('Sign in again before saving changes.', 'AUTH');
        }
      }
      const headers = new Headers(request.headers);
      if (mutation) headers.set('X-CSRF-Token', csrfToken);
      request = new Request(request, { headers, credentials: 'same-origin' });
      const result = await send(request, true);
      const { response, payload } = result;
      if (url.pathname === '/api/session' && response.ok) updateSession(payload);
      if (response.status === 401 && url.pathname !== '/login') {
        sessionState = null;
        csrfToken = '';
        redirectToLogin();
      }
      if (response.ok && mutation && payload?.csrf_token) {
        updateSession({ authenticated: url.pathname !== '/logout', user: payload.user || sessionState?.user, csrf_token: payload.csrf_token });
      }
      if (mutation && response.status === 403 && payload?.error === csrfMessage) {
        // This exact server guard runs before any mutation. Refresh only the
        // session; the user reviews and submits the rejected operation again.
        sessionState = null;
        csrfToken = '';
        await ensureSession(true);
        const message = 'Your session was refreshed. The change was not saved. Review it and submit again.';
        reportStatus(message, { kind: 'warning' });
        const headers = new Headers(response.headers);
        headers.delete('Content-Length');
        return new Response(JSON.stringify({ ...payload, error: message, code: 'CSRF_REFRESHED' }), { status: 403, headers });
      }
      if (response.status >= 500) {
        reportStatus('FoodHeaven could not load or save this data. Check the local server and database, then retry loading the records.', { kind: 'error', source: 'connection', onAction: retrySession });
      }
      return response;
    } catch (error) {
      announceFailure(error);
      throw error;
    }
  };

  function cell(row, value) {
    const td = document.createElement('td');
    td.textContent = value ?? '';
    row.appendChild(td);
    return td;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  async function logout() {
    const response = await fetch('/logout', { method: 'POST' });
    if (!response.ok) throw failure('Could not sign out. Please retry.', 'AUTH');
    storageRemove('MgrID', 'session');
    if (!redirecting) { redirecting = true; location.replace(loginPath); }
  }

  function syncThemeControls() {
    const dark = document.body?.classList.contains('dark-theme') || false;
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
      button.setAttribute('aria-pressed', String(dark));
      button.title = 'Switch to ' + (dark ? 'light' : 'dark') + ' theme';
      if (!button.hasAttribute('data-preserve-label')) button.textContent = dark ? '\u2600\ufe0f' : '\ud83c\udf19';
    }
  }
  function setTheme(theme) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.body?.classList.toggle('dark-theme', selected === 'dark');
    document.documentElement.dataset.theme = selected;
    storageSet('theme', selected);
    syncThemeControls();
    window.dispatchEvent(new CustomEvent('foodheaven:themechange', { detail: { theme: selected } }));
    return selected;
  }
  function loadTheme() { return setTheme(storageGet('theme') === 'dark' ? 'dark' : 'light'); }
  function toggleTheme() { return setTheme(document.body?.classList.contains('dark-theme') ? 'light' : 'dark'); }

  window.FoodHeaven = {
    get ready() { return ensureSession(); },
    cell, escapeHtml, logout, retrySession, reportStatus, clearStatus, setBusy,
    storageGet, storageSet, storageRemove,
    storage: { get: storageGet, set: storageSet, remove: storageRemove },
    loadTheme, setTheme, toggleTheme,
  };

  function initializePage() {
    renderNotice();
    loadTheme();
    for (const link of document.querySelectorAll('.workspace-links a, .nav-links a')) {
      if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page');
    }
    for (const input of document.querySelectorAll('input[placeholder]')) {
      if (!input.labels?.length && !input.hasAttribute('aria-label')) input.setAttribute('aria-label', input.placeholder);
    }
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.removeAttribute('onclick');
      button.addEventListener('click', toggleTheme);
    }
    const passwordToggle = document.getElementById('toggle-password');
    if (passwordToggle) {
      passwordToggle.setAttribute('role', 'button');
      passwordToggle.tabIndex = 0;
      passwordToggle.setAttribute('aria-label', 'Show or hide password');
      passwordToggle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); passwordToggle.click(); }
      });
    }
    const drawer = document.getElementById('profilePanel');
    if (drawer) {
      document.getElementById('accountTrigger')?.addEventListener('click', () => window.toggleCanvas());
      document.getElementById('closeProfile')?.addEventListener('click', () => window.toggleCanvas());
      document.addEventListener('keydown', event => {
        if (!drawer.classList.contains('active')) return;
        if (event.key === 'Escape') { event.preventDefault(); window.toggleCanvas(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...drawer.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePage, { once: true });
  else initializePage();
  ensureSession().catch(() => {});
})();
