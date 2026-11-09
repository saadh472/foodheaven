const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const root = path.resolve(__dirname, '..');
const endpoints = ['/employees/get/', '/payroll/get/', '/shift/get/'];
const initialEmployees = [
  {EmployeeID:1001, EmployeeName:'Demo Manager', EmailID:'manager@example.com'},
  {EmployeeID:1002, EmployeeName:'<img src=x onerror="window.injected=true">', EmailID:'two@example.com'},
  {EmployeeID:1003, EmployeeName:'Demo Three', EmailID:'three@example.com'}
];
const initialPayroll = [
  {EmployeeID:1001, Salary:'100.10'}, {EmployeeID:1002, Salary:'200.20'}, {EmployeeID:1003, Salary:'300.30'}
];
const initialShifts = [
  {EmployeeID:1001, ShiftName:'Morning', StartTime:'2026-01-01T09:00:00', EndTime:'2026-01-01T17:00:00'},
  {EmployeeID:1002, ShiftName:'Not Assigned', StartTime:null, EndTime:null},
  {EmployeeID:1003, ShiftName:'Evening', StartTime:'2026-01-01T17:00:00', EndTime:'2026-01-02T01:00:00'}
];
const defaults = {'/employees/get/':initialEmployees, '/payroll/get/':initialPayroll, '/shift/get/':initialShifts};
const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise,resolve};};
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

async function until(predicate, label) {
  for (let tries = 0; tries < 150; tries++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out: ' + label);
}

async function setup(t, customRoute = () => undefined) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    if (!error.message.includes('navigation')) errors.push(error.message);
  });
  let html = fs.readFileSync(path.join(root,'interface.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi,'');
  const styles = ['styles.css','dashboard.css'].map(file => '<style>' + fs.readFileSync(path.join(root,file),'utf8') + '</style>').join('');
  html = html.replace('</head>', styles + '</head>');
  const dom = new JSDOM(html, {url:'http://localhost/interface.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole});
  const {window} = dom;
  const calls = [];
  window.Request = Request;
  window.Response = Response;
  window.Headers = Headers;
  window.AbortController = AbortController;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
    const request = {path:url.pathname, method:options.method || input.method || 'GET', input,options};
    calls.push(request);
    if (url.pathname === '/api/session') return reply({authenticated:true,user:{MgrID:1001,EmployeeName:'Demo Manager'},csrf_token:'test-csrf-token'});
    if (url.pathname === '/employee/profile/' || url.pathname === '/manager/details/') return reply({employees:[initialEmployees[0]],details:[initialEmployees[0]]});
    const custom = customRoute(request);
    if (custom !== undefined) return custom;
    if (Object.hasOwn(defaults,url.pathname)) return reply(defaults[url.pathname]);
    return reply({error:'Unexpected endpoint'},404);
  };
  window.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
  window.eval(fs.readFileSync(path.join(root,'dashboard.js'),'utf8'));
  t.after(() => {assert.deepEqual(errors, [], 'no unhandled dashboard script errors'); window.close();});
  await until(() => calls.some(call => endpoints.includes(call.path)), 'overview initial request');
  await until(() => window.document.getElementById('metricRegion').getAttribute('aria-busy') === 'false', 'overview settled');
  return {window,document:window.document,calls};
}

function snapshot(view) {
  return ['totalEmployees','totalPayroll','shiftsScheduled','coverageValue','teamPreview'].map(id => view.document.getElementById(id).textContent);
}

test('overview renders one confirmed snapshot with safe team text and native workspace links', async t => {
  const view = await setup(t);
  assert.equal(view.document.getElementById('totalEmployees').textContent,'3');
  assert.match(view.document.getElementById('totalPayroll').textContent,/600\.60?/);
  assert.equal(view.document.getElementById('shiftsScheduled').textContent,'2');
  assert.equal(view.document.querySelector('#teamPreview img'),null);
  assert.equal(view.window.injected,undefined);
  const links = [...view.document.querySelectorAll('.tools-grid a.tool-card[href]')];
  assert.equal(links.length,4);
  assert.deepEqual(links.map(link => new URL(link.href).pathname),[
    '/Sidebar/Sidebar_attendance.html','/Sidebar/Sidebar_payroll.html',
    '/Sidebar/Sidebar_performance.html','/Sidebar/Sidebar_analytics.html'
  ]);
  assert.ok(view.document.querySelector(view.document.querySelector('.skip-link').getAttribute('href')));
  assert.equal(view.document.querySelector('.workspace-menu [aria-current="page"]').getAttribute('href'),'/interface.html');
  assert.equal(view.calls.filter(call => endpoints.includes(call.path)).length,3);
});

test('overview preserves failed panels on partial refresh without inventing new employee salaries and supports Retry', async t => {
  let phase = 'initial';
  const view = await setup(t, request => {
    if (phase === 'initial') return undefined;
    if (request.path === '/payroll/get/' && phase === 'broken') return reply({error:'Database unavailable.'},503);
    if (request.path === '/employees/get/') return reply([...initialEmployees,{EmployeeID:1004,EmployeeName:'New Employee'}]);
    if (request.path === '/payroll/get/') return reply([...initialPayroll,{EmployeeID:1004,Salary:'10.10'}]);
    if (request.path === '/shift/get/') return reply(initialShifts);
    return undefined;
  });
  const confirmed = snapshot(view);
  phase = 'broken';
  view.document.getElementById('refreshOverview').click();
  await until(() => view.document.getElementById('metricRegion').getAttribute('aria-busy') === 'false', 'failed refresh settled');
  assert.equal(view.document.getElementById('totalPayroll').textContent,confirmed[1],'failed payroll refresh preserves the last confirmed total');
  assert.equal(view.document.getElementById('totalEmployees').textContent,'4','independent successful directory refresh is retained');
  const newEmployee = [...view.document.querySelectorAll('#teamPreview tr')].find(row => row.textContent.includes('New Employee'));
  assert.ok(newEmployee);
  assert.match(newEmployee.cells[3].textContent,/—|unavailable/i,'missing payroll row is unavailable, not a fictional zero salary');
  const status = view.document.getElementById('overviewStatus');
  assert.equal(status.hidden,false);
  assert.match(status.textContent,/retry|refresh|could not|unable/i);
  phase = 'recovered';
  const retry = status.querySelector('button');
  if (retry) retry.click();
  else view.document.getElementById('refreshOverview').click();
  await until(() => /610\.70?/.test(view.document.getElementById('totalPayroll').textContent) && view.document.getElementById('metricRegion').getAttribute('aria-busy') === 'false','successful retry');
  assert.match(view.document.getElementById('totalPayroll').textContent,/610\.70?/);
});

test('rapid overview refresh events share a single pending read cycle', async t => {
  let pending = false;
  const waiting = Object.fromEntries(endpoints.map(endpoint => [endpoint,deferred()]));
  const view = await setup(t, request => pending && Object.hasOwn(waiting,request.path) ? waiting[request.path].promise : undefined);
  const before = view.calls.filter(call => endpoints.includes(call.path)).length;
  pending = true;
  const button = view.document.getElementById('refreshOverview');
  button.dispatchEvent(new view.window.Event('click',{bubbles:true}));
  button.dispatchEvent(new view.window.Event('click',{bubbles:true}));
  await until(() => view.calls.filter(call => endpoints.includes(call.path)).length >= before + 3,'pending refresh requests');
  await pause();
  assert.equal(view.calls.filter(call => endpoints.includes(call.path)).length,before + 3);
  assert.equal(button.disabled,true);
  for (const endpoint of endpoints) waiting[endpoint].resolve(reply(defaults[endpoint]));
  await until(() => !button.disabled,'pending refresh completed');
  assert.equal(view.document.getElementById('totalEmployees').textContent,'3');
});

test('invalid overview payloads do not turn a previously confirmed total into zero', async t => {
  let broken = false;
  const view = await setup(t, request => broken && request.path === '/payroll/get/' ? reply({unexpected:'shape'}) : undefined);
  const confirmed = snapshot(view);
  broken = true;
  view.document.getElementById('refreshOverview').click();
  await until(() => view.document.getElementById('metricRegion').getAttribute('aria-busy') === 'false','invalid refresh settled');
  assert.deepEqual(snapshot(view),confirmed);
});

test('invalid scalar payroll values do not replace a confirmed amount with zero', async t => {
  let badValue;
  const view = await setup(t, request => badValue !== undefined && request.path === '/payroll/get/' ? reply([{EmployeeID:1001,Salary:badValue}]) : undefined);
  const confirmed = view.document.getElementById('totalPayroll').textContent;
  for (const value of [null,'',false]) {
    badValue = value;
    await view.window.loadDashboardStats();
    assert.equal(view.document.getElementById('totalPayroll').textContent,confirmed,String(value));
    assert.equal(view.document.getElementById('overviewStatus').hidden,false);
  }
});

test('invalid schedule timestamps cannot count as assigned employees', async t => {
  let invalid = false;
  const view = await setup(t, request => invalid && request.path === '/shift/get/' ? reply([{EmployeeID:1001,ShiftName:'Morning',StartTime:'invalid',EndTime:'invalid'}]) : undefined);
  const confirmed = view.document.getElementById('shiftsScheduled').textContent;
  invalid = true;
  await view.window.loadDashboardStats();
  assert.equal(view.document.getElementById('shiftsScheduled').textContent,confirmed);
  assert.equal(view.document.getElementById('overviewStatus').hidden,false);
});

test('overview controls stay compact and theme changes preserve their readable labels', async t => {
  const view = await setup(t);
  const trigger = view.window.getComputedStyle(view.document.getElementById('accountTrigger'));
  assert.equal(trigger.width,'auto');
  assert.equal(trigger.maxWidth,'220px');
  assert.equal(view.window.getComputedStyle(view.document.querySelector('.primary-action')).width,'auto');
  assert.equal(view.window.getComputedStyle(view.document.getElementById('refreshOverview')).width,'34px');
  const appearance = view.document.querySelector('.theme-toggle');
  const background = view.window.getComputedStyle(view.document.body).backgroundColor;
  appearance.click();
  assert.equal(view.document.body.classList.contains('dark-theme'),true);
  assert.equal(appearance.getAttribute('aria-pressed'),'true');
  assert.match(appearance.textContent,/Appearance/);
  assert.notEqual(view.window.getComputedStyle(view.document.body).backgroundColor,background);
  assert.equal(view.window.getComputedStyle(view.document.getElementById('accountTrigger')).width,'auto');
});

test('account drawer supports focus, inert background, Tab wrapping, Escape and backdrop closure', async t => {
  const view = await setup(t);
  const {document,window} = view;
  const trigger = document.getElementById('accountTrigger'), drawer = document.getElementById('profilePanel');
  trigger.focus(); trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(drawer.hidden,false);
  assert.equal(drawer.getAttribute('aria-hidden'),'false');
  assert.equal(document.getElementById('workspace').inert,true);
  assert.equal(document.getElementById('sidebar').inert,true);
  const controls = [...drawer.querySelectorAll('a[href],button:not(:disabled)')];
  assert.ok(drawer.contains(document.activeElement));
  controls.at(-1).focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(document.activeElement,controls[0]);
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(document.activeElement,controls.at(-1));
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(drawer.hidden,true);
  assert.equal(document.activeElement,trigger);
  assert.equal(document.getElementById('workspace').inert,false);
  trigger.click(); document.getElementById('accountBackdrop').click();
  assert.equal(drawer.hidden,true);
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
  assert.equal(document.activeElement,trigger);
});
