const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const payrollRow = { EmployeeID: 1, EmployeeName: 'Demo Manager', PayID: 1, Salary: '100.10' };
const shiftRow = { EmployeeID: 1, EmployeeName: 'Demo Manager', ShiftID: 1, ShiftName: 'Morning', StartTime: '2026-01-01T09:00:00', EndTime: '2026-01-01T17:00:00' };
const pages = [
  { name: 'payroll', html: 'Sidebar_payroll.html', script: 'payroll.js', row: payrollRow, read: 'fetchPayroll', select: 'showSalaryForm', write: 'updateSalary', save: 'saveSalary', retry: 'retryPayroll', status: 'payrollStatus', message: 'salaryMessage', selected: 'empName', table: 'employeeTable' },
  { name: 'shifts', html: 'Sidebar_shift.html', script: 'shifts.js', row: shiftRow, read: 'fetchShifts', select: 'editShift', write: 'changeShiftTime', save: 'saveShift', retry: 'retryShifts', status: 'shiftStatus', message: 'shiftMessage', selected: 'currentEmployeeName', table: 'shiftTable' }
];
const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json'}});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

async function until(predicate, label = 'operation state') {
  for (let tries = 0; tries < 100; tries++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for ' + label);
}

async function setup(t, page, route) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const html = fs.readFileSync(path.join(root, 'Sidebar', page.html), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(html, {url:'http://localhost/Sidebar/' + page.html, runScripts:'dangerously', virtualConsole:console, pretendToBeVisual:true});
  const {window} = dom;
  const calls = [];
  window.AbortController = AbortController;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = async (url, options = {}) => {
    const call = {url, method:options.method || 'GET', options};
    calls.push(call);
    return route(call);
  };
  window.FoodHeaven = {
    cell(row, value) {const cell = window.document.createElement('td'); cell.textContent = value ?? ''; row.appendChild(cell); return cell;},
    toggleTheme() {}
  };
  window.eval(fs.readFileSync(path.join(root, 'Sidebar', page.script), 'utf8'));
  t.after(() => {assert.deepEqual(errors, [], 'no unhandled script errors'); window.close();});
  await until(() => calls.length, 'initial request');
  await pause();
  return {window, document:window.document, calls};
}

function choose(view, page) {
  view.window[page.select](1);
  if (page.name === 'payroll') {
    view.document.getElementById('increaseCheckbox').checked = true;
    view.window.toggleInput('increase');
    view.document.getElementById('increaseSalary').value = '0.20';
    view.window.checkSalaryLimit();
  } else {
    view.document.getElementById('shiftType').value = 'Night';
    view.document.getElementById('shiftDate').value = '2026-12-31';
  }
}

for (const page of pages) {
  test(page.name + ': one initial read; network failure has inline Retry and a distinct empty state', async t => {
    let online = false;
    const view = await setup(t, page, () => online ? reply([]) : Promise.reject(new Error('Offline')));
    await until(() => view.document.getElementById(page.status).dataset.kind === 'error');
    assert.equal(view.calls.length, 1, 'no duplicate initial loads');
    assert.equal(view.document.getElementById(page.retry).hidden, false);
    assert.equal(view.document.getElementById(page.save).disabled, true);
    assert.match(view.document.getElementById(page.table).textContent, /could not be loaded/);
    online = true;
    view.document.getElementById(page.retry).click();
    await until(() => view.document.getElementById(page.retry).hidden && view.document.getElementById(page.table).getAttribute('aria-busy') === 'false');
    assert.match(view.document.getElementById(page.table).textContent, /No employees are available/);
    assert.equal(view.document.getElementById(page.retry).hidden, true);
  });

  test(page.name + ': out-of-order reads cannot overwrite the newer confirmed result', async t => {
    const old = deferred(), latest = deferred();
    let count = 0;
    const view = await setup(t, page, () => ++count === 1 ? old.promise : latest.promise);
    const newer = view.window[page.read]();
    latest.resolve(reply([{...page.row, EmployeeName:'Latest confirmed employee'}]));
    await newer;
    old.resolve(reply([{...page.row, EmployeeName:'Stale employee'}]));
    await pause();
    assert.match(view.document.getElementById(page.table).textContent, /Latest confirmed employee/);
    assert.doesNotMatch(view.document.getElementById(page.table).textContent, /Stale employee/);
    assert.equal(view.document.getElementById(page.retry).hidden, true);
  });

  test(page.name + ': malformed refresh keeps confirmed rows, blocks editing and preserves selection through recovery', async t => {
    let malformed = false;
    const view = await setup(t, page, () => malformed ? reply({unexpected:true}) : reply([page.row]));
    await until(() => view.document.getElementById(page.table).textContent.includes(page.row.EmployeeName));
    choose(view, page);
    malformed = true;
    await view.window[page.read]();
    assert.match(view.document.getElementById(page.table).textContent, /Demo Manager/);
    assert.equal(view.document.getElementById(page.selected).value, page.row.EmployeeName);
    assert.equal(view.document.getElementById(page.save).disabled, true);
    const writesBefore = view.calls.filter(call => call.method === 'PUT').length;
    await view.window[page.write]();
    assert.equal(view.calls.filter(call => call.method === 'PUT').length, writesBefore);
    malformed = false;
    await view.window[page.read]();
    assert.equal(view.document.getElementById(page.selected).value, page.row.EmployeeName);
    assert.equal(view.document.getElementById(page.retry).hidden, true);
  });

  test(page.name + ': rapid duplicate submits send one request and do not change displayed values before confirmation', async t => {
    const pending = deferred();
    let current = {...page.row};
    let payload;
    const view = await setup(t, page, call => {
      if (call.method === 'PUT') {payload = JSON.parse(call.options.body); return pending.promise;}
      return reply([current]);
    });
    await until(() => view.document.getElementById(page.table).textContent.includes(page.row.EmployeeName));
    choose(view, page);
    const before = view.document.getElementById(page.table).textContent;
    const first = view.window[page.write](), second = view.window[page.write]();
    assert.equal(view.calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(view.document.getElementById(page.save).disabled, true);
    assert.equal(view.document.getElementById(page.table).textContent, before);
    if (page.name === 'payroll') {
      assert.equal(payload.Salary, '100.30', 'integer cents avoid floating-point drift');
      current = {...current, Salary:payload.Salary};
    } else {
      assert.equal(payload.ShiftName, 'Night');
      assert.equal(payload.StartTime, '2026-12-31 01:00:00');
      assert.equal(payload.EndTime, '2026-12-31 09:00:00');
      current = {...current, ...payload};
    }
    pending.resolve(reply({message:'Saved.'}));
    await Promise.all([first, second]);
    assert.match(view.document.getElementById(page.message).textContent, /confirmed from the server/);
    assert.equal(view.document.getElementById(page.selected).value, page.row.EmployeeName);
    assert.equal(view.document.getElementById(page.retry).hidden, true);
  });

  for (const kind of ['network failure', 'malformed success response']) {
    test(page.name + ': ' + kind + ' locks an uncertain mutation until a fresh read; Retry never replays it', async t => {
      const view = await setup(t, page, call => {
        if (call.method === 'PUT') return kind === 'network failure' ? Promise.reject(new Error('Connection lost')) : new Response('<html>not JSON</html>', {status:200});
        return reply([page.row]);
      });
      await until(() => view.document.getElementById(page.table).textContent.includes(page.row.EmployeeName));
      choose(view, page);
      await view.window[page.write]();
      assert.equal(view.calls.filter(call => call.method === 'PUT').length, 1);
      assert.equal(view.document.getElementById(page.save).disabled, true);
      assert.equal(view.document.getElementById(page.retry).hidden, false);
      assert.match(view.document.getElementById(page.message).textContent, /may already have been saved/);
      await view.window[page.write]();
      assert.equal(view.calls.filter(call => call.method === 'PUT').length, 1);
      await view.window[page.read]();
      assert.equal(view.calls.filter(call => call.method === 'PUT').length, 1, 'read retry does not replay a write');
      assert.equal(view.document.getElementById(page.retry).hidden, true);
    });
  }

  test(page.name + ': a validation rejection preserves the form without claiming a save', async t => {
    const view = await setup(t, page, call => call.method === 'PUT' ? reply({error:'Please review the selected record.'}, 400) : reply([page.row]));
    await until(() => view.document.getElementById(page.table).textContent.includes(page.row.EmployeeName));
    choose(view, page);
    await view.window[page.write]();
    assert.equal(view.document.getElementById(page.message).textContent, 'Please review the selected record.');
    assert.equal(view.document.getElementById(page.message).dataset.kind, 'error');
    assert.equal(view.document.getElementById(page.selected).value, page.row.EmployeeName);
    assert.equal(view.document.getElementById(page.retry).hidden, true);
    assert.equal(view.document.getElementById(page.save).disabled, false);
  });

  test(page.name + ': saved mutation followed by a failed refresh stays locked until confirmed data arrives', async t => {
    let saved = false, online = true;
    const updated = page.name === 'payroll' ? {...page.row, Salary:'100.30'} : {...page.row, ShiftName:'Night', StartTime:'2026-12-31 01:00:00', EndTime:'2026-12-31 09:00:00'};
    const view = await setup(t, page, call => {
      if (call.method === 'PUT') {saved = true; online = false; return reply({message:'Saved.'});}
      return online ? reply([saved ? updated : page.row]) : reply({error:'Unavailable'}, 503);
    });
    await until(() => view.document.getElementById(page.table).textContent.includes(page.row.EmployeeName));
    choose(view, page);
    await view.window[page.write]();
    assert.match(view.document.getElementById(page.message).textContent, /server saved this change/);
    assert.equal(view.document.getElementById(page.save).disabled, true);
    assert.equal(view.document.getElementById(page.retry).hidden, false);
    online = true;
    await view.window[page.read]();
    assert.equal(view.document.getElementById(page.retry).hidden, true);
    assert.equal(view.document.getElementById(page.selected).value, page.row.EmployeeName);
    if (page.name === 'payroll') assert.match(view.document.getElementById('currentSalary').value, /100\.30/);
    else assert.equal(view.document.getElementById('shiftType').value, 'Night');
  });
}

test('payroll rejects negative, zero, non-finite, exponent and sub-cent adjustments without submitting', async t => {
  const page = pages[0];
  const view = await setup(t, page, () => reply([payrollRow]));
  await until(() => view.document.getElementById(page.table).textContent.includes(payrollRow.EmployeeName));
  choose(view, page);
  for (const value of ['-1', '0', 'NaN', '1e2', '0.001']) {
    view.document.getElementById('increaseSalary').value = value;
    await view.window.updateSalary();
    assert.equal(view.calls.filter(call => call.method === 'PUT').length, 0, value);
  }
  view.document.getElementById('decreaseCheckbox').checked = true;
  view.window.toggleInput('decrease');
  view.document.getElementById('decreaseSalary').value = '100.11';
  await view.window.updateSalary();
  assert.equal(view.calls.filter(call => call.method === 'PUT').length, 0);
});

test('shift calendar validation and overnight rollover reject invalid values and preserve eight-hour presets', async t => {
  const page = pages[1];
  const view = await setup(t, page, () => reply([shiftRow]));
  await until(() => view.document.getElementById(page.table).textContent.includes(shiftRow.EmployeeName));
  choose(view, page);
  view.document.getElementById('shiftDate').value = '2026-02-30';
  await view.window.changeShiftTime();
  assert.equal(view.calls.filter(call => call.method === 'PUT').length, 0);
  assert.equal(view.document.getElementById('shiftDate').getAttribute('aria-invalid'), 'true');
  view.document.getElementById('shiftDate').value = '2026-12-31';
  for (const name of ['Morning', 'Evening', 'Night']) {
    const start = view.window.createShiftDateTime(name), end = view.window.createShiftDateTime(name, true);
    assert.equal(new Date(end) - new Date(start), 8 * 60 * 60 * 1000);
  }
  assert.equal(view.window.createShiftDateTime('Evening', true), '2027-01-01 01:00:00');
  view.document.getElementById('shiftDate').value = '9999-12-31';
  assert.equal(view.window.createShiftDateTime('Evening', true), null, 'cannot overflow the supported calendar');
});
