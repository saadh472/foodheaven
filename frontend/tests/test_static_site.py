import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = []

    def handle_starttag(self, tag, attributes):
        for name, value in attributes:
            if value and name in {"href", "src", "action"}:
                self.values.append(value)
            if tag == "meta" and name == "content" and value and "url=" in value:
                self.values.append(value.split("url=", 1)[1].strip())


def exact_path_exists(path):
    relative = path.resolve().relative_to(ROOT)
    current = ROOT
    for part in relative.parts:
        if part not in {item.name for item in current.iterdir()}:
            return False
        current = current / part
    return current.is_file()


class StaticSiteTests(unittest.TestCase):
    def test_html_links_and_assets_are_portable(self):
        for page in ROOT.rglob("*.html"):
            content = page.read_text(encoding="utf-8-sig")
            with self.subTest(page=page.relative_to(ROOT)):
                self.assertNotRegex(content, r"(?i)file:///|(?<![a-z])[a-z]:[/\\]")
                parser = References()
                parser.feed(content)
                references = parser.values + re.findall(r"window\.location\.href\s*=\s*['\"]([^'\"]+)", content)
                for reference in references:
                    parsed = urlsplit(reference)
                    if parsed.scheme or parsed.netloc or not parsed.path:
                        continue
                    path = page.parent / unquote(parsed.path)
                    self.assertTrue(exact_path_exists(path), f"Broken local reference in {page.name}: {reference}")


if __name__ == "__main__":
    unittest.main()
