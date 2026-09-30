#!/usr/bin/env python3
"""Build examples.json for the Relaxation Fitter from ../build/geasse_data.json (the packed GeAsSe DSC set):
   normalized dT_f/dT for the 10 K/min cooling and heating scans of every composition (≈1 K spacing, inside the
   saved baseline windows) plus the TL parameters fitted to the 0.5/1/5 K/min series."""
import json, pathlib, numpy as np
here = pathlib.Path(__file__).parent
src = json.load(open(here.parent / "build" / "geasse_data.json")) if (here.parent / "build" / "geasse_data.json").exists() else json.load(open(here / "geasse_data.json"))
out = {"geasse": {}}
for c, e in src["comps"].items():
    ent = {"curves": {}, "Tmin": None, "Tmax": None}
    Ts = []
    for d in ("cooling", "heating"):
        sc, r = e["scans"].get(d), e["ranges"].get(d)
        if not sc or not r: continue
        T, H = np.array(sc["T"]), np.array(sc["HF"]); Ts += [T.min(), T.max()]
        def lin(a, b):
            m = (T >= a) & (T <= b); return np.polyfit(T[m], H[m], 1)
        g, l = np.polyval(lin(*r["glass"]), T), np.polyval(lin(*r["liquid"]), T)
        cp = (H - g) / (l - g); lo, hi = r["glass"][0], r["liquid"][1]
        m = (T >= lo) & (T <= hi); Tk, cpk = T[m] + 273.15, cp[m]
        # 1 K bins
        b = np.round(Tk); ub = np.unique(b)
        ent["curves"][d] = {"T": [round(float(x), 2) for x in ub], "y": [round(float(cpk[b == x].mean()), 5) for x in ub]}
    ent["Tmin"], ent["Tmax"] = round(min(Ts) + 273.15, 2), round(max(Ts) + 273.15, 2)
    if "fit" in e: ent["fit"] = {k: e["fit"][k] for k in ("Tg_K", "m", "log10_tau0", "f", "beta0")}
    out["geasse"][c] = ent
(here / "examples.json").write_text(json.dumps(out, separators=(",", ":")))
print("examples.json", round((here / "examples.json").stat().st_size / 1024), "kB,", len(out["geasse"]), "compositions")
