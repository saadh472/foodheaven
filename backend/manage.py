"""Explicit initialization of a new, dedicated SQL Server demo database."""

import argparse
import os
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app import create_app
from backend.database import seed_demo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init-sqlserver-demo"])
    parser.add_argument("--confirm-empty", action="store_true", required=True,
                        help="Confirm this is a new, dedicated, empty demo database.")
    parser.parse_args()
    if os.environ.get("DB_BACKEND", "sqlite").lower() != "sqlserver":
        parser.error("Set DB_BACKEND=sqlserver and configure the intended dedicated database first.")
    app = create_app()
    database = app.extensions["foodheaven_database"]
    with app.app_context():
        with database.transaction():
            existing = database.query("SELECT COUNT(*) AS count FROM sys.tables WHERE is_ms_shipped = 0", one=True)
            if existing["count"]:
                parser.error("Refusing initialization: this database already contains user tables.")
            schema = (Path(__file__).parent / "sql" / "sqlserver-schema.sql").read_text(encoding="utf-8")
            for statement in schema.split(";"):
                if statement.strip():
                    database.execute(statement)
            seed_demo(database)
    print("Initialized the dedicated SQL Server demo database with fictional records.")
    print("Demo login: 1001 / DemoPass123! (password is stored as a hash).")


if __name__ == "__main__":
    main()
