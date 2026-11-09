# FoodHeaven backend

A Flask application that serves the [dashboard](../frontend/README.md) and a read-only SQL Server API. Start it with the [root quick start](../README.md#quick-start).

The app exposes only the frontend folder as static content. Backend files, environment settings, and the repository root are outside the static directory. Database connections and cursors are closed after successful requests and errors.

## Database setup

The sample dashboard works without SQL Server. To load database employees, install a compatible Microsoft SQL Server ODBC driver and use a running SQL Server or SQL Server Express instance.

Create a dedicated database in SQL Server Management Studio:

```sql
CREATE DATABASE project_database;
```

Select that database and run [sql/demo-schema.sql](sql/demo-schema.sql). The script creates `dbo.EMPLOYEE` if missing and adds one synthetic employee only when the table is empty. Use a dedicated demo database with fictional records.

The endpoint selects these columns explicitly:

| Column | Demo schema type |
| --- | --- |
| `EmployeeID` | `INT IDENTITY` primary key |
| `EmployeeName` | `NVARCHAR(120)` |
| `ContactNo` | `NVARCHAR(32)` |
| `EmailID` | `NVARCHAR(254)` |
| `Address` | `NVARCHAR(250)` |
| `HireDate` | `DATE` |
| `DateOfBirth` | `DATE` |

An existing table must supply these fields. Unrelated columns are excluded from the response. Records are ordered by employee ID.

On Windows, the default connection uses Windows Authentication. The account running Python needs database access and SELECT permission on `dbo.EMPLOYEE`.

## Configuration

Set process environment variables before starting the application. [`.env.example`](.env.example) is a reference; copying it does not automatically load its values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_SERVER` | `localhost\SQLEXPRESS01` | SQL Server host and instance |
| `DB_NAME` | `project_database` | Database containing `dbo.EMPLOYEE` |
| `DB_DRIVER` | `ODBC Driver 17 for SQL Server` | Installed SQL Server ODBC driver |
| `DB_TIMEOUT` | `5` | Connection timeout in seconds |
| `DB_CONNECTION_STRING` | unset | Complete ODBC string overriding the connection fields |
| `API_HOST` | `127.0.0.1` | Local bind address |
| `API_PORT` | `5000` | Dashboard and API port |
| `CORS_ORIGINS` | `http://localhost:8000,http://127.0.0.1:8000` | Optional comma-separated cross-origin clients |

Example from the repository root in PowerShell:

```powershell
$env:DB_SERVER = "localhost\SQLEXPRESS01"
$env:DB_NAME = "project_database"
$env:DB_DRIVER = "ODBC Driver 17 for SQL Server"
.\.venv\Scripts\python.exe backend/project-backend.py
```

On macOS or Linux, use `export` to set variables and `.venv/bin/python` to run the application. Set `DB_CONNECTION_STRING` when using another authentication mode. Driver 18 may require encryption and certificate settings suitable for your server. Keep any credentials in local environment variables and outside version control.

The unified dashboard uses a relative API URL and does not need CORS configuration. The allowed-origin list applies only to API routes and the compatibility alias.

## API contract

### `GET /api/health`

Returns HTTP 200 when a database connection succeeds:

```json
{
  "message": "Welcome to the FoodHeaven API!",
  "db_status": "Connected to the database."
}
```

A failed connection returns HTTP 503 and a sanitized database status. The dashboard can still be served independently.

### `GET /api/employees`

Returns HTTP 200 with an array of the seven dashboard fields:

```json
[
  {
    "EmployeeID": 1,
    "EmployeeName": "Demo Employee",
    "ContactNo": "0000000000",
    "EmailID": "demo.employee@example.com",
    "Address": "Demo office",
    "HireDate": "2024-01-15",
    "DateOfBirth": "1995-06-01"
  }
]
```

Dates and timestamps are ISO 8601 strings. A connection or query error returns HTTP 503 with `{"error": "The employee database is unavailable."}`. Responses use `Cache-Control: no-store`. `GET /employees` remains an alias for earlier clients.

The API has no write endpoints or authentication. Browser edits are session-only previews. Run it on loopback with fictional records for local demonstrations.

## Verify

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

Tests mock database connections to cover serialization, cleanup, error responses, CORS, dashboard serving without SQL Server, and backend file isolation. They do not verify a live SQL Server installation.
