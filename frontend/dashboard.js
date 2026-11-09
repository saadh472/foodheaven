/* Keep confirmed snapshots visible while refreshing independent data panels. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const data = { employees: null, payroll: null, shifts: null };
  let pending = null;
  let refreshedAt = 0;
  const initials = name => String(name || 'Manager').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
  const money = value => 'PKR ' + Number(value).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function emptyRow(message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4; cell.className = 'table-placeholder'; cell.textContent = message;
    row.appendChild(cell); byId('teamPreview').replaceChildren(row);
  }
  function setStatus(message, kind) {
    const status = byId('overviewStatus');
    status.replaceChildren(); status.hidden = !message; status.dataset.kind = kind || 'info';
    if (!message) return;
    const text = document.createElement('span'); text.textContent = message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => loadDashboardStats());
    status.append(text, retry);
  }
  async function readRows(url, kind) {
    const response = await fetch(url);
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.error || 'Workspace data is unavailable.');
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.EmployeeID === 'boolean' || !/^[1-9]\d*$/.test(String(row.EmployeeID)))) throw new Error('Unexpected workspace data.');
    if (kind === 'employees' && rows.some(row => typeof row.EmployeeName !== 'string' || !row.EmployeeName.trim())) throw new Error('Unexpected employee data.');
    if (kind === 'payroll' && rows.some(row => !['number', 'string'].includes(typeof row.Salary) || !/^\d+(?:\.\d{1,2})?$/.test(String(row.Salary)) || Number(row.Salary) > 100000)) throw new Error('Unexpected payroll amount.');
    if (kind === 'shifts' && rows.some(row => {
      if (row.StartTime == null && row.EndTime == null) return false;
      const start = Date.parse(row.StartTime), end = Date.parse(row.EndTime);
      return typeof row.StartTime !== 'string' || typeof row.EndTime !== 'string'
        || !/^\d{4}-\d{2}-\d{2}[T ]/.test(row.StartTime) || !/^\d{4}-\d{2}-\d{2}[T ]/.test(row.EndTime)
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start >= 86400000;
    })) throw new Error('Unexpected shift data.');
    return rows;
  }
  function renderTeam() {
    if (!data.employees) { emptyRow('The directory is unavailable. Use Retry to reconnect.'); byId('teamSummary').textContent = 'Employee records unavailable'; return; }
    if (!data.employees.length) { emptyRow('Your directory is empty. Add your first employee to get started.'); byId('teamSummary').textContent = 'Build your team directory'; return; }
    byId('teamSummary').textContent = data.employees.length + (data.employees.length === 1 ? ' employee in your workspace' : ' employees in your workspace');
    const rows = data.employees.slice(0, 5).map(employee => {
      const row = document.createElement('tr');
      const person = document.createElement('td'); const wrap = document.createElement('div'); wrap.className = 'person-cell';
      const avatar = document.createElement('span'); avatar.className = 'person-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = initials(employee.EmployeeName);
      const details = document.createElement('span'); const name = document.createElement('strong'); name.textContent = employee.EmployeeName || 'Unnamed employee';
      const email = document.createElement('small'); email.textContent = employee.EmailID || 'No email added'; details.append(name, email); wrap.append(avatar, details); person.appendChild(wrap); row.appendChild(person);
      FoodHeaven.cell(row, employee.EmployeeID);
      const shift = data.shifts?.find(item => String(item.EmployeeID) === String(employee.EmployeeID));
      const shiftCell = document.createElement('td'); const badge = document.createElement('span');
      const assigned = shift && shift.StartTime && shift.EndTime;
      badge.className = 'shift-badge' + (assigned ? '' : ' unassigned'); badge.textContent = shift ? (assigned ? shift.ShiftName : 'Unassigned') : 'Unavailable';
      shiftCell.appendChild(badge); row.appendChild(shiftCell);
      const salary = data.payroll?.find(item => String(item.EmployeeID) === String(employee.EmployeeID));
      FoodHeaven.cell(row, salary ? money(salary.Salary) : '—');
      return row;
    });
    byId('teamPreview').replaceChildren(...rows);
  }
  function renderCoverage() {
    if (!data.shifts || !data.employees) {
      byId('coverageValue').textContent = '—'; byId('coverageBar').style.width = '0%';
      const item = document.createElement('li'); item.className = 'muted'; item.textContent = 'Schedule data is unavailable.'; byId('shiftBreakdown').replaceChildren(item); return;
    }
    const employeeIds = new Set(data.employees.map(employee => String(employee.EmployeeID)));
    const assigned = new Map();
    const known = new Set();
    for (const row of data.shifts) if (employeeIds.has(String(row.EmployeeID))) known.add(String(row.EmployeeID));
    for (const row of data.shifts) if (employeeIds.has(String(row.EmployeeID)) && row.StartTime && row.EndTime) assigned.set(String(row.EmployeeID), row.ShiftName || 'Regular');
    const ratio = data.employees.length ? Math.round(assigned.size / data.employees.length * 100) : 0;
    byId('coverageValue').textContent = ratio + '%'; byId('coverageBar').style.width = ratio + '%';
    const unknown = data.employees.length - known.size;
    byId('scheduleCaption').textContent = assigned.size + ' of ' + data.employees.length + ' employees assigned' + (unknown ? ' · ' + unknown + ' awaiting refresh' : '');
    const counts = new Map();
    for (const name of assigned.values()) counts.set(name, (counts.get(name) || 0) + 1);
    counts.set('Unassigned', known.size - assigned.size);
    if (unknown) counts.set('Awaiting refresh', unknown);
    const items = [...counts].map(([name, count], index) => {
      const item = document.createElement('li'); const label = document.createElement('span'); const swatch = document.createElement('i');
      swatch.className = 'shift-swatch tone-' + (index % 4); swatch.setAttribute('aria-hidden', 'true'); label.append(swatch, document.createTextNode(name));
      const value = document.createElement('strong'); value.textContent = count; item.append(label, value); return item;
    });
    byId('shiftBreakdown').replaceChildren(...items);
  }
  function renderSnapshot() {
    byId('totalEmployees').textContent = data.employees ? data.employees.length : '—';
    byId('totalPayroll').textContent = data.payroll ? money(data.payroll.reduce((sum, row) => sum + Math.round(Number(row.Salary) * 100), 0) / 100) : '—';
    byId('shiftsScheduled').textContent = data.shifts ? new Set(data.shifts.filter(row => row.StartTime && row.EndTime).map(row => String(row.EmployeeID))).size : '—';
    renderTeam(); renderCoverage();
  }
  function loadDashboardStats() {
    if (pending) return pending;
    const refresh = byId('refreshOverview'); refresh.disabled = true;
    byId('metricRegion').setAttribute('aria-busy', 'true'); byId('updateTime').textContent = 'Updating…';
    pending = (async () => {
      const specs = [['employees', '/employees/get/'], ['payroll', '/payroll/get/'], ['shifts', '/shift/get/']];
      const results = await Promise.allSettled(specs.map(([name, path]) => readRows(path, name)));
      const failed = [];
      results.forEach((result, index) => { const key = specs[index][0]; if (result.status === 'fulfilled') data[key] = result.value; else failed.push(key); });
      renderSnapshot();
      if (failed.length) {
        setStatus('Could not refresh ' + failed.join(', ') + '. Previously loaded values stay visible. Retry when the connection is available.', 'warning');
        byId('updateTime').textContent = 'Refresh incomplete'; byId('syncStatus').textContent = 'Some data may be out of date';
      } else {
        refreshedAt = Date.now(); setStatus('', 'info');
        byId('updateTime').textContent = 'Updated just now'; byId('syncStatus').textContent = 'Workspace data is up to date';
      }
      return !failed.length;
    })().finally(() => { refresh.disabled = false; byId('metricRegion').setAttribute('aria-busy', 'false'); pending = null; });
    return pending;
  }
  window.loadDashboardStats = loadDashboardStats;
  window.refreshDashboard = loadDashboardStats;
  window.toggleCanvas = () => {
    const panel = byId('profilePanel'); const opening = panel.hidden;
    panel.hidden = !opening; panel.classList.toggle('active', opening); panel.setAttribute('aria-hidden', String(!opening));
    byId('accountBackdrop').hidden = !opening; byId('accountTrigger').setAttribute('aria-expanded', String(opening));
    byId('workspace').inert = opening; byId('sidebar').inert = opening;
    document.body.classList.toggle('drawer-open', opening);
    if (opening) byId('closeProfile').focus(); else byId('accountTrigger').focus();
  };
  byId('accountBackdrop').addEventListener('click', window.toggleCanvas);
  byId('refreshOverview').addEventListener('click', loadDashboardStats);
  byId('signOutBtn').addEventListener('click', async event => {
    const button = event.currentTarget; if (button.disabled) return; button.disabled = true;
    try { await FoodHeaven.logout(); } catch (error) { FoodHeaven.reportStatus?.(error.message, { kind: error.uncertain ? 'warning' : 'error' }); }
    finally { button.disabled = false; }
  });
  async function loadProfile() {
    try {
      const response = await fetch('/employee/profile/'); const payload = await response.json();
      if (!response.ok || !payload.employees?.[0]) throw new Error('Profile unavailable.');
      const manager = payload.employees[0];
      document.querySelectorAll('.managerName').forEach(element => element.textContent = manager.EmployeeName || 'Manager');
      document.querySelectorAll('.managerEmail').forEach(element => element.textContent = manager.EmailID || 'No email added');
      byId('topAvatar').textContent = initials(manager.EmployeeName); byId('profileAvatar').textContent = initials(manager.EmployeeName);
    } catch { document.querySelectorAll('.managerEmail').forEach(element => element.textContent = 'Profile unavailable. Refresh to retry.'); }
  }
  byId('overviewDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  window.addEventListener('foodheaven:connection-restored', () => { loadDashboardStats(); loadProfile(); });
  window.addEventListener('pageshow', event => { if (event.persisted) loadDashboardStats(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - refreshedAt > 30000) loadDashboardStats(); });
  loadProfile(); loadDashboardStats();
})();
