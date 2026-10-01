#!/usr/bin/env python3
"""Assemble ../../site/index.html (GARASU home) from template.html with the shared fonts, theme and tool rail."""
import os, pathlib, sys
here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here.parent / "shared")); from theme import apply
html = apply((here / "template.html").read_text(), "home")
out = pathlib.Path(os.environ.get("OUT", here.parent.parent / "site" / "index.html"))
out.write_text(html); print("wrote", out, f"({len(html)/1024:.0f} kB)")
