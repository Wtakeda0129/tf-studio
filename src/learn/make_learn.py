#!/usr/bin/env python3
"""Assemble ../../site/learn.html (GARASU · Learn) from template.html, learn_core.js, learn_app.js
   learn_plot.js, learn_exp.js, learn_expui.js and the model cores + engine in ../fitter.
   KaTeX is loaded from site/vendor/katex (vendored, so the page also works offline in the desktop app)."""
import os, pathlib
here = pathlib.Path(__file__).parent
ex = here.parent / "fitter"   # same model cores as the Fitter (β-continuous Prony blend) + its engine
rd = lambda p: pathlib.Path(p).read_text()
nomod = lambda s: s.replace("if (typeof module", "if (false && typeof module")
html = rd(here / "template.html")
for key, val in {"CORE": nomod(rd(ex / "tl_core.js")), "MODELS": nomod(rd(ex / "models_extra.js")),
                 "LIB": rd(ex / "beta_library.json"), "PRONYFIT": rd(ex / "prony_fit.json"), "PRONYRP": rd(ex / "relaxpy_prony.json"),
                 "ENGINE": nomod(rd(ex / "engine.js")), "PLOT": rd(here / "learn_plot.js"),
                 "LEARN": nomod(rd(here / "learn_core.js")), "EXP": nomod(rd(here / "learn_exp.js")),
                 "APP": rd(here / "learn_app.js"), "EXPUI": rd(here / "learn_expui.js")}.items():
    assert f"/*%%{key}%%*/" in html, key
    html = html.replace(f"/*%%{key}%%*/", val)
import sys as _sys; _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "shared")); from theme import apply
html = apply(html, "learn")
out = pathlib.Path(os.environ.get("OUT", here.parent.parent / "site" / "learn.html"))
out.write_text(html)
print("wrote", out, f"({len(html)/1024:.0f} kB)")
