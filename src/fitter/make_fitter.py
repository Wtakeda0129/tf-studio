#!/usr/bin/env python3
"""Assemble ../../site/fitter.html (GARASU · Fitter) (single self-contained file) from:
   template.html, tl_core.js, models_extra.js (β-continuous Prony blend), engine.js, ui_plot.js, ui_main.js,
   beta_library.json, prony_fit.json, relaxpy_prony.json, examples.json
   (examples.json: python3 build_examples.py, from ../build/geasse_data.json)"""
import json, os, pathlib
here = pathlib.Path(__file__).parent
# Ge–As–Se example data are unpublished: included only when INCLUDE_GEASSE=1
INCLUDE = os.environ.get("INCLUDE_GEASSE") == "1"
rd = lambda n: (here / n).read_text()
nomod = lambda s: s.replace("if (typeof module", "if (false && typeof module")
html = rd("template.html")
for key, val in {"CORE": nomod(rd("tl_core.js")), "MODELS": nomod(rd("models_extra.js")), "ENGINE": nomod(rd("engine.js")),
                 "UI": rd("ui_plot.js") + "\n" + rd("ui_main.js"), "LIB": rd("beta_library.json"),
                 "PRONYFIT": rd("prony_fit.json"), "PRONYRP": rd("relaxpy_prony.json"), "EXAMPLES": rd("examples.json") if INCLUDE else json.dumps({"geasse": {}})}.items():
    assert f"/*%%{key}%%*/" in html, key
    html = html.replace(f"/*%%{key}%%*/", val)
out = pathlib.Path(os.environ.get("OUT", here.parent.parent / "site" / "fitter.html"))
out.write_text(html)
print("wrote", out, f"({len(html)/1024:.0f} kB)")
