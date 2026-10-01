#!/usr/bin/env python3
"""Assemble ../../site/analysis.html (GARASU · Data Analysis): template.html + the Fitter's styles and plot
library (../fitter/template.html, ../fitter/ui_plot.js) + analysis_core.js + analysis_ui.js + examples.json.
Rebuild the example data (TL model, synthetic):  node build_examples.js"""
import os, pathlib, re
here = pathlib.Path(__file__).parent; fit = here.parent / "fitter"
rd = lambda p: pathlib.Path(p).read_text()
style = re.search(r"<style>(.*?)</style>", rd(fit / "template.html"), re.S).group(1)
html = rd(here / "template.html")
for key, val in {"STYLE": style, "PLOT": rd(fit / "ui_plot.js"), "CORE": rd(here / "analysis_core.js").replace("if (typeof module", "if (false && typeof module"),
                 "EXAMPLES": rd(here / "examples.json"), "UI": rd(here / "analysis_ui.js")}.items():
    assert f"/*%%{key}%%*/" in html, key
    html = html.replace(f"/*%%{key}%%*/", val)
import sys as _sys; _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "shared")); from theme import apply
html = apply(html, "analysis", projects=True)
out = pathlib.Path(os.environ.get("OUT", here.parent.parent / "site" / "analysis.html"))
out.write_text(html); print("wrote", out, f"({len(html)/1024:.0f} kB)")
