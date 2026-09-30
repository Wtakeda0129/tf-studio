/* ============================================================
   TL model core — direct port of TL_model.py (Takeda & Lucas, JCP 160, 174504 (2024))
   Units: temperature in K (or any consistent unit as long as Tg, T are same), time in s.
   ============================================================ */
const TL = (function () {
  const LN10 = Math.log(10);

  // ---- helper formulas (same names as TL_model.py) ----
  const Tv_from_Tg_m_tau0 = (Tg, m, tau0) => Tg * (1 - Math.log(100 / tau0) / (m * LN10));
  const D_from_m_tau0 = (m, tau0) => { const a = Math.log(100 / tau0); return a * a / (m * LN10 - a); };
  const AG = (T, Tv, tau0, D, Tf) => tau0 * Math.exp(D * Tv / (T * (1 - Tv / Tf)));
  const localTf = (Tv, T, aveTv) => T * (2 - Tv / aveTv);
  const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

  // ---- beta library: {"10": {G:[...], x:[...]}, ..., "99": ...} ----
  let LIB = null;
  function setLibrary(lib) { LIB = lib; }

  // Build the Tv,i / Yi distribution (calculation_of_Tf, lines 110-135)
  function buildDistribution(p) {
    const { Tg, m, log10tau0, f } = p; const N = p.N || 200;
    const tau0 = Math.pow(10, log10tau0);
    const Tv0 = Tv_from_Tg_m_tau0(Tg, m, tau0);
    const D = D_from_m_tau0(m, tau0);
    const key = String(Math.round(f * 100));
    const tab = LIB[key];
    if (!tab) throw new Error('No beta-library entry for f=' + f);
    const x0 = tab.x, G0 = tab.G;
    // new grid: linear in ln(tau/tauK) between first and last (== log of logspace in python)
    const xa = x0[0], xb = x0[x0.length - 1];
    const x = new Float64Array(N), G = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      x[i] = N === 1 ? xa : xa + (xb - xa) * i / (N - 1);
      while (j < x0.length - 2 && x0[j + 1] < x[i]) j++;
      const w = (x[i] - x0[j]) / (x0[j + 1] - x0[j]);           // linear interp (extrapolates)
      G[i] = G0[j] + w * (G0[j + 1] - G0[j]);
    }
    const Tvi = new Float64Array(N), Yi = new Float64Array(N), tauTg = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      tauTg[i] = Math.exp(x[i]) * 100;
      const L = Math.log(tauTg[i] / tau0);
      Tvi[i] = Tg / (1 + D / L);
      Yi[i] = G[i] * (L + D) * (L + D) / (Tg * D);
    }
    const sY = sum(Yi);
    for (let i = 0; i < N; i++) Yi[i] /= sY;
    for (let i = 0; i < N; i++) if (Tvi[i] < 0) Yi[i] = 0;
    let s = 0; for (let i = 0; i < N; i++) s += Tvi[i] * Yi[i];
    const shift = Tv0 - s;
    for (let i = 0; i < N; i++) Tvi[i] += shift;
    s = 0; for (let i = 0; i < N; i++) s += Tvi[i] * Yi[i];
    const Tv = s;
    return { N, tau0, D, Tv, Tvi, Yi, tauTg, x, Tg };
  }

  // Xi (normalised weights of ln tau) for temperature T and average fictive temperature Tf
  function weightsX(dist, T, Tf, out) {
    const { N, Yi, Tv, D } = dist; out = out || new Float64Array(N);
    let s = 0; const c = 1 - Tv / Tf;
    for (let i = 0; i < N; i++) { out[i] = Yi[i] * T / D * c * c; s += out[i]; }
    for (let i = 0; i < N; i++) out[i] /= s;
    return out;
  }

  // ---- main integration (calculation_of_Tf, lines 138-209) ----
  // p: {Tg,m,log10tau0,f,beta0,N}; T[], t[] arrays. opts.keepTfi -> store all local Tf,i (Float32)
  function run(p, T, t, opts) {
    opts = opts || {};
    const dist = buildDistribution(p);
    const { N, tau0, D, Tv, Tvi, Yi } = dist;
    const beta0 = p.beta0, n = T.length;
    const Tf = new Float64Array(n), tau = new Float64Array(n), sigTf = new Float64Array(n),
      sigLnTau = new Float64Array(n), tauEq = new Float64Array(n);
    const Tfi = new Float64Array(N), Xi = new Float64Array(N), taui = new Float64Array(N);
    const store = opts.keepTfi ? new Float32Array(n * N) : null;
    const TfiPrev = new Float64Array(N);

    Tf[0] = T[0];
    for (let k = 0; k < N; k++) Tfi[k] = localTf(Tvi[k], Tf[0], Tv);
    tauEq[0] = AG(T[0], Tv, tau0, D, T[0]);
    weightsX(dist, T[0], Tf[0], Xi);
    let a = 0, mu = 0;
    for (let k = 0; k < N; k++) { taui[k] = AG(T[0], Tvi[k], tau0, D, Tf[0]); a += Xi[k] * Math.log(taui[k]); }
    tau[0] = Math.exp(a);
    const varOf = (w, v) => { let mu = 0, s = 0; for (let k = 0; k < N; k++) mu += w[k] * v[k]; for (let k = 0; k < N; k++) s += w[k] * (v[k] - mu) * (v[k] - mu); return s; };
    const lnT = new Float64Array(N);
    sigTf[0] = varOf(Yi, Tfi);
    for (let k = 0; k < N; k++) lnT[k] = Math.log(taui[k]);
    sigLnTau[0] = varOf(Xi, lnT);
    if (store) store.set(Tfi, 0);

    for (let i = 1; i < n; i++) {
      const dt = t[i] - t[i - 1], Ti = T[i], Tfprev = Tf[i - 1];
      tauEq[i] = AG(Ti, Tv, tau0, D, Ti);
      let ax = 0;
      weightsX(dist, Ti, Tfprev, Xi);
      for (let k = 0; k < N; k++) {
        taui[k] = AG(Ti, Tvi[k], tau0, D, Tfprev);
        const Tloc = localTf(Tvi[k], Ti, Tv);
        Tfi[k] = Tloc - (Tloc - Tfi[k]) * Math.exp(-Math.pow(dt / taui[k], beta0));
        ax += Xi[k] * Math.log(taui[k]);
        lnT[k] = Math.log(taui[k]);
      }
      tau[i] = Math.exp(ax);
      let s = 0; for (let k = 0; k < N; k++) s += Yi[k] * Tfi[k];
      Tf[i] = s;
      sigTf[i] = varOf(Yi, Tfi);
      sigLnTau[i] = varOf(Xi, lnT);
      if (store) store.set(Tfi, i * N);
    }
    return { dist, Tf, tau, tauEq, sigTf, sigLnTau, TfiAll: store, T, t, p };
  }

  // ---- snapshot at step i: distributions + beta_KWW (paper Eq. 20 and KWW fit) ----
  function snapshot(res, i) {
    const { dist, T, Tf, TfiAll, p } = res; const { N, tau0, D, Tvi, Yi } = dist;
    const Ti = T[i];
    const Tfprev = i === 0 ? Tf[0] : Tf[i - 1];
    const Tfcur = Tf[i];
    // paper: non-equilibrium chi uses <Tf> (state at step i); equilibrium uses <Tf> = T
    const mk = (Tfavg) => {
      const X = weightsX(dist, Ti, Tfavg);
      const lt = new Float64Array(N), l10 = new Float64Array(N);
      for (let k = 0; k < N; k++) { lt[k] = Math.log(AG(Ti, Tvi[k], tau0, D, Tfavg)); l10[k] = lt[k] / LN10; }
      // G(log10 tau) : area-normalised density (paper Sec. III B). Sort by l10 (monotonic in Tvi)
      const idx = Array.from({ length: N }, (_, k) => k).sort((a, b) => l10[a] - l10[b]);
      let area = 0; for (let q = 0; q < N - 1; q++) area += X[idx[q]] * (l10[idx[q + 1]] - l10[idx[q]]);
      const G = idx.map(k => X[k] / area), xs = idx.map(k => l10[k]);
      return { X, lt, xs, G, beta: fitKWW(X, lt) };
    };
    const ne = mk(Tfcur), eq = mk(Ti);
    const Tfi = new Float64Array(N);
    if (TfiAll) for (let k = 0; k < N; k++) Tfi[k] = TfiAll[i * N + k];
    return { ne, eq, Tfi, Tvi, Yi, T: Ti, Tf: Tfcur };
  }

  // KWW fit of chi(t)=sum X_i exp(-t/tau_i): linear regression of ln(-ln chi) vs ln t over 0.9>chi>0.1
  function fitKWW(X, lt) {
    const N = X.length; let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < N; k++) { if (X[k] > 1e-8) { lo = Math.min(lo, lt[k]); hi = Math.max(hi, lt[k]); } }
    const pts = []; const M = 400;
    for (let q = 0; q < M; q++) {
      const lnt = lo - 4 + (hi - lo + 8) * q / (M - 1), tt = Math.exp(lnt);
      let chi = 0; for (let k = 0; k < N; k++) chi += X[k] * Math.exp(-tt / Math.exp(lt[k]));
      if (chi < 0.9 && chi > 0.1) pts.push([lnt, Math.log(-Math.log(chi)), chi]);
    }
    if (pts.length < 3) return NaN;
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = pts.length;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  }

  // Derived quantities from the paper (Eq. 23-24 and fragility)
  function derived(p) {
    const tau0 = Math.pow(10, p.log10tau0), D = D_from_m_tau0(p.m, tau0);
    const Tv = Tv_from_Tg_m_tau0(p.Tg, p.m, tau0);
    return { tau0, D, Tv, mCheck: D * Tv * p.Tg / ((p.Tg - Tv) * (p.Tg - Tv) * LN10) };
  }

  return { run, buildDistribution, snapshot, derived, setLibrary, weightsX, AG, fitKWW };
})();
if (typeof module !== 'undefined') module.exports = TL;
