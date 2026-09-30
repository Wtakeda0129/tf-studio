#!/usr/bin/env python3
"""Pack the GeAsSe DSC data in ../system/GeAsSe into geasse_data.json for the app.

   - DSC qH=qC=10cmin/<comp> .../*Cooling.csv, *Heating.csv : raw heat flow (W/g) vs T (°C).
     Ramp points only (isothermal repeats and blank rows dropped), averaged in 0.25 K bins.
   - equal_rate_DSC_manual_baseline_ranges.json : glass / liquid baseline windows (°C)
     used for  dTf/dT = (HF − HF_g)/(HF_l − HF_g)  with linear HF_g(T), HF_l(T).
   - Ternary_analysis_0.5-1-5Kmin/<comp>/metadata.json, beta_vs_T.csv : fitted TL
     parameters (from the 0.5/1/5 K/min series) and β_KWW(T) predictions.

   Usage:  python3 build_geasse.py            (then python3 make_app.py)
"""
import csv, json, os, re, pathlib
import numpy as np

here = pathlib.Path(__file__).parent
root = here.parent / "system" / "GeAsSe"
dsc_dir = root / "DSC qH=qC=10cmin"
tern_dir = root / "Ternary_analysis_0.5-1-5Kmin"
ranges = json.load(open(root / "equal_rate_DSC_manual_baseline_ranges.json"))["ranges"]

def canon(name):  # "Ge7.5.As15Se77.5 s1 ..." -> "Ge7.5As15Se77.5"
    return re.sub(r"\.(?=[A-Z])", "", name.split(" ")[0])

def load_scan(path, heating):
    T, H = [], []
    with open(path, encoding="utf-8-sig") as fh:
        rd = csv.reader(fh); head = [h.strip().lower() for h in next(rd)]; next(rd)
        iT = next(i for i, h in enumerate(head) if h.startswith("temperature"))   # column order differs between files
        iH = next(i for i, h in enumerate(head) if h.startswith("heat flow"))
        for row in rd:
            if len(row) <= max(iT, iH) or not row[iT].strip() or not row[iH].strip(): continue
            try: T.append(float(row[iT])); H.append(float(row[iH]))
            except ValueError: pass
    T, H = np.array(T), np.array(H)
    # keep ramp points only: strictly moving in the scan direction relative to the running extreme
    keep, ext = [], None
    for i, t in enumerate(T):
        if ext is None or (t > ext if heating else t < ext): keep.append(i); ext = t
    T, H = T[keep], H[keep]
    bins = np.round(T / 0.25) * 0.25
    ub = np.unique(bins)
    Hb = np.array([H[bins == b].mean() for b in ub])
    return [round(float(v), 3) for v in ub], [float(f"{v:.6g}") for v in Hb]

data = {"source": "system/GeAsSe", "definition": "dTf/dT=(HF-HFg)/(HFl-HFg)", "rate_Kmin": 10.0, "comps": {}}
for d in sorted(os.listdir(dsc_dir)):
    p = dsc_dir / d
    if not p.is_dir(): continue
    c = canon(d); entry = {"folder": d, "scans": {}, "ranges": {}}
    for f in os.listdir(p):
        if f.endswith("Cooling.csv"): entry["scans"]["cooling"] = dict(zip(("T", "HF"), load_scan(p / f, False)))
        if f.endswith("Heating.csv"): entry["scans"]["heating"] = dict(zip(("T", "HF"), load_scan(p / f, True)))
    for dirn in ("cooling", "heating"):
        r = ranges.get(f"{c}|{dirn}")
        if r: entry["ranges"][dirn] = r
    md = tern_dir / c / "metadata.json"
    if md.exists():
        m = json.load(open(md))
        entry["fit"] = {k: m[k] for k in ("m", "Tg_K", "f", "log10_tau0", "Tv_K", "beta0", "N", "cooling_rates_Kmin", "heating_rate_DSC_Kmin")}
        bt = tern_dir / c / "beta_vs_T.csv"
        if bt.exists():
            rows = list(csv.DictReader(open(bt)))
            num = lambda s: float(s) if s not in ("", None) else None
            entry["beta"] = {"T": [num(r["Temperature_K"]) for r in rows], "ne": [num(r["Beta_fit"]) for r in rows],
                             "eq": [num(r["Beta_eq_fit"]) for r in rows], "rate_Kmin": m.get("beta_cooling_rate_Kmin")}
    data["comps"][c] = entry
    print(f"{c:18s} cool {len(entry['scans'].get('cooling',{}).get('T',[])):5d}  heat {len(entry['scans'].get('heating',{}).get('T',[])):5d}  fit {'yes' if 'fit' in entry else 'no '}  ranges {sorted(entry['ranges'])}")
(here / "geasse_data.json").write_text(json.dumps(data, separators=(",", ":")))
print("wrote geasse_data.json", round((here / "geasse_data.json").stat().st_size / 1024), "kB")
