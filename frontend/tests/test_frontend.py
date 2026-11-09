"""Check portable local assets and JavaScript syntax without a browser."""

import re
import os
import shutil
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def source_files(pattern):
    """Keep dependency fixtures and repository metadata out of application checks."""
    for directory, folders, files in os.walk(ROOT):
        folders[:] = [name for name in folders if name not in {".git", "node_modules", "__pycache__"}]
        for name in files:
            if Path(name).match(pattern):
                yield Path(directory) / name


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.scripts = []
        self.inline = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for name in ("href", "src", "action"):
            if values.get(name):
                self.references.append(values[name])
        if tag == "meta" and values.get("http-equiv", "").lower() == "refresh":
            self.references.append(values["content"].split("url=", 1)[1].strip())
        if tag == "script":
            self.inline = "src" not in values

    def handle_endtag(self, tag):
        if tag == "script":
            self.inline = False

    def handle_data(self, data):
        if self.inline and data.strip():
            self.scripts.append(data)


class FrontendTests(unittest.TestCase):
    def test_html_and_css_references_resolve_with_exact_case(self):
        for page in source_files("*.html"):
            content = page.read_text(encoding="utf-8-sig")
            self.assertIsNone(re.search(r"(?i)file:///|(?<![a-z])[a-z]:[/\\]", content), page.name)
            parser = PageParser()
            parser.feed(content)
            references = parser.references + re.findall(r"url\(['\"]?([^)'\"]+)", content)
            references += re.findall(r"(?:window\.)?location\.href\s*=\s*['\"]([^'\"]+)", content)
            for reference in references:
                url = urlsplit(reference)
                if url.scheme or url.netloc or not url.path:
                    continue
                target = ROOT / unquote(url.path.lstrip("/")) if url.path.startswith("/") else page.parent / unquote(url.path)
                with self.subTest(page=page.name, reference=reference):
                    # Windows realpath() corrects filename case, so normalize
                    # dot segments without resolving the filesystem first.
                    relative = Path(os.path.abspath(target)).relative_to(ROOT)
                    current = ROOT
                    for part in relative.parts:
                        self.assertIn(part, {item.name for item in current.iterdir()})
                        current /= part
                    self.assertTrue(current.is_file())

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for JavaScript syntax validation")
    def test_all_javascript_parses(self):
        sources = [(str(path.relative_to(ROOT)), path.read_text(encoding="utf-8")) for path in source_files("*.js")]
        for page in source_files("*.html"):
            parser = PageParser()
            parser.feed(page.read_text(encoding="utf-8-sig"))
            sources.extend((str(page.relative_to(ROOT)), source) for source in parser.scripts)
        self.assertTrue(sources)
        for name, source in sources:
            with self.subTest(source=name):
                result = subprocess.run(["node", "--check"], input=source, encoding="utf-8", capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
