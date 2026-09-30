#!/usr/bin/env python3
"""Assemble ../../site/explorer.html (Tf Studio · Explorer) (one self-contained file) from the pieces in this folder:
   template.html, tl_core.js (TL model), models_extra.js (TNM + RelaxPy),
   app_head.js, part_segs.js, app_run.js, part_plot.js, app_render.js (GUI),
   beta_library.json (TL beta library), prony_fit.json, relaxpy_prony.json (Prony tables).

   Rebuild the TL beta library from the CSVs:   python3 make_app.py --rebuild-lib <lntau_Glntau folder>
   Rebuild the fitted Prony table:              python3 build_prony.py
   Re-pack the GeAsSe DSC data:                 python3 build_geasse.py
"""
import json, os, sys, pathlib
here = pathlib.Path(__file__).parent
# Ge–As–Se DSC data are unpublished: included only when INCLUDE_GEASSE=1
INCLUDE = os.environ.get("INCLUDE_GEASSE") == "1"
if len(sys.argv) == 3 and sys.argv[1] == "--rebuild-lib":
    import pandas as pd
    folder = pathlib.Path(sys.argv[2]); out = {}
    for k in range(10, 100):
        f = k / 100
        a = pd.read_csv(folder / f"Lindsey and Richert N = 200 G lntau vs lntautauK beta = {round(f, 2)}.csv").to_numpy().astype(float)
        out[str(k)] = {"G": [float(f"{v:.7g}") for v in a[:, 1]], "x": [float(f"{v:.8g}") for v in a[:, 2]]}
    (here / "beta_library.json").write_text(json.dumps(out, separators=(",", ":")))
rd = lambda n: (here / n).read_text()
nomod = lambda s: s.replace("if (typeof module", "if (false && typeof module")
app = "\n".join(rd(n) for n in ["app_head.js", "part_segs.js", "app_run.js", "part_plot.js", "app_render.js", "app_data.js", "app_tail.js"])
html = rd("template.html")
for key, val in {"CORE": nomod(rd("tl_core.js")), "MODELS": nomod(rd("models_extra.js")), "APP": app,
                 "LIB": rd("beta_library.json"), "PRONYFIT": rd("prony_fit.json"), "PRONYRP": rd("relaxpy_prony.json"), "GEASSE": rd("geasse_data.json") if INCLUDE else json.dumps({"comps": {}, "rate_Kmin": 10})}.items():
    assert f"/*%%{key}%%*/" in html, key
    html = html.replace(f"/*%%{key}%%*/", val)
out_path = pathlib.Path(os.environ.get("OUT", here.parent.parent / "site" / "explorer.html"))
out_path.write_text(html)
print("wrote", out_path, f"({len(html)/1024:.0f} kB)")
