#!/usr/bin/env python3
"""Build the claude.ai Artifact page from index.html.

The Artifact viewer wraps the published page in its own <html>/<head>/<body>
skeleton, so the page must contain only <title>, stylesheet links and the body
content. styles.css, app.js, chat.js and fonts/ are published alongside it.

    python3 tools/build_artifact.py   # writes dist/mindmap.html
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "index.html").read_text(encoding="utf-8")

title = re.search(r"<title>.*?</title>", src, re.S).group(0)
links = re.findall(r'<link rel="stylesheet"[^>]*>', src)
body = re.search(r"<body>(.*)</body>", src, re.S).group(1).strip("\n")

out = root / "dist" / "mindmap.html"
out.parent.mkdir(exist_ok=True)
out.write_text("\n".join([title, *links, body, ""]), encoding="utf-8")
print(f"wrote {out.relative_to(root)}")
