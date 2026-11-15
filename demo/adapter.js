/* Browser-only portfolio demo. The Flask application never loads this adapter. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    const script = document.currentScript;
    root.FoodHeavenDemo = { ...api, basePath: script?.dataset.base || '/' };
    api.install(root, root.FoodHeavenDemo.basePath);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const KEY = 'foodheaven-fictional-demo-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const today = () => {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  };
  const randomToken = () => globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now();
  function seed() {
    return {
      version: 1, authenticated: false, csrf: randomToken(), password: 'DemoPass123!',
      employees: [
        { EmployeeID: 1001, EmployeeName: 'Alex Morgan', Contact: '+00 000000001', EmailID: 'alex.manager@example.com', Address: 'Demo Office', HireDate: '2024-01-15', DateOfBirth: '1990-06-10', MgrID: null },
        { EmployeeID: 1002, EmployeeName: 'Taylor Jordan', Contact: '+00 000000002', EmailID: 'taylor.employee@example.com', Address: 'Demo Office', HireDate: '2024-02-01', DateOfBirth: '1995-04-20', MgrID: 1001 },
        { EmployeeID: 1003, EmployeeName: 'Casey Lee', Contact: '+00 000000003', EmailID: 'casey.employee@example.com', Address: 'Demo Office', HireDate: '2024-03-01', DateOfBirth: '1996-08-12', MgrID: 1001 },
      ],
      salaries: { 1001: '85000.00', 1002: '55000.00', 1003: '50000.00' },
      shifts: [1001, 1002, 1003].map((id, index) => ({ EmployeeID: id, ShiftID: index + 1, ShiftName: 'Morning', StartTime: today() + 'T09:00:00', EndTime: today() + 'T17:00:00' })),
      attendance: [1001, 1002, 1003].map(id => ({ EmployeeID: id, AttendDate: today(), Status: 'Present' })),
      ratings: { 1001: 'Excellent', 1002: 'Good', 1003: 'Good' },
    };
  }
  class DemoError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
  }
  function id(value, label = 'EmployeeID') {
    if (typeof value === 'boolean' || !/^\d{1,10}$/.test(String(value)) || Number(value) < 1 || Number(value) > 2147483647) throw new DemoError(label + ' must be a positive integer.');
    return Number(value);
  }
  function text(value, label, limit, required = false) {
    if ((value === null || value === undefined) && !required) return null;
    if (typeof value !== 'string' || value.length > limit || /[\x00-\x1f]/.test(value)) throw new DemoError(label + ' contains invalid text.');
    const result = value.trim();
    if (required && !result) throw new DemoError(label + ' is required.');
    return result || null;
  }
  function date(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new DemoError(label + ' must be a valid YYYY-MM-DD date.');
    return value;
  }
  function employeeValues(payload, existing) {
    const fields = new Set(['EmployeeID', 'EmployeeName', 'Contact', 'ContactNo', 'EmailID', 'Address', 'HireDate', 'DateOfBirth', 'MgrID']);
    if (Object.keys(payload).some(key => !fields.has(key))) throw new DemoError('The employee request contains unsupported fields.');
    if (existing && !Object.keys(payload).length) throw new DemoError('Provide an employee field to update.');
    if (payload.ContactNo !== undefined && payload.Contact !== undefined && payload.ContactNo !== payload.Contact) throw new DemoError('Contact and ContactNo must agree.');
    const values = { ...(existing || {}), ...payload };
    if (payload.ContactNo !== undefined) values.Contact = payload.ContactNo;
    const result = {
      EmployeeID: id(values.EmployeeID), EmployeeName: text(values.EmployeeName, 'EmployeeName', 120, true),
      Contact: text(values.Contact, 'Contact', 32), EmailID: text(values.EmailID, 'EmailID', 254), Address: text(values.Address, 'Address', 250),
      HireDate: values.HireDate ? date(values.HireDate, 'HireDate') : null,
      DateOfBirth: values.DateOfBirth ? date(values.DateOfBirth, 'DateOfBirth') : null,
      MgrID: values.MgrID === null ? null : id(values.MgrID ?? 1001, 'MgrID'),
    };
    if (existing && result.EmployeeID !== existing.EmployeeID) throw new DemoError('EmployeeID cannot be changed.');
    // Deliberately constrain the public playground to fictional contact details.
    if (result.EmailID && !/^[^\s@]+@example\.(com|org|net)$/i.test(result.EmailID)) throw new DemoError('Use a fictional email at example.com, example.org, or example.net in this demo.');
    if (result.Contact && !/^\+00[\d -]*$/.test(result.Contact)) throw new DemoError('Use a fictional phone number beginning with +00.');
    if (result.MgrID !== null && result.MgrID !== 1001) throw new DemoError('The demo manager ID is 1001.');
    if (result.DateOfBirth && result.DateOfBirth > today()) throw new DemoError('DateOfBirth cannot be in the future.');
    if (result.HireDate && result.DateOfBirth && result.HireDate < result.DateOfBirth) throw new DemoError('HireDate must be on or after DateOfBirth.');
    return result;
  }
  function createStore(storage) {
    let state;
    try {
      const saved = JSON.parse(storage?.getItem(KEY) || 'null');
      if (saved?.version === 1 && Array.isArray(saved.employees) && Array.isArray(saved.shifts) && Array.isArray(saved.attendance) && saved.salaries && saved.ratings && typeof saved.csrf === 'string' && typeof saved.password === 'string') state = saved;
    } catch (_) { /* A corrupt or unavailable browser store starts a fresh fictional workspace. */ }
    state ||= seed();
    function save() { try { storage?.setItem(KEY, JSON.stringify(state)); } catch (_) { /* Still usable in memory for this page. */ } }
    function manager() { return { ...state.employees.find(employee => employee.EmployeeID === 1001), MgrID: 1001 }; }
    function employee(employeeId) {
      const found = state.employees.find(row => row.EmployeeID === employeeId);
      if (!found) throw new DemoError('Employee not found.', 404);
      return found;
    }
    function fillDay(day) {
      const records = [];
      for (const person of state.employees) {
        if (state.attendance.some(row => row.EmployeeID === person.EmployeeID && row.AttendDate === day)) continue;
        const status = (person.EmployeeID + Number(day.replaceAll('-', ''))) % 5 === 0 ? 'Absent' : 'Present';
        state.attendance.push({ EmployeeID: person.EmployeeID, AttendDate: day, Status: status });
        records.push({ EmployeeID: person.EmployeeID, EmployeeName: person.EmployeeName, Status: status, Date: day });
      }
      return records;
    }
    function route(method, rawPath, payload = {}, csrf) {
      method = method.toUpperCase();
      const url = new URL(rawPath, 'https://demo.invalid');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const result = (body, status = 200) => ({ status, body: clone(body) });
      try {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf !== state.csrf) throw new DemoError('Refresh the page and try again with a valid CSRF token.', 403);
        if (method === 'GET' && path === '/api/health') return result({ status: 'ok', database: 'browser-tab', backend: 'interactive-demo' });
        if (method === 'GET' && path === '/api/session') return result({ authenticated: state.authenticated, user: state.authenticated ? manager() : null, csrf_token: state.csrf });
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new DemoError('The request body must be a JSON object.');
        if (method === 'POST' && path === '/login') {
          if (String(payload.LoginID) !== '1001' || payload.Password !== state.password) throw new DemoError('Invalid login ID or password.', 401);
          state.authenticated = true; state.csrf = randomToken(); save();
          return result({ message: 'Demo sign-in successful.', MgrID: 1001, user: manager(), csrf_token: state.csrf });
        }
        if (method === 'POST' && path === '/logout') {
          state.authenticated = false; state.csrf = randomToken(); save();
          return result({ message: 'Signed out.', authenticated: false, csrf_token: state.csrf });
        }
        if (method === 'POST' && path === '/login/forgotpassword') throw new DemoError('Password recovery is unavailable in the public demo. Reset the demo to restore its sample password.');
        if (!state.authenticated) throw new DemoError('Sign in to continue.', 401);
        if (method === 'GET' && ['/employees/get', '/api/employees', '/employees'].includes(path)) return result(state.employees);
        let match = path.match(/^\/employees\/get\/(\d+)$/);
        if (method === 'GET' && match) return result(employee(id(match[1])));
        if (method === 'POST' && path === '/employees/add') {
          if (state.employees.length >= 100) throw new DemoError('This playground is limited to 100 fictional employees. Reset the demo to start again.');
          const row = employeeValues(payload);
          if (state.employees.some(person => person.EmployeeID === row.EmployeeID)) throw new DemoError('EmployeeID already exists.', 409);
          state.employees.push(row); state.employees.sort((a, b) => a.EmployeeID - b.EmployeeID); state.salaries[row.EmployeeID] = '0.00'; save();
          return result({ message: 'Fictional employee added in this browser tab.', employee: row }, 201);
        }
        match = path.match(/^\/employees\/update\/(\d+)$/);
        if (method === 'PUT' && match) {
          const old = employee(id(match[1])); const row = employeeValues(payload, old);
          Object.assign(old, row); save(); return result({ message: 'Fictional employee updated.', employee: row });
        }
        match = path.match(/^\/employees\/delete\/(\d+)$/);
        if (method === 'DELETE' && match) {
          const employeeId = id(match[1]); employee(employeeId);
          if (employeeId === 1001) throw new DemoError('Manager accounts cannot be deleted from the employee directory.', 409);
          state.employees = state.employees.filter(person => person.EmployeeID !== employeeId);
          state.shifts = state.shifts.filter(row => row.EmployeeID !== employeeId);
          state.attendance = state.attendance.filter(row => row.EmployeeID !== employeeId);
          delete state.salaries[employeeId]; delete state.ratings[employeeId]; save();
          return result({ message: 'Fictional employee and associated records deleted.' });
        }
        if (method === 'GET' && path === '/payroll/get') return result(state.employees.map(person => ({ PayID: person.EmployeeID, EmployeeID: person.EmployeeID, EmployeeName: person.EmployeeName, Salary: state.salaries[person.EmployeeID] || '0.00' })));
        match = path.match(/^\/payroll\/modify\/(\d+)$/);
        if (method === 'PUT' && match) {
          const employeeId = id(match[1]); employee(employeeId);
          const salary = payload.Salary;
          if (!['string', 'number'].includes(typeof salary) || !/^\d{1,6}(?:\.\d{1,2})?$/.test(String(salary)) || !Number.isFinite(Number(salary)) || Number(salary) > 100000) throw new DemoError('Salary must be between 0 and 100000 with at most two decimal places.');
          state.salaries[employeeId] = Number(salary).toFixed(2); save(); return result({ message: 'Demo payroll updated.' });
        }
        if (method === 'GET' && path === '/shift/get') return result(state.employees.map(person => ({ ShiftID: 0, ShiftName: 'Not Assigned', StartTime: null, EndTime: null, ...state.shifts.find(row => row.EmployeeID === person.EmployeeID), EmployeeID: person.EmployeeID, EmployeeName: person.EmployeeName })));
        if (method === 'PUT' && path === '/shift/update') {
          const employeeId = id(payload.EmployeeID); employee(employeeId);
          const localTime = (value, label) => {
            if (typeof value !== 'string' || !/^(?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new DemoError(label + ' must be a local ISO date-time or HH:MM time.');
            const full = value.includes('T') || value.includes(' ') ? value.replace(' ', 'T') : today() + 'T' + value;
            date(full.slice(0, 10), label);
            const time = full.split('T')[1].split(':').map(Number);
            if (time[0] > 23 || time[1] > 59 || (time[2] || 0) > 59) throw new DemoError(label + ' is not a valid time.');
            return { value: full.length === 16 ? full + ':00' : full, ms: Date.parse(full + 'Z') };
          };
          const start = localTime(payload.StartTime, 'StartTime'); const end = localTime(payload.EndTime, 'EndTime');
          if (end.ms <= start.ms && /^\d\d:/.test(payload.EndTime)) { end.ms += 86400000; end.value = new Date(end.ms).toISOString().slice(0, 19); }
          if (!(end.ms > start.ms && end.ms - start.ms < 86400000)) throw new DemoError('A shift must last more than zero and less than 24 hours.');
          const shift = { EmployeeID: employeeId, ShiftID: employeeId, ShiftName: text(payload.ShiftName ?? 'Regular Shift', 'ShiftName', 80, true), StartTime: start.value, EndTime: end.value };
          state.shifts = state.shifts.filter(row => row.EmployeeID !== employeeId); state.shifts.push(shift); save();
          return result({ message: 'Demo shift updated successfully.' });
        }
        if (method === 'GET' && path === '/attendance/get') return result(state.employees.flatMap(person => {
          const rows = state.attendance.filter(row => row.EmployeeID === person.EmployeeID).sort((a, b) => b.AttendDate.localeCompare(a.AttendDate));
          return (rows.length ? rows : [{ AttendDate: null, Status: 'Not Recorded' }]).map(row => ({ EmployeeID: person.EmployeeID, EmployeeName: person.EmployeeName, ...row }));
        }));
        if (method === 'GET' && path === '/attendance/missing') {
          const day = date(url.searchParams.get('date') || today(), 'date');
          const employees = state.employees.filter(person => !state.attendance.some(row => row.EmployeeID === person.EmployeeID && row.AttendDate === day)).map(person => ({ EmployeeID: person.EmployeeID, EmployeeName: person.EmployeeName }));
          return result({ date: day, missing_count: employees.length, employees });
        }
        if (method === 'POST' && path === '/attendance/generate-random') {
          const day = date(payload.date || today(), 'date');
          if (payload.fill_missing !== undefined && typeof payload.fill_missing !== 'boolean') throw new DemoError('fill_missing must be a boolean.');
          const records = fillDay(day); save();
          return result({ success: true, date: day, records_added: records.length, employees_processed: records, message: 'Added ' + records.length + ' fictional attendance records; existing records were preserved.' });
        }
        if (method === 'POST' && path === '/attendance/fill-range') {
          const start = date(payload.start_date, 'start_date'); const end = date(payload.end_date, 'end_date');
          const days = (Date.parse(end) - Date.parse(start)) / 86400000;
          if (days < 0 || days >= 31) throw new DemoError('Attendance ranges must contain 1 to 31 days in chronological order.');
          const results = [];
          for (let offset = 0; offset <= days; offset++) {
            const day = new Date(Date.parse(start) + offset * 86400000).toISOString().slice(0, 10);
            results.push({ date: day, records_added: fillDay(day).length });
          }
          const total = results.reduce((sum, row) => sum + row.records_added, 0); save();
          return result({ success: true, start_date: start, end_date: end, total_records_added: total, date_results: results, message: 'Added ' + total + ' fictional attendance records; existing records were preserved.' });
        }
        if (method === 'GET' && path === '/performance/get') return result(state.employees.map(person => ({ EmployeeID: person.EmployeeID, EmployeeName: person.EmployeeName, Performance: state.ratings[person.EmployeeID] || 'Not Rated' })));
        if (method === 'GET' && ['/employee/profile', '/manager/details'].includes(path)) {
          if (url.searchParams.has('MgrID') && id(url.searchParams.get('MgrID'), 'MgrID') !== 1001) throw new DemoError('You can view only your own manager profile.', 403);
          return result(path === '/employee/profile' ? { employees: [manager()] } : { details: [manager()] });
        }
        if (method === 'POST' && path === '/login/resetpassword') {
          if (payload.CurrentPassword !== state.password) throw new DemoError('Current password is incorrect.', 403);
          if (typeof payload.NewPassword !== 'string' || !/^Demo[\x21-\x7e]{6,124}$/.test(payload.NewPassword) || payload.NewPassword === state.password) throw new DemoError('Use a different fictional demo password beginning with Demo (10 to 128 characters). Never enter a real password.');
          state.password = payload.NewPassword; save(); return result({ message: 'Demo password updated in this browser tab. Reset demo restores DemoPass123!.' });
        }
        throw new DemoError('This route is not available in the browser demo.', 404);
      } catch (error) {
        if (error instanceof DemoError) return result({ error: error.message }, error.status);
        throw error;
      }
    }
    return { route, reset() { state = seed(); save(); }, snapshot() { return clone(state); } };
  }
  function install(win, basePath) {
    let storage;
    try { storage = win.sessionStorage; } catch (_) { /* Browser storage may be disabled. */ }
    const store = createStore(storage);
    const originalFetch = win.fetch.bind(win);
    const apiPath = /^\/(?:api(?:\/|$)|employees?(?:\/|$)|manager(?:\/|$)|payroll(?:\/|$)|shift(?:\/|$)|attendance(?:\/|$)|performance(?:\/|$)|login(?:\/|$)|logout(?:\/|$))/;
    win.fetch = async function (input, options) {
      const request = new win.Request(input instanceof win.Request ? input : new URL(input, win.location.href), options);
      const url = new URL(request.url);
      if (url.origin !== win.location.origin || !apiPath.test(url.pathname)) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new win.Response(JSON.stringify({ error: 'The portfolio demo never sends changes to a server.' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
        return originalFetch(request);
      }
      if (request.signal.aborted) throw request.signal.reason || new win.DOMException('Request aborted.', 'AbortError');
      let payload = {};
      const body = await request.clone().text();
      if (body) {
        try { payload = JSON.parse(body); }
        catch (_) { return new win.Response(JSON.stringify({ error: 'The request body must be JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      }
      const response = store.route(request.method, url.pathname + url.search, payload, request.headers.get('X-CSRF-Token'));
      return new win.Response(JSON.stringify(response.body), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    };
    function banner() {
      if (!document.body || document.getElementById('foodDemoBanner')) return;
      const country = document.getElementById('countryCode');
      if (country && ![...country.options].some(option => option.value === '+00')) {
        for (const option of country.options) option.defaultSelected = false;
        const option = document.createElement('option'); option.value = '+00'; option.textContent = 'Demo +00';
        option.defaultSelected = true; country.prepend(option); country.value = '+00';
      }
      const style = document.createElement('style');
      style.textContent = '.food-demo-banner{position:fixed;inset:0 0 auto;z-index:100000;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 20px;background:#073f42;color:#fff;font:500 13px/1.5 system-ui,sans-serif;box-sizing:border-box}.food-demo-banner strong{display:block;color:#fff}.food-demo-banner small{display:block;color:#cbe4e2}.food-demo-banner button{flex:none;width:auto!important;min-height:34px;padding:6px 12px;border:1px solid #8bbfba;border-radius:8px;background:#fff;color:#073f42;cursor:pointer;font:600 12px system-ui,sans-serif}.food-demo-banner button:hover{background:#dcefed}.food-demo-banner button:focus-visible{outline:3px solid #f5c66b;outline-offset:2px}body{padding-top:var(--food-demo-offset,74px)!important}.app-sidebar,.workspace-sidebar,.sidebar{top:var(--food-demo-offset,74px)!important;height:calc(100dvh - var(--food-demo-offset,74px))!important}@media(max-width:540px){.food-demo-banner{padding:8px 12px;gap:8px;font-size:11px}.food-demo-banner small{font-size:10px}}';
      document.head.appendChild(style);
      const panel = document.createElement('aside'); panel.id = 'foodDemoBanner'; panel.className = 'food-demo-banner'; panel.setAttribute('aria-label', 'Public demo notice');
      const label = document.createElement('div'); const title = document.createElement('strong'); const detail = document.createElement('small');
      title.textContent = 'Interactive demo · fictional data · saved only in this browser tab';
      detail.textContent = 'Use invented names, +00 phone numbers, example.com emails, and Demo passwords. This preview simulates the API; Flask + SQLite run locally.';
      label.append(title, detail);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Reset demo';
      button.addEventListener('click', () => { store.reset(); win.location.assign(basePath + 'Portal_login/Portal%20Page.html'); });
      panel.append(label, button); document.body.prepend(panel);
      const resize = () => document.documentElement.style.setProperty('--food-demo-offset', panel.getBoundingClientRect().height + 'px');
      resize(); if (win.ResizeObserver) new win.ResizeObserver(resize).observe(panel); else win.addEventListener('resize', resize);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner, { once: true }); else banner();
    return store;
  }
  return { createStore, install, storageKey: KEY };
});
