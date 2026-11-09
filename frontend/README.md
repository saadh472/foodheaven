# FoodHeaven dashboard

The HTML, CSS, and JavaScript interface for [FoodHeaven](../README.md). The Flask application serves this folder directly, so dashboard requests and API requests share the same origin.

## Run

Follow the [root quick start](../README.md#quick-start), then open [http://127.0.0.1:5000/](http://127.0.0.1:5000/). No frontend compilation or npm install is needed.

For a static-only preview, run `python -m http.server 8000 --bind 127.0.0.1 --directory frontend` from the repository root and open [http://127.0.0.1:8000/](http://127.0.0.1:8000/). The relative API request will be unavailable on that static server, so the directory uses sample employees.

## Screens and behavior

| Path | Purpose |
| --- | --- |
| `index.html` | Entry point that opens the dashboard |
| `interface.html` | Main dashboard and profile panel |
| `Sidebar/` | Attendance, payroll, performance, shifts, and directory |
| `Sidebar/employees.js` | Employee fetch, search, and session-only editing |
| `Canvas/` | Profile and password form previews |
| `Portal_login/` | Portal and password recovery previews |
| `tests/test_static_site.py` | Local link and asset checks |

The employee directory requests `GET /api/employees`. Failed, invalid, or timed-out responses leave the page usable with synthetic employees and a visible explanation. Controls remain disabled while the initial request is pending. API values are rendered with `textContent`.

Expected fields are `EmployeeID`, `EmployeeName`, `ContactNo`, `EmailID`, `Address`, `HireDate`, and `DateOfBirth`. The backend serializes dates as ISO 8601 values. See the [API contract](../backend/README.md#api-contract).

Directory edits, salary adjustments, and shift changes reset when the page reloads. Attendance and performance use sample data. Login and password screens are form previews. Use fictional information when trying them.

## Verify

From the repository root:

```sh
python -m unittest discover -s frontend/tests -v
node --check frontend/Sidebar/employees.js
```

The Python check resolves local HTML links, assets, form targets, redirects, and script navigation with exact filename case. It rejects machine-specific filesystem paths.
