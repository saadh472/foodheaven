/* Payroll uses confirmed server values and never replays an uncertain update. */
(() => {
  'use strict';
  const state = { rows: [], page: 1, selectedId: null, ready: false, loading: false, saving: false, needsRefresh: false, version: 0, controller: null };
  const pageSize = 10;
  const byId = id => document.getElementById(id);
  const sameId = (left, right) => String(left) === String(right);

  function status(message, kind = 'info', focus = false) {
    const element = byId('payrollStatus');
    element.textContent = message;
    element.dataset.kind = kind;
    if (focus) element.focus();
  }

  function formMessage(message, kind = 'error', focus = false) {
    const element = byId('salaryMessage');
    element.textContent = message;
    element.dataset.kind = kind;
    if (focus) element.focus();
  }

  function cents(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const parts = text.split('.');
    const amount = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    return Number.isSafeInteger(amount) && amount <= 10000000 ? amount : null;
  }

  function formatCurrency(value) {
    const amount = cents(value);
    return amount === null ? 'Unavailable' : 'PKR ' + (amount / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function selected() {
    return state.rows.find(row => sameId(row.EmployeeID, state.selectedId));
  }

  function editable() {
    return state.ready && !state.loading && !state.saving && !state.needsRefresh;
  }

  function adjustment(showErrors = false) {
    const row = selected();
    const increase = byId('increaseCheckbox').checked;
    const decrease = byId('decreaseCheckbox').checked;
    const input = byId(increase ? 'increaseSalary' : 'decreaseSalary');
    let message = '';
    let newCents = null;
    if (!row) message = 'Select an employee before changing salary.';
    else if (increase === decrease) message = 'Choose either Increase or Decrease.';
    else {
      const amount = cents(input.value);
      if (amount === null || amount <= 0) message = 'Enter a positive amount with at most two decimal places.';
      else {
        newCents = cents(row.Salary) + (increase ? amount : -amount);
        if (newCents < 0 || newCents > 10000000) message = 'Salary must stay between PKR 0 and PKR 100,000.';
      }
    }
    byId('increaseWarning').style.display = 'none';
    byId('decreaseWarning').style.display = 'none';
    for (const id of ['increaseSalary', 'decreaseSalary']) byId(id).removeAttribute('aria-invalid');
    if (message && showErrors) {
      formMessage(message);
      if (row && increase !== decrease) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      } else byId('increaseCheckbox').focus();
    }
    return { message, newCents };
  }

  function syncControls() {
    const canEdit = editable() && Boolean(selected());
    byId('refreshPayroll').disabled = state.loading || state.saving;
    byId('retryPayroll').disabled = state.loading || state.saving;
    byId('retryPayroll').hidden = !state.needsRefresh;
    byId('salaryFormContainer').setAttribute('aria-busy', String(state.saving));
    byId('employeeTable').setAttribute('aria-busy', String(state.loading));
    byId('increaseCheckbox').disabled = !canEdit;
    byId('decreaseCheckbox').disabled = !canEdit;
    byId('increaseSalary').disabled = !canEdit || !byId('increaseCheckbox').checked;
    byId('decreaseSalary').disabled = !canEdit || !byId('decreaseCheckbox').checked;
    byId('saveSalary').disabled = !canEdit || Boolean(adjustment().message);
    byId('saveSalary').textContent = state.saving ? 'Saving…' : 'Update Salary';
    byId('cancelSalary').disabled = state.saving;
    for (const button of document.querySelectorAll('#employeeTable tbody button')) button.disabled = !editable();
  }

  function filteredRows() {
    const query = byId('employeeId').value.trim().toLowerCase();
    return state.rows.filter(row => String(row.EmployeeID).includes(query) || row.EmployeeName.toLowerCase().includes(query));
  }

  function render() {
    const rows = filteredRows();
    const pages = Math.ceil(rows.length / pageSize);
    state.page = Math.min(Math.max(state.page, 1), Math.max(pages, 1));
    const body = document.querySelector('#employeeTable tbody');
    body.replaceChildren();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = FoodHeaven.cell(row, state.loading ? 'Loading payroll…' : state.needsRefresh ? 'Payroll could not be loaded. Use Retry to load confirmed records.' : state.ready ? state.rows.length ? 'No employees match this search.' : 'No employees are available for payroll.' : 'Payroll has not loaded yet.');
      cell.colSpan = 4;
      body.appendChild(row);
    }
    for (const employee of rows.slice((state.page - 1) * pageSize, state.page * pageSize)) {
      const row = document.createElement('tr');
      [employee.EmployeeID, employee.EmployeeName, formatCurrency(employee.Salary)].forEach(value => FoodHeaven.cell(row, value));
      const actions = FoodHeaven.cell(row, '');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Modify';
      button.addEventListener('click', () => showSalaryForm(employee.EmployeeID));
      actions.appendChild(button);
      body.appendChild(row);
    }
    byId('pageNum').textContent = 'Page ' + (pages ? state.page : 0) + ' of ' + pages;
    byId('prevPage').disabled = state.page <= 1 || !pages;
    byId('nextPage').disabled = state.page >= pages;
    syncControls();
  }

  function validateRows(rows) {
    if (!Array.isArray(rows)) throw new Error('The server returned an invalid payroll response.');
    const ids = new Set();
    for (const row of rows) {
      if (!row || !/^\d+$/.test(String(row.EmployeeID)) || !Number.isSafeInteger(Number(row.EmployeeID)) || Number(row.EmployeeID) <= 0 ||
          typeof row.EmployeeName !== 'string' || !row.EmployeeName.trim() || cents(row.Salary) === null || ids.has(String(Number(row.EmployeeID)))) {
        throw new Error('The server returned invalid payroll records.');
      }
      ids.add(String(Number(row.EmployeeID)));
    }
    return rows;
  }

  async function responseData(response) {
    let data;
    try { data = await response.json(); }
    catch {
      const error = new Error('The server returned an unreadable response.');
      error.uncertain = response.ok || response.status >= 500;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(typeof data?.error === 'string' ? data.error : 'The request failed. Please try again.');
      error.uncertain = response.status >= 500 || response.status === 401 || response.status === 403;
      throw error;
    }
    return data;
  }

  function clearAdjustment() {
    for (const id of ['increaseCheckbox', 'decreaseCheckbox']) byId(id).checked = false;
    for (const id of ['increaseSalary', 'decreaseSalary']) byId(id).value = '';
  }

  async function loadPayroll(internal = false) {
    if (state.saving && !internal) return false;
    const version = ++state.version;
    state.controller?.abort();
    state.controller = new AbortController();
    state.loading = true;
    status(state.rows.length ? 'Refreshing payroll. Showing the last confirmed records.' : 'Loading payroll…');
    render();
    try {
      const response = await fetch('/payroll/get/', { signal: state.controller.signal });
      const rows = validateRows(await responseData(response));
      if (version !== state.version) return false;
      const before = selected();
      state.rows = rows;
      state.ready = true;
      state.needsRefresh = false;
      if (state.selectedId !== null) {
        const current = selected();
        if (!current) {
          resetSelection();
          formMessage('That employee is no longer available. Select another employee.', 'info');
        } else {
          byId('empName').value = current.EmployeeName;
          byId('currentSalary').value = formatCurrency(current.Salary);
          if (!before || cents(before.Salary) !== cents(current.Salary) || internal) clearAdjustment();
        }
      }
      status(rows.length ? rows.length + ' employee payroll records loaded.' : 'No employees are available for payroll.');
      return true;
    } catch (error) {
      if (version !== state.version) return false;
      state.needsRefresh = true;
      status('Could not load payroll. ' + error.message + (state.rows.length ? ' The table shows the last confirmed records; refresh before editing.' : ''), 'error');
      return false;
    } finally {
      if (version === state.version) {
        state.loading = false;
        render();
      }
    }
  }

  function showSalaryForm(employeeId) {
    if (!editable()) return;
    const row = state.rows.find(employee => sameId(employee.EmployeeID, employeeId));
    if (!row) return;
    state.selectedId = row.EmployeeID;
    byId('empName').value = row.EmployeeName;
    byId('currentSalary').value = formatCurrency(row.Salary);
    byId('salaryFormContainer').style.display = 'block';
    clearAdjustment();
    formMessage('Choose an adjustment against the current salary shown above.', 'info');
    syncControls();
    byId('salaryFormContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    byId('increaseCheckbox').focus();
  }

  async function updateSalary() {
    if (state.saving) return false;
    if (!editable()) {
      status('Refresh payroll before submitting another salary change.', 'error', true);
      return false;
    }
    const result = adjustment(true);
    if (result.message) return false;
    state.saving = true;
    formMessage('Saving salary. Please wait for confirmation.', 'info');
    syncControls();
    try {
      const response = await fetch('/payroll/modify/' + encodeURIComponent(state.selectedId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Salary: (result.newCents / 100).toFixed(2) })
      });
      const data = await responseData(response);
      if (!data || typeof data.message !== 'string' || !data.message.trim()) {
        const error = new Error('The server did not confirm the salary change.');
        error.uncertain = true;
        throw error;
      }
      state.needsRefresh = true;
      const refreshed = await loadPayroll(true);
      formMessage(refreshed ? 'Salary updated and confirmed from the server.' : 'The server saved this change, but refreshed payroll could not be loaded. Use Retry before making another change.', refreshed ? 'success' : 'error', true);
      return refreshed;
    } catch (error) {
      const uncertain = error.uncertain !== false;
      if (uncertain) state.needsRefresh = true;
      formMessage(uncertain ? 'The salary update could not be confirmed. Refresh payroll before trying again; it may already have been saved.' : error.message, 'error', true);
      if (uncertain) status('Refresh payroll to confirm the current salary before editing.', 'error');
      return false;
    } finally {
      state.saving = false;
      render();
    }
  }

  function resetSelection() {
    state.selectedId = null;
    clearAdjustment();
    byId('empName').value = '';
    byId('currentSalary').value = '';
    byId('salaryFormContainer').style.display = 'none';
    formMessage('');
    syncControls();
  }

  function clearForm() {
    if (state.saving) return;
    resetSelection();
  }

  function toggleInput(action) {
    const other = action === 'increase' ? 'decrease' : 'increase';
    if (byId(action + 'Checkbox').checked) {
      byId(other + 'Checkbox').checked = false;
      byId(other + 'Salary').value = '';
    }
    formMessage('');
    syncControls();
  }

  function searchEmployee() { state.page = 1; render(); }
  function clearSearch() { byId('employeeId').value = ''; searchEmployee(); }
  function changePage(direction) { state.page += direction === 'next' ? 1 : -1; render(); }
  function checkSalaryLimit() {
    syncControls();
    const result = adjustment();
    const input = byId(byId('increaseCheckbox').checked ? 'increaseSalary' : 'decreaseSalary');
    if (input.value.trim() && result.message) {
      formMessage(result.message);
      input.setAttribute('aria-invalid', 'true');
    } else formMessage(input.value.trim() ? '' : 'Enter a positive adjustment with at most two decimal places.', 'info');
  }
  function checkDecreaseSalary() { checkSalaryLimit(); }
  function toggleTheme() { FoodHeaven.toggleTheme(); }
  Object.assign(window, { fetchPayroll: () => loadPayroll(), showSalaryForm, updateSalary, clearForm, toggleInput, searchEmployee, clearSearch, changePage, checkSalaryLimit, checkDecreaseSalary, formatCurrency, toggleTheme });
  function initialize() {
    byId('salaryFormContainer').addEventListener('submit', event => { event.preventDefault(); updateSalary(); });
    byId('cancelSalary').addEventListener('click', clearForm);
    loadPayroll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
