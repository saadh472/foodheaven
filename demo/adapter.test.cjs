const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, storageKey } = require('./adapter.js');

function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
function workspace(storage) {
  const store = createStore(storage);
  let csrf = store.route('GET', '/api/session').body.csrf_token;
  const request = (method, path, body = {}) => {
    const response = store.route(method, path, body, csrf);
    if (response.body.csrf_token) csrf = response.body.csrf_token;
    return response;
  };
  const login = request('POST', '/login', { LoginID: 1001, Password: 'DemoPass123!' });
  assert.equal(login.status, 200);
  return { store, request };
}
const fictional = { EmployeeID: 2001, EmployeeName: 'Demo Parker', Contact: '+00 000000004', EmailID: 'demo.parker@example.com', Address: 'Fictional Office', DateOfBirth: '1998-04-15', HireDate: '2025-01-15' };

test('anonymous reads and CSRF-protected sign-in follow Flask contracts', () => {
  const store = createStore();
  assert.equal(store.route('GET', '/employees/get/').status, 401);
  assert.equal(store.route('POST', '/login', { LoginID: 1001, Password: 'DemoPass123!' }).status, 403);
  const csrf = store.route('GET', '/api/session').body.csrf_token;
  assert.equal(store.route('POST', '/login', { LoginID: 1001, Password: 'incorrect' }, csrf).status, 401);
  const login = store.route('POST', '/login', { LoginID: 1001, Password: 'DemoPass123!' }, csrf);
  assert.equal(login.body.user.EmployeeName, 'Alex Morgan');
  assert.notEqual(login.body.csrf_token, csrf);
  assert.equal(store.route('POST', '/employees/add', fictional, csrf).status, 403);
});

test('employee CRUD updates related payroll and deletes associated records', () => {
  const { request } = workspace();
  const added = request('POST', '/employees/add', fictional);
  assert.equal(added.status, 201);
  assert.equal(added.body.employee.MgrID, 1001);
  assert.equal(request('POST', '/employees/add', fictional).status, 409);
  assert.equal(request('PUT', '/employees/update/2001', { EmployeeName: 'Demo Rowan' }).status, 200);
  assert.equal(request('GET', '/employees/get/2001').body.EmployeeName, 'Demo Rowan');
  assert.equal(request('GET', '/payroll/get/').body.find(row => row.EmployeeID === 2001).Salary, '0.00');
  assert.equal(request('PUT', '/payroll/modify/2001', { Salary: '53250.75' }).status, 200);
  assert.equal(request('GET', '/payroll/get/').body.find(row => row.EmployeeID === 2001).Salary, '53250.75');
  assert.equal(request('DELETE', '/employees/delete/2001').status, 200);
  assert.equal(request('GET', '/employees/get/2001').status, 404);
  assert.equal(request('GET', '/payroll/get/').body.some(row => row.EmployeeID === 2001), false);
  assert.equal(request('DELETE', '/employees/delete/1001').status, 409);
});

test('public playground limits contact details to fictional values', () => {
  const { request } = workspace();
  assert.equal(request('POST', '/employees/add', { ...fictional, EmailID: 'real@gmail.com' }).status, 400);
  assert.equal(request('POST', '/employees/add', { ...fictional, Contact: '+92 3331234567' }).status, 400);
  assert.equal(request('POST', '/employees/add', { ...fictional, EmployeeID: true }).status, 400);
  assert.equal(request('POST', '/employees/add', { ...fictional, EmployeeName: '' }).status, 400);
  assert.equal(request('POST', '/employees/add', { ...fictional, HireDate: '2025-02-30' }).status, 400);
  assert.equal(request('POST', '/employees/add', { ...fictional, Unsupported: 'value' }).status, 400);
  assert.equal(request('GET', '/employees/get/').body.length, 3);
});

test('salary validation rejects excessive precision, nonnumeric and out of range values', () => {
  const { request } = workspace();
  for (const Salary of [-1, 100001, '55000.001', true, null, 'NaN', '', '1e3']) {
    assert.equal(request('PUT', '/payroll/modify/1002', { Salary }).status, 400, String(Salary));
  }
  assert.equal(request('GET', '/payroll/get/').body.find(row => row.EmployeeID === 1002).Salary, '55000.00');
});

test('overnight shift works and invalid shifts leave the saved schedule intact', () => {
  const { request } = workspace();
  assert.equal(request('PUT', '/shift/update/', { EmployeeID: 1002, ShiftName: 'Demo night', StartTime: '22:00', EndTime: '06:00' }).status, 200);
  const before = request('GET', '/shift/get/').body.find(row => row.EmployeeID === 1002);
  assert.equal(Date.parse(before.EndTime + 'Z') - Date.parse(before.StartTime + 'Z'), 8 * 3600000);
  assert.equal(request('PUT', '/shift/update/', { EmployeeID: 1002, StartTime: '27:00', EndTime: '09:00' }).status, 400);
  assert.equal(request('PUT', '/shift/update/', { EmployeeID: 1002, StartTime: '09:00', EndTime: '09:00' }).status, 400);
  assert.deepEqual(request('GET', '/shift/get/').body.find(row => row.EmployeeID === 1002), before);
});

test('attendance generation is deterministic, idempotent, and bounded', () => {
  const { request } = workspace();
  assert.equal(request('GET', '/attendance/missing/?date=2020-03-15').body.missing_count, 3);
  assert.equal(request('POST', '/attendance/generate-random/', { date: '2020-03-15', fill_missing: true }).body.records_added, 3);
  assert.equal(request('POST', '/attendance/generate-random/', { date: '2020-03-15' }).body.records_added, 0);
  assert.equal(request('GET', '/attendance/missing/?date=2020-03-15').body.missing_count, 0);
  assert.equal(request('POST', '/attendance/fill-range/', { start_date: '2020-03-15', end_date: '2020-03-17' }).body.total_records_added, 6);
  assert.equal(request('POST', '/attendance/fill-range/', { start_date: '2020-03-15', end_date: '2020-05-17' }).status, 400);
  assert.equal(request('POST', '/attendance/fill-range/', { start_date: '2020-03-15', end_date: '2020-03-14' }).status, 400);
  assert.equal(request('GET', '/attendance/get/').body.filter(row => row.AttendDate === '2020-03-15').length, 3);
});

test('own profile only and all report contracts remain usable', () => {
  const { request } = workspace();
  assert.equal(request('GET', '/employee/profile/?MgrID=1002').status, 403);
  assert.equal(request('GET', '/employee/profile/?MgrID=1001').body.employees[0].MgrID, 1001);
  assert.equal(request('GET', '/manager/details/').body.details[0].EmployeeID, 1001);
  assert.equal(request('GET', '/performance/get/').body.length, 3);
  assert.equal(request('GET', '/shift/get/').body.length, 3);
});

test('reload retains only this tab state and reset restores pristine fictional data', () => {
  const storage = memory();
  const { request, store } = workspace(storage);
  request('POST', '/employees/add', fictional);
  const reloaded = createStore(storage);
  assert.equal(reloaded.route('GET', '/api/session').body.authenticated, true);
  assert.equal(reloaded.route('GET', '/employees/get/').body.length, 4);
  assert.equal(createStore(memory()).route('GET', '/api/session').body.authenticated, false);
  store.reset();
  const reset = createStore(storage);
  assert.equal(reset.route('GET', '/api/session').body.authenticated, false);
  const state = reset.snapshot();
  assert.equal(state.employees.length, 3);
  state.employees.length = 0;
  assert.equal(reset.snapshot().employees.length, 3, 'Snapshots cannot change saved state');
});

test('logout rotates the token and re-locks all records', () => {
  const { request } = workspace();
  const old = request('GET', '/api/session').body.csrf_token;
  const logout = request('POST', '/logout');
  assert.equal(logout.body.authenticated, false);
  assert.notEqual(logout.body.csrf_token, old);
  assert.equal(request('GET', '/employees/get/').status, 401);
});

test('password changes accept demo passwords only and reset restores sample credentials', () => {
  const { request, store } = workspace();
  assert.equal(request('POST', '/login/resetpassword/', { CurrentPassword: 'DemoPass123!', NewPassword: 'my-real-secret' }).status, 400);
  assert.equal(request('POST', '/login/resetpassword/', { CurrentPassword: 'wrong', NewPassword: 'DemoPass456!' }).status, 403);
  assert.equal(request('POST', '/login/resetpassword/', { CurrentPassword: 'DemoPass123!', NewPassword: 'DemoPass456!' }).status, 200);
  request('POST', '/logout');
  assert.equal(request('POST', '/login', { LoginID: 1001, Password: 'DemoPass123!' }).status, 401);
  assert.equal(request('POST', '/login', { LoginID: 1001, Password: 'DemoPass456!' }).status, 200);
  store.reset();
  assert.equal(store.snapshot().password, 'DemoPass123!');
});

test('corrupt or disabled tab storage recovers to a clean workspace', () => {
  assert.equal(createStore({ getItem: () => '{bad json' }).snapshot().employees.length, 3);
  assert.equal(createStore({ getItem: () => JSON.stringify({ version: 1 }) }).snapshot().employees.length, 3);
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const { request } = workspace(denied);
  assert.equal(request('POST', '/employees/add', fictional).status, 201);
  assert.equal(storageKey, 'foodheaven-fictional-demo-v1');
});
