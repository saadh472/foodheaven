/* Mount the overview's navigation and account chrome around a component page. */
(() => {
  'use strict';
  const main = document.getElementById('main-content');
  if (!main || document.getElementById('workspace') || document.getElementById('sidebar')) return;
  const pages = {
    overview: { title: 'Overview', path: '/interface.html' },
    employees: { title: 'Employees', path: '/Sidebar/Sidebar_employeedetails.html' },
    attendance: { title: 'Attendance', path: '/Sidebar/Sidebar_attendance.html' },
    payroll: { title: 'Payroll', path: '/Sidebar/Sidebar_payroll.html' },
    shifts: { title: 'Shifts', path: '/Sidebar/Sidebar_shift.html' },
    performance: { title: 'Performance', path: '/Sidebar/Sidebar_performance.html' },
    analytics: { title: 'Analytics', path: '/Sidebar/Sidebar_analytics.html' },
  };
  const key = Object.hasOwn(pages, document.body.dataset.page) ? document.body.dataset.page
    : Object.keys(pages).find(name => pages[name].path === location.pathname) || 'overview';
  const title = document.body.dataset.pageTitle || pages[key].title;
  document.body.classList.add('app-page', 'dashboard-page');
  main.classList.add('overview-content');
  if (!main.hasAttribute('tabindex')) main.tabIndex = -1;

  // The template contains only fixed application markup. Profile data is
  // written through textContent below, never interpolated into this template.
  const template = document.createElement('template');
  template.innerHTML = `
<aside id="sidebar" class="workspace-sidebar" aria-label="Main navigation">
  <a class="brand-lockup" href="/interface.html"><span class="brand-mark" aria-hidden="true">fh.</span><span><strong>FoodHeaven</strong><small>Team workspace</small></span></a>
  <span class="nav-caption">WORKSPACE</span>
  <nav class="workspace-menu">
    <a href="/interface.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#grid"/></svg>Overview</a>
    <a href="/Sidebar/Sidebar_employeedetails.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#users"/></svg>Employees</a>
    <a href="/Sidebar/Sidebar_attendance.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#calendar"/></svg>Attendance</a>
    <a href="/Sidebar/Sidebar_payroll.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#wallet"/></svg>Payroll</a>
    <a href="/Sidebar/Sidebar_shift.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#clock"/></svg>Shifts</a>
    <a href="/Sidebar/Sidebar_performance.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#award"/></svg>Performance</a>
    <a href="/Sidebar/Sidebar_analytics.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#chart"/></svg>Analytics</a>
  </nav>
  <div class="sidebar-bottom"><div class="workspace-label"><span class="workspace-dot" aria-hidden="true"></span><span>Employee portal<small>FoodHeaven workspace</small></span></div><button type="button" class="theme-toggle" data-preserve-label aria-label="Switch color theme"><svg class="icon" aria-hidden="true"><use href="/icons.svg#sun"/></svg><span>Appearance</span></button></div>
</aside>
<div class="workspace-shell" id="workspace">
  <header class="workspace-topbar">
    <div class="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong id="shellPageTitle"></strong></div>
    <div class="topbar-actions"><span id="updateTime" class="update-time" aria-live="polite">Employee workspace</span><button type="button" id="refreshWorkspace" class="icon-button" aria-label="Refresh workspace"><svg class="icon" aria-hidden="true"><use href="/icons.svg#refresh"/></svg></button><button type="button" id="accountTrigger" class="account-trigger" aria-controls="profilePanel" aria-expanded="false" aria-haspopup="dialog"><span class="small-avatar" id="topAvatar" aria-hidden="true">M</span><span class="account-name managerName" id="shellAccountName">My account</span><svg class="icon" aria-hidden="true"><use href="/icons.svg#chevron"/></svg></button></div>
  </header>
</div>
<div id="accountBackdrop" class="drawer-backdrop" aria-hidden="true" hidden></div>
<aside id="profilePanel" class="account-drawer" role="dialog" aria-modal="true" aria-labelledby="accountTitle" aria-hidden="true" hidden>
  <header class="drawer-heading"><h2 id="accountTitle">Your account</h2><button type="button" id="closeProfile" class="icon-button" aria-label="Close account panel"><svg class="icon" aria-hidden="true"><use href="/icons.svg#close"/></svg></button></header>
  <div class="account-identity"><span id="profileAvatar" class="large-avatar" aria-hidden="true">M</span><h3 class="managerName" id="shellManagerName">Manager</h3><p class="managerEmail" id="shellManagerEmail">Loading profile…</p><span class="role-badge">Workspace manager</span></div>
  <nav class="account-links" aria-label="Account actions"><a id="viewProfileBtn" href="/Canvas/Canvas_viewprofile.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#users"/></svg>View profile</a><a id="changePasswordBtn" href="/Canvas/Canvas_changepassword.html"><svg class="icon" aria-hidden="true"><use href="/icons.svg#lock"/></svg>Change password</a></nav>
  <button id="signOutBtn" type="button" class="logout-action"><svg class="icon" aria-hidden="true"><use href="/icons.svg#logout"/></svg>Sign out</button>
</aside>`;
  const sidebar = template.content.querySelector('#sidebar');
  const workspace = template.content.querySelector('#workspace');
  const backdrop = template.content.querySelector('#accountBackdrop');
  const panel = template.content.querySelector('#profilePanel');
  main.replaceWith(workspace);
  workspace.appendChild(main);
  document.body.prepend(sidebar);
  document.body.append(backdrop, panel);
  if (!document.querySelector('.skip-link')) {
    const skip = document.createElement('a');
    skip.className = 'skip-link'; skip.href = '#main-content'; skip.textContent = 'Skip to main content';
    document.body.prepend(skip);
  }
  const byId = id => document.getElementById(id);
  byId('shellPageTitle').textContent = title;
  byId('refreshWorkspace').setAttribute('aria-label', 'Refresh ' + title.toLowerCase());
  for (const link of sidebar.querySelectorAll('.workspace-menu a')) {
    if (new URL(link.href).pathname === pages[key].path) link.setAttribute('aria-current', 'page');
  }

  let profilePending = null;
  let profileLoaded = false;
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
  function loadProfile() {
    if (profilePending) return profilePending;
    profilePending = (async () => {
      try {
        const response = await fetch('/employee/profile/');
        const payload = await response.json();
        const manager = payload?.employees?.[0];
        if (!response.ok || !manager || typeof manager.EmployeeName !== 'string' || !manager.EmployeeName.trim()) throw new Error('Profile unavailable.');
        const name = manager.EmployeeName.trim();
        byId('shellAccountName').textContent = name;
        byId('shellManagerName').textContent = name;
        byId('shellManagerEmail').textContent = typeof manager.EmailID === 'string' && manager.EmailID.trim() ? manager.EmailID : 'No email added';
        byId('topAvatar').textContent = initials(name);
        byId('profileAvatar').textContent = initials(name);
        byId('accountTrigger').setAttribute('aria-label', 'Open account for ' + name);
        profileLoaded = true;
        return true;
      } catch {
        byId('shellManagerEmail').textContent = 'Profile unavailable. Reopen this panel or restore the connection to retry.';
        profileLoaded = false;
        return false;
      } finally { profilePending = null; }
    })();
    return profilePending;
  }

  let previousInert = null;
  let previousDrawerOpen = false;
  let previousFocus = null;
  window.toggleCanvas = () => {
    const opening = panel.hidden;
    if (opening && typeof window.closeEmployeeDrawer === 'function' && window.closeEmployeeDrawer() === false) return false;
    if (opening) {
      previousFocus = document.activeElement;
      previousInert = { workspace: workspace.inert, sidebar: sidebar.inert };
      previousDrawerOpen = document.body.classList.contains('drawer-open');
    }
    panel.hidden = !opening;
    panel.classList.toggle('active', opening);
    panel.setAttribute('aria-hidden', String(!opening));
    backdrop.hidden = !opening;
    byId('accountTrigger').setAttribute('aria-expanded', String(opening));
    workspace.inert = opening || Boolean(previousInert?.workspace);
    sidebar.inert = opening || Boolean(previousInert?.sidebar);
    document.body.classList.toggle('drawer-open', opening || previousDrawerOpen);
    if (opening) {
      byId('closeProfile').focus();
      if (!profileLoaded) loadProfile();
    } else if (!workspace.inert) byId('accountTrigger').focus();
    else if (previousFocus?.isConnected) previousFocus.focus();
    return opening;
  };
  backdrop.addEventListener('click', () => { if (!panel.hidden) window.toggleCanvas(); });
  byId('refreshWorkspace').addEventListener('click', () => window.dispatchEvent(new CustomEvent('foodheaven:refresh', { detail: { page: key } })));
  byId('signOutBtn').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    let complete = false;
    try { await FoodHeaven.logout(); complete = true; }
    catch (error) { FoodHeaven.reportStatus(error.message || 'Could not sign out. Please retry.', { kind: error.uncertain ? 'warning' : 'error' }); }
    finally { if (!complete) { button.disabled = false; button.removeAttribute('aria-busy'); } }
  });
  window.addEventListener('foodheaven:connection-restored', loadProfile);
  window.FoodHeavenShell = { ready: loadProfile(), refreshProfile: loadProfile };
})();
