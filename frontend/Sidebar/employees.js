/* Employee directory: confirmed server data, cancellable reads and guarded writes. */
(() => {
  'use strict';

  const fieldIds = ['empId', 'empName', 'countryCode', 'contactNo', 'email', 'address', 'hireDate', 'dob', 'mgrId'];
  const errorIds = { empId: 'empIdError', empName: 'empNameError', contactNo: 'contactError', email: 'emailError', address: 'addressError', hireDate: 'hireDateError', dob: 'dobError', mgrId: 'mgrIdError' };
  const columns = ['EmployeeID', 'EmployeeName', 'Contact', 'EmailID', 'Address', 'HireDate', 'DateOfBirth', 'MgrID'];
  const state = { rows: [], hasSnapshot: false, loading: false, loadFailed: false, sequence: 0, controller: null,
    writing: false, reconcile: false, editingId: null, editSource: null, editConflict: false, page: 1, baseline: '', initialized: false,
    drawerOpen: false, drawerMode: null, detailsId: null, returnFocus: null, inertElements: [], managerId: null, hashPending: location.hash === '#employeeForm' };
  const pageSize = 10;
  const byId = id => document.getElementById(id);
  const formValues = () => JSON.stringify(fieldIds.map(id => byId(id).value));
  const dirty = () => state.baseline !== '' && formValues() !== state.baseline;
  const ready = () => state.hasSnapshot && !state.loading && !state.loadFailed && !state.reconcile;
  const matches = row => {
    const query = byId('searchInput').value.trim().toLocaleLowerCase();
    return !query || String(row.EmployeeID).toLocaleLowerCase().includes(query) || row.EmployeeName.toLocaleLowerCase().includes(query) || String(row.EmailID ?? '').toLocaleLowerCase().includes(query);
  };

  function status(message, kind = 'info', retry = false) {
    byId('directoryMessage').textContent = message;
    byId('directoryStatus').dataset.kind = kind;
    byId('directoryStatus').setAttribute('role', kind === 'error' ? 'alert' : 'status');
    byId('directoryStatus').hidden = kind === 'success' && !retry;
    byId('retryDirectory').hidden = !retry;
    byId('retryDirectory').style.display = retry ? '' : 'none';
  }

  function formStatus(message = '', kind = 'info') {
    const element = byId('formStatus');
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
    element.style.display = message ? '' : 'none';
  }

  function showToast(message, kind = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    toast.setAttribute('role', 'status');
    const content = document.createElement('span');
    content.className = 'toast-message';
    content.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    toast.append(content, close);
    byId('toastContainer').appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function formatDateInput(value) {
    const candidate = String(value ?? '').slice(0, 10);
    return validDate(candidate) ? candidate : '';
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function formatDateDisplay(value) {
    const iso = formatDateInput(value);
    return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Not recorded';
  }

  function normalizedRow(row) {
    const id = Number(row?.EmployeeID);
    if (!row || !Number.isInteger(id) || id < 1 || id > 2147483647 || typeof row.EmployeeName !== 'string' || !row.EmployeeName.trim()) {
      throw new Error('The server returned an unexpected employee record.');
    }
    return Object.fromEntries(columns.map(key => [key, key === 'EmployeeID' ? id : row[key] ?? null]));
  }

  function cell(row, value) {
    const element = document.createElement('td');
    element.textContent = value ?? '';
    row.appendChild(element);
    return element;
  }

  function icon(name) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.setAttribute('class', 'icon');
    element.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/icons.svg#${name}`);
    element.appendChild(use);
    return element;
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  }

  function syncControls() {
    const canWrite = ready() && !state.writing;
    for (const control of byId('employeeForm').querySelectorAll('input, select, button')) control.disabled = !canWrite;
    byId('saveButton').disabled = !canWrite || state.editConflict;
    byId('clearFormButton').disabled = state.writing;
    byId('addEmployeeButton').disabled = !canWrite;
    byId('refreshButton').disabled = state.loading || state.writing;
    byId('retryDirectory').disabled = state.loading || state.writing;
    byId('exportCsvButton').disabled = !canWrite || !state.rows.some(matches);
    byId('exportTsvButton').disabled = !canWrite || !state.rows.some(matches);
    for (const button of byId('tableBody').querySelectorAll('button')) button.disabled = state.writing || button.dataset.protected === 'true' || (button.dataset.readonly === 'true' ? !state.hasSnapshot : !canWrite);
    byId('closeEmployeeDrawer').disabled = state.writing;
    byId('editEmployeeDetails').disabled = !canWrite || !state.rows.some(row => row.EmployeeID === state.detailsId);
    if (byId('refreshWorkspace')) byId('refreshWorkspace').disabled = state.loading || state.writing;
    byId('clearSearchButton').hidden = !byId('searchInput').value;
    byId('employeeForm').setAttribute('aria-busy', String(state.writing));
    byId('directoryTableRegion').setAttribute('aria-busy', String(state.loading || state.writing));
    byId('refreshButton').querySelector('span').textContent = state.loading ? 'Refreshing…' : 'Refresh';
    byId('saveButton').textContent = state.writing ? 'Saving…' : state.editingId === null ? 'Add Employee' : 'Update Employee';
    byId('clearFormButton').textContent = 'Cancel';
    byId('editHint').textContent = state.writing ? 'Saving employee. Keep this panel open.' : dirty() ? 'You have unsaved changes.' : 'Fields marked * are required.';
  }

  function render() {
    const filtered = state.rows.filter(matches);
    const pages = Math.ceil(filtered.length / pageSize);
    state.page = pages ? Math.min(Math.max(state.page, 1), pages) : 1;
    const body = byId('tableBody');
    body.replaceChildren();
    if (!filtered.length) {
      const row = document.createElement('tr');
      const message = !state.hasSnapshot ? state.loading ? 'Loading employee records…' : 'The directory could not be loaded. Use Retry above.' : state.rows.length ? 'No employees match your search. Try another name, email, or ID.' : 'Your directory is empty. Add your first employee to get started.';
      const placeholder = cell(row, message);
      placeholder.colSpan = 5;
      placeholder.className = 'directory-placeholder';
      body.appendChild(row);
    }
    for (const employee of filtered.slice((state.page - 1) * pageSize, state.page * pageSize)) {
      const row = document.createElement('tr');
      row.dataset.employeeId = String(employee.EmployeeID);
      const person = document.createElement('div');
      person.className = 'directory-person';
      const avatar = document.createElement('span');
      avatar.className = 'employee-avatar'; avatar.dataset.tone = String(employee.EmployeeID % 4); avatar.textContent = initials(employee.EmployeeName); avatar.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('div'); copy.className = 'directory-person-copy';
      const name = document.createElement('button'); name.type = 'button'; name.className = 'employee-name'; name.textContent = employee.EmployeeName; name.title = employee.EmployeeName;
      name.dataset.readonly = 'true'; name.setAttribute('aria-label', `View details for ${employee.EmployeeName}`); name.setAttribute('aria-haspopup', 'dialog'); name.setAttribute('aria-controls', 'employeeDrawer');
      name.addEventListener('click', () => viewEmployee(employee.EmployeeID));
      const email = document.createElement('span'); email.className = 'employee-email'; email.textContent = employee.EmailID || 'Email not provided'; email.title = email.textContent;
      copy.append(name, email); person.append(avatar, copy); cell(row, '').appendChild(person);
      const id = document.createElement('span'); id.className = 'employee-id'; id.textContent = employee.EmployeeID; cell(row, '').appendChild(id);
      cell(row, employee.Contact || 'Not provided').className = 'directory-contact';
      cell(row, formatDateDisplay(employee.HireDate)).className = 'directory-hire-date';
      const actions = cell(row, '');
      const group = document.createElement('div'); group.className = 'row-actions';
      for (const [label, className, iconName, action] of [['Edit', 'edit-action', 'edit', editEmployee], ['Delete', 'delete-action', 'trash', removeEmployee]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `employee-action ${className}`;
        button.append(icon(iconName), document.createTextNode(label));
        button.setAttribute('aria-label', `${label} ${employee.EmployeeName} (${employee.EmployeeID})`);
        button.addEventListener('click', () => action(employee.EmployeeID));
        if (label === 'Delete' && employee.EmployeeID === state.managerId) { button.dataset.protected = 'true'; button.title = 'Your manager account is protected from deletion.'; }
        group.appendChild(button);
      }
      actions.appendChild(group);
      body.appendChild(row);
    }
    byId('totalEmployeesStat').textContent = state.hasSnapshot ? state.rows.length : '—';
    byId('pageNum').textContent = pages ? `Page ${state.page} of ${pages}` : 'Page 0 of 0';
    const first = filtered.length ? (state.page - 1) * pageSize + 1 : 0;
    byId('directoryRange').textContent = state.hasSnapshot ? `Showing ${first}–${Math.min(state.page * pageSize, filtered.length)} of ${filtered.length} employees${byId('searchInput').value.trim() ? ' matching your search' : ''}` : 'Waiting for employees';
    byId('prevPage').disabled = !pages || state.page <= 1;
    byId('nextPage').disabled = !pages || state.page >= pages;
    syncControls();
  }

  function clearErrors() {
    for (const [field, error] of Object.entries(errorIds)) {
      byId(field).removeAttribute('aria-invalid');
      byId(error).textContent = '';
      byId(error).hidden = true;
    }
  }

  function fieldError(field, message) {
    byId(field).setAttribute('aria-invalid', 'true');
    byId(errorIds[field]).textContent = message;
    byId(errorIds[field]).hidden = false;
  }

  function openDrawer(mode) {
    const account = byId('profilePanel');
    if (account?.classList.contains('active') && typeof window.toggleCanvas === 'function') window.toggleCanvas();
    if (!state.drawerOpen) {
      state.returnFocus = document.activeElement;
      const background = [byId('workspace') || byId('main-content'), byId('sidebar')].filter(Boolean);
      state.inertElements = background.map(element => ({ element, inert: element.inert, attribute: element.hasAttribute('inert') }));
      for (const { element } of state.inertElements) { element.inert = true; element.setAttribute('inert', ''); }
    }
    state.drawerOpen = true;
    state.drawerMode = mode;
    byId('employeeDrawer').hidden = false;
    byId('employeeDrawer').setAttribute('aria-hidden', 'false');
    byId('employeeDrawer').classList.add('active');
    byId('employeeBackdrop').hidden = false;
    byId('formSection').hidden = mode !== 'editor';
    byId('employeeDetails').hidden = mode !== 'details';
    byId('employeeDrawerCaption').textContent = mode === 'details' ? 'EMPLOYEE DIRECTORY' : state.editingId === null ? 'GROW YOUR TEAM' : 'EMPLOYEE DIRECTORY';
    document.body.classList.add('directory-drawer-open');
    syncControls();
    (mode === 'editor' ? byId('empName') : byId('closeEmployeeDrawer')).focus();
  }

  function closeDrawer(force = false) {
    if (!state.drawerOpen) return true;
    if (!force && (state.writing || (state.drawerMode === 'editor' && !discardAllowed()))) {
      if (state.writing) formStatus('Please wait for the current change to finish before closing this panel.', 'warning');
      return false;
    }
    state.drawerOpen = false;
    state.drawerMode = null;
    state.detailsId = null;
    byId('employeeDrawer').hidden = true;
    byId('employeeDrawer').setAttribute('aria-hidden', 'true');
    byId('employeeDrawer').classList.remove('active');
    byId('employeeBackdrop').hidden = true;
    document.body.classList.remove('directory-drawer-open');
    for (const { element, inert, attribute } of state.inertElements) {
      element.inert = inert;
      if (!attribute) element.removeAttribute('inert');
    }
    state.inertElements = [];
    resetForm();
    if (location.hash === '#employeeForm') {
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* Closing still works when history is unavailable. */ }
    }
    const opener = state.returnFocus;
    state.returnFocus = null;
    if (opener?.isConnected && !opener.disabled && !opener.closest('[hidden]')) opener.focus();
    else (byId('addEmployeeButton').disabled ? byId('refreshButton') : byId('addEmployeeButton')).focus();
    return true;
  }

  function updateDetails() {
    const employee = state.rows.find(row => row.EmployeeID === state.detailsId);
    const notice = byId('detailsStatus');
    if (!employee) {
      notice.textContent = 'This employee is no longer in the current directory. The details below are the last confirmed record.';
      notice.hidden = false;
      byId('editEmployeeDetails').disabled = true;
      return;
    }
    byId('detailAvatar').textContent = initials(employee.EmployeeName);
    byId('detailAvatar').dataset.tone = String(employee.EmployeeID % 4);
    byId('detailName').textContent = employee.EmployeeName;
    byId('detailEmail').textContent = employee.EmailID || 'Email not provided';
    byId('detailEmployeeId').textContent = `ID ${employee.EmployeeID}`;
    byId('detailContact').textContent = employee.Contact || 'Not provided';
    byId('detailAddress').textContent = employee.Address || 'Not provided';
    byId('detailDob').textContent = formatDateDisplay(employee.DateOfBirth);
    byId('detailHireDate').textContent = formatDateDisplay(employee.HireDate);
    byId('detailManager').textContent = employee.MgrID ?? 'Not assigned';
    notice.textContent = ready() ? '' : 'Showing the last confirmed employee details. Refresh the directory to check for updates.';
    notice.hidden = ready();
  }

  function viewEmployee(employeeId) {
    if (!state.hasSnapshot || state.writing) return false;
    if (state.drawerMode === 'editor' && !discardAllowed()) return false;
    const employee = state.rows.find(row => row.EmployeeID === Number(employeeId));
    if (!employee) return false;
    resetForm();
    state.detailsId = employee.EmployeeID;
    byId('employeeDrawerTitle').textContent = 'Employee details';
    updateDetails();
    openDrawer('details');
    return true;
  }

  function discardAllowed() {
    if (state.writing) { formStatus('Wait for the current change to finish before leaving or clearing the form.', 'warning'); return false; }
    return !dirty() || confirm('Discard your unsaved employee changes?');
  }

  function resetForm() {
    state.editingId = null;
    state.editSource = null;
    state.editConflict = false;
    byId('employeeForm').reset();
    byId('empId').readOnly = false;
    document.querySelector('.form-heading').textContent = 'Add employee';
    for (const option of byId('countryCode').querySelectorAll('[data-temporary]')) option.remove();
    clearErrors();
    formStatus();
    state.baseline = formValues();
    syncControls();
  }

  function clearForm() {
    if (!discardAllowed()) return false;
    resetForm();
    byId('empId').focus();
    return true;
  }

  function scrollToForm() {
    if (!state.drawerOpen || state.drawerMode !== 'editor') openDrawer('editor');
  }

  function beginNewEmployee() {
    if (!ready() || state.writing || !clearForm()) return;
    openDrawer('editor');
  }

  function populateForm(employee) {
    state.editingId = employee.EmployeeID;
    state.editSource = JSON.stringify(employee);
    state.editConflict = false;
    byId('empId').value = employee.EmployeeID;
    byId('empId').readOnly = true;
    byId('empName').value = employee.EmployeeName;
    byId('email').value = employee.EmailID ?? '';
    byId('address').value = employee.Address ?? '';
    byId('hireDate').value = formatDateInput(employee.HireDate);
    byId('dob').value = formatDateInput(employee.DateOfBirth);
    byId('mgrId').value = employee.MgrID ?? '';
    const contact = String(employee.Contact ?? '');
    const match = contact.match(/^(\+\d+)\s+(.+)$/);
    if (match && ![...byId('countryCode').options].some(option => option.value === match[1])) {
      const option = document.createElement('option'); option.value = match[1]; option.textContent = match[1]; option.dataset.temporary = 'true'; byId('countryCode').appendChild(option);
    }
    byId('countryCode').value = match ? match[1] : '+92';
    byId('contactNo').value = match ? match[2] : contact;
    document.querySelector('.form-heading').textContent = `Edit Employee ${employee.EmployeeID}`;
    clearErrors();
    formStatus();
    state.baseline = formValues();
    syncControls();
  }

  function editEmployee(employeeId) {
    if (!ready() || state.writing || !discardAllowed()) return false;
    const employee = state.rows.find(row => row.EmployeeID === Number(employeeId));
    if (!employee) { status('That employee is no longer in this view. Refresh the directory.', 'warning', true); return false; }
    populateForm(employee);
    openDrawer('editor');
    byId('empName').focus();
    return true;
  }

  function invalidateRead() {
    state.sequence += 1;
    state.controller?.abort();
    state.controller = null;
    state.loading = false;
  }

  async function fetchEmployees() {
    if (state.writing) return false;
    invalidateRead();
    const sequence = state.sequence;
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    status(state.hasSnapshot ? 'Refreshing employee records. Your form values are preserved…' : 'Loading the employee directory…');
    render();
    try {
      const response = await fetch('/employees/get/', { signal: controller.signal });
      const payload = await response.json();
      if (sequence !== state.sequence) return false;
      if (!response.ok) throw new Error(payload.error || `The directory could not be loaded (HTTP ${response.status}).`);
      if (!Array.isArray(payload)) throw new Error('The server returned an unexpected directory format.');
      const rows = payload.map(normalizedRow);
      if (new Set(rows.map(row => row.EmployeeID)).size !== rows.length) throw new Error('The server returned duplicate employee IDs.');
      if (state.editingId !== null) {
        const employee = rows.find(row => row.EmployeeID === state.editingId);
        if (!employee || (dirty() && state.editSource !== JSON.stringify(employee))) {
          state.editConflict = true;
          formStatus(employee ? 'This record changed on the server. Cancel editing and reopen it before saving.' : 'This employee was removed on the server. Cancel editing to start another record.', 'warning');
        } else if (!dirty()) populateForm(employee);
      }
      state.rows = rows;
      state.hasSnapshot = true;
      state.loadFailed = false;
      state.reconcile = false;
      status(`${rows.length} employee records loaded. Search, edit, or add an employee below.`, 'success');
      return true;
    } catch (error) {
      if (sequence !== state.sequence) return false;
      state.loadFailed = true;
      status(`${error.message || 'Could not connect to the server.'}${state.hasSnapshot ? ' Showing the last confirmed records; editing is paused until refresh succeeds.' : ' Retry to load the directory.'}`, 'error', true);
      return false;
    } finally {
      if (sequence === state.sequence) {
        state.loading = false;
        state.controller = null;
        render();
        if (state.drawerMode === 'details') updateDetails();
        if (ready() && state.hashPending) { state.hashPending = false; beginNewEmployee(); }
      }
    }
  }

  function positiveId(value) {
    return /^\d{1,10}$/.test(value) && Number(value) >= 1 && Number(value) <= 2147483647;
  }

  function validateForm() {
    clearErrors();
    formStatus();
    const values = Object.fromEntries(fieldIds.map(id => [id, byId(id).value.trim()]));
    const errors = {};
    if (!positiveId(values.empId)) errors.empId = 'Enter a whole employee ID between 1 and 2147483647.';
    else if (state.editingId !== null && Number(values.empId) !== state.editingId) errors.empId = 'The ID of an existing employee cannot be changed.';
    else if (state.editingId === null && state.rows.some(row => row.EmployeeID === Number(values.empId))) errors.empId = 'This ID already exists. Use Edit on its row instead.';
    if (!values.empName || values.empName.length > 120 || /[\x00-\x1f]/.test(values.empName)) errors.empName = 'Enter an employee name of up to 120 characters.';
    const contact = values.contactNo.startsWith('+') ? values.contactNo : `${values.countryCode} ${values.contactNo}`;
    if (!values.contactNo || contact.length > 32 || !/^[+\d\s().-]+$/.test(contact) || contact.replace(/\D/g, '').length < 3) errors.contactNo = 'Enter a contact number using digits, spaces, +, parentheses, or hyphens (up to 32 characters).';
    if (!values.email || values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) || byId('email').validity.typeMismatch) errors.email = 'Enter a valid email address, such as name@example.com.';
    if (!values.address || values.address.length > 250 || /[\x00-\x1f]/.test(values.address)) errors.address = 'Enter an address of up to 250 characters.';
    if (!validDate(values.hireDate)) errors.hireDate = 'Choose a valid hire date.';
    if (!validDate(values.dob)) errors.dob = 'Choose a valid date of birth.';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (!errors.dob && values.dob > today) errors.dob = 'Date of birth cannot be in the future.';
    if (!errors.hireDate && !errors.dob && values.hireDate < values.dob) errors.hireDate = 'Hire date must be on or after the date of birth.';
    if (values.mgrId && !positiveId(values.mgrId)) errors.mgrId = 'Enter a valid manager ID or leave this field empty.';
    if (Object.keys(errors).length) {
      for (const [field, message] of Object.entries(errors)) fieldError(field, message);
      formStatus('Correct the highlighted fields before saving.', 'error');
      byId(Object.keys(errors)[0]).focus();
      return null;
    }
    return { EmployeeID: Number(values.empId), EmployeeName: values.empName, Contact: contact, EmailID: values.email,
      Address: values.address, HireDate: values.hireDate, DateOfBirth: values.dob, MgrID: values.mgrId ? Number(values.mgrId) : null };
  }

  function serverField(message) {
    const mapping = { EmployeeID: 'empId', EmployeeName: 'empName', Contact: 'contactNo', EmailID: 'email', Address: 'address', HireDate: 'hireDate', DateOfBirth: 'dob', MgrID: 'mgrId' };
    const entry = Object.entries(mapping).find(([name]) => message.includes(name));
    if (entry) { fieldError(entry[1], message); byId(entry[1]).focus(); }
  }

  async function saveEmployee() {
    if (state.writing) return false;
    if (!ready() || state.editConflict) { formStatus('Refresh the directory and review this record before saving.', 'warning'); return false; }
    const employee = validateForm();
    if (!employee) return false;
    const editing = state.editingId !== null;
    invalidateRead();
    state.writing = true;
    let saved = false;
    status(editing ? 'Saving the employee update. Please wait for confirmation…' : 'Adding the employee. Please wait for confirmation…');
    syncControls();
    try {
      const response = await fetch(editing ? `/employees/update/${state.editingId}` : '/employees/add', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(employee)
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload.error || `The employee could not be saved (HTTP ${response.status}).`;
        formStatus(message, 'error');
        if (response.status >= 500) state.reconcile = true;
        status(state.reconcile ? `${message} Refresh the directory before trying again.` : 'The employee was not saved. Review the form and try again.', 'error', state.reconcile);
        return false;
      }
      const confirmed = normalizedRow(payload.employee);
      if (confirmed.EmployeeID !== employee.EmployeeID) throw new Error('The server returned a different employee ID.');
      const index = state.rows.findIndex(row => row.EmployeeID === confirmed.EmployeeID);
      if (index === -1) state.rows.push(confirmed); else state.rows[index] = confirmed;
      state.rows.sort((a, b) => a.EmployeeID - b.EmployeeID);
      resetForm();
      saved = true;
      const hidden = !matches(confirmed);
      const message = `Employee ${editing ? 'updated' : 'added'} successfully.${hidden ? ' The active search hides this record; clear it to view the employee.' : ''}`;
      status(message, 'success');
      showToast(message, 'success');
      return true;
    } catch (error) {
      state.reconcile = true;
      formStatus('The save could not be confirmed. Your form is preserved. Refresh and review the directory before trying again.', 'warning');
      status(`${error.message || 'Connection interrupted.'} The save may have reached the server. Refresh before another submission.`, 'error', true);
      return false;
    } finally {
      state.writing = false;
      render();
      if (saved && state.drawerMode === 'editor') closeDrawer(true);
      if (byId('formStatus').dataset.kind === 'error') serverField(byId('formStatus').textContent);
    }
  }

  async function removeEmployee(employeeId) {
    if (state.writing || !ready()) return false;
    const employee = state.rows.find(row => row.EmployeeID === Number(employeeId));
    if (!employee) return false;
    if (employee.EmployeeID === state.managerId) { status('Your manager account is protected from deletion.', 'warning'); return false; }
    const unsaved = state.editingId === employee.EmployeeID && dirty() ? ' Unsaved edits to this employee will also be discarded after deletion succeeds.' : '';
    if (!confirm(`Delete ${employee.EmployeeName} (ID ${employee.EmployeeID}) and their payroll, shift, attendance, and performance records?${unsaved} This cannot be undone.`)) return false;
    invalidateRead();
    state.writing = true;
    let deleted = false;
    const closeAfterDelete = state.editingId === employee.EmployeeID || state.detailsId === employee.EmployeeID;
    status(`Deleting employee ${employee.EmployeeID}. Waiting for confirmation…`);
    syncControls();
    try {
      const response = await fetch(`/employees/delete/${employee.EmployeeID}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload.error || `The employee could not be deleted (HTTP ${response.status}).`;
        if (response.status >= 500 || response.status === 404) state.reconcile = true;
        status(`${message}${state.reconcile ? ' Refresh the directory before another change.' : ''}`, 'error', state.reconcile);
        return false;
      }
      state.rows = state.rows.filter(row => row.EmployeeID !== employee.EmployeeID);
      if (state.editingId === employee.EmployeeID) resetForm();
      deleted = true;
      status(`Employee ${employee.EmployeeID} deleted successfully.`, 'success');
      showToast('Employee deleted successfully.', 'success');
      return true;
    } catch (error) {
      state.reconcile = true;
      status(`${error.message || 'Connection interrupted.'} The deletion could not be confirmed. Refresh before trying again.`, 'error', true);
      return false;
    } finally {
      state.writing = false;
      render();
      if (deleted && closeAfterDelete) closeDrawer(true);
    }
  }

  function searchEmployees() { state.page = 1; render(); }
  function clearSearch() { byId('searchInput').value = ''; searchEmployees(); byId('searchInput').focus(); }
  function changePage(direction) { state.page += direction === 'next' ? 1 : -1; render(); }

  function exportEmployees(separator) {
    const rows = state.rows.filter(matches);
    if (!ready() || state.writing || !rows.length) return;
    const quote = value => {
      let content = String(value ?? '');
      if (/^\s*[=+@-]|^[\t\r\n]/.test(content)) content = `'${content}`;
      return `"${content.replace(/"/g, '""')}"`;
    };
    const content = [columns, ...rows.map(row => columns.map(key => row[key]))].map(row => row.map(quote).join(separator)).join('\r\n');
    const extension = separator === ',' ? 'csv' : 'tsv';
    const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `employees.${extension}`;
    document.body.appendChild(link); link.click(); link.remove();
    byId('exportMenu').open = false;
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${rows.length} matching employees as ${extension.toUpperCase()}.`, 'success');
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    resetForm();
    byId('employeeForm').addEventListener('submit', event => { event.preventDefault(); saveEmployee(); });
    byId('employeeForm').addEventListener('input', event => {
      if (errorIds[event.target.id]) {
        byId(event.target.id).removeAttribute('aria-invalid');
        byId(errorIds[event.target.id]).hidden = true;
      }
      if (!state.editConflict) formStatus();
      syncControls();
    });
    byId('employeeForm').addEventListener('change', syncControls);
    byId('retryDirectory').addEventListener('click', fetchEmployees);
    byId('closeEmployeeDrawer').addEventListener('click', () => closeDrawer());
    byId('employeeBackdrop').addEventListener('click', () => closeDrawer());
    byId('editEmployeeDetails').addEventListener('click', () => editEmployee(state.detailsId));
    document.addEventListener('keydown', event => {
      if (state.drawerOpen && !byId('employeeDrawer').hidden) {
        if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...byId('employeeDrawer').querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(element => !element.closest('[hidden]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (!byId('employeeDrawer').contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      } else if (event.key === 'Escape' && byId('exportMenu').open) { byId('exportMenu').open = false; byId('exportMenu').querySelector('summary').focus(); }
    });
    document.addEventListener('click', event => {
      if (!byId('exportMenu').contains(event.target)) byId('exportMenu').open = false;
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.download || anchor.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const target = new URL(anchor.href, location.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (!discardAllowed()) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('beforeunload', event => {
      if (dirty() || state.writing) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('foodheaven:connection-restored', () => { if (!state.writing) fetchEmployees(); });
    window.addEventListener('foodheaven:refresh', event => { if (!event.detail?.page || event.detail.page === 'employees') fetchEmployees(); });
    if (window.FoodHeaven?.ready) {
      Promise.resolve(window.FoodHeaven.ready).then(session => { state.managerId = Number(session.user?.MgrID) || null; render(); }).catch(() => {});
    }
    fetchEmployees();
  }

  Object.assign(window, { fetchEmployees, refreshEmployeeData: fetchEmployees, saveEmployee, editEmployee, removeEmployee,
    searchEmployees, clearSearch, changePage, clearForm, beginNewEmployee, scrollToForm,
    viewEmployee, closeEmployeeDrawer: () => closeDrawer(), cancelEmployeeEditing: () => closeDrawer(),
    exportToCSV: () => exportEmployees(','), exportToExcel: () => exportEmployees('\t') });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
