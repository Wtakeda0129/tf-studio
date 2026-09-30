/* ============================================================
   Additional relaxation models for comparison with the TL model
   (1) TNM  — Tool–Narayanaswamy–Moynihan
       τ = A exp[ x Δh/(R T) + (1−x) Δh/(R T_f) ],  Δh/R = m ln10 T_g,  A fixed by τ(T_g)=100 s
       kernel: exact KWW summation (Moynihan 1976)  or  Prony-series recursion
   (2) RelaxPy — Wilkinson, Mauro & Mauro, SoftwareX 7, 255 (2018); MAP viscosity (Guo et al. 2017)
       log η = x log η_eq(T_f) + (1−x) log η_ne(T,T_f),  x = [min(T,T_f)/max(T,T_f)]^p
       log η_eq = MYEGA(T_f);  log η_ne = A + B/T − C exp[−(T_g/T_f)(m/(12−log η∞) − 1)]
       τ_K = η / K_s ;  T_f,i(t_j) = T_j − (T_j − T_f,i(t_j−1)) exp(−k_i Δt/τ_K)
   All models start in equilibrium, T_f(0) = T(0), and use T(t_j) with T_f(t_j−1) to evaluate τ.
   ============================================================ */
const MODELS = (function () {
  const LN10 = Math.log(10);
  let PRONY_FIT = null, PRONY_RP = null;
  function setTables(fit, rp) { PRONY_FIT = fit; PRONY_RP = rp; }

  // Prony coefficients {w,k,err,src}
  function pronyFit(beta) {
    // Prony coefficients for any β in [0.10, 1]: the tabulated fits (0.01 grid) are blended linearly between
    // neighbouring β, so the relaxation function — and every simulated response — varies continuously with β.
    const b = Math.min(1, Math.max(0.1, beta)), x = b * 100, lo = Math.floor(x + 1e-9), hi = Math.min(100, lo + 1), wHi = hi > lo ? x - lo : 0;
    const A = PRONY_FIT[String(lo)], B = PRONY_FIT[String(hi)];
    if (wHi < 1e-9 || !B) return { w: A.w, k: A.k, err: A.err, src: `NNLS fit, β = ${b.toFixed(3)}, ${A.w.length} terms` };
    return { w: A.w.map(v => v * (1 - wHi)).concat(B.w.map(v => v * wHi)), k: A.k.concat(B.k), err: Math.max(A.err, B.err), src: `NNLS fit blended between β = ${(lo / 100).toFixed(2)} and ${(hi / 100).toFixed(2)}` };
  }
  function pronyRelaxPy(betaName, N) {
    const e = PRONY_RP[betaName][String(N)];
    return { w: e.w, k: e.k, err: null, src: `RelaxPy table, β = ${betaName}, N = ${N}` };
  }

  // generic Prony integrator. logtauFn(T, Tf) -> ln τ
  function pronyRun(T, t, pr, lntauFn, extraFn) {
    const n = T.length, N = pr.w.length, w = pr.w, k = pr.k;
    const Tfi = new Float64Array(N).fill(T[0]);
    const Tf = new Float64Array(n), tau = new Float64Array(n), extra = extraFn ? new Float64Array(n) : null;
    const comp = new Float32Array(n * N);
    Tf[0] = T[0]; tau[0] = Math.exp(lntauFn(T[0], T[0])); if (extra) extra[0] = extraFn(T[0], T[0]);
    comp.set(Tfi, 0);
    for (let i = 1; i < n; i++) {
      const dt = t[i] - t[i - 1], Ti = T[i], Tfp = Tf[i - 1];
      const lt = lntauFn(Ti, Tfp); tau[i] = Math.exp(lt); if (extra) extra[i] = extraFn(Ti, Tfp);
      const r = dt / tau[i]; let s = 0;
      for (let q = 0; q < N; q++) { Tfi[q] = Ti - (Ti - Tfi[q]) * Math.exp(-k[q] * r); s += w[q] * Tfi[q]; }
      Tf[i] = s; comp.set(Tfi, i * N);
    }
    return { Tf, tau, extra, comp, prony: pr };
  }

  // ---------------- TNM ----------------
  function tnmConsts(p) { const dh = p.m * LN10 * p.Tg; return { dh, lnA: Math.log(100) - dh / p.Tg }; }
  function runTNM(p, T, t) {
    const { dh, lnA } = tnmConsts(p), x = p.x;
    const lntau = (Ti, Tf) => lnA + x * dh / Ti + (1 - x) * dh / Tf;
    const tauEq = Float64Array.from(T, Ti => Math.exp(lnA + dh / Ti));
    if (p.kernel === 'prony') {
      const pr = pronyFit(p.beta), r = pronyRun(T, t, pr, lntau);
      return { ...r, tauEq, info: { 'Δh/R': dh.toFixed(0) + ' K', 'ln A': lnA.toFixed(3), kernel: pr.src + (pr.err ? `, max err ${pr.err}` : '') } };
    }
    // exact KWW (Moynihan): Tf_n = T0 + Σ_j ΔT_j [1 − exp(−(ξ_n − ξ_{j−1})^β)]
    const n = T.length, Tf = new Float64Array(n), tau = new Float64Array(n), Xi = new Float64Array(n), beta = p.beta;
    Tf[0] = T[0]; tau[0] = Math.exp(lntau(T[0], T[0]));
    const dT = new Float64Array(n); const idx = []; // only steps with ΔT ≠ 0 contribute
    for (let i = 1; i < n; i++) {
      tau[i] = Math.exp(lntau(T[i], Tf[i - 1]));
      Xi[i] = Xi[i - 1] + (t[i] - t[i - 1]) / tau[i];
      dT[i] = T[i] - T[i - 1]; if (dT[i] !== 0) idx.push(i);
      let s = T[0]; const X = Xi[i];
      for (let q = 0; q < idx.length; q++) {
        const j = idx[q], red = X - Xi[j - 1];
        s += dT[j] * (red > 0 ? 1 - Math.exp(-Math.pow(red, beta)) : 0);
      }
      Tf[i] = s;
    }
    return { Tf, tau, tauEq, extra: null, comp: null, prony: null, info: { 'Δh/R': dh.toFixed(0) + ' K', 'ln A': lnA.toFixed(3), kernel: 'exact KWW summation (Moynihan)' } };
  }

  // ---------------- RelaxPy (MAP) ----------------
  function mapFns(p) {
    const { eta_inf: ei, Tg, m, A, B, C, pexp, log10Ks } = p, c = m / (12 - ei) - 1;
    const eq = Tf => ei + (12 - ei) * (Tg / Tf) * Math.exp(c * (Tg / Tf - 1));
    const ne = (T, Tf) => A + B / T - C * Math.exp(-(Tg / Tf) * c);
    const visc = (T, Tf) => { const y = Math.pow(Math.min(T, Tf) / Math.max(T, Tf), pexp); return y * eq(Tf) + (1 - y) * ne(T, Tf); };
    return { eq, ne, visc, lntau: (T, Tf) => (visc(T, Tf) - log10Ks) * LN10 };
  }
  function continuityA(p) { const c = p.m / (12 - p.eta_inf) - 1; return 12 - p.B / p.Tg + p.C * Math.exp(-c); }
  function runRelaxPy(p, T, t) {
    const f = mapFns(p);
    const pr = p.betaName === 'custom' ? pronyFit(p.beta) : pronyRelaxPy(p.betaName, p.N);
    const r = pronyRun(T, t, pr, f.lntau, f.visc);
    const tauEq = Float64Array.from(T, Ti => Math.pow(10, f.eq(Ti) - p.log10Ks));
    const tauTg = Math.pow(10, 12 - p.log10Ks);
    return { ...r, tauEq, logEta: r.extra, info: { 'τ_K(T_g)': tauTg.toPrecision(3) + ' s', 'A for continuity at T_g': continuityA(p).toFixed(3), kernel: pr.src } };
  }

  return { setTables, runTNM, runRelaxPy, continuityA, pronyFit, pronyRelaxPy, mapFns };
})();
if (typeof module !== 'undefined') module.exports = MODELS;
