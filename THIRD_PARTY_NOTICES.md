# Attribution and third-party notices

The repository-authored source code and documentation are available under the [MIT license](LICENSE). Dependencies and third-party assets retain their own licenses; the project license does not relicense them.

## Project history

FoodHeaven combines the original [FoodHeaven-UI](https://github.com/saadh472/FoodHeaven-UI) and [FoodHeaven-API](https://github.com/saadh472/FoodHeaven-API) coursework. Those archived repositories retain their original commit history. Their history and author attribution are preserved rather than replaced by this consolidation.

## Dependencies

| Component | Use | Upstream terms |
| --- | --- | --- |
| Flask and Pallets dependencies | HTTP application, sessions, templates, password utilities | [Flask BSD-3-Clause license](https://github.com/pallets/flask/blob/main/LICENSE.txt); each installed dependency includes its own license |
| Chart.js | Analytics charts, loaded from jsDelivr | [MIT; Chart.js Contributors](https://github.com/chartjs/Chart.js/blob/master/LICENSE.md) |
| jsdom | Development-only browser DOM tests | [MIT; jsdom contributors](https://github.com/jsdom/jsdom/blob/main/LICENSE.txt) |
| pyodbc, optional | SQL Server connectivity | [Upstream pyodbc license](https://github.com/mkleehammer/pyodbc/blob/master/LICENSE.txt) |

Dependency versions and installation inputs are in `backend/requirements.txt`, `backend/requirements-sqlserver.txt`, and `frontend/package-lock.json`. Microsoft ODBC drivers and SQL Server are installed separately under their respective vendor terms. SQLite is provided by the Python runtime.

This is a guide to direct dependencies, not a replacement for their full license texts or the notices accompanying transitive dependencies. Keep those notices when redistributing installed packages or bundles.

## Legacy bitmap assets

The following images were supplied with the original coursework. No separate creator or reuse license was recorded in the source repository:

- `frontend/Logo.png` and `frontend/Portal_login/Logo.png`
- `frontend/Food.gif` and `frontend/Canvas/Food.gif`
- `frontend/Portal_login/Background.png`
- `frontend/Capture.PNG`

They are retained as project history and are excluded from the MIT grant unless their original rights holder has authorized that license. Before reusing these assets separately, establish their provenance or replace them with assets you own. The MIT grant for the application source does not claim ownership of third-party brands, fonts, emoji, or imagery.

