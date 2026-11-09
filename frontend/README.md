# FoodHeaven dashboard

The browser interface for the [FoodHeaven employee portal](../README.md), built with HTML, CSS, and JavaScript. Start [the local launcher](../launcher/Start%20FoodHeaven.cmd) and open its local address. The server hosts the interface and API together.

## Sign in

The default SQLite demo provides manager login **1001** and password **DemoPass123!**. This account and all seeded employee records are fictional. Changes are saved to the local database.

The session uses an HTTP-only cookie. The manager ID in browser storage is only a display hint. API requests use a CSRF token from `/api/session`; credentials and database access remain on the server.

## Screens

- **Dashboard:** employee totals, payroll and shift statistics, quick actions, and your profile.
- **Employee details:** search, pagination, create, edit, delete, and CSV/TSV exports.
- **Payroll:** apply a validated increase or decrease between PKR 0 and PKR 100,000.
- **Shift scheduling:** assign morning, evening, or night shifts.
- **Attendance and performance:** search recorded employee data.
- **Analytics:** payroll and shift charts. Charts load Chart.js from a CDN; the data summaries remain usable if it is unavailable.
- **Profile and password:** view the signed-in manager's profile and change a password by verifying the current password.

Employee values are rendered as text. CSV/TSV exports quote cells and neutralize spreadsheet formula prefixes. Email-only password recovery is disabled. If a local password is lost, retain the existing database; the [backend guide](../backend/README.md) explains how to start a separate clean SQLite demo using a new `SQLITE_PATH`.

The shared [app.js](app.js) supplies same-origin API requests, a request timeout, CSRF headers, session handling, and logout. Pages redirect to sign-in when a session expires. Use the provided server rather than opening HTML files directly.

[styles.css](styles.css) supplies the shared teal palette, light and dark surfaces, consistent controls, and responsive navigation. Tables scroll inside labeled regions on small screens. Dashboard cards are native links; the account drawer supports Escape, focus trapping, and returning focus to its trigger. Visible keyboard focus and reduced-motion preferences are supported.

## Verification

From the repository root, run:

```sh
python -m unittest discover -s frontend/tests -v
node --check frontend/app.js
```

These checks resolve local HTML/CSS references with exact filename case and parse all inline and external JavaScript. Node.js must be installed for syntax checks. Interactive workflows also need the running backend.
