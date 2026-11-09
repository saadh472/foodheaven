# FoodHeaven

[![Quality checks](https://github.com/saadh472/foodheaven/actions/workflows/quality.yml/badge.svg)](https://github.com/saadh472/foodheaven/actions/workflows/quality.yml)

An employee portal prototype with a browser dashboard and a Flask API in one repository. Explore attendance, payroll, performance, shift scheduling, and an employee directory. One local server serves both the interface and the API.

**Stack:** HTML, CSS, JavaScript · Python, Flask · SQL Server, pyodbc

## Features

- **Employee directory:** search records, preview adding and editing employees, and remove rows for the current page session.
- **SQL Server integration:** load employee records through a read-only API; use clearly labeled sample records when the database is unavailable.
- **Payroll and shifts:** try salary adjustments and scheduling changes using sample records.
- **Dashboard navigation:** access attendance, performance, employee details, and profile screens through portable relative links.
- **Resilient API:** bounded database connections, automatic resource cleanup, ISO date values, and sanitized JSON errors.
- **Automated checks:** API behavior, database failure handling, static route isolation, local links, and JavaScript syntax.

## Quick start

Use Python 3.11 or newer. SQL Server is optional for exploring the sample dashboard. Clone the repository, then run these commands from its root.

### Windows PowerShell

```powershell
git clone https://github.com/saadh472/foodheaven.git
cd foodheaven
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe backend/project-backend.py
```

### macOS or Linux

```sh
git clone https://github.com/saadh472/foodheaven.git
cd foodheaven
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python backend/project-backend.py
```

Open [the dashboard](http://127.0.0.1:5000/). Stop the server with Ctrl+C. No Node build step or separate frontend server is needed. Google Fonts are optional; the interface has local font fallbacks.

On Linux, pyodbc also requires the system's unixODBC runtime. A compatible Microsoft ODBC driver and a running SQL Server instance are needed only to retrieve database records. See [database setup](backend/README.md#database-setup).

## Explore the portal

1. Open **Employee Details**. The directory requests `/api/employees`; if SQL Server is unavailable, it shows synthetic records and explains the fallback.
2. Search by employee ID or name. Add a fictional employee, edit it, or remove a row.
3. Open **Payroll** and apply a sample salary adjustment using **Modify**.
4. Open **Shift Scheduling** and change a sample employee's working hours.

Directory, payroll, and shift edits are kept in page memory and reset on reload. The API reads SQL Server records; it does not save these edits. Attendance and performance are sample views. Login, password recovery, and profile forms demonstrate navigation and validation with fictional data; they do not implement account authentication.

## Enable SQL Server records

Create a dedicated demo database, run [backend/sql/demo-schema.sql](backend/sql/demo-schema.sql) against it, and set the matching connection variables before starting the server.

```powershell
$env:DB_SERVER = "localhost\SQLEXPRESS01"
$env:DB_NAME = "project_database"
$env:DB_DRIVER = "ODBC Driver 17 for SQL Server"
.\.venv\Scripts\python.exe backend/project-backend.py
```

The default connection uses Windows Authentication. [Backend documentation](backend/README.md) covers the schema, driver, other authentication modes, and all settings. [backend/.env.example](backend/.env.example) is a settings reference; the application reads process environment variables directly.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /` | Opens the dashboard |
| `GET /api/health` | Checks database connectivity; returns 503 when unavailable |
| `GET /api/employees` | Returns the seven employee fields used by the dashboard; returns 503 when unavailable |
| `GET /employees` | Compatibility alias for the employee endpoint |

The app binds to `127.0.0.1:5000` by default. This coursework prototype is intended for local, fictional-data demonstrations. Authentication, authorization, persistent editing, and production deployment are future work.

## Project layout

```text
foodheaven/
├── frontend/                 # Dashboard, styles, scripts, and assets
│   ├── interface.html
│   ├── Sidebar/              # Directory, attendance, payroll, shifts
│   ├── Canvas/               # Profile and password previews
│   └── tests/                # Portable links and asset checks
├── backend/
│   ├── project-backend.py    # Flask application factory and routes
│   ├── sql/demo-schema.sql   # Optional SQL Server demo schema
│   └── tests/                # API and static-serving tests
├── .github/workflows/quality.yml
└── requirements.txt          # Installs backend dependencies
```

See the [frontend guide](frontend/README.md) and [backend guide](backend/README.md) for component details.

## Verification

Install Node.js 24 or newer for the JavaScript syntax check. From the repository root on Windows:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe -m unittest discover -s frontend/tests -v
node --check frontend/Sidebar/employees.js
```

On macOS or Linux, replace `.\.venv\Scripts\python.exe` with `.venv/bin/python`. The same checks run in GitHub Actions. API tests mock database connections, so they do not require SQL Server. Real database connectivity requires a separately configured instance.

## Project history

This repository consolidates the original FoodHeaven dashboard and API coursework into one application. The earlier `FoodHeaven-UI` and `FoodHeaven-API` repositories retain their original commit history; ongoing development belongs here.
