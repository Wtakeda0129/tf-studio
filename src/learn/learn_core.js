/* Learn page: run TNM, MAP (RelaxPy) and TL on one example glass for a cool → anneal history,
   keeping every component fictive temperature so their distributions can be compared. */
const LEARN = (function () {
  const GLASS = { Tg: 734.5, m: 35.3 };                       // RelaxPy's example glass
  const MAP0 = { eta_inf: -2.9, B: 4136.7, C: 135.09, log10Ks: 10 };  // log Ks = 10 → τ(T_g) = 100 s, like TL and TNM
  const TL0 = { log10tau0: -14, beta0: 1, N: 200 };
  const TNM_X = 0.5;

  // cool from Tg+40 to Ta at q (K/min) in 0.25 K steps, then hold at Ta with log-spaced times up to tmax
  function history(q, Ta, tmax) {
    const T = [], t = [], T0 = GLASS.Tg + 40, dT = 0.25, rate = q / 60;
    const nc = Math.max(2, Math.round((T0 - Ta) / dT));
    for (let i = 0; i <= nc; i++) { T.push(T0 - (T0 - Ta) * i / nc); t.push((T0 - T[i]) / rate); }
    const tc = t[t.length - 1], na = 160;
    for (let i = 1; i <= na; i++) { T.push(Ta); t.push(tc + Math.pow(10, -1 + (Math.log10(tmax) + 1) * i / na)); }
    return { T: Float64Array.from(T), t: Float64Array.from(t), nCool: nc + 1, tCool: tc };
  }
  function tlBeta(f, T) {   // equilibrium β_KWW of the TL model at temperature T
    const d = TL.buildDistribution({ ...GLASS, ...TL0, f });
    const X = TL.weightsX(d, T, T), lt = Array.from(d.Tvi, Tv => Math.log(TL.AG(T, Tv, d.tau0, d.D, T)));
    return TL.fitKWW(X, lt);
  }
  function wstats(w, v) { let mu = 0, s = 0; for (let k = 0; k < w.length; k++) mu += w[k] * v[k]; for (let k = 0; k < w.length; k++) s += w[k] * (v[k] - mu) ** 2; return [mu, Math.sqrt(Math.max(s, 0))]; }

  function runAll(o) {
    const H = history(o.q, o.Ta, o.tmax || 1e6), n = H.T.length;
    const beta = +tlBeta(o.f, GLASS.Tg).toFixed(2);             // TNM and MAP use the TL β_KWW at T_g
    // TL
    const tl = TL.run({ ...GLASS, ...TL0, f: o.f }, H.T, H.t, { keepTfi: true });
    const N = tl.dist.N, Y = tl.dist.Yi;
    // TNM (exact KWW summation)
    const tnm = MODELS.runTNM({ ...GLASS, x: TNM_X, beta, kernel: 'exact' }, H.T, H.t);
    // MAP / RelaxPy, Prony series fitted to the same β
    const mp = { ...GLASS, ...MAP0, pexp: 0.3082153 * GLASS.m, betaName: 'custom', beta };
    mp.A = MODELS.continuityA(mp);
    const map = MODELS.runRelaxPy(mp, H.T, H.t);
    const w = map.prony.w, NP = w.length;
    const sig = { TL: new Float64Array(n), MAP: new Float64Array(n), TNM: new Float64Array(n) };
    const tmpT = new Float64Array(N), tmpM = new Float64Array(NP);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < N; k++) tmpT[k] = tl.TfiAll[i * N + k];
      sig.TL[i] = wstats(Y, tmpT)[1];
      for (let k = 0; k < NP; k++) tmpM[k] = map.comp[i * NP + k];
      sig.MAP[i] = wstats(w, tmpM)[1];
    }
    return { H, beta, tl, tnm, map, sig, N, Y, w, NP };
  }
  return { GLASS, MAP0, TL0, TNM_X, history, runAll, tlBeta, wstats };
})();
if (typeof module !== 'undefined') module.exports = LEARN;
