"""Employee portal business rules, independent of HTTP routing."""

import hashlib
import re
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation

from werkzeug.security import check_password_hash, generate_password_hash

from backend.database import DataConflict


class ValidationError(Exception):
    pass


class NotFound(Exception):
    pass


class AccessDenied(Exception):
    pass


EMPLOYEE_COLUMNS = "EmployeeID, EmployeeName, Contact, EmailID, Address, HireDate, DateOfBirth, MgrID"
EMPLOYEE_FIELDS = {"EmployeeID", "EmployeeName", "Contact", "EmailID", "Address", "HireDate", "DateOfBirth", "MgrID"}


def positive_id(value, name="EmployeeID"):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,10}", str(value)):
        raise ValidationError(f"{name} must be a positive integer.")
    result = int(value)
    if not 1 <= result <= 2147483647:
        raise ValidationError(f"{name} is outside the supported range.")
    return result


def text(value, name, limit, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{name} must be text.")
    result = value.strip()
    if len(result) > limit or any(ord(character) < 32 for character in result):
        raise ValidationError(f"{name} contains invalid characters or exceeds {limit} characters.")
    if required and not result:
        raise ValidationError(f"{name} is required.")
    return result or None


def iso_date(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValidationError(f"{name} must use YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError(f"{name} is not a valid date.") from exc


def salary_value(value):
    if isinstance(value, bool) or value is None or len(str(value)) > 32:
        raise ValidationError("Salary must be a valid amount.")
    try:
        result = Decimal(str(value))
        if not result.is_finite() or not Decimal("0") <= result <= Decimal("100000"):
            raise ValidationError("Salary must be between 0 and 100000.")
        if result != result.quantize(Decimal("0.01")):
            raise ValidationError("Salary supports at most two decimal places.")
        return str(result.quantize(Decimal("0.01")))
    except InvalidOperation as exc:
        raise ValidationError("Salary must be a valid amount.") from exc


def shift_time(value, name):
    if not isinstance(value, str) or len(value) > 32:
        raise ValidationError(f"{name} must be a local ISO date-time or HH:MM time.")
    try:
        if "T" in value or " " in value:
            parsed = datetime.fromisoformat(value)
        else:
            parsed = datetime.combine(date.today(), time.fromisoformat(value))
        if parsed.tzinfo is not None:
            raise ValueError("Timezone offsets are not supported.")
        return parsed.replace(microsecond=0)
    except ValueError as exc:
        raise ValidationError(f"{name} must be a valid local time.") from exc


class PortalService:
    def __init__(self, db):
        self.db = db

    def employee(self, employee_id):
        return self.db.query(
            f"SELECT {EMPLOYEE_COLUMNS} FROM Employee WHERE EmployeeID = ?",
            (employee_id,), one=True,
        )

    def require_employee(self, employee_id):
        row = self.employee(employee_id)
        if row is None:
            raise NotFound("Employee not found.")
        return row

    def employees(self):
        return self.db.query(f"SELECT {EMPLOYEE_COLUMNS} FROM Employee ORDER BY EmployeeID")

    def _employee_values(self, payload, *, existing=None, manager_id=None):
        values = dict(payload)
        if "ContactNo" in values:
            alias = values.pop("ContactNo")
            if "Contact" in values and values["Contact"] != alias:
                raise ValidationError("Contact and ContactNo must agree.")
            values["Contact"] = alias
        if set(values) - EMPLOYEE_FIELDS:
            raise ValidationError("The employee request contains unsupported fields.")
        if existing:
            if "EmployeeID" in values and positive_id(values["EmployeeID"]) != existing["EmployeeID"]:
                raise ValidationError("EmployeeID cannot be changed.")
            if not values:
                raise ValidationError("Provide at least one employee field to update.")
            values = {**existing, **values}
        employee_id = positive_id(values.get("EmployeeID"))
        result = {
            "EmployeeID": employee_id,
            "EmployeeName": text(values.get("EmployeeName"), "EmployeeName", 120, required=True),
            "Contact": text(values.get("Contact"), "Contact", 32),
            "EmailID": text(values.get("EmailID"), "EmailID", 254),
            "Address": text(values.get("Address"), "Address", 250),
        }
        email = result["EmailID"]
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValidationError("EmailID must be a valid email address.")
        for field in ("HireDate", "DateOfBirth"):
            value = values.get(field)
            result[field] = iso_date(value, field).isoformat() if value else None
        if result["DateOfBirth"] and result["DateOfBirth"] > date.today().isoformat():
            raise ValidationError("DateOfBirth cannot be in the future.")
        if result["HireDate"] and result["DateOfBirth"] and result["HireDate"] < result["DateOfBirth"]:
            raise ValidationError("HireDate must be on or after DateOfBirth.")
        raw_manager = values.get("MgrID", manager_id)
        result["MgrID"] = positive_id(raw_manager, "MgrID") if raw_manager not in (None, "") else None
        if result["MgrID"] is not None:
            if not self.db.query("SELECT MgrID FROM Login WHERE MgrID = ?", (result["MgrID"],), one=True):
                raise ValidationError("MgrID must identify an existing manager.")
        return result

    def add_employee(self, payload, manager_id):
        with self.db.transaction():
            values = self._employee_values(payload, manager_id=manager_id)
            if self.employee(values["EmployeeID"]):
                raise DataConflict("EmployeeID already exists.")
            self.db.execute(
                f"INSERT INTO Employee ({EMPLOYEE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                tuple(values[field] for field in EMPLOYEE_COLUMNS.split(", ")),
            )
            self.db.execute("INSERT INTO Payroll (EmployeeID, Salary) VALUES (?, ?)", (values["EmployeeID"], "0.00"))
        return values

    def update_employee(self, employee_id, payload):
        with self.db.transaction():
            existing = self.require_employee(employee_id)
            values = self._employee_values(payload, existing=existing)
            columns = EMPLOYEE_COLUMNS.split(", ")[1:]
            self.db.execute(
                f"UPDATE Employee SET {', '.join(field + ' = ?' for field in columns)} WHERE EmployeeID = ?",
                tuple(values[field] for field in columns) + (employee_id,),
            )
        return values

    def delete_employee(self, employee_id):
        with self.db.transaction():
            self.require_employee(employee_id)
            if self.db.query("SELECT MgrID FROM Login WHERE MgrID = ?", (employee_id,), one=True):
                raise DataConflict("Manager accounts cannot be deleted from the employee directory.")
            self.db.execute("DELETE FROM Employee WHERE EmployeeID = ?", (employee_id,))

    def payroll(self):
        return self.db.query(
            "SELECT COALESCE(p.PayID, 0) AS PayID, e.EmployeeID, e.EmployeeName, COALESCE(p.Salary, 0) AS Salary "
            "FROM Employee e LEFT JOIN Payroll p ON p.EmployeeID = e.EmployeeID ORDER BY e.EmployeeID"
        )

    def modify_salary(self, employee_id, value):
        salary = salary_value(value)
        with self.db.transaction():
            self.require_employee(employee_id)
            exists = self.db.query("SELECT PayID FROM Payroll WHERE EmployeeID = ?", (employee_id,), one=True)
            if exists:
                self.db.execute("UPDATE Payroll SET Salary = ? WHERE EmployeeID = ?", (salary, employee_id))
            else:
                self.db.execute("INSERT INTO Payroll (EmployeeID, Salary) VALUES (?, ?)", (employee_id, salary))

    def shifts(self):
        return self.db.query(
            "SELECT COALESCE(s.ShiftID, 0) AS ShiftID, e.EmployeeID, e.EmployeeName, "
            "COALESCE(s.ShiftName, 'Not Assigned') AS ShiftName, s.StartTime, s.EndTime "
            "FROM Employee e LEFT JOIN Shift s ON s.EmployeeID = e.EmployeeID ORDER BY e.EmployeeID"
        )

    def update_shift(self, payload):
        employee_id = positive_id(payload.get("EmployeeID"))
        start = shift_time(payload.get("StartTime"), "StartTime")
        end = shift_time(payload.get("EndTime"), "EndTime")
        if end <= start and "T" not in str(payload.get("EndTime")) and " " not in str(payload.get("EndTime")):
            end += timedelta(days=1)
        duration = end - start
        if not timedelta(0) < duration < timedelta(days=1):
            raise ValidationError("A shift must last more than zero and less than 24 hours.")
        name = text(payload.get("ShiftName", "Regular Shift"), "ShiftName", 80, required=True)
        with self.db.transaction():
            self.require_employee(employee_id)
            exists = self.db.query("SELECT ShiftID FROM Shift WHERE EmployeeID = ?", (employee_id,), one=True)
            parameters = (name, start.isoformat(), end.isoformat(), employee_id)
            if exists:
                self.db.execute("UPDATE Shift SET ShiftName = ?, StartTime = ?, EndTime = ? WHERE EmployeeID = ?", parameters)
            else:
                self.db.execute("INSERT INTO Shift (ShiftName, StartTime, EndTime, EmployeeID) VALUES (?, ?, ?, ?)", parameters)

    def attendance(self):
        return self.db.query(
            "SELECT e.EmployeeID, e.EmployeeName, a.AttendDate, COALESCE(a.Status, 'Not Recorded') AS Status "
            "FROM Employee e LEFT JOIN Attendance a ON a.EmployeeID = e.EmployeeID "
            "ORDER BY e.EmployeeID, a.AttendDate DESC"
        )

    def missing_attendance(self, attend_date):
        return self.db.query(
            "SELECT e.EmployeeID, e.EmployeeName FROM Employee e LEFT JOIN Attendance a "
            "ON a.EmployeeID = e.EmployeeID AND a.AttendDate = ? WHERE a.AttendID IS NULL ORDER BY e.EmployeeID",
            (attend_date,),
        )

    def _fill_day(self, attend_date):
        employees = self.missing_attendance(attend_date)
        records = []
        for employee in employees:
            fingerprint = hashlib.sha256(f"{employee['EmployeeID']}:{attend_date}".encode()).digest()
            status = "Absent" if fingerprint[0] % 5 == 0 else "Present"
            check_in = f"{attend_date}T09:00:00" if status == "Present" else None
            check_out = f"{attend_date}T17:00:00" if status == "Present" else None
            self.db.execute(
                "INSERT INTO Attendance (EmployeeID, AttendDate, Status, CheckIN, CheckOUT) VALUES (?, ?, ?, ?, ?)",
                (employee["EmployeeID"], attend_date, status, check_in, check_out),
            )
            records.append({**employee, "Status": status, "Date": attend_date})
        return records

    def generate_attendance(self, payload):
        attend_date = iso_date(payload.get("date", date.today().isoformat()), "date").isoformat()
        if "fill_missing" in payload and not isinstance(payload["fill_missing"], bool):
            raise ValidationError("fill_missing must be a boolean.")
        with self.db.transaction():
            records = self._fill_day(attend_date)
        return {"success": True, "date": attend_date, "records_added": len(records), "employees_processed": records,
                "message": f"Added {len(records)} fictional attendance records; existing records were preserved."}

    def fill_attendance_range(self, payload):
        start = iso_date(payload.get("start_date"), "start_date")
        end = iso_date(payload.get("end_date"), "end_date")
        if not 0 <= (end - start).days < 31:
            raise ValidationError("Attendance ranges must contain 1 to 31 days in chronological order.")
        days = []
        with self.db.transaction():
            for offset in range((end - start).days + 1):
                current = start + timedelta(days=offset)
                records = self._fill_day(current.isoformat())
                days.append({"date": current.isoformat(), "records_added": len(records)})
        total = sum(day["records_added"] for day in days)
        return {"success": True, "start_date": start.isoformat(), "end_date": end.isoformat(),
                "total_records_added": total, "date_results": days,
                "message": f"Added {total} fictional attendance records; existing records were preserved."}

    def performance(self):
        return self.db.query(
            "SELECT e.EmployeeID, e.EmployeeName, COALESCE(p.Performance, 'Not Rated') AS Performance "
            "FROM Employee e LEFT JOIN Performance p ON p.EmployeeID = e.EmployeeID ORDER BY e.EmployeeID"
        )

    def manager(self, manager_id):
        if not manager_id:
            return None
        return self.db.query(
            "SELECT e.EmployeeID, e.EmployeeName, e.Contact, e.EmailID, e.Address, e.HireDate, e.DateOfBirth, "
            "e.EmployeeID AS MgrID FROM Employee e INNER JOIN Login l ON l.MgrID = e.EmployeeID WHERE l.MgrID = ?",
            (manager_id,), one=True,
        )

    def authenticate(self, login_id, password):
        try:
            manager_id = positive_id(login_id, "LoginID")
        except ValidationError:
            manager_id = 0
        if not isinstance(password, str) or not 1 <= len(password) <= 128:
            return None
        credentials = self.db.query("SELECT MgrID, PasswordHash FROM Login WHERE MgrID = ?", (manager_id,), one=True)
        # A real hash is always checked so unknown IDs do not skip password hashing.
        password_hash = credentials["PasswordHash"] if credentials else self.db.app.config["DUMMY_PASSWORD_HASH"]
        if check_password_hash(password_hash, password) and credentials:
            return self.manager(manager_id)
        return None

    def change_password(self, manager_id, payload):
        current = payload.get("CurrentPassword")
        replacement = payload.get("NewPassword")
        if not isinstance(current, str) or not 1 <= len(current) <= 128:
            raise ValidationError("CurrentPassword is required.")
        if not isinstance(replacement, str) or not 10 <= len(replacement) <= 128:
            raise ValidationError("NewPassword must contain 10 to 128 characters.")
        if current == replacement:
            raise ValidationError("Choose a different new password.")
        with self.db.transaction():
            credentials = self.db.query("SELECT PasswordHash FROM Login WHERE MgrID = ?", (manager_id,), one=True)
            if not credentials or not check_password_hash(credentials["PasswordHash"], current):
                raise AccessDenied("Current password is incorrect.")
            self.db.execute(
                "UPDATE Login SET PasswordHash = ? WHERE MgrID = ?",
                (generate_password_hash(replacement, method="pbkdf2:sha256:600000"), manager_id),
            )
