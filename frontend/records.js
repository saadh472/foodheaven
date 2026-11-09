/* Read-only attendance/performance tables share recovery, search and pagination. */
(() => {
  'use strict';

  const configurations = {
    attendance: { tableId: 'attendanceTable', endpoint: '/attendance/get/', columns: 4, fetchName: 'fetchAttendance', searchName: 'searchAttendance', displayName: 'displayAttendance' },
    performance: { tableId: 'performanceTable', endpoint: '/performance/get/', columns: 3, fetchName: 'fetchPerformance', searchName: 'searchPerformance', displayName: 'displayPerformance' }
  };

  function createRecordsTable(kind) {
    const config = configurations[kind];
    if (!config) return null;
    const byId = id => document.getElementById(id);
    const body = byId(config.tableId).querySelector('tbody');
    const state = { rows: [], hasSnapshot: false, loading: false, failed: false, page: 1, sequence: 0, controller: null };
    const perPage = 10;

    function filteredRows() {
      const query = byId('employeeId').value.trim().toLocaleLowerCase();
      return state.rows.filter(row => !query || String(row.EmployeeID).toLocaleLowerCase().includes(query) || row.EmployeeName.toLocaleLowerCase().includes(query));
    }

    function status(message, kind = 'info', retry = false) {
      byId('recordsMessage').textContent = message;
      byId('recordsStatus').dataset.kind = kind;
      byId('recordsStatus').setAttribute('role', kind === 'error' ? 'alert' : 'status');
      byId('retryRecords').hidden = !retry;
      byId('retryRecords').style.display = retry ? '' : 'none';
    }

    function isoDay(value) {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string') throw new Error('The server returned an unexpected attendance date.');
      const day = value.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('The server returned an unexpected attendance date.');
      const parsed = new Date(`${day}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('The server returned an invalid attendance date.');
      return day;
    }

    function normalizedRow(row) {
      const id = Number(row?.EmployeeID);
      if (!row || !Number.isInteger(id) || id < 1 || id > 2147483647 || typeof row.EmployeeName !== 'string') {
        throw new Error('The server returned an unexpected record format.');
      }
      if (kind === 'attendance') {
        if (row.Status != null && typeof row.Status !== 'string') throw new Error('The server returned an unexpected attendance status.');
        return { EmployeeID: id, EmployeeName: row.EmployeeName, AttendDate: isoDay(row.AttendDate), Status: row.Status ?? 'Not Recorded' };
      }
      if (row.Performance != null && typeof row.Performance !== 'string' && (typeof row.Performance !== 'number' || !Number.isFinite(row.Performance))) {
        throw new Error('The server returned unexpected performance feedback.');
      }
      return { EmployeeID: id, EmployeeName: row.EmployeeName, Performance: row.Performance ?? 'Not Rated' };
    }

    function cell(row, value) {
      const td = document.createElement('td');
      td.textContent = value;
      row.appendChild(td);
      return td;
    }

    function render() {
      const rows = filteredRows();
      const pages = Math.ceil(rows.length / perPage);
      state.page = pages ? Math.min(Math.max(state.page, 1), pages) : 1;
      body.replaceChildren();
      if (!rows.length) {
        const row = document.createElement('tr');
        const message = !state.hasSnapshot ? state.loading ? `Loading ${kind} records…` : `The ${kind} records could not be loaded. Use Retry above.`
          : state.rows.length ? `No ${kind} records match your search. Clear the search or try another employee.` : `No ${kind} records are available yet.`;
        cell(row, message).colSpan = config.columns;
        body.appendChild(row);
      }
      for (const record of rows.slice((state.page - 1) * perPage, state.page * perPage)) {
        const row = document.createElement('tr');
        row.dataset.employeeId = String(record.EmployeeID);
        cell(row, record.EmployeeID);
        cell(row, record.EmployeeName);
        if (kind === 'attendance') {
          const dateCell = cell(row, record.AttendDate ? '' : 'Not recorded');
          if (record.AttendDate) {
            const time = document.createElement('time');
            time.dateTime = record.AttendDate;
            // Date-only records represent calendar days, independent of browser timezone.
            time.textContent = new Date(`${record.AttendDate}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
            dateCell.appendChild(time);
          }
          cell(row, record.Status);
        } else cell(row, record.Performance);
        body.appendChild(row);
      }
      byId('pageNum').textContent = pages ? `Page ${state.page} of ${pages}` : 'Page 0 of 0';
      byId('prevPage').disabled = !pages || state.page <= 1;
      byId('nextPage').disabled = !pages || state.page >= pages;
      const first = rows.length ? (state.page - 1) * perPage + 1 : 0;
      const last = Math.min(state.page * perPage, rows.length);
      byId('recordCount').textContent = state.hasSnapshot ? `Showing ${first}–${last} of ${rows.length} matching results · ${state.rows.length} total${state.failed ? ' · Last confirmed data' : ''}` : state.loading ? 'Waiting for records.' : 'No confirmed data loaded.';
      byId('refreshRecords').disabled = state.loading;
      byId('refreshRecords').textContent = state.loading ? 'Refreshing…' : 'Refresh';
      byId('retryRecords').disabled = state.loading;
      byId('recordsRegion').setAttribute('aria-busy', String(state.loading));
    }

    async function refresh() {
      state.sequence += 1;
      const sequence = state.sequence;
      state.controller?.abort();
      const controller = new AbortController();
      state.controller = controller;
      state.loading = true;
      status(state.hasSnapshot ? `Refreshing ${kind} records. Current results remain visible…` : `Loading ${kind} records…`);
      render();
      try {
        const response = await fetch(config.endpoint, { signal: controller.signal });
        const payload = await response.json();
        if (sequence !== state.sequence) return false;
        if (!response.ok) throw new Error(payload.error || `Could not load ${kind} records (HTTP ${response.status}).`);
        if (!Array.isArray(payload)) throw new Error('The server returned an unexpected records format.');
        const rows = payload.map(normalizedRow);
        state.rows = rows;
        state.hasSnapshot = true;
        state.failed = false;
        status(`${rows.length} ${kind} results loaded. Search by employee name or ID.`, 'success');
        return true;
      } catch (error) {
        if (sequence !== state.sequence) return false;
        state.failed = true;
        status(`${error.message || 'Could not connect to the server.'}${state.hasSnapshot ? ' Showing the last confirmed records; refresh to try again.' : ' Retry to load the records.'}`, 'error', true);
        return false;
      } finally {
        if (sequence === state.sequence) {
          state.loading = false;
          state.controller = null;
          render();
        }
      }
    }

    function search() { state.page = 1; render(); }
    function clearSearch() { byId('employeeId').value = ''; search(); byId('employeeId').focus(); }
    function changePage(direction) { state.page += direction === 'next' ? 1 : -1; render(); }
    byId('refreshRecords').addEventListener('click', refresh);
    byId('retryRecords').addEventListener('click', refresh);
    window.addEventListener('foodheaven:connection-restored', refresh);
    window.addEventListener('pagehide', () => { state.sequence += 1; state.controller?.abort(); });
    Object.assign(window, { [config.fetchName]: refresh, [config.searchName]: search, [config.displayName]: render, clearSearch, changePage });
    refresh();
    return { refresh, search, clearSearch, changePage };
  }

  function initialize() {
    if (window.FoodHeavenRecords) return;
    window.FoodHeavenRecords = createRecordsTable(document.body.dataset.records);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
