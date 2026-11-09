/* Analytics refreshes as one validated snapshot and never turns failures into zero. */
(() => {
  'use strict';
  let sequence = 0, controller = null, snapshot = null;
  let payrollChart = null, shiftChart = null;
  const byId = id => document.getElementById(id);

  function status(message, kind = 'info', retry = false) {
    byId('analyticsMessage').textContent = message;
    byId('analyticsStatus').dataset.kind = kind;
    byId('analyticsStatus').setAttribute('role', kind === 'error' ? 'alert' : 'status');
    byId('retryAnalytics').hidden = !retry;
    byId('retryAnalytics').style.display = retry ? '' : 'none';
  }

  function chartStatus(message = '') {
    byId('chartStatus').textContent = message;
    byId('chartStatus').hidden = !message;
    byId('chartStatus').style.display = message ? '' : 'none';
  }

  function busy(value) {
    byId('statsGrid').setAttribute('aria-busy', String(value));
    byId('refreshAnalytics').disabled = value;
    byId('retryAnalytics').disabled = value;
    byId('refreshAnalytics').textContent = value ? 'Refreshing…' : 'Refresh';
  }

  function validId(row) {
    const id = Number(row?.EmployeeID);
    if (!row || !Number.isInteger(id) || id < 1 || id > 2147483647) throw new Error('The server returned an unexpected employee reference.');
    return id;
  }

  async function read(endpoint, type, signal) {
    const response = await fetch(endpoint, { signal });
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.error || `${type} data is unavailable (HTTP ${response.status}).`);
    if (!Array.isArray(rows)) throw new Error(`The server returned unexpected ${type} data.`);
    return rows.map(row => {
      const EmployeeID = validId(row);
      if (type === 'Employee') {
        if (typeof row.EmployeeName !== 'string') throw new Error('The server returned an invalid employee name.');
        return { EmployeeID, EmployeeName: row.EmployeeName };
      }
      if (type === 'Payroll') {
        if (!['number', 'string'].includes(typeof row.Salary) || String(row.Salary).trim() === '') throw new Error('The server returned an invalid salary.');
        const salary = Number(row.Salary);
        if (!Number.isFinite(salary) || salary < 0 || salary > 100000) throw new Error('The server returned an invalid salary.');
        return { EmployeeID, Salary: salary };
      }
      if (row.ShiftName != null && typeof row.ShiftName !== 'string') throw new Error('The server returned an invalid shift name.');
      return { EmployeeID, ShiftName: row.ShiftName || 'Not Assigned' };
    });
  }

  function destroyCharts() {
    const existing = new Set([payrollChart, shiftChart]);
    if (typeof window.Chart?.getChart === 'function') {
      existing.add(window.Chart.getChart(byId('payrollChart')));
      existing.add(window.Chart.getChart(byId('shiftChart')));
    }
    for (const chart of existing) {
      try { chart?.destroy(); } catch { /* A broken renderer must not erase the confirmed summaries. */ }
    }
    payrollChart = null;
    shiftChart = null;
  }

  function drawCharts(data) {
    destroyCharts();
    if (typeof window.Chart !== 'function') {
      chartStatus('Charts are unavailable offline. The confirmed summaries above remain available.');
      return;
    }
    try {
      if (window.Chart.defaults) {
        const theme = getComputedStyle(document.body);
        window.Chart.defaults.color = theme.getPropertyValue('--muted').trim() || '#536970';
        window.Chart.defaults.borderColor = theme.getPropertyValue('--line').trim() || '#dbe4e6';
      }
      const names = new Map(data.employees.map(employee => [employee.EmployeeID, employee.EmployeeName]));
      const salaries = data.payroll.slice(0, 10);
      payrollChart = new window.Chart(byId('payrollChart'), {
        type: 'line',
        data: { labels: salaries.map(row => names.get(row.EmployeeID) || `Employee ${row.EmployeeID}`),
          datasets: [{ label: 'Salary (PKR)', data: salaries.map(row => row.Salary), borderColor: '#198474', backgroundColor: 'rgba(25,132,116,.15)', tension: .3, fill: true }] },
        options: { responsive: true, maintainAspectRatio: true, scales: { y: { beginAtZero: true } } }
      });
      const shifts = new Map();
      for (const row of data.shifts) shifts.set(row.ShiftName, (shifts.get(row.ShiftName) || 0) + 1);
      shiftChart = new window.Chart(byId('shiftChart'), {
        type: 'pie',
        data: { labels: [...shifts.keys()], datasets: [{ data: [...shifts.values()], backgroundColor: ['#198474', '#375caa', '#dda148', '#8855a4', '#c85665'], borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
      });
      chartStatus();
    } catch {
      destroyCharts();
      chartStatus('Charts could not be drawn. The confirmed summaries above remain available.');
    }
  }

  function updateSummaries(data) {
    byId('totalEmployees').textContent = data.employees.length;
    const cents = data.payroll.reduce((sum, row) => sum + Math.round(row.Salary * 100), 0);
    byId('totalPayroll').textContent = 'PKR ' + (cents / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
    byId('shiftsCount').textContent = data.shifts.filter(row => row.ShiftName !== 'Not Assigned').length;
  }

  async function loadAnalyticsData() {
    sequence += 1;
    const current = sequence;
    controller?.abort();
    controller = new AbortController();
    const pending = controller;
    busy(true);
    status(snapshot ? 'Refreshing workforce summaries. Last confirmed data remains visible…' : 'Loading workforce summaries…');
    try {
      const [employees, payroll, shifts] = await Promise.all([
        read('/employees/get/', 'Employee', pending.signal),
        read('/payroll/get/', 'Payroll', pending.signal),
        read('/shift/get/', 'Shift', pending.signal)
      ]);
      if (current !== sequence) return false;
      if (new Set(employees.map(row => row.EmployeeID)).size !== employees.length) throw new Error('The server returned duplicate employees.');
      snapshot = { employees, payroll, shifts };
      updateSummaries(snapshot);
      drawCharts(snapshot);
      status('Workforce summaries updated from the current database.', 'success');
      return true;
    } catch (error) {
      if (current !== sequence) return false;
      pending.abort();
      status(`${error.message || 'Could not connect to the server.'}${snapshot ? ' Showing the last confirmed summaries and charts.' : ' No confirmed summaries are loaded yet.'}`, 'error', true);
      return false;
    } finally {
      if (current === sequence) { controller = null; busy(false); }
    }
  }

  function initialize() {
    byId('refreshAnalytics').addEventListener('click', loadAnalyticsData);
    byId('retryAnalytics').addEventListener('click', loadAnalyticsData);
    window.addEventListener('foodheaven:connection-restored', loadAnalyticsData);
    window.addEventListener('foodheaven:themechange', () => { if (snapshot) drawCharts(snapshot); });
    loadAnalyticsData();
  }
  window.loadAnalyticsData = loadAnalyticsData;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
