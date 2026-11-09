"""Serve the FoodHeaven dashboard and its read-only SQL Server API."""

import os
from contextlib import closing
from datetime import date, datetime
from pathlib import Path

import pyodbc
from flask import Flask, current_app, jsonify
from flask_cors import CORS


def create_app(test_config=None):
    frontend = Path(__file__).resolve().parents[1] / "frontend"
    app = Flask(__name__, static_folder=str(frontend), static_url_path="")
    app.config.from_mapping(
        DB_SERVER=os.environ.get("DB_SERVER", r"localhost\SQLEXPRESS01"),
        DB_NAME=os.environ.get("DB_NAME", "project_database"),
        DB_DRIVER=os.environ.get("DB_DRIVER", "ODBC Driver 17 for SQL Server"),
        DB_CONNECTION_STRING=os.environ.get("DB_CONNECTION_STRING"),
        DB_TIMEOUT=int(os.environ.get("DB_TIMEOUT", "5")),
        CORS_ORIGINS=[
            origin.strip()
            for origin in os.environ.get(
                "CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
            ).split(",")
            if origin.strip()
        ],
    )
    if test_config:
        app.config.update(test_config)

    CORS(
        app,
        resources={r"/api/*": {}, r"/employees": {}},
        origins=app.config["CORS_ORIGINS"],
        methods=["GET"],
    )

    @app.get("/")
    def dashboard():
        return app.send_static_file("index.html")

    @app.get("/api/health")
    def health():
        try:
            with closing(get_db_connection()):
                return jsonify(
                    message="Welcome to the FoodHeaven API!",
                    db_status="Connected to the database.",
                )
        except pyodbc.Error:
            app.logger.warning("The employee database is unavailable.")
            return jsonify(
                message="Welcome to the FoodHeaven API!",
                db_status="Failed to connect to the database.",
            ), 503

    @app.get("/api/employees")
    @app.get("/employees")
    def get_employees():
        try:
            with closing(get_db_connection()) as connection:
                with closing(connection.cursor()) as cursor:
                    cursor.execute(
                        "SELECT EmployeeID, EmployeeName, ContactNo, EmailID, "
                        "Address, HireDate, DateOfBirth FROM dbo.EMPLOYEE ORDER BY EmployeeID"
                    )
                    columns = [column[0] for column in cursor.description]
                    employees = [
                        {
                            column: value.isoformat() if isinstance(value, (date, datetime)) else value
                            for column, value in zip(columns, row)
                        }
                        for row in cursor.fetchall()
                    ]
                    return jsonify(employees)
        except pyodbc.Error:
            app.logger.warning("Could not read the employee database.")
            return jsonify(error="The employee database is unavailable."), 503

    @app.after_request
    def prevent_employee_cache(response):
        response.headers["Cache-Control"] = "no-store"
        return response

    return app


def get_db_connection():
    config = current_app.config
    connection_string = config["DB_CONNECTION_STRING"] or (
        f"DRIVER={{{config['DB_DRIVER']}}};"
        f"SERVER={config['DB_SERVER']};"
        f"DATABASE={config['DB_NAME']};"
        "Trusted_Connection=yes;"
    )
    return pyodbc.connect(connection_string, timeout=config["DB_TIMEOUT"])


app = create_app()


if __name__ == "__main__":
    app.run(
        host=os.environ.get("API_HOST", "127.0.0.1"),
        port=int(os.environ.get("API_PORT", "5000")),
        debug=False,
    )
