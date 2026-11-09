"""Behavioral tests use isolated SQLite files, never the user's database."""

import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from backend.app import create_app
from backend.database import DataConflict


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = {
            "TESTING": True,
            "DB_BACKEND": "sqlite",
            "DATABASE": str(Path(self.directory.name) / "portal.sqlite3"),
            "SECRET_KEY": "isolated-test-session-secret",
        }
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.db = self.app.extensions["foodheaven_database"]

    def csrf(self, client=None):
        return (client or self.client).get("/api/session").json["csrf_token"]

    def login(self, client=None, password="DemoPass123!"):
        client = client or self.client
        response = client.post("/login", json={"LoginID": 1001, "Password": password},
                               headers={"X-CSRF-Token": self.csrf(client)})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["csrf_token"]

    def mutate(self, method, path, payload=None, token=None):
        headers = {"X-CSRF-Token": token or self.csrf()}
        return self.client.open(path, method=method, json=payload, headers=headers)

    def test_dashboard_and_private_files_are_isolated(self):
        with self.client.get("/") as response:
            self.assertEqual(response.status_code, 200)
        for path in ("/backend/app.py", "/instance/foodheaven.sqlite3", "/.git/config", "/Canvas/.env", "/%2egit/config"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get("/api/health").json["status"], "ok")

    def test_authentication_and_csrf_are_required(self):
        self.assertEqual(self.client.get("/employees/get/").status_code, 401)
        self.assertEqual(self.client.post("/login", json={}).status_code, 403)
        initial_token = self.csrf()
        for malformed in ("wrong", "é", "x" * 129):
            with self.subTest(token=malformed):
                response = self.client.post("/login", json={}, headers={"X-CSRF-Token": malformed})
                self.assertEqual(response.status_code, 403)
        response = self.client.post("/employees/add", json={"EmployeeID": 9000}, headers={"X-CSRF-Token": initial_token})
        self.assertEqual(response.status_code, 401)
        token = self.login()
        self.assertNotEqual(token, initial_token)
        self.assertEqual(self.client.post("/logout", headers={"X-CSRF-Token": initial_token}).status_code, 403)
        foreign = self.client.post("/logout", headers={"X-CSRF-Token": token, "Origin": "https://other.example"})
        self.assertEqual(foreign.status_code, 403)
        self.assertTrue(self.client.get("/api/session").json["authenticated"])

    def test_session_cookies_are_http_only_and_logout_revokes_access(self):
        response = self.client.get("/api/session")
        cookie = response.headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        token = self.login()
        response = self.mutate("POST", "/logout", token=token)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json["csrf_token"], token)
        self.assertEqual(self.client.get("/api/employees").status_code, 401)

    def test_employee_crud_validates_and_persists_without_reseeding(self):
        self.login()
        employee = {"EmployeeID": 2001, "EmployeeName": "Fictional Tester", "ContactNo": "+00 000000004",
                    "EmailID": "tester@example.com", "HireDate": "2025-01-02", "DateOfBirth": "1998-04-20"}
        response = self.mutate("POST", "/employees/add", employee)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["employee"]["Contact"], "+00 000000004")
        self.assertEqual(self.mutate("POST", "/employees/add", employee).status_code, 409)
        response = self.mutate("PUT", "/employees/update/2001", {"EmployeeName": "Updated Fictional Tester"})
        self.assertEqual(response.status_code, 200)
        next_app = create_app(self.config)
        next_client = next_app.test_client()
        self.login(next_client)
        rows = next_client.get("/api/employees").json
        self.assertEqual(len(rows), 4)
        self.assertEqual(next(row for row in rows if row["EmployeeID"] == 2001)["EmployeeName"], "Updated Fictional Tester")

    def test_employee_validation_rejects_invalid_dates_ids_and_fields(self):
        self.login()
        base = {"EmployeeID": 2001, "EmployeeName": "Sample Tester"}
        invalid = (
            {"EmployeeID": True}, {"EmployeeID": 1.5}, {"EmployeeName": " "},
            {"EmailID": "invalid"}, {"HireDate": "2024-02-31"},
            {"HireDate": "1990-01-01", "DateOfBirth": "2000-01-01"},
            {"MgrID": 9999}, {"Password": "unexpected"},
        )
        for values in invalid:
            with self.subTest(values=values):
                self.assertEqual(self.mutate("POST", "/employees/add", {**base, **values}).status_code, 400)
        self.assertEqual(self.mutate("POST", "/employees/add", []).status_code, 400)

    def test_employee_deletion_cascades_dependent_records_and_protects_managers(self):
        self.login()
        self.assertEqual(self.mutate("DELETE", "/employees/delete/1001").status_code, 409)
        self.assertEqual(self.mutate("DELETE", "/employees/delete/1002").status_code, 200)
        self.assertEqual(self.client.get("/employees/get/1002").status_code, 404)
        with self.app.app_context():
            for table in ("Payroll", "Shift", "Attendance", "Performance"):
                with self.subTest(table=table):
                    self.assertEqual(self.db.query(f"SELECT COUNT(*) AS count FROM {table} WHERE EmployeeID = ?", (1002,), one=True)["count"], 0)

    def test_salary_validation_keeps_invalid_amounts_out_of_database(self):
        self.login()
        original = self.client.get("/payroll/get/").json[1]["Salary"]
        for invalid in (-1, "NaN", "Infinity", "-Infinity", 100001, "1.234", "garbage", True, None):
            with self.subTest(value=invalid):
                self.assertEqual(self.mutate("PUT", "/payroll/modify/1002", {"Salary": invalid}).status_code, 400)
        self.assertEqual(self.client.get("/payroll/get/").json[1]["Salary"], original)
        self.assertEqual(self.mutate("PUT", "/payroll/modify/1002", {"Salary": "12345.67"}).status_code, 200)
        self.assertEqual(self.client.get("/payroll/get/").json[1]["Salary"], 12345.67)
        self.assertEqual(self.mutate("PUT", "/payroll/modify/9999", {"Salary": 100}).status_code, 404)

    def test_shift_validation_supports_overnight_and_rejects_invalid_durations(self):
        self.login()
        payload = {"EmployeeID": 1002, "ShiftName": "Night", "StartTime": "22:00", "EndTime": "06:00"}
        self.assertEqual(self.mutate("PUT", "/shift/update/", payload).status_code, 200)
        row = next(row for row in self.client.get("/shift/get/").json if row["EmployeeID"] == 1002)
        self.assertEqual((datetime.fromisoformat(row["EndTime"]) - datetime.fromisoformat(row["StartTime"])).total_seconds(), 8 * 3600)
        for values in ({"StartTime": "99:00"}, {"StartTime": "06:00", "EndTime": "06:00"},
                       {"StartTime": "2025-01-01T09:00:00", "EndTime": "2025-01-03T09:00:00"}):
            self.assertEqual(self.mutate("PUT", "/shift/update/", {**payload, **values}).status_code, 400)

    def test_attendance_fill_is_idempotent_bounded_and_preserves_existing_records(self):
        self.login()
        payload = {"date": "2025-01-02", "fill_missing": True}
        first = self.mutate("POST", "/attendance/generate-random/", payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json["records_added"], 3)
        second = self.mutate("POST", "/attendance/generate-random/", {**payload, "fill_missing": False})
        self.assertEqual(second.json["records_added"], 0)
        self.assertEqual(self.client.get("/attendance/missing/?date=2025-01-02").json["missing_count"], 0)
        for payload in ({"start_date": "2025-01-02", "end_date": "2025-01-01"},
                        {"start_date": "2025-01-01", "end_date": "2025-02-01"}):
            self.assertEqual(self.mutate("POST", "/attendance/fill-range/", payload).status_code, 400)
        result = self.mutate("POST", "/attendance/fill-range/", {"start_date": "9999-12-31", "end_date": "9999-12-31"})
        self.assertEqual(result.status_code, 200)

    def test_profile_identity_and_password_privacy(self):
        self.login()
        for route, key in (("/manager/details/", "details"), ("/employee/profile/", "employees")):
            response = self.client.get(route)
            self.assertEqual(response.json[key][0]["MgrID"], 1001)
            self.assertNotIn("Password", response.get_data(as_text=True))
            self.assertEqual(self.client.get(route + "?MgrID=1002").status_code, 403)
        with self.app.app_context():
            credentials = self.db.query("SELECT PasswordHash FROM Login WHERE MgrID = ?", (1001,), one=True)
        self.assertNotEqual(credentials["PasswordHash"], "DemoPass123!")

    def test_password_change_requires_current_password_and_survives_restart(self):
        self.login()
        self.assertEqual(self.mutate("POST", "/login/resetpassword/", {"MgrID": 1001, "Password": "bypass"}).status_code, 400)
        payload = {"CurrentPassword": "incorrect", "NewPassword": "ChangedDemo456!"}
        self.assertEqual(self.mutate("POST", "/login/resetpassword/", payload).status_code, 403)
        payload["CurrentPassword"] = "DemoPass123!"
        self.assertEqual(self.mutate("POST", "/login/resetpassword/", payload).status_code, 200)
        restarted = create_app(self.config).test_client()
        response = restarted.post("/login", json={"LoginID": 1001, "Password": "DemoPass123!"}, headers={"X-CSRF-Token": self.csrf(restarted)})
        self.assertEqual(response.status_code, 401)
        self.login(restarted, password="ChangedDemo456!")

    def test_transaction_failure_rolls_back_and_closes_connection(self):
        with self.app.app_context():
            connection = self.db.connection()
            with self.assertRaises(DataConflict):
                with self.db.transaction():
                    self.db.execute("INSERT INTO Employee (EmployeeID, EmployeeName) VALUES (?, ?)", (2001, "Rollback Fixture"))
                    self.db.execute("INSERT INTO Payroll (EmployeeID, Salary) VALUES (?, ?)", (9999, "100.00"))
        with self.assertRaises(sqlite3.ProgrammingError):
            connection.execute("SELECT 1")
        with self.app.app_context():
            self.assertIsNone(self.db.query("SELECT EmployeeID FROM Employee WHERE EmployeeID = ?", (2001,), one=True))

    def test_each_request_has_its_own_closed_connection(self):
        connect = sqlite3.connect
        connections = []

        class ObservedConnection:
            def __init__(self, wrapped):
                self.wrapped = wrapped
                self.closed = False

            def __getattr__(self, name):
                return getattr(self.wrapped, name)

            def close(self):
                self.closed = True
                self.wrapped.close()

        def tracked_connect(*args, **kwargs):
            connection = ObservedConnection(connect(*args, **kwargs))
            connections.append(connection)
            return connection

        with patch("backend.database.sqlite3.connect", side_effect=tracked_connect):
            self.assertEqual(self.client.get("/api/health").status_code, 200)
            self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(len(connections), 2)
        self.assertTrue(all(connection.closed for connection in connections))
        self.assertIsNot(connections[0].wrapped, connections[1].wrapped)

    def test_sqlserver_mode_is_lazy_explicit_and_never_falls_back(self):
        sqlite_path = Path(self.directory.name) / "never-created.sqlite3"
        config = {**self.config, "DB_BACKEND": "sqlserver", "DATABASE": str(sqlite_path)}
        app = create_app(config)
        client = app.test_client()
        with patch.dict("sys.modules", {"pyodbc": None}):
            with client.get("/") as response:
                self.assertEqual(response.status_code, 200)
            response = client.get("/api/health")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("pyodbc", response.get_data(as_text=True))
        self.assertFalse(sqlite_path.exists())


if __name__ == "__main__":
    unittest.main()
