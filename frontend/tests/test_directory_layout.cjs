const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole, requestInterceptor} = require('jsdom');

const root = path.resolve(__dirname, '..');
const employee = {
  EmployeeID:1002, EmployeeName:'Jordan Example', Contact:'+92 3001234567',
  EmailID:'jordan.employee@example.com', Address:'<img src=x onerror="window.injected=true">',
  HireDate:'2024-01-15', DateOfBirth:'1995-06-01', MgrID:1001
};
const manager = {...employee, EmployeeID:1001, MgrID:1001, EmployeeName:'Demo Manager', EmailID:'manager@example.com'};
const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise,resolve};};

async function until(predicate,label) {
  for (let attempt=0; attempt<200; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve,5));
  }
  throw new Error('Timed out: '+label);
}

async function setup(t,options={}) {
  const state = {rows:[{...employee}], failRead:false, confirms:[], confirmResult:true, writes:[], ...options};
  const errors=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error => {
    if (!error.message.includes('navigation')) errors.push(error.message);
  });
  const url='http://foodheaven.test/Sidebar/Sidebar_employeedetails.html'+(options.hash||'');
  const html=fs.readFileSync(path.join(root,'Sidebar/Sidebar_employeedetails.html'),'utf8');
  const resources={interceptors:[requestInterceptor(request => {
    const asset=new URL(request.url);
    if (asset.origin!=='http://foodheaven.test') return new Response('',{headers:{'Content-Type':'text/css'}});
    const resolved=path.resolve(root,decodeURIComponent(asset.pathname).replace(/^\/+/,''));
    if (!resolved.startsWith(root+path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return new Response('',{status:404});
    const type={'.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif'}[path.extname(resolved).toLowerCase()]||'text/plain';
    return new Response(fs.readFileSync(resolved),{headers:{'Content-Type':type}});
  })]};
  const dom=new JSDOM(html,{
    url,runScripts:'dangerously',pretendToBeVisual:true,resources,virtualConsole,
    beforeParse(window) {
      window.Request=Request; window.Response=Response; window.Headers=Headers; window.AbortController=AbortController;
      window.HTMLElement.prototype.scrollIntoView=()=>{};
      window.confirm=message => {state.confirms.push(String(message)); return state.confirmResult;};
      window.alert=message => {throw new Error('Unexpected alert: '+message);};
      window.fetch=async(input,options={}) => {
        const request=input instanceof Request ? new Request(input,options) : new Request(new URL(input,url),options);
        const endpoint=new URL(request.url).pathname;
        if(endpoint==='/api/session') return reply({authenticated:true,user:{MgrID:1001,EmployeeName:'Demo Manager'},csrf_token:'directory-layout-csrf'});
        if(endpoint==='/employee/profile/') return reply({employees:[manager]});
        if(endpoint==='/manager/details/') return reply({details:[manager]});
        if(endpoint==='/employees/get/') {
          if(state.failRead) throw new Error('Connection unavailable');
          return reply(state.rows);
        }
        if(request.method!=='GET') {
          state.writes.push({endpoint,method:request.method,body:await request.json()});
          if(state.writeResponse) return state.writeResponse.promise;
          return reply({message:'Saved.'});
        }
        return reply({error:'Unexpected API endpoint'},404);
      };
    }
  });
  t.after(()=>{dom.window.close(); assert.deepEqual(errors,[],'no unhandled directory/chrome errors');});
  const {window}=dom;
  await until(()=>window.document.readyState==='complete','directory styles and scripts');
  await until(()=>typeof window.fetchEmployees==='function','directory controller');
  await window.FoodHeaven.ready;
  await until(()=>['success','error'].includes(window.document.getElementById('directoryStatus').dataset.kind) && window.document.getElementById('employeeTable').getAttribute('aria-busy')!=='true','initial directory read');
  return {window,document:window.document,state};
}

function rowFor(view,id=1002) {
  return [...view.document.querySelectorAll('#tableBody tr')].find(row=>row.textContent.includes(String(id)));
}

function assertCompact(window,element,label) {
  assert.ok(element,label+' exists');
  const width=window.getComputedStyle(element).width;
  assert.ok(width==='auto'||(/px$/.test(width)&&Number.parseFloat(width)<=240),label+' has compact declared width, received '+width);
}

function modalVisible(view) {
  const drawer=view.document.getElementById('employeeDrawer');
  return !drawer.hidden && drawer.getAttribute('aria-hidden')!=='true';
}

function openNew(view) {
  const opener=view.document.getElementById('addEmployeeButton');
  opener.focus(); opener.click();
  return opener;
}

test('employee list uses five columns, compact horizontal actions, and matching workspace chrome',async t=>{
  const view=await setup(t);
  await until(()=>rowFor(view),'confirmed employee row');
  assert.equal(view.document.querySelectorAll('#employeeTable thead th').length,5);
  const row=rowFor(view);
  assert.equal(row.cells.length,5);
  assert.match(row.cells[0].textContent,/Jordan Example/);
  assert.match(row.cells[0].textContent,/jordan\.employee@example\.com/);
  assert.doesNotMatch(row.textContent,/\bActive\b|\bDepartment\b/);
  const buttons=[...row.cells[4].querySelectorAll('button')];
  assert.equal(buttons.length,2);
  const actions=buttons[0].parentElement;
  assert.ok(['flex','inline-flex'].includes(view.window.getComputedStyle(actions).display));
  assert.equal(view.window.getComputedStyle(actions).flexWrap,'nowrap');
  for(const button of buttons) assertCompact(view.window,button,'row action');
  for(const id of ['addEmployeeButton','refreshButton','accountTrigger']) assertCompact(view.window,view.document.getElementById(id),id);
  assert.equal(view.document.querySelectorAll('#accountTrigger').length,1);
  const triggerStyle=view.window.getComputedStyle(view.document.getElementById('accountTrigger'));
  assert.equal(triggerStyle.maxWidth,'220px');
  const active=view.document.querySelector('.workspace-menu [aria-current="page"]');
  assert.ok(active);
  assert.equal(new URL(active.href).pathname,'/Sidebar/Sidebar_employeedetails.html');
});

test('compact row opens accessible details with address, birth date, manager, and every existing employee field',async t=>{
  const view=await setup(t);
  await until(()=>rowFor(view),'confirmed employee row');
  const name=rowFor(view).querySelector('.employee-name');
  assert.equal(name.tagName,'BUTTON');
  name.focus(); name.click();
  assert.equal(modalVisible(view),true);
  const drawer=view.document.getElementById('employeeDrawer');
  assert.equal(drawer.getAttribute('role'),'dialog');
  assert.equal(drawer.getAttribute('aria-modal'),'true');
  for(const [id,text] of [
    ['detailName','Jordan Example'],['detailEmail','jordan.employee@example.com'],['detailEmployeeId','1002'],
    ['detailContact','3001234567'],['detailAddress',employee.Address],['detailDob','1995'],['detailHireDate','2024'],['detailManager','1001']
  ]) assert.ok(view.document.getElementById(id).textContent.includes(text),id+' preserves its value');
  assert.equal(drawer.querySelector('img[src="x"]'),null);
  assert.equal(view.window.injected,undefined);
  view.document.getElementById('editEmployeeDetails').click();
  for(const id of ['empId','empName','contactNo','email','address','hireDate','dob','mgrId']) {
    const field=view.document.getElementById(id);
    assert.ok(field.labels.length,id+' is labeled');
    assert.ok(!field.closest('[hidden]'),id+' is available in the editor');
  }
  assert.equal(view.document.getElementById('address').value,employee.Address);
  assert.equal(view.document.getElementById('dob').value,'1995-06-01');
  assert.ok(view.document.getElementById('empId').disabled||view.document.getElementById('empId').readOnly);
});

test('add editor closes cleanly with Escape, restores focus, and respects both dirty-discard decisions',async t=>{
  const view=await setup(t);
  const opener=openNew(view);
  assert.equal(modalVisible(view),true);
  assert.ok(view.document.getElementById('employeeDrawer').contains(view.document.activeElement));
  view.document.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(modalVisible(view),false);
  assert.equal(view.document.activeElement,opener);
  openNew(view);
  const field=view.document.getElementById('empName');
  field.value='Unsaved employee';
  field.dispatchEvent(new view.window.Event('input',{bubbles:true}));
  view.state.confirmResult=false;
  view.document.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(modalVisible(view),true);
  assert.equal(field.value,'Unsaved employee');
  view.state.confirmResult=true;
  view.document.getElementById('closeEmployeeDrawer').click();
  assert.equal(modalVisible(view),false);
  assert.equal(view.document.activeElement,opener);
  assert.equal(view.state.confirms.length,2);
});

test('overview Add employee hash opens the editor after the directory is ready',async t=>{
  const view=await setup(t,{hash:'#employeeForm'});
  await until(()=>modalVisible(view),'hash-opened employee editor');
  assert.equal(view.document.getElementById('empId').value,'');
  assert.equal(view.document.getElementById('empId').disabled,false);
  assert.ok(view.document.getElementById('employeeDrawer').contains(view.document.activeElement));
});

test('empty and unavailable directory rows span the five-column table and retain a usable Retry',async t=>{
  const view=await setup(t,{rows:[]});
  let cell=view.document.querySelector('#tableBody td');
  assert.equal(cell.colSpan,5);
  assert.match(cell.textContent,/no employee|empty|first employee/i);
  view.state.failRead=true;
  await view.window.fetchEmployees();
  cell=view.document.querySelector('#tableBody td');
  assert.equal(cell.colSpan,5);
  assert.equal(view.document.getElementById('retryDirectory').hidden,false);
  view.state.failRead=false;
  view.state.rows=[{...employee}];
  view.document.getElementById('retryDirectory').click();
  await until(()=>rowFor(view),'retry confirmed employee row');
  assert.equal(view.document.getElementById('retryDirectory').hidden,true);
});

test('pending employee update cannot be dismissed by Escape, backdrop or close button',async t=>{
  const response=deferred();
  const view=await setup(t,{writeResponse:response});
  await until(()=>rowFor(view),'confirmed employee row');
  view.window.editEmployee(1002);
  view.document.getElementById('empName').value='Updated Employee';
  view.document.getElementById('empName').dispatchEvent(new view.window.Event('input',{bubbles:true}));
  const saving=view.window.saveEmployee();
  await until(()=>view.state.writes.length===1,'pending employee write');
  assert.equal(view.document.getElementById('saveButton').disabled,true);
  view.document.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  view.document.getElementById('employeeBackdrop').click();
  view.document.getElementById('closeEmployeeDrawer').click();
  assert.equal(modalVisible(view),true);
  assert.equal(view.state.writes.length,1);
  view.state.rows=[{...employee,EmployeeName:'Updated Employee'}];
  response.resolve(reply({message:'Updated.',employee:view.state.rows[0]}));
  await saving;
  await until(()=>rowFor(view)?.textContent.includes('Updated Employee'),'confirmed employee update');
});

test('employee editor and account dialog close with their own focus restoration and never share a visible trap',async t=>{
  const view=await setup(t);
  const opener=openNew(view);
  const account=view.document.getElementById('accountTrigger');
  const ancestors=[];
  for(let element=account;element;element=element.parentElement) ancestors.push(element);
  assert.ok(ancestors.some(element=>element.inert),'account header is inert behind the employee editor');
  view.document.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(modalVisible(view),false);
  assert.equal(view.document.activeElement,opener);
  account.focus(); account.click();
  const profile=view.document.getElementById('profilePanel');
  assert.equal(profile.hidden,false);
  assert.equal(modalVisible(view),false);
  assert.ok(profile.contains(view.document.activeElement));
  view.document.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(profile.hidden,true);
  assert.equal(view.document.activeElement,account);
});

test('switching account and employee dialogs respects dirty edits and cannot leave two focus traps visible',async t=>{
  const view=await setup(t);
  openNew(view);
  const name=view.document.getElementById('empName');
  name.value='Keep this draft';
  name.dispatchEvent(new view.window.Event('input',{bubbles:true}));
  const account=view.document.getElementById('accountTrigger');
  const profile=view.document.getElementById('profilePanel');
  view.state.confirmResult=false;
  account.click();
  assert.equal(modalVisible(view),true);
  assert.equal(profile.hidden,true);
  assert.equal(name.value,'Keep this draft');
  view.state.confirmResult=true;
  account.click();
  assert.equal(modalVisible(view),false);
  assert.equal(profile.hidden,false);
  view.window.beginNewEmployee();
  const visible=Number(modalVisible(view))+Number(!profile.hidden);
  assert.equal(visible,1,'one dialog owns focus at a time');
});

test('a name-only edit preserves an existing unfamiliar calling code and confirms the returned employee',async t=>{
  const response=deferred();
  const original={...employee,Contact:'+00 55512'};
  const view=await setup(t,{rows:[original],writeResponse:response});
  view.window.editEmployee(1002);
  view.document.getElementById('empName').value='Updated Name Only';
  view.document.getElementById('empName').dispatchEvent(new view.window.Event('input',{bubbles:true}));
  const saving=view.window.saveEmployee();
  await until(()=>view.state.writes.length===1,'calling-code update request');
  assert.equal(view.state.writes[0].body.Contact,original.Contact);
  const confirmed={...original,EmployeeName:'Updated Name Only'};
  response.resolve(reply({message:'Updated.',employee:confirmed}));
  await saving;
  assert.match(rowFor(view).textContent,/Updated Name Only/);
});

test('cached employee details remain readable offline while every write action stays paused',async t=>{
  const view=await setup(t);
  view.state.failRead=true;
  await view.window.fetchEmployees();
  assert.equal(view.document.getElementById('directoryStatus').dataset.kind,'error');
  const row=rowFor(view);
  const name=row.querySelector('.employee-name');
  assert.equal(name.disabled,false);
  name.focus(); name.click();
  assert.equal(modalVisible(view),true);
  assert.ok(view.document.getElementById('detailAddress').textContent.includes(employee.Address));
  assert.ok(view.document.getElementById('detailDob').textContent.includes('1995'));
  assert.equal(view.document.getElementById('editEmployeeDetails').disabled,true);
  assert.equal(view.state.writes.length,0);
  view.window.closeEmployeeDrawer();
  view.state.failRead=false;
  await view.window.fetchEmployees();
  assert.equal(view.document.getElementById('directoryStatus').dataset.kind,'success');
});
