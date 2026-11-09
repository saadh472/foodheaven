/* Shift updates are submitted once and reconciled with confirmed server records. */
(() => {
  'use strict';
  const state = { rows: [], page: 1, selectedId: null, ready: false, loading: false, saving: false, needsRefresh: false, version: 0, controller: null };
  const presets = Object.freeze({
    Morning: { start: '09:00:00', end: '17:00:00' },
    Evening: { start: '17:00:00', end: '01:00:00' },
    Night: { start: '01:00:00', end: '09:00:00' }
  });
  const pageSize = 10;
  const byId = id => document.getElementById(id);
  const sameId = (left, right) => String(left) === String(right);
  const selected = () => state.rows.find(row => sameId(row.EmployeeID, state.selectedId));
  const editable = () => state.ready && !state.loading && !state.saving && !state.needsRefresh;

  function status(message, kind = 'info', focus = false) {
    const element = byId('shiftStatus');
    element.textContent = message;
    element.dataset.kind = kind;
    if (focus) element.focus();
  }

  function formMessage(message, kind = 'error', focus = false) {
    const element = byId('shiftMessage');
    element.textContent = message;
    element.dataset.kind = kind;
    if (focus) element.focus();
  }

  function today() {
    const value = new Date();
    return String(value.getFullYear()) + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  }

  function calendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match || Number(match[1]) < 1000) return null;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  }

  function clock(value) {
    const text = String(value || '');
    const match = /(?:T| |^)(\d{2}):([0-5]\d)(?::([0-5]\d))?/.exec(text);
    if (!match || Number(match[1]) > 23) return null;
    return match[1] + ':' + match[2] + ':' + (match[3] || '00');
  }

  function convertDateToTime(value) {
    const time = clock(value);
    if (!time) return 'Not assigned';
    const hour = Number(time.slice(0, 2));
    return String(hour % 12 || 12).padStart(2, '0') + ':' + time.slice(3, 5) + (hour >= 12 ? ' PM' : ' AM');
  }

  function createShiftDateTime(name, isEndTime = false) {
    const preset = presets[name];
    const date = calendarDate(byId('shiftDate').value);
    if (!preset || !date) return null;
    if (isEndTime && preset.end <= preset.start) date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    if (!calendarDate(day)) return null;
    return day + ' ' + (isEndTime ? preset.end : preset.start);
  }

  function rowPreset(row) {
    if (Object.hasOwn(presets, row.ShiftName)) return row.ShiftName;
    const start = clock(row.StartTime), end = clock(row.EndTime);
    return Object.keys(presets).find(name => presets[name].start === start && presets[name].end === end) || '';
  }

  function validateRows(rows) {
    if (!Array.isArray(rows)) throw new Error('The server returned an invalid shift response.');
    const ids = new Set();
    for (const row of rows) {
      if (!row || !/^\d+$/.test(String(row.EmployeeID)) || !Number.isSafeInteger(Number(row.EmployeeID)) || Number(row.EmployeeID) <= 0 ||
          typeof row.EmployeeName !== 'string' || !row.EmployeeName.trim() || (row.ShiftName != null && typeof row.ShiftName !== 'string') || ids.has(String(Number(row.EmployeeID)))) {
        throw new Error('The server returned invalid employee shift records.');
      }
      if (row.StartTime != null || row.EndTime != null) {
        const start = String(row.StartTime || ''), end = String(row.EndTime || '');
        if (!calendarDate(start.slice(0, 10)) || !calendarDate(end.slice(0, 10)) || !clock(start) || !clock(end)) {
          throw new Error('The server returned an invalid shift date or time.');
        }
        const duration = new Date(end.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(end) ? '' : 'Z')) -
          new Date(start.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(start) ? '' : 'Z'));
        if (!Number.isFinite(duration) || duration <= 0 || duration >= 24 * 60 * 60 * 1000) {
          throw new Error('The server returned a shift with an invalid duration.');
        }
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

  function syncControls() {
    const canEdit = editable() && Boolean(selected());
    byId('refreshShifts').disabled = state.loading || state.saving;
    byId('retryShifts').disabled = state.loading || state.saving;
    byId('retryShifts').hidden = !state.needsRefresh;
    byId('shiftForm').setAttribute('aria-busy', String(state.saving));
    byId('shiftTable').setAttribute('aria-busy', String(state.loading));
    byId('shiftType').disabled = !canEdit;
    byId('shiftDate').disabled = !canEdit;
    byId('saveShift').disabled = !canEdit;
    byId('saveShift').textContent = state.saving ? 'Saving…' : 'Assign / Update Shift';
    byId('cancelShift').disabled = state.saving;
    for (const button of document.querySelectorAll('#shiftTable tbody button')) button.disabled = !editable();
  }

  function render() {
    const query = byId('employeeName').value.trim().toLowerCase();
    const rows = state.rows.filter(row => String(row.EmployeeID).includes(query) || row.EmployeeName.toLowerCase().includes(query));
    const pages = Math.ceil(rows.length / pageSize);
    state.page = Math.min(Math.max(state.page, 1), Math.max(pages, 1));
    const body = document.querySelector('#shiftTable tbody');
    body.replaceChildren();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = FoodHeaven.cell(row, state.loading ? 'Loading shifts…' : state.needsRefresh ? 'Shifts could not be loaded. Use Retry to load confirmed records.' : state.ready ? state.rows.length ? 'No employees match this search.' : 'No employees are available for scheduling.' : 'Shifts have not loaded yet.');
      cell.colSpan = 5;
      body.appendChild(row);
    }
    for (const employee of rows.slice((state.page - 1) * pageSize, state.page * pageSize)) {
      const row = document.createElement('tr');
      [employee.EmployeeName, employee.ShiftName || 'Not assigned', convertDateToTime(employee.StartTime), convertDateToTime(employee.EndTime)].forEach(value => FoodHeaven.cell(row, value));
      const actions = FoodHeaven.cell(row, '');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = employee.StartTime ? 'Edit' : 'Assign Shift';
      button.addEventListener('click', () => editShift(employee.EmployeeID));
      actions.appendChild(button);
      body.appendChild(row);
    }
    byId('pageNum').textContent = 'Page ' + (pages ? state.page : 0) + ' of ' + pages;
    byId('prevPage').disabled = state.page <= 1 || !pages;
    byId('nextPage').disabled = state.page >= pages;
    syncControls();
  }

  function populateSelection(row) {
    byId('currentEmployeeName').value = row.EmployeeName;
    byId('shiftType').value = rowPreset(row);
    byId('shiftDate').value = calendarDate(String(row.StartTime || '').slice(0, 10)) ? row.StartTime.slice(0, 10) : today();
  }

  function resetSelection() {
    state.selectedId = null;
    byId('currentEmployeeName').value = '';
    byId('shiftType').value = '';
    byId('shiftDate').value = today();
  }

  async function loadShifts(internal = false) {
    if (state.saving && !internal) return false;
    const version = ++state.version;
    state.controller?.abort();
    state.controller = new AbortController();
    state.loading = true;
    status(state.rows.length ? 'Refreshing shifts. Showing the last confirmed records.' : 'Loading shifts…');
    render();
    try {
      const response = await fetch('/shift/get/', { signal: state.controller.signal });
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
        } else if (internal || !before || before.StartTime !== current.StartTime || before.EndTime !== current.EndTime) {
          populateSelection(current);
        } else byId('currentEmployeeName').value = current.EmployeeName;
      }
      status(rows.length ? rows.length + ' employee shift records loaded.' : 'No employees are available for scheduling.');
      return true;
    } catch (error) {
      if (version !== state.version) return false;
      state.needsRefresh = true;
      status('Could not load shifts. ' + error.message + (state.rows.length ? ' The table shows the last confirmed records; refresh before editing.' : ''), 'error');
      return false;
    } finally {
      if (version === state.version) {
        state.loading = false;
        render();
      }
    }
  }

  function editShift(employeeId) {
    if (!editable()) return;
    const row = state.rows.find(employee => sameId(employee.EmployeeID, employeeId));
    if (!row) return;
    state.selectedId = row.EmployeeID;
    populateSelection(row);
    formMessage('Select a start date and one of the eight-hour shifts.', 'info');
    byId('shiftType').removeAttribute('aria-invalid');
    byId('shiftDate').removeAttribute('aria-invalid');
    syncControls();
    byId('shiftForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    byId('shiftType').focus();
  }

  async function changeShiftTime() {
    if (state.saving) return false;
    if (!editable()) { status('Refresh shifts before submitting another change.', 'error', true); return false; }
    const employee = selected();
    if (!employee) { formMessage('Select an employee before assigning a shift.', 'error', true); return false; }
    const name = byId('shiftType').value;
    byId('shiftType').removeAttribute('aria-invalid');
    byId('shiftDate').removeAttribute('aria-invalid');
    if (!Object.hasOwn(presets, name)) {
      formMessage('Choose Morning, Evening, or Night.');
      byId('shiftType').setAttribute('aria-invalid', 'true'); byId('shiftType').focus(); return false;
    }
    const start = createShiftDateTime(name), end = createShiftDateTime(name, true);
    if (!start || !end) {
      formMessage('Enter a valid shift start date.');
      byId('shiftDate').setAttribute('aria-invalid', 'true'); byId('shiftDate').focus(); return false;
    }
    state.saving = true;
    formMessage('Saving shift. Please wait for confirmation.', 'info');
    syncControls();
    try {
      const response = await fetch('/shift/update/', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ EmployeeID: Number(employee.EmployeeID), StartTime: start, EndTime: end, ShiftName: name })
      });
      const data = await responseData(response);
      if (!data || typeof data.message !== 'string' || !data.message.trim()) {
        const error = new Error('The server did not confirm the shift change.');
        error.uncertain = true;
        throw error;
      }
      state.needsRefresh = true;
      const refreshed = await loadShifts(true);
      formMessage(refreshed ? 'Shift updated and confirmed from the server.' : 'The server saved this change, but refreshed shifts could not be loaded. Use Retry before making another change.', refreshed ? 'success' : 'error', true);
      return refreshed;
    } catch (error) {
      const uncertain = error.uncertain !== false;
      if (uncertain) state.needsRefresh = true;
      formMessage(uncertain ? 'The shift update could not be confirmed. Refresh shifts before trying again; it may already have been saved.' : error.message, 'error', true);
      if (uncertain) status('Refresh shifts to confirm the current assignment before editing.', 'error');
      return false;
    } finally {
      state.saving = false;
      render();
    }
  }

  function clearForm() {
    if (state.saving) return;
    resetSelection();
    formMessage('');
    syncControls();
  }
  function searchShift() { state.page = 1; render(); }
  function clearSearch() { byId('employeeName').value = ''; searchShift(); }
  function changePage(direction) { state.page += direction === 'next' ? 1 : -1; render(); }
  function toggleTheme() { FoodHeaven.toggleTheme(); }
  Object.assign(window, { fetchShifts: () => loadShifts(), editShift, changeShiftTime, clearForm, searchShift, clearSearch, changePage, createShiftDateTime, convertDateToTime, toggleTheme });
  function initialize() {
    byId('shiftDate').value = today();
    byId('shiftForm').addEventListener('submit', event => { event.preventDefault(); changeShiftTime(); });
    byId('cancelShift').addEventListener('click', clearForm);
    for (const id of ['shiftType', 'shiftDate']) byId(id).addEventListener('input', () => { byId(id).removeAttribute('aria-invalid'); formMessage(''); });
    loadShifts();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
