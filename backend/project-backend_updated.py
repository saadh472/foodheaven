"""Compatibility entry point; the maintained Flask application is app.py."""

from app import create_app, run


if __name__ == "__main__":
    run()
