"""Request-scoped database access with explicit SQLite and SQL Server modes."""

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

from flask import current_app, g
from werkzeug.security import generate_password_hash


class DatabaseUnavailable(Exception):
    """A configured database could not complete a request."""


class DataConflict(Exception):
    """An operation violates a database constraint."""


def json_value(value):
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


class Database:
    def __init__(self, app):
        self.app = app
        self.backend = app.config["DB_BACKEND"]
        if self.backend not in {"sqlite", "sqlserver"}:
            raise ValueError("DB_BACKEND must be sqlite or sqlserver.")
        self.error_types = (sqlite3.Error,)
        app.teardown_appcontext(self.close)

    def connection(self):
        if "foodheaven_connection" in g:
            return g.foodheaven_connection
        connection = None
        try:
            if self.backend == "sqlite":
                connection = sqlite3.connect(
                    current_app.config["DATABASE"],
                    timeout=current_app.config["DB_TIMEOUT"],
                    isolation_level=None,
                )
                connection.execute("PRAGMA foreign_keys = ON")
            else:
                try:
                    import pyodbc
                except ImportError as exc:
                    raise DatabaseUnavailable("SQL Server support is not installed.") from exc
                self.error_types = (sqlite3.Error, pyodbc.Error)
                config = current_app.config
                connection_string = config["DB_CONNECTION_STRING"] or (
                    f"DRIVER={{{config['DB_DRIVER']}}};"
                    f"SERVER={config['DB_SERVER']};DATABASE={config['DB_NAME']};"
                    "Trusted_Connection=yes;"
                )
                connection = pyodbc.connect(
                    connection_string, autocommit=False, timeout=config["DB_TIMEOUT"]
                )
                connection.timeout = config["DB_TIMEOUT"]
                cursor = connection.cursor()
                try:
                    cursor.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                finally:
                    cursor.close()
            g.foodheaven_connection = connection
            return connection
        except self.error_types as exc:
            if connection is not None:
                connection.close()
            raise DatabaseUnavailable("The employee database is unavailable.") from exc

    def _translate(self, error):
        if isinstance(error, sqlite3.IntegrityError) or (error.args and str(error.args[0]).startswith("23")):
            return DataConflict("This change conflicts with an existing record.")
        return DatabaseUnavailable("The employee database is unavailable.")

    def query(self, sql, parameters=(), *, one=False):
        cursor = None
        try:
            cursor = self.connection().cursor()
            cursor.execute(sql, tuple(parameters))
            columns = [column[0] for column in cursor.description]
            rows = cursor.fetchmany(1) if one else cursor.fetchall()
            result = [
                {name: json_value(value) for name, value in zip(columns, row)}
                for row in rows
            ]
            return (result[0] if result else None) if one else result
        except self.error_types as exc:
            raise self._translate(exc) from exc
        finally:
            if cursor is not None:
                cursor.close()

    def execute(self, sql, parameters=()):
        cursor = None
        try:
            cursor = self.connection().cursor()
            cursor.execute(sql, tuple(parameters))
            return cursor.rowcount
        except self.error_types as exc:
            raise self._translate(exc) from exc
        finally:
            if cursor is not None:
                cursor.close()

    @contextmanager
    def transaction(self):
        connection = self.connection()
        try:
            if self.backend == "sqlite":
                connection.execute("BEGIN IMMEDIATE")
            yield self
            connection.commit()
        except self.error_types as exc:
            connection.rollback()
            raise self._translate(exc) from exc
        except Exception:
            connection.rollback()
            raise

    def close(self, _error=None):
        connection = g.pop("foodheaven_connection", None)
        if connection is not None:
            try:
                connection.rollback()
            finally:
                connection.close()

    def initialize_fresh_sqlite(self):
        """Initialize new files only; never reseed or replace an existing database."""
        if self.backend != "sqlite":
            return
        path = Path(self.app.config["DATABASE"])
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=self.app.config["DB_TIMEOUT"])
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            schema = Path(__file__).parent / "sql" / "sqlite-schema.sql"
            connection.executescript(schema.read_text(encoding="utf-8"))
            connection.commit()
        finally:
            connection.close()
        if self.app.config["SEED_DEMO"]:
            with self.app.app_context():
                with self.transaction():
                    seed_demo(self)


def seed_demo(db):
    """Insert fictional starter records into a newly initialized, empty schema."""
    employees = (
        (1001, "Alex Morgan", "+00 000000001", "alex.manager@example.com", "Demo Office", "2024-01-15", "1990-06-10", None),
        (1002, "Taylor Jordan", "+00 000000002", "taylor.employee@example.com", "Demo Office", "2024-02-01", "1995-04-20", 1001),
        (1003, "Casey Lee", "+00 000000003", "casey.employee@example.com", "Demo Office", "2024-03-01", "1996-08-12", 1001),
    )
    for row in employees:
        db.execute(
            "INSERT INTO Employee (EmployeeID, EmployeeName, Contact, EmailID, Address, HireDate, DateOfBirth, MgrID) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", row,
        )
    db.execute(
        "INSERT INTO Login (MgrID, PasswordHash) VALUES (?, ?)",
        (1001, generate_password_hash("DemoPass123!", method="pbkdf2:sha256:600000")),
    )
    today = date.today().isoformat()
    for employee_id, salary, rating in ((1001, "85000.00", "Excellent"), (1002, "55000.00", "Good"), (1003, "50000.00", "Good")):
        db.execute("INSERT INTO Payroll (EmployeeID, Salary) VALUES (?, ?)", (employee_id, salary))
        db.execute("INSERT INTO Performance (EmployeeID, Performance) VALUES (?, ?)", (employee_id, rating))
        db.execute(
            "INSERT INTO Shift (EmployeeID, ShiftName, StartTime, EndTime) VALUES (?, ?, ?, ?)",
            (employee_id, "Morning", f"{today}T09:00:00", f"{today}T17:00:00"),
        )
        db.execute(
            "INSERT INTO Attendance (EmployeeID, AttendDate, Status, CheckIN, CheckOUT) VALUES (?, ?, ?, ?, ?)",
            (employee_id, today, "Present", f"{today}T09:00:00", f"{today}T17:00:00"),
        )
