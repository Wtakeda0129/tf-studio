<p align="center"><img src="site/icon256.png" width="128" alt="Tf Studio icon"></p>

<h1 align="center">Tf Studio</h1>
<p align="center"><b>Thermal Fingerprint</b>: compute and fit glass relaxation dynamics with structural relaxation models.</p>
<p align="center"><a href="https://wtakeda0129.github.io/tf-studio/"><b>Open in your browser</b></a> · <a href="https://github.com/Wtakeda0129/tf-studio/releases/latest">Download for macOS / Windows</a></p>

Every glass carries a thermal fingerprint of how it was made, written in its fictive temperature *T*<sub>f</sub>. Tf Studio simulates that history and fits it to measurements. It uses the heterogeneous **Takeda–Lucas (TL)** model, alongside the **Tool–Narayanaswamy–Moynihan (TNM)** model and **RelaxPy** (MAP viscosity).

| Tool | What it does |
|---|---|
| **Explorer** | Interactive cool/heat, anneal and T-jump runs: C<sub>p</sub>, *T*<sub>f</sub>, τ, δ*T*<sub>f</sub>, relaxation-time distributions, β<sub>KWW</sub>(T); TL vs TNM vs RelaxPy |
| **Fitter** | Four steps: (1) program any thermal history: ramps, anneals with log-spaced times, T-jumps, MDSC. (2) Load DSC, MDSC C<sub>p</sub>′/C<sub>p</sub>″, enthalpy, volume, *T*<sub>f</sub> or annealing data. (3) Choose a model and set parameter bounds. (4) Compute with chosen parameters, or fit with Levenberg–Marquardt or differential evolution; get standard errors, correlations, AIC/BIC |

Everything runs locally, in the browser or in the desktop app. No data is uploaded.

## Repository layout

```
site/                 the website, published to GitHub Pages (index.html, explorer.html, fitter.html)
src/explorer/         sources of explorer.html  → python3 src/explorer/make_app.py
src/fitter/           sources of fitter.html    → python3 src/fitter/make_fitter.py   (tests in src/fitter/tests)
desktop/              Electron desktop app (macOS dmg, Windows installer) with auto-update → see desktop/README.md
.github/workflows/    pages.yml (website on every push) · release.yml (macOS + Windows apps on tags v*)
```

The TL implementation is a line-by-line port of the reference Python code (`TL_model.py`). It agrees to 1 × 10⁻¹³ K on a glycerol cool/heat run. The embedded β-library contains the *G*(ln τ) tables for f = 0.10–0.99.

## How to cite

- W. Takeda and P. Lucas, "A model of heterogeneous undercooled liquid and glass accounting for temperature-dependent nonexponentiality and enthalpy fluctuation," *J. Chem. Phys.* **160**, 174504 (2024). https://doi.org/10.1063/5.0196812
- W. Takeda and P. Lucas, "Relationship between enthalpy fluctuation and nonexponential relaxation in glass-forming liquids," *Mater. Adv.* **7**, 5729 (2026). https://doi.org/10.1039/d6ma00442c

### Comparison models

**Tool–Narayanaswamy–Moynihan (TNM)**
- A. Q. Tool, *J. Am. Ceram. Soc.* **29**, 240–253 (1946).
- O. S. Narayanaswamy, *J. Am. Ceram. Soc.* **54**, 491–498 (1971). https://doi.org/10.1111/j.1151-2916.1971.tb12186.x
- C. T. Moynihan, A. J. Easteal, M. A. DeBolt and J. Tucker, *J. Am. Ceram. Soc.* **59**, 12–16 (1976). https://doi.org/10.1111/j.1151-2916.1976.tb09376.x
- I. M. Hodge, *Macromolecules* **20**, 2897 (1987).
- G. W. Scherer, "Volume relaxation far from equilibrium," *J. Am. Ceram. Soc.* **69**, 374–381 (1986). https://doi.org/10.1111/j.1151-2916.1986.tb04764.x

**MAP nonequilibrium viscosity / RelaxPy**
- J. C. Mauro, D. C. Allan and M. Potuzak, "Nonequilibrium viscosity of glass," *Phys. Rev. B* **80**, 094204 (2009). https://doi.org/10.1103/PhysRevB.80.094204
- X. Guo, J. C. Mauro, D. C. Allan and M. M. Smedskjaer, *J. Am. Ceram. Soc.* **101**, 1169–1179 (2018). https://doi.org/10.1111/jace.15272
- C. J. Wilkinson, Y. Z. Mauro and J. C. Mauro, "RelaxPy: Python code for modeling of glass relaxation behavior," *SoftwareX* **7**, 255–258 (2018). https://doi.org/10.1016/j.softx.2018.07.008

---
Lucas group · Department of Materials Science and Engineering · University of Arizona
