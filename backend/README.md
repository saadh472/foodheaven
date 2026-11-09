# FoodHeaven backend

The Flask backend serves the [frontend](../frontend/README.md), authenticates a demo manager, and persists employee, payroll, shift, attendance, and performance records. HTTP controllers call a service layer; a request-scoped database adapter handles SQLite or explicitly configured SQL Server connections.

## Run locally

Use the [root quick start](../README.md#quick-start) or open [launcher/Start FoodHeaven.cmd](../launcher/Start%20FoodHeaven.cmd). The launcher starts one server for both the frontend and backend.

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe backend/app.py
```

Open [the portal](http://127.0.0.1:5000/). On macOS or Linux, use `python3` to create the environment and `.venv/bin/python` to run it. `backend/project-backend_updated.py` remains a compatibility launcher for the same application.

## SQLite demo

SQLite is the default and needs no database server or ODBC driver. On the first run, a **new** `instance/foodheaven.sqlite3` file receives the [SQLite schema](sql/sqlite-schema.sql) and fictional starter records.

| Demo field | Value |
| --- | --- |
| Manager login ID | `1001` |
| Initial password | `DemoPass123!` |
| Initial employees | Three fictional records |

Passwords are stored as PBKDF2 hashes. Changes persist across reloads and restarts. Existing database files are not replaced, migrated, reset, or reseeded. For a separate clean demo, set `SQLITE_PATH` to a new filename; retain any earlier database you want to keep.

The local signing key is generated once in `instance/.session-key` unless `SECRET_KEY` is supplied. This keeps login cookies valid across server restarts. Both the key and database belong outside version control.

## Configuration

Set process environment variables before starting the server. [`.env.example`](.env.example) is a reference file; its values are not loaded automatically.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_BACKEND` | `sqlite` | `sqlite` or explicit `sqlserver` mode |
| `SQLITE_PATH` | `instance/foodheaven.sqlite3` | SQLite file; relative paths resolve from the project root |
| `DB_TIMEOUT` | `5` | Database connection/query timeout, 1–30 seconds |
| `SECRET_KEY` | generated local key | Private Flask session signing secret |
| `API_HOST` | `127.0.0.1` | Bind address |
| `API_PORT` | `5000` | Frontend and API port |
| `DB_SERVER` | `localhost\SQLEXPRESS01` | Explicit SQL Server instance |
| `DB_NAME` | `FoodHeavenDemo` | Dedicated SQL Server demo database |
| `DB_DRIVER` | `ODBC Driver 17 for SQL Server` | Installed SQL Server ODBC driver |
| `DB_CONNECTION_STRING` | unset | Optional complete ODBC connection string |

SQLite uses the timeout when waiting for a database lock; SQL Server uses it for connection and query execution. There is no automatic fallback when an explicitly configured SQL Server is unavailable.

## Optional SQL Server setup

SQL Server mode retains the project's original database technology. Install SQL Server or SQL Server Express, a compatible Microsoft SQL Server ODBC driver, and the optional Python dependency:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-sqlserver.txt
```

Create a **new, dedicated, empty database** in SQL Server Management Studio:

```sql
CREATE DATABASE FoodHeavenDemo;
```

Configure that database and explicitly initialize it:

```powershell
$env:DB_BACKEND = "sqlserver"
$env:DB_SERVER = "localhost\SQLEXPRESS01"
$env:DB_NAME = "FoodHeavenDemo"
$env:DB_DRIVER = "ODBC Driver 17 for SQL Server"
.\.venv\Scripts\python.exe backend/manage.py init-sqlserver-demo --confirm-empty
.\.venv\Scripts\python.exe backend/app.py
```

The initializer applies [sql/sqlserver-schema.sql](sql/sqlserver-schema.sql) and inserts the same fictional demo records and hashed manager password. It refuses databases that already contain user tables. Normal application startup never initializes or changes the SQL Server schema.

Windows Authentication is the default. For other authentication or driver encryption settings, supply a private `DB_CONNECTION_STRING` appropriate to your SQL Server installation. Do not put credentials in Git.

The new schema uses `Login.PasswordHash`. The original plaintext-password database and its backup are **not automatically migrated or restored**. This code has been tested with SQLite; a live SQL Server installation has not been exercised.

## Authentication and requests

1. `GET /api/session` creates a CSRF token and returns `{authenticated, user, csrf_token}`.
2. Send `POST /login` with `{"LoginID":1001,"Password":"DemoPass123!"}` and the `X-CSRF-Token` header.
3. Keep the login cookie and use the new `csrf_token` returned by login for subsequent changes.
4. Send `POST /logout` with that token to end the session. Logout returns a replacement token.

Cookies are HttpOnly and SameSite Lax; signed-in sessions expire after four hours of inactivity. All data endpoints require a signed-in manager. Every mutation, including login and logout, checks the CSRF token and rejects a foreign `Origin`. The unified frontend uses same-origin requests and does not need CORS.

Password changes require the authenticated session and `{"CurrentPassword":"...","NewPassword":"..."}` at `POST /login/resetpassword/`. New passwords must contain 10–128 characters. Passwords and their hashes are never returned in profile or session responses. Email-only recovery is disabled because this project has no verified email delivery or reset-token service.

## Routes

| Method and path | Contract |
| --- | --- |
| `GET /` | Frontend entry page |
| `GET /api/health` | Public database connectivity status |
| `GET /api/session` | Session, current manager profile, and CSRF token |
| `POST /login`, `POST /logout` | Start/end cookie session |
| `GET /employees/get/` | Employee array; aliases `/api/employees` and `/employees` |
| `GET /employees/get/<id>` | One employee object |
| `POST /employees/add` | Create employee; returns 201 |
| `PUT /employees/update/<id>` | Update supplied employee fields |
| `DELETE /employees/delete/<id>` | Remove employee and dependent demo records |
| `GET /payroll/get/` | Payroll array, including employees without a payroll record |
| `PUT /payroll/modify/<id>` | Set `Salary` |
| `GET /shift/get/` | Shift array, including unassigned employees |
| `PUT /shift/update/` | Set `EmployeeID`, `StartTime`, `EndTime`, optional `ShiftName` |
| `GET /attendance/get/` | Attendance array |
| `GET /attendance/missing/?date=YYYY-MM-DD` | Missing count and employees |
| `POST /attendance/generate-random/` | Fill missing fictional attendance for `date` |
| `POST /attendance/fill-range/` | Fill missing fictional attendance between `start_date` and `end_date` |
| `GET /performance/get/` | Performance array |
| `GET /employee/profile/` | `{employees:[current_manager]}` |
| `GET /manager/details/` | `{details:[current_manager]}` |
| `POST /login/resetpassword/` | Authenticated password change |
| `POST /login/forgotpassword/` | Explains disabled email-only recovery; returns 400 |

Employee fields are `EmployeeID`, `EmployeeName`, `Contact`, `EmailID`, `Address`, `HireDate`, `DateOfBirth`, and `MgrID`. `ContactNo` is accepted as an input alias for `Contact`. Dates use ISO 8601. Profile query parameters cannot select a different manager.

## Validation and transactions

- Employee IDs are positive SQL-compatible integers; names, contact fields, dates, manager references, and supported fields are validated.
- Salaries use decimal validation, range from 0 to 100000, and allow at most two decimal places. NaN and infinity are rejected.
- Shifts must last more than zero and less than 24 hours. Overnight time-only shifts are supported.
- Attendance generation is a deterministic **demo-data** utility despite its historical route name. It fills missing records only and never overwrites attendance. Date ranges contain at most 31 days.
- Foreign keys protect relationships. Manager login records cannot be deleted through the directory. Employee deletion removes associated payroll, shifts, attendance, and performance atomically.
- Each request owns its connection. Writes commit together or roll back; teardown rolls back unfinished work and closes the connection. SQLite uses immediate write transactions; SQL Server uses serializable transactions.

Validation errors return 400, missing login 401, denied access/CSRF 403, missing records 404, conflicts 409, and database failures a sanitized 503. API responses use `Cache-Control: no-store`. Static routes expose only `frontend/` and deny hidden path components such as `.git` and `.env`.

## Verification

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

Tests create temporary SQLite databases. They cover session and CSRF behavior, persistent CRUD, validation, dependent-record deletion, password privacy/change, attendance idempotency, overnight shifts, rollback/cleanup, static-file isolation, and explicit SQL Server failure without fallback. They never connect to the user's SQL Server or restore a backup.

This is a local coursework portfolio application. Public deployment, rate limiting, multi-role authorization, verified email recovery, and managed schema migrations require additional work.
