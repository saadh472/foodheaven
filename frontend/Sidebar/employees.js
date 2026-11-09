const fields = ['EmployeeID', 'EmployeeName', 'ContactNo', 'EmailID', 'Address', 'HireDate', 'DateOfBirth'];
const inputs = ['empId', 'empName', 'contactNo', 'email', 'address', 'hireDate', 'dob'];
let employeeData = [
    { EmployeeID: 'E001', EmployeeName: 'Demo Employee One', ContactNo: '0000000000', EmailID: 'demo.one@example.com', Address: 'Sample Office', HireDate: '2024-01-01', DateOfBirth: '1995-01-01' },
    { EmployeeID: 'E002', EmployeeName: 'Demo Employee Two', ContactNo: '0000000001', EmailID: 'demo.two@example.com', Address: 'Sample Office', HireDate: '2024-02-01', DateOfBirth: '1996-02-01' }
];
let editingId = null;
let directoryReady = false;

function inputDate(value) {
    const date = String(value ?? '');
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function setDirectoryStatus(message) {
    document.getElementById('directoryStatus').textContent = message;
}

function clearEmployeeForm() {
    inputs.forEach(id => document.getElementById(id).value = '');
    document.getElementById('empId').disabled = false;
    document.getElementById('saveEmployee').textContent = 'Add Employee';
    editingId = null;
}

function displayEmployees(data) {
    const tableBody = document.querySelector('#employeeTable tbody');
    tableBody.replaceChildren();
    for (const employee of data) {
        const row = document.createElement('tr');
        for (const field of fields) {
            const cell = document.createElement('td');
            cell.textContent = employee[field] ?? '';
            row.appendChild(cell);
        }
        const actions = document.createElement('td');
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.disabled = !directoryReady;
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => editEmployee(String(employee.EmployeeID)));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.disabled = !directoryReady;
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => removeEmployee(String(employee.EmployeeID)));
        actions.append(edit, remove);
        row.appendChild(actions);
        tableBody.appendChild(row);
    }
}

async function fetchEmployees() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    document.getElementById('saveEmployee').disabled = true;
    displayEmployees(employeeData);
    try {
        const response = await fetch('/api/employees', { signal: controller.signal });
        if (!response.ok) throw new Error('The API returned an error.');
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.some(row => !row || row.EmployeeID == null || row.EmployeeName == null)) {
            throw new Error('The API returned an unexpected employee format.');
        }
        employeeData = rows.map(row => Object.fromEntries(fields.map(field => {
            const value = String(row[field] ?? '');
            return [field, field === 'HireDate' || field === 'DateOfBirth' ? inputDate(value) : value];
        })));
        setDirectoryStatus('Loaded from SQL Server through the FoodHeaven API. Edits below last until the page reloads.');
        searchEmployees();
    } catch {
        setDirectoryStatus('Using sample employees because SQL Server records are unavailable. Edits last until reload. See the project README to configure the database.');
    } finally {
        clearTimeout(timeout);
        directoryReady = true;
        document.getElementById('saveEmployee').disabled = false;
        searchEmployees();
    }
}

function addEmployee() {
    if (!directoryReady) return;
    const employee = Object.fromEntries(fields.map((field, index) => [field, document.getElementById(inputs[index]).value.trim()]));
    if (fields.some(field => !employee[field])) {
        setDirectoryStatus('Complete every employee field before saving.');
        return;
    }
    if (!document.getElementById('email').checkValidity()) {
        setDirectoryStatus('Enter a valid sample email address.');
        return;
    }
    if (employee.HireDate < employee.DateOfBirth) {
        setDirectoryStatus('The hire date must be on or after the date of birth.');
        return;
    }
    if (editingId === null && employeeData.some(row => String(row.EmployeeID) === employee.EmployeeID)) {
        setDirectoryStatus('That employee ID already exists. Choose Edit to change that row.');
        return;
    }
    if (editingId === null) {
        employeeData.push(employee);
    } else {
        const index = employeeData.findIndex(row => String(row.EmployeeID) === editingId);
        if (index === -1) return;
        employeeData[index] = employee;
    }
    clearEmployeeForm();
    searchEmployees();
    setDirectoryStatus('Saved in this browser session. Reloading restores the API or sample data.');
}

function editEmployee(id) {
    const employee = employeeData.find(row => String(row.EmployeeID) === id);
    if (!employee) return;
    fields.forEach((field, index) => document.getElementById(inputs[index]).value = employee[field] ?? '');
    editingId = id;
    document.getElementById('empId').disabled = true;
    document.getElementById('saveEmployee').textContent = 'Save Changes';
}

function removeEmployee(id) {
    employeeData = employeeData.filter(row => String(row.EmployeeID) !== id);
    if (editingId === id) clearEmployeeForm();
    searchEmployees();
    setDirectoryStatus('Removed from this browser session. Reloading restores the API or sample data.');
}

function searchEmployees() {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    displayEmployees(employeeData.filter(employee =>
        String(employee.EmployeeID).toLowerCase().includes(query) ||
        String(employee.EmployeeName).toLowerCase().includes(query)
    ));
}

fetchEmployees();
