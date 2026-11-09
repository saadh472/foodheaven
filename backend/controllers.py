"""HTTP contracts for the FoodHeaven manager portal."""

import hmac
import secrets
from datetime import date
from functools import wraps
from urllib.parse import urlsplit

from flask import g, jsonify, request, session

from backend.services import AccessDenied, ValidationError, iso_date, positive_id


def register_routes(app, service):
    def csrf_token():
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(32)
        return session["csrf_token"]

    def current_user():
        if "portal_user" not in g:
            manager_id = session.get("MgrID")
            g.portal_user = service.manager(manager_id) if isinstance(manager_id, int) else None
        return g.portal_user

    def require_login(function):
        @wraps(function)
        def protected(*args, **kwargs):
            if current_user() is None:
                return jsonify(error="Sign in to continue."), 401
            return function(*args, **kwargs)
        return protected

    def body():
        payload = request.get_json()
        if not isinstance(payload, dict):
            raise ValidationError("The request body must be a JSON object.")
        return payload

    @app.before_request
    def protect_mutations():
        if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
            return None
        origin = request.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != request.scheme or parsed.netloc != request.host:
                return jsonify(error="Cross-origin changes are not allowed."), 403
        expected = session.get("csrf_token", "")
        provided = request.headers.get("X-CSRF-Token", "")
        if not expected or not provided or len(provided) > 128 or not provided.isascii() or not hmac.compare_digest(expected, provided):
            return jsonify(error="Refresh the page and try again with a valid CSRF token."), 403
        return None

    @app.get("/")
    def home():
        index = "index.html" if (app.config["FRONTEND_DIR"] / "index.html").is_file() else "interface.html"
        return app.send_static_file(index)

    @app.get("/api/health")
    def health():
        service.db.query("SELECT 1 AS healthy", one=True)
        return jsonify(status="ok", database="connected", backend=app.config["DB_BACKEND"])

    @app.get("/api/session")
    def session_status():
        user = current_user()
        return jsonify(authenticated=user is not None, user=user, csrf_token=csrf_token())

    @app.post("/login")
    def login():
        data = body()
        user = service.authenticate(data.get("LoginID"), data.get("Password"))
        if user is None:
            return jsonify(error="Invalid login ID or password."), 401
        session.clear()
        session["MgrID"] = user["MgrID"]
        session.permanent = True
        return jsonify(message="Login successful.", MgrID=user["MgrID"], user=user, csrf_token=csrf_token())

    @app.post("/logout")
    def logout():
        session.clear()
        return jsonify(message="Signed out.", authenticated=False, csrf_token=csrf_token())

    @app.post("/login/resetpassword/")
    @require_login
    def change_password():
        service.change_password(current_user()["MgrID"], body())
        return jsonify(message="Password updated. Use the new password next time you sign in.")

    @app.post("/login/forgotpassword/")
    def forgot_password():
        return jsonify(error="Email-only password resets are disabled. Sign in to change your password using the current password."), 400

    @app.get("/employees/get/")
    @app.get("/api/employees")
    @app.get("/employees")
    @require_login
    def employees():
        return jsonify(service.employees())

    @app.get("/employees/get/<int:employee_id>")
    @require_login
    def employee(employee_id):
        return jsonify(service.require_employee(positive_id(employee_id)))

    @app.post("/employees/add")
    @require_login
    def add_employee():
        row = service.add_employee(body(), current_user()["MgrID"])
        return jsonify(message="Employee added.", employee=row), 201

    @app.put("/employees/update/<int:employee_id>")
    @require_login
    def update_employee(employee_id):
        row = service.update_employee(positive_id(employee_id), body())
        return jsonify(message="Employee updated.", employee=row)

    @app.delete("/employees/delete/<int:employee_id>")
    @require_login
    def delete_employee(employee_id):
        service.delete_employee(positive_id(employee_id))
        return jsonify(message="Employee and associated demo records deleted.")

    @app.get("/payroll/get/")
    @require_login
    def payroll():
        return jsonify(service.payroll())

    @app.put("/payroll/modify/<int:employee_id>")
    @require_login
    def modify_payroll(employee_id):
        data = body()
        service.modify_salary(positive_id(employee_id), data.get("Salary"))
        return jsonify(message="Payroll updated.")

    @app.get("/shift/get/")
    @require_login
    def shifts():
        return jsonify(service.shifts())

    @app.put("/shift/update/")
    @require_login
    def update_shift():
        service.update_shift(body())
        return jsonify(message="Shift updated successfully.")

    @app.get("/attendance/get/")
    @require_login
    def attendance():
        return jsonify(service.attendance())

    @app.get("/attendance/missing/")
    @require_login
    def missing_attendance():
        target = iso_date(request.args.get("date", date.today().isoformat()), "date").isoformat()
        employees = service.missing_attendance(target)
        return jsonify(date=target, missing_count=len(employees), employees=employees)

    @app.post("/attendance/generate-random/")
    @require_login
    def generate_attendance():
        return jsonify(service.generate_attendance(body()))

    @app.post("/attendance/fill-range/")
    @require_login
    def fill_attendance():
        return jsonify(service.fill_attendance_range(body()))

    @app.get("/performance/get/")
    @require_login
    def performance():
        return jsonify(service.performance())

    def own_profile():
        user = current_user()
        requested = request.args.get("MgrID")
        if requested is not None and positive_id(requested, "MgrID") != user["MgrID"]:
            raise AccessDenied("You can view only your own manager profile.")
        return user

    @app.get("/employee/profile/")
    @require_login
    def employee_profile():
        return jsonify(employees=[own_profile()])

    @app.get("/manager/details/")
    @require_login
    def manager_details():
        return jsonify(details=[own_profile()])
