# FoodHeaven dashboard

The browser interface for the [FoodHeaven employee portal](../README.md), built with HTML, CSS, and JavaScript. Start [the local launcher](../launcher/Start%20FoodHeaven.cmd) and open its local address. The server hosts the interface and API together.

## Sign in

The default SQLite demo provides manager login **1001** and password **DemoPass123!**. The form is prefilled for testing; **Use demo account** restores those values without signing in automatically. This account and all seeded employee records are fictional. Saved password changes still apply.

The session uses an HTTP-only cookie. The manager ID in browser storage is only a display hint. API requests use a CSRF token from `/api/session`; credentials and database access remain on the server.

## Screens

- **Dashboard:** compact workspace totals, a team-directory preview, shift coverage, workspace tools, and your profile.
- **Employee details:** search, pagination, create, edit, delete, and CSV/TSV exports.
- **Payroll:** apply a validated increase or decrease between PKR 0 and PKR 100,000.
- **Shift scheduling:** assign morning, evening, or night shifts.
- **Attendance and performance:** search recorded employee data.
- **Analytics:** payroll and shift charts. Charts load Chart.js from a CDN; the data summaries remain usable if it is unavailable.
- **Profile and password:** view the signed-in manager's profile and change a password by verifying the current password.

Employee values are rendered as text. CSV/TSV exports quote cells and neutralize spreadsheet formula prefixes. Email-only password recovery is disabled. If a local password is lost, retain the existing database; the [backend guide](../backend/README.md) explains how to start a separate clean SQLite demo using a new `SQLITE_PATH`.

The shared [app.js](app.js) supplies same-origin API requests, response timeouts, CSRF headers, recoverable session loading, safe optional browser storage, and logout. Pages redirect to sign-in when a session expires. Use the provided server rather than opening HTML files directly.

Directory, payroll, and shift forms prevent duplicate writes and update their displayed values only after confirmation. If a request's outcome is uncertain, the page keeps the form and requires a fresh read before another attempt. Retry controls reload data; they never silently repeat a write. Confirmed rows remain visible when a refresh fails, with a notice that the snapshot may be stale.

[styles.css](styles.css) supplies shared light and dark surfaces, controls, responsive navigation, and accessible feedback. The overview uses its own [dashboard.css](dashboard.css) and [dashboard.js](dashboard.js), so component-page rules cannot stretch its controls or change its layout. [icons.svg](icons.svg) provides local vector icons. Tables scroll inside labeled regions on small screens; the account drawer supports Escape, focus trapping, and focus restoration.

## Verification

From the repository root, run:

```sh
python -m unittest discover -s frontend/tests -v
npm ci --prefix frontend --ignore-scripts --no-fund --no-audit
npm test --prefix frontend
```

Use Node.js 24 or newer. The Python checks resolve local HTML references with exact filename case and parse application JavaScript. The DOM regression suite checks failed/retried reads, cancelled and uncertain writes, stale responses, validation, blocked storage, keyboard controls, login autofill, and dashboard control sizing. jsdom is a test dependency; the application has no frontend build step. DOM tests do not replace visual review in a browser.
