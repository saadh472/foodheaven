/* Employee directory: confirmed server data, cancellable reads and guarded writes. */
(() => {
  'use strict';

  const fieldIds = ['empId', 'empName', 'countryCode', 'contactNo', 'email', 'address', 'hireDate', 'dob', 'mgrId'];
  const errorIds = { empId: 'empIdError', empName: 'empNameError', contactNo: 'contactError', email: 'emailError', address: 'addressError', hireDate: 'hireDateError', dob: 'dobError', mgrId: 'mgrIdError' };
  const columns = ['EmployeeID', 'EmployeeName', 'Contact', 'EmailID', 'Address', 'HireDate', 'DateOfBirth', 'MgrID'];
  const state = { rows: [], hasSnapshot: false, loading: false, loadFailed: false, sequence: 0, controller: null,
    writing: false, reconcile: false, editingId: null, editSource: null, editConflict: false, page: 1, baseline: '', initialized: false };
  const pageSize = 10;
  const byId = id => document.getElementById(id);
  const formValues = () => JSON.stringify(fieldIds.map(id => byId(id).value));
  const dirty = () => state.baseline !== '' && formValues() !== state.baseline;
  const ready = () => state.hasSnapshot && !state.loading && !state.loadFailed && !state.reconcile;
  const matches = row => {
    const query = byId('searchInput').value.trim().toLocaleLowerCase();
    return !query || String(row.EmployeeID).toLocaleLowerCase().includes(query) || row.EmployeeName.toLocaleLowerCase().includes(query);
  };

  function status(message, kind = 'info', retry = false) {
    byId('directoryMessage').textContent = message;
    byId('directoryStatus').dataset.kind = kind;
    byId('directoryStatus').setAttribute('role', kind === 'error' ? 'alert' : 'status');
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
    for (const button of byId('tableBody').querySelectorAll('button')) button.disabled = !canWrite;
    byId('employeeForm').setAttribute('aria-busy', String(state.writing));
    byId('directoryTableRegion').setAttribute('aria-busy', String(state.loading || state.writing));
    byId('refreshButton').textContent = state.loading ? 'Refreshing…' : 'Refresh';
    byId('saveButton').textContent = state.writing ? 'Saving…' : state.editingId === null ? 'Add Employee' : 'Update Employee';
    byId('clearFormButton').textContent = state.editingId === null ? 'Clear form' : 'Cancel editing';
    byId('editHint').textContent = state.writing ? 'Waiting for server confirmation. Keep this page open.' : dirty() ? 'You have unsaved changes.' : 'Changes are saved only after the server confirms them.';
  }

  function render() {
    const filtered = state.rows.filter(matches);
    const pages = Math.ceil(filtered.length / pageSize);
    state.page = pages ? Math.min(Math.max(state.page, 1), pages) : 1;
    const body = byId('tableBody');
    body.replaceChildren();
    if (!filtered.length) {
      const row = document.createElement('tr');
      const message = !state.hasSnapshot ? state.loading ? 'Loading employee records…' : 'The directory could not be loaded. Use Retry above.' : state.rows.length ? 'No employees match your search. Try another name or ID, or clear the search.' : 'No employees yet. Add your first employee using the form below.';
      cell(row, message).colSpan = 8;
      body.appendChild(row);
    }
    for (const employee of filtered.slice((state.page - 1) * pageSize, state.page * pageSize)) {
      const row = document.createElement('tr');
      row.dataset.employeeId = String(employee.EmployeeID);
      [employee.EmployeeID, employee.EmployeeName, employee.Contact, employee.EmailID, employee.Address,
        formatDateDisplay(employee.HireDate), formatDateDisplay(employee.DateOfBirth)].forEach(value => cell(row, value));
      const actions = cell(row, '');
      for (const [label, className, action] of [['Edit', 'btn-edit', editEmployee], ['Delete', 'btn-delete', removeEmployee]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn-small ${className}`;
        button.textContent = label;
        button.setAttribute('aria-label', `${label} ${employee.EmployeeName} (${employee.EmployeeID})`);
        button.addEventListener('click', () => action(employee.EmployeeID));
        actions.appendChild(button);
      }
      body.appendChild(row);
    }
    byId('totalEmployeesStat').textContent = state.hasSnapshot ? state.rows.length : '—';
    byId('pageNum').textContent = pages ? `Page ${state.page} of ${pages} · ${filtered.length} matching employees` : 'Page 0 of 0';
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
    document.querySelector('.form-heading').textContent = 'Add New Employee';
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
    byId('formSection').scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function beginNewEmployee() {
    if (!ready() || state.writing || !clearForm()) return;
    scrollToForm();
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
    const supported = [...byId('countryCode').options].some(option => option.value === match?.[1]);
    byId('countryCode').value = supported ? match[1] : '+92';
    byId('contactNo').value = supported ? match[2] : contact;
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
    scrollToForm();
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
      if (byId('formStatus').dataset.kind === 'error') serverField(byId('formStatus').textContent);
    }
  }

  async function removeEmployee(employeeId) {
    if (state.writing || !ready()) return false;
    const employee = state.rows.find(row => row.EmployeeID === Number(employeeId));
    if (!employee) return false;
    const unsaved = state.editingId === employee.EmployeeID && dirty() ? ' Unsaved edits to this employee will also be discarded after deletion succeeds.' : '';
    if (!confirm(`Delete ${employee.EmployeeName} (ID ${employee.EmployeeID}) and their payroll, shift, attendance, and performance records?${unsaved} This cannot be undone.`)) return false;
    invalidateRead();
    state.writing = true;
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
    document.addEventListener('click', event => {
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
    fetchEmployees();
  }

  Object.assign(window, { fetchEmployees, refreshEmployeeData: fetchEmployees, saveEmployee, editEmployee, removeEmployee,
    searchEmployees, clearSearch, changePage, clearForm, beginNewEmployee, scrollToForm,
    exportToCSV: () => exportEmployees(','), exportToExcel: () => exportEmployees('\t') });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
