/* Learn page, Part I: simulated experiments (annealing, Kovacs, DSC, enthalpy recovery, MDSC)
   on the example glass, with any of the three models. Uses ENGINE (fitter engine), TL and MODELS. */
const EXP = (function () {
  const G = LEARN.GLASS;                 // selenium (see learn_core.js)
  const F = LEARN.F0, X = LEARN.TNM_X;
  let BETA = null;
  function beta() { if (BETA == null) BETA = +LEARN.tlBeta(F, G.Tg).toFixed(2); return BETA; }
  function params(model) {
    if (model === 'TL') return { ...G, ...LEARN.TL0, f: F };
    if (model === 'TNM') return { ...G, x: X, beta: beta() };
    const M = LEARN.MAP0;
    return { ...G, eta_inf: M.eta_inf, log10Ks: M.log10Ks, A: 0, B: M.B, C: M.C, pexp: 0.3082153 * G.m, beta: beta(), Aauto: true, pauto: false };
  }
  const key = m => (m === 'MAP' ? 'RP' : m);
  function sim(model, T0, segs) {
    const hist = ENGINE.compile(T0, segs);
    const s = ENGINE.simulate(key(model), params(model), hist, {});
    return { hist, Tf: s.Tf, tau: s.tau, tauEq: s.tauEq };
  }
  // equilibrium relaxation time at T (same τ(T_g) = 100 s for all three)
  function tauEq(model, T) { const r = sim(model, T, [{ type: 'hold', dur: 1, n: 2 }]); return r.tauEq[0]; }

  /* 1. isothermal annealing after a 10 K down-jump: φ(t) = (T_f − T_a)/(T_f(0) − T_a) */
  function anneal(model) {
    return [5, 10, 20].map(d => {
      const Ta = G.Tg - d, T0 = Ta + 10;
      const r = sim(model, T0, [{ type: 'jump', T: Ta }, { type: 'hold', dur: 1e9, n: 100, t1: 1e-2 }]);
      const i0 = 1, t = [], phi = [];
      for (let i = i0 + 1; i < r.Tf.length; i++) { t.push(r.hist.t[i] - r.hist.t[i0]); phi.push((r.Tf[i] - Ta) / (T0 - Ta)); }
      const te = tauEq(model, Ta);
      // KWW fit of the simulated curve: ln(−ln φ) = β ln t − β ln τ over 0.1 < φ < 0.9
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      t.forEach((x, i) => { const f = phi[i]; if (f > 0.1 && f < 0.9) { const X = Math.log(x), Y = Math.log(-Math.log(f)); n++; sx += X; sy += Y; sxx += X * X; sxy += X * Y; } });
      const bApp = (n * sxy - sx * sy) / (n * sxx - sx * sx), tauApp = Math.exp(-(sy - bApp * sx) / n / bApp);
      return { Ta, t, phi, tauEq: te, kww: t.map(x => Math.exp(-Math.pow(x / te, beta()))), bApp, tauApp };
    });
  }

  /* 2a. Kovacs asymmetry: ±5 K jumps into T = T_g − 10 */
  function asym(model) {
    const T = G.Tg - 10;
    return [+5, -5].map(d => {
      const r = sim(model, T + d, [{ type: 'jump', T }, { type: 'hold', dur: 1e9, n: 100, t1: 1e-2 }]);
      const t = [], y = [];
      for (let i = 2; i < r.Tf.length; i++) { t.push(r.hist.t[i] - r.hist.t[1]); y.push(r.Tf[i] - T); }
      return { from: T + d, T, t, y };
    });
  }
  /* 2b. memory (Kovacs / Macedo–Napolitano crossover): T0 → T1, age until ⟨T_f⟩ = T2, then jump to T2 */
  function memory(model) {
    const T2 = G.Tg - 10, T0 = G.Tg + 10;
    return [10, 20, 30].map(d => {
      const T1 = T2 - d;
      const r1 = sim(model, T0, [{ type: 'jump', T: T1 }, { type: 'hold', dur: 1e12, n: 100, t1: 1e-3 }]);
      let k = -1; for (let i = 2; i < r1.Tf.length; i++) if (r1.Tf[i] <= T2) { k = i; break; }
      if (k < 0) return null;
      const la = Math.log(r1.hist.t[k - 1] - r1.hist.t[1]), lb = Math.log(r1.hist.t[k] - r1.hist.t[1]), fa = r1.Tf[k - 1] - T2, fb = r1.Tf[k] - T2;
      const t1 = Math.exp(la + (lb - la) * fa / (fa - fb));
      const r = sim(model, T0, [{ type: 'jump', T: T1 }, { type: 'hold', dur: t1, n: 100, t1: Math.min(1e-3, t1 / 10) }, { type: 'jump', T: T2 }, { type: 'hold', dur: 1e9, n: 100, t1: 1e-2 }]);
      const j = r.hist.info[2].i0, t = [], y = [];
      for (let i = j + 1; i < r.Tf.length; i++) { t.push(r.hist.t[i] - r.hist.t[j]); y.push(r.Tf[i] - T2); }
      let pk = 0, tp = 0; y.forEach((v, i) => { if (v > pk) { pk = v; tp = t[i]; } });
      return { T1, T2, t1, t, y, Tf2: r.Tf[j - 1], peak: pk, tpeak: tp };
    }).filter(Boolean);
  }

  /* 3. DSC: cool at q_c, heat at 10 K/min; T_f' vs q_c (Moynihan) */
  function dsc(model) {
    const hi = G.Tg + 50, lo = G.Tg - 70, rates = [1, 3, 10, 30, 100];
    const runs = rates.map(q => {
      const r = sim(model, hi, [{ type: 'ramp', T: lo, rate: q, dT: 0.5 }, { type: 'ramp', T: hi, rate: 10, dT: 0.5 }]);
      const cool = ENGINE.cpSeries(r.hist, r, 0), heat = ENGINE.cpSeries(r.hist, r, 1);
      return { q, cool, heat, TfPrime: r.Tf[r.hist.info[0].i1] };
    });
    // Moynihan: d log10|q| / d(1/T_f') = −Δh/(R ln10)
    const xs = runs.map(r => 1 / r.TfPrime), ys = runs.map(r => Math.log10(r.q));
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxy / sxx, dhR = -slope * Math.log(10);
    const Tf10 = runs[2].TfPrime;   // 10 K/min
    return { runs, dhR, mApp: dhR / (Math.log(10) * Tf10) };
  }

  /* 4. enthalpy recovery: cool 10 K/min to T_a, anneal t_a, cool to T_g − 60, heat 10 K/min */
  function recovery(model) {
    const hi = G.Tg + 50, lo = G.Tg - 60, Ta = G.Tg - 20, times = [0, 1e2, 1e3, 1e4, 1e5, 1e6];
    const runs = times.map(ta => {
      const segs = [{ type: 'ramp', T: Ta, rate: 10, dT: 0.5 }];
      if (ta > 0) segs.push({ type: 'hold', dur: ta, n: 100, t1: 1 });
      segs.push({ type: 'ramp', T: lo, rate: 10, dT: 0.5 }, { type: 'ramp', T: hi, rate: 10, dT: 0.5 });
      const r = sim(model, hi, segs), si = segs.length - 1;
      const Tf0 = r.Tf[r.hist.info[0].i1], TfA = ta > 0 ? r.Tf[r.hist.info[1].i1] : Tf0;
      return { ta, heat: ENGINE.cpSeries(r.hist, r, si), dH: Tf0 - TfA };
    });
    // continuous φ(t_a) during the anneal
    const r = sim(model, hi, [{ type: 'ramp', T: Ta, rate: 10, dT: 0.5 }, { type: 'hold', dur: 1e9, n: 100, t1: 1e-1 }]);
    const i0 = r.hist.info[0].i1, Tf0 = r.Tf[i0], t = [], phi = [], dH = [];
    for (let i = i0 + 1; i < r.Tf.length; i++) { t.push(r.hist.t[i] - r.hist.t[i0]); phi.push((r.Tf[i] - Ta) / (Tf0 - Ta)); dH.push(Tf0 - r.Tf[i]); }
    return { Ta, runs, t, phi, dH, dHinf: Tf0 - Ta };
  }

  /* 5. MDSC: underlying 1 K/min, amplitude A, period P; heating (after cooling at 1 K/min) or cooling */
  function mdsc(model, P, dir, A) {
    A = A || 0.5; const hi = G.Tg + 60, lo = G.Tg - 70, ppp = 40, q = 1;
    const segs = dir === 'cool' ? [{ type: 'mdsc', T: lo, rate: q, A, P, ppp }] : [{ type: 'ramp', T: lo, rate: q, dT: 0.5 }, { type: 'mdsc', T: hi, rate: q, A, P, ppp }];
    const T0 = hi, si = segs.length - 1;
    const r = sim(model, T0, segs), seg = segs[si];
    // Windows one modulation period long, slid by STRIDE steps (a tenth of a period) for a fine temperature grid.
    // Each window: least-squares fit of v(t) = p0 + p1·(t − t̄) + C cos ωt + D sin ωt to dT_f/dt and to dT/dt.
    //   total C_p   = ⟨dT_f/dt⟩ / ⟨dT/dt⟩ over the period  (underlying, period-averaged)
    //   complex C_p = (C − iD)[dT_f/dt] / (C − iD)[dT/dt] (ω component; same convention as the Fitter engine,
    //                 incl. the τ-dependent correction for the staircase input, ENGINE.stepCorr)
    const inf = r.hist.info[si], i0 = Math.max(1, inf.i0), n = inf.i1 - i0 + 1, w = 2 * Math.PI / P, STRIDE = Math.max(1, Math.round(ppp / 10));
    const out = [];
    for (let s0 = 0; s0 + ppp <= n; s0 += STRIDE) {
      const tt = [], a = [], b = []; let Tm = 0;
      for (let k = 0; k < ppp; k++) { const i = i0 + s0 + k, dt = r.hist.t[i] - r.hist.t[i - 1]; tt.push((r.hist.t[i] + r.hist.t[i - 1]) / 2 - r.hist.t[i0 - 1]); a.push((r.Tf[i] - r.Tf[i - 1]) / dt); b.push((r.hist.T[i] - r.hist.T[i - 1]) / dt); Tm += (r.hist.T[i] + r.hist.T[i - 1]) / 2; }
      const tc = tt.reduce((x, y) => x + y) / ppp, X = [tt.map(() => 1), tt.map(x => x - tc), tt.map(x => Math.cos(w * x)), tt.map(x => Math.sin(w * x))];
      const fa = ENGINE.lstsq(X, a), fb = ENGINE.lstsq(X, b); if (!fa || !fb) continue;
      const xr = fa.b[2], xi = -fa.b[3], yr = fb.b[2], yi = -fb.b[3], den = yr * yr + yi * yi; if (!(den > 0)) continue;
      let Rr = (xr * yr + xi * yi) / den, Ri = (xi * yr - xr * yi) / den;
      let lt = 0; for (let k = 0; k < ppp; k++) lt += Math.log(r.tau[i0 + s0 + k]);
      const [cr, ci] = ENGINE.stepCorr(w, P / ppp, Math.exp(lt / ppp)); [Rr, Ri] = [Rr * cr - Ri * ci, Rr * ci + Ri * cr];
      out.push({ T: Tm / ppp, total: a.reduce((x, y) => x + y) / b.reduce((x, y) => x + y), re: Rr, im: -Ri });   // total: one-period average
    }
    // Single-window results depend on the phase at which the window starts wherever τ changes appreciably within a period
    // (non-stationary response). As in instrument software, average C′, C″ and the total over one period of window positions.
    const M = Math.round(ppp / STRIDE), sm = k => out.map((o, i) => { let s = 0, c = 0; for (let j = i - (M >> 1); j < i - (M >> 1) + M; j++) if (j >= 0 && j < out.length) { s += out[j][k]; c++; } return s / c; });
    { const R = sm("re"), I = sm("im"), Q = sm("total"); out.forEach((o, i) => { o.re = R[i]; o.im = I[i]; o.total = Q[i]; }); }
    out.sort((u, v) => u.T - v.T);
    const T = out.map(o => o.T), re = out.map(o => o.re), im = out.map(o => o.im), total = out.map(o => o.total), rev = out.map(o => Math.hypot(o.re, o.im));
    return { P, dir, T, re, im, rev, total, nonrev: total.map((v, i) => v - rev[i]) };
  }

  return { G, beta, params, sim, tauEq, anneal, asym, memory, dsc, recovery, mdsc };
})();
if (typeof module !== 'undefined') module.exports = EXP;
