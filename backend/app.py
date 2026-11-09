"""Application factory and local entry point for the FoodHeaven portal."""

import os
import secrets
import sys
from datetime import timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flask import Flask, abort, jsonify, request
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash

from backend.controllers import register_routes
from backend.database import Database, DatabaseUnavailable, DataConflict
from backend.services import AccessDenied, NotFound, PortalService, ValidationError


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def persistent_secret(instance_path):
    instance_path.mkdir(parents=True, exist_ok=True)
    secret_path = instance_path / ".session-key"
    try:
        descriptor = os.open(secret_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        secret = secret_path.read_text(encoding="ascii").strip()
        if len(secret) < 32:
            raise ValueError("The local session key is invalid. Set SECRET_KEY explicitly.")
        return secret
    secret = secrets.token_hex(32)
    with os.fdopen(descriptor, "w", encoding="ascii") as stream:
        stream.write(secret)
    return secret


def create_app(test_config=None):
    config = {
        "DB_BACKEND": os.environ.get("DB_BACKEND", "sqlite").lower(),
        "DATABASE": os.environ.get("SQLITE_PATH", str(PROJECT_ROOT / "instance" / "foodheaven.sqlite3")),
        "DB_TIMEOUT": 5,
        "DB_SERVER": os.environ.get("DB_SERVER", r"localhost\SQLEXPRESS01"),
        "DB_NAME": os.environ.get("DB_NAME", "FoodHeavenDemo"),
        "DB_DRIVER": os.environ.get("DB_DRIVER", "ODBC Driver 17 for SQL Server"),
        "DB_CONNECTION_STRING": os.environ.get("DB_CONNECTION_STRING"),
        "FRONTEND_DIR": PROJECT_ROOT / "frontend",
        "SECRET_KEY": os.environ.get("SECRET_KEY"),
        "SEED_DEMO": True,
        "MAX_CONTENT_LENGTH": 64 * 1024,
        "SESSION_COOKIE_NAME": "foodheaven_session",
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": "Lax",
        "SESSION_COOKIE_SECURE": False,
        "PERMANENT_SESSION_LIFETIME": timedelta(hours=4),
    }
    try:
        config["DB_TIMEOUT"] = int(os.environ.get("DB_TIMEOUT", "5"))
    except ValueError as exc:
        raise ValueError("DB_TIMEOUT must be an integer from 1 to 30 seconds.") from exc
    if test_config:
        config.update(test_config)
    if not isinstance(config["DB_TIMEOUT"], int) or not 1 <= config["DB_TIMEOUT"] <= 30:
        raise ValueError("DB_TIMEOUT must be an integer from 1 to 30 seconds.")
    config["FRONTEND_DIR"] = Path(config["FRONTEND_DIR"]).resolve()
    database_path = Path(config["DATABASE"])
    if not database_path.is_absolute():
        database_path = PROJECT_ROOT / database_path
    config["DATABASE"] = str(database_path.resolve())
    app = Flask(__name__, static_folder=str(config["FRONTEND_DIR"]), static_url_path="", instance_path=str(PROJECT_ROOT / "instance"))
    app.config.update(config)
    if not app.config["SECRET_KEY"]:
        app.config["SECRET_KEY"] = persistent_secret(Path(app.instance_path))
    app.config["DUMMY_PASSWORD_HASH"] = generate_password_hash(secrets.token_urlsafe(32), method="pbkdf2:sha256:600000")
    database = Database(app)
    database.initialize_fresh_sqlite()
    app.extensions["foodheaven_database"] = database

    @app.before_request
    def hide_private_static_paths():
        if any(component.startswith(".") for component in request.path.replace("\\", "/").split("/")):
            abort(404)

    register_routes(app, PortalService(database))

    @app.errorhandler(ValidationError)
    def invalid_request(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(NotFound)
    def missing_record(error):
        return jsonify(error=str(error)), 404

    @app.errorhandler(AccessDenied)
    def forbidden(error):
        return jsonify(error=str(error)), 403

    @app.errorhandler(DataConflict)
    def conflicting_record(error):
        return jsonify(error=str(error)), 409

    @app.errorhandler(DatabaseUnavailable)
    def unavailable_database(_error):
        app.logger.warning("A database operation could not be completed.")
        return jsonify(error="The employee database is unavailable. Check the local database configuration."), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.name), error.code

    @app.after_request
    def response_headers(response):
        if request.endpoint != "static" and request.endpoint != "home":
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    return app


def run():
    app = create_app()
    app.run(host=os.environ.get("API_HOST", "127.0.0.1"), port=int(os.environ.get("API_PORT", "5000")), debug=False)


if __name__ == "__main__":
    run()
