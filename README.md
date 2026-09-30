<p align="center"><img src="site/icon256.png" width="128" alt="GARASU icon"></p>

<h1 align="center">GARASU <sup>beta</sup></h1>
<p align="center"><b>G</b>lass <b>A</b>ging, <b>R</b>elaxation <b>A</b>nd <b>S</b>imulation <b>U</b>tility: compute and fit glass relaxation dynamics with structural relaxation models.</p>
<p align="center"><a href="https://wtakeda0129.github.io/tf-studio/"><b>Open in your browser</b></a> · <a href="https://github.com/Wtakeda0129/tf-studio/releases/latest">Download for macOS / Windows</a></p>

Every glass carries a thermal fingerprint of how it was made, written in its fictive temperature *T*<sub>f</sub>. GARASU simulates that history and fits it to measurements. It uses the heterogeneous **Takeda–Lucas (TL)** model, alongside the **Tool–Narayanaswamy–Moynihan (TNM)** model and **RelaxPy** (MAP viscosity).

| Tool | What it does |
|---|---|
| **Learn** | Part I, experiments: isothermal annealing, Kovacs asymmetry and memory (Macedo–Napolitano crossover), DSC cooling and heating (T<sub>f</sub>′, Moynihan's cooling-rate relation), enthalpy recovery, and MDSC (complex C<sub>p</sub>*, reversing/non-reversing and the Hutchinson/Schawe caveats). Each comes with a live simulation using any of the three models. Part II, models: the mathematics of TNM, MAP (RelaxPy) and TL, and an interactive comparison of their T<sub>f,i</sub> distributions (mean field vs Prony vs domain fictive temperatures) |
| **Lab** | Interactive cool/heat, anneal and T-jump runs: C<sub>p</sub>, *T*<sub>f</sub>, τ, δ*T*<sub>f</sub>, relaxation-time distributions, β<sub>KWW</sub>(T); TL vs TNM vs RelaxPy |
| **Data Analysis** | Raw DSC heat flow (heating or cooling): linear glass and liquid baselines, normalized C<sub>p</sub><sup>N</sup>, T<sub>f</sub>(T) and T<sub>f</sub>′ by area matching. Heating after annealing: scans aligned to the unaged reference, ΔHF(T), recovered enthalpy ΔH(t<sub>a</sub>), φ(t<sub>a</sub>) and a KWW fit. Volume, density or length during annealing: V(t) = V∞ + ΔV exp[−(t/τ)<sup>β</sup>] |
| **Fitter** | Four steps: (1) program any thermal history: ramps, anneals with log-spaced times, T-jumps, MDSC. (2) Load DSC, MDSC C<sub>p</sub>′/C<sub>p</sub>″, enthalpy, volume, *T*<sub>f</sub> or annealing data. (3) Choose a model and set parameter bounds. (4) Compute with chosen parameters, or fit with Levenberg–Marquardt or differential evolution; get standard errors, correlations, AIC/BIC |

📘 **Documentation:** [Quick Start (PDF)](https://wtakeda0129.github.io/tf-studio/docs/GARASU_Quick_Start.pdf) · [User Guide (PDF)](https://wtakeda0129.github.io/tf-studio/docs/GARASU_User_Guide.pdf) (sources in `docs/src`, rebuild with `node docs/src/build_docs.js`).

GARASU is in beta: features and results may still change between versions. Everything runs locally, in the browser or in the desktop app. No data is uploaded. Equations in Learn are typeset with [KaTeX](https://katex.org) (MIT licence), bundled in `site/vendor/katex` so they also render offline.

## Repository layout

```
site/                 the website, published to GitHub Pages (index.html, learn.html, explorer.html = Lab, fitter.html, analysis.html, vendor/katex)
src/analysis/         sources of analysis.html  → python3 src/analysis/make_analysis.py   (tests in src/analysis/tests)
src/learn/            sources of learn.html     → python3 src/learn/make_learn.py
src/explorer/         sources of explorer.html (Lab) → python3 src/explorer/make_app.py
src/fitter/           sources of fitter.html    → python3 src/fitter/make_fitter.py   (tests in src/fitter/tests)
desktop/              Electron desktop app (macOS dmg, Windows installer) with auto-update → see desktop/README.md
.github/workflows/    pages.yml (website on every push) · release.yml (macOS + Windows apps when the version in desktop/package.json changes)
```

The TL implementation is a line-by-line port of the reference Python code (`TL_model.py`). It agrees to 1 × 10⁻¹³ K on a glycerol cool/heat run. The embedded β-library contains the *G*(ln τ) tables for f = 0.10–0.99.

## References

**Takeda–Lucas (TL) model**
- W. Takeda and P. Lucas, "A model of heterogeneous undercooled liquid and glass accounting for temperature-dependent nonexponentiality and enthalpy fluctuation," *J. Chem. Phys.* **160**, 174504 (2024). https://doi.org/10.1063/5.0196812
- W. Takeda and P. Lucas, "Relationship between enthalpy fluctuation and nonexponential relaxation in glass-forming liquids," *Mater. Adv.* **7**, 5729 (2026). https://doi.org/10.1039/d6ma00442c

**Tool–Narayanaswamy–Moynihan (TNM)**
- A. Q. Tool, *J. Am. Ceram. Soc.* **29**, 240–253 (1946).
- O. S. Narayanaswamy, *J. Am. Ceram. Soc.* **54**, 491–498 (1971). https://doi.org/10.1111/j.1151-2916.1971.tb12186.x
- C. T. Moynihan, A. J. Easteal, M. A. DeBolt and J. Tucker, *J. Am. Ceram. Soc.* **59**, 12–16 (1976). https://doi.org/10.1111/j.1151-2916.1976.tb09376.x
- I. M. Hodge, *Macromolecules* **20**, 2897 (1987).
- G. W. Scherer, "Volume relaxation far from equilibrium," *J. Am. Ceram. Soc.* **69**, 374–381 (1986). https://doi.org/10.1111/j.1151-2916.1986.tb04764.x

**MAP nonequilibrium viscosity / RelaxPy**
- J. C. Mauro, D. C. Allan and M. Potuzak, "Nonequilibrium viscosity of glass," *Phys. Rev. B* **80**, 094204 (2009). https://doi.org/10.1103/PhysRevB.80.094204
- X. Guo, J. C. Mauro, D. C. Allan and M. M. Smedskjaer, *J. Am. Ceram. Soc.* **101**, 1169–1179 (2018). https://doi.org/10.1111/jace.15272
- J. C. Mauro and Y. Z. Mauro, "On the Prony series representation of stretched exponential relaxation," *Physica A* **506**, 75–87 (2018). https://doi.org/10.1016/j.physa.2018.04.047
- J. C. Mauro, R. J. Loucks and P. K. Gupta, "Fictive temperature and the glassy state," *J. Am. Ceram. Soc.* **92**, 75–86 (2009). https://doi.org/10.1111/j.1551-2916.2008.02851.x
- C. J. Wilkinson, Y. Z. Mauro and J. C. Mauro, "RelaxPy: Python code for modeling of glass relaxation behavior," *SoftwareX* **7**, 255–258 (2018). https://doi.org/10.1016/j.softx.2018.07.008

**Experiments (Learn, Part I)**
- A. J. Kovacs, *Fortschr. Hochpolym.-Forsch.* **3**, 394–507 (1963). https://doi.org/10.1007/BFb0050366
- A. J. Kovacs, J. J. Aklonis, J. M. Hutchinson and A. R. Ramos, *J. Polym. Sci. Polym. Phys. Ed.* **17**, 1097–1162 (1979).
- P. B. Macedo and A. Napolitano, *J. Res. Natl. Bur. Stand.* **71A**, 231–238 (1967).
- I. M. Hodge, "Enthalpy relaxation and recovery in amorphous materials," *J. Non-Cryst. Solids* **169**, 211 (1994).
- J. E. K. Schawe, *Thermochim. Acta* **261**, 183–194 (1995). https://doi.org/10.1016/0040-6031(95)02315-S
- J. M. Hutchinson and S. Montserrat, *J. Therm. Anal.* **47**, 103–115 (1996). https://doi.org/10.1007/BF01982690

---
Lucas group · Department of Materials Science and Engineering · University of Arizona
