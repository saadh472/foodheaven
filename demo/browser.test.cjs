const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('../frontend/node_modules/jsdom');
const { createStore } = require('./adapter.js');
const frontend = path.resolve(__dirname, '../frontend');
const read = name => fs.readFileSync(path.join(frontend, name), 'utf8');

async function until(predicate, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}
function page(t, name, scripts) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => { if (!error.message.includes('navigation')) errors.push(error.message); });
  const html = read(name).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi, '');
  const dom = new JSDOM(html, { url: 'https://portfolio.example/' + name, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
  const win = dom.window;
  for (const key of ['Request', 'Response', 'Headers', 'AbortController']) win[key] = globalThis[key];
  win.confirm = () => true;
  win.HTMLElement.prototype.scrollIntoView = () => {};
  let networkCalls = 0;
  win.fetch = async () => { networkCalls++; throw Error('No real API requests are allowed in the demo.'); };
  const initial = createStore(win.sessionStorage);
  const token = initial.route('GET', '/api/session').body.csrf_token;
  initial.route('POST', '/login', { LoginID: 1001, Password: 'DemoPass123!' }, token);
  win.eval(fs.readFileSync(path.join(__dirname, 'adapter.js'), 'utf8'));
  for (const script of ['app.js', ...scripts]) win.eval(read(script));
  t.after(() => { assert.deepEqual(errors, [], 'No unhandled demo page errors'); assert.equal(networkCalls, 0, 'All API traffic stays in the browser'); win.close(); });
  return win;
}

test('actual overview and shared API client render the isolated demo without a backend', async t => {
  const win = page(t, 'interface.html', ['dashboard.js']);
  await until(() => win.document.getElementById('totalEmployees').textContent === '3', 'Overview renders fictional employee count');
  assert.match(win.document.getElementById('totalPayroll').textContent, /190,?000/);
  assert.equal(win.document.getElementById('shiftsScheduled').textContent, '3');
  assert.match(win.document.getElementById('foodDemoBanner').textContent, /fictional data/);
  assert.match(win.document.getElementById('foodDemoBanner').textContent, /simulates the API/);
  const response = await win.fetch('/api/session');
  assert.equal((await response.json()).user.MgrID, 1001);
});

test('actual directory UI creates, edits, and deletes a fictional record through the adapter', async t => {
  const win = page(t, 'Sidebar/Sidebar_employeedetails.html', ['workspace-shell.js', 'Sidebar/employees.js']);
  const doc = win.document;
  await until(() => doc.getElementById('totalEmployeesStat').textContent === '3' && !doc.getElementById('addEmployeeButton').disabled, 'Directory loads');
  win.beginNewEmployee();
  assert.equal(doc.getElementById('countryCode').value, '+00', 'The fictional dialling option is usable');
  const fields = { empId: '2001', empName: 'Demo Parker', contactNo: '000000004', email: 'demo.parker@example.com', address: 'Fictional Office', dob: '1998-04-15', hireDate: '2025-01-15', mgrId: '1001' };
  for (const [key, value] of Object.entries(fields)) doc.getElementById(key).value = value;
  await win.saveEmployee();
  await until(() => doc.getElementById('totalEmployeesStat').textContent === '4', 'Fictional employee is added');
  assert.match(doc.getElementById('tableBody').textContent, /Demo Parker/);
  win.editEmployee(2001);
  doc.getElementById('empName').value = 'Demo Rowan';
  await win.saveEmployee();
  await until(() => doc.getElementById('tableBody').textContent.includes('Demo Rowan'), 'Fictional employee is edited');
  await win.removeEmployee(2001);
  await until(() => doc.getElementById('totalEmployeesStat').textContent === '3', 'Fictional employee is deleted');
  assert.equal(doc.getElementById('tableBody').textContent.includes('Demo Rowan'), false);
});
