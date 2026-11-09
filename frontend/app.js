/* Shared same-origin API, session and DOM helpers. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const loginPath = '/Portal_login/Portal%20Page.html';
  const publicPage = location.pathname === '/' || location.pathname === '/index.html' || location.pathname.startsWith('/Portal_login/');
  let csrfToken = '';

  async function request(input, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12000);
    try {
      return await nativeFetch(input, { ...options, credentials: 'same-origin', signal: controller.signal });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  const ready = request('/api/session').then(async response => {
    if (!response.ok) throw new Error('The local server is unavailable. Start FoodHeaven and reload.');
    const state = await response.json();
    csrfToken = state.csrf_token;
    if (state.authenticated && state.user?.MgrID != null) sessionStorage.setItem('MgrID', String(state.user.MgrID));
    else sessionStorage.removeItem('MgrID');
    if (!state.authenticated && !publicPage) location.replace(loginPath);
    return state;
  });
  // Page requests surface this failure through their own status UI.
  ready.catch(() => {});

  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.origin !== location.origin) return request(input, options);
    await ready;
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrfToken);
    const response = await request(input, { ...options, headers });
    if (response.status === 401 && url.pathname !== '/login') {
      sessionStorage.removeItem('MgrID');
      location.replace(loginPath);
    }
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('Unexpected server response. Start FoodHeaven with its launcher and reload.');
    }
    if (response.ok && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const state = await response.clone().json();
      if (state.csrf_token) csrfToken = state.csrf_token;
    }
    return response;
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
    if (!response.ok) throw new Error('Could not sign out. Please retry.');
    sessionStorage.clear();
    location.replace(loginPath);
  }

  window.FoodHeaven = { ready, cell, escapeHtml, logout };

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
    } catch { /* Storage may be unavailable in a private browsing context. */ }

    for (const link of document.querySelectorAll('.workspace-links a, .nav-links a')) {
      if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page');
    }
    for (const input of document.querySelectorAll('input[placeholder]')) {
      if (!input.labels?.length && !input.hasAttribute('aria-label')) input.setAttribute('aria-label', input.placeholder);
    }
    const themeButton = document.querySelector('.theme-toggle');
    if (themeButton) {
      themeButton.setAttribute('aria-label', 'Switch color theme');
      const syncTheme = () => themeButton.setAttribute('aria-pressed', String(document.body.classList.contains('dark-theme')));
      syncTheme();
      themeButton.addEventListener('click', syncTheme);
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
      document.getElementById('accountTrigger').addEventListener('click', () => window.toggleCanvas());
      document.getElementById('closeProfile').addEventListener('click', () => window.toggleCanvas());
      document.addEventListener('keydown', event => {
        if (!drawer.classList.contains('active')) return;
        if (event.key === 'Escape') { event.preventDefault(); window.toggleCanvas(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...drawer.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
    }
  });
})();
