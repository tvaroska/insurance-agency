#!/usr/bin/env python3
"""Verify required governance files, OpenAPI specs, and relative Markdown links in insurance-agency."""

from __future__ import annotations

import pathlib
import re
import sys

REQUIRED_FILES = (
    "AGENTS.md",
    "CRITICAL.md",
    "DECISIONS.md",
    "README.md",
    "docs/roadmap.md",
    "eval/evaluators/rubric.ts",
)


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    for req in REQUIRED_FILES:
        if not (root / req).is_file():
            sys.exit(f"ERROR: Missing required file in insurance-agency: {req}")
    specs = list((root / "specs").glob("*.yaml"))
    if len(specs) < 8:
        sys.exit(f"ERROR: Expected >=8 OpenAPI specs in specs/*.yaml, found {len(specs)}")

    fenced = re.compile(r"```.*?```", re.DOTALL)
    inline = re.compile(r"`[^`\n]+`")
    link_re = re.compile(r"\[[^\]]+\]\(([^)\s]+)\)")
    broken: list[str] = []
    for md in sorted(root.rglob("*.md")):
        if any(p.startswith(".") or p == "node_modules" for p in md.relative_to(root).parts):
            continue
        txt = inline.sub("code", fenced.sub("", md.read_text(encoding="utf-8")))
        for m in link_re.finditer(txt):
            raw = m.group(1).split("#", 1)[0]
            if not raw or raw.startswith(("http://", "https://", "mailto:")):
                continue
            target = (md.parent / raw.replace("%20", " ")).resolve()
            if not target.exists() or not target.is_relative_to(root):
                broken.append(f"{md.relative_to(root)} -> {raw}")
    if broken:
        sys.exit("ERROR: Broken links in insurance-agency:\n" + "\n".join(broken))
    print("✓ insurance-agency docs, 8 OpenAPI specs, rubric.ts, and relative links verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
