/* ============================================================
   Relaxation Fitter engine
   - thermal-history compiler (ramp / hold / T-jump / MDSC)
   - model wrapper for TL (tl_core.js), TNM and RelaxPy (models_extra.js)
   - observables for DSC, enthalpy, volume, T_f, annealing, MDSC data
   - bounded Nelder–Mead and differential evolution, fit statistics
   Requires globals TL and MODELS.
   ============================================================ */
const ENGINE = (function () {
  const PHSIGN = -1, MDSC_DETREND = true;
  const LN10 = Math.log(10);

  /* ---------------- thermal history ---------------- */
  // seg types:
  //  ramp : {type:'ramp', T, rate (K/min), dT (K)}
  //  hold : {type:'hold', dur (s), n (log-spaced points), t1 (first step, s)}
  //  jump : {type:'jump', T}
  //  mdsc : {type:'mdsc', T (end, underlying), rate (K/min; 0 = quasi-isothermal), dur (s, if rate 0), A (K), P (s), ppp}
  function compile(T0, segs) {
    let T = +T0, t = 0; const Ta = [T], ta = [0], sa = [-1], info = [];
    segs.forEach((s, si) => {
      const i0 = Ta.length, Tstart = T, tstart = t;
      if (s.type === 'ramp') {
        if (!(s.rate > 0)) throw new Error(`Segment ${si + 1}: rate must be > 0`);
        const dist = Math.abs(s.T - T);
        if (dist > 1e-12) {
          const dT = Math.max(1e-4, +s.dT || 0.5), n = Math.max(1, Math.ceil(dist / dT - 1e-9)), step = (s.T - T) / n, dtt = Math.abs(step) / (s.rate / 60);
          for (let k = 1; k <= n; k++) { T = k === n ? s.T : Tstart + step * k; t += dtt; Ta.push(T); ta.push(t); sa.push(si); }
        }
      } else if (s.type === 'jump') {
        if (Math.abs(s.T - T) > 1e-12) { T = s.T; Ta.push(T); ta.push(t); sa.push(si); }
      } else if (s.type === 'hold') {
        if (!(s.dur > 0)) throw new Error(`Segment ${si + 1}: hold duration must be > 0`);
        const n = Math.max(2, Math.round(s.n || 40)), t1 = Math.min(Math.max(1e-6, +s.t1 || 0.1), s.dur);
        let prev = 0;
        for (let k = 0; k < n; k++) {
          const tt = n === 1 ? s.dur : t1 * Math.pow(s.dur / t1, k / (n - 1));
          if (tt <= prev + 1e-12) continue; t = tstart + tt; prev = tt; Ta.push(T); ta.push(t); sa.push(si);
        }
      } else if (s.type === 'mdsc') {
        const P = +s.P, A = +s.A, ppp = Math.max(8, Math.round(s.ppp || 40));
        if (!(P > 0)) throw new Error(`Segment ${si + 1}: period must be > 0`);
        let D;
        if (s.rate > 0) D = Math.abs(s.T - T) / (s.rate / 60); else D = +s.dur;
        if (!(D > 0)) throw new Error(`Segment ${si + 1}: MDSC needs a rate > 0 or a duration`);
        const nP = Math.max(1, Math.round(D / P)); D = nP * P;
        const Tend = s.rate > 0 ? s.T : T, n = nP * ppp;
        for (let k = 1; k <= n; k++) {
          const tt = D * k / n; t = tstart + tt;
          Ta.push(Tstart + (Tend - Tstart) * tt / D + A * Math.sin(2 * Math.PI * tt / P)); ta.push(t); sa.push(si);
        }
        T = Tend;
      } else throw new Error('Unknown segment type ' + s.type);
      info.push({ type: s.type, i0, i1: Ta.length - 1, n: Ta.length - i0, Tstart, Tend: T, tstart, tend: t });
    });
    if (Ta.length > 200000) throw new Error(`History has ${Ta.length.toLocaleString()} steps — too many; increase ΔT or reduce points`);
    return { T: Float64Array.from(Ta), t: Float64Array.from(ta), seg: Int32Array.from(sa), info, T0: +T0 };
  }
  function describeSeg(s, inf) {
    const f = v => (+v).toPrecision(5).replace(/\.?0+$/, '');
    if (s.type === 'ramp') return `${inf && inf.Tend < inf.Tstart ? 'Cool' : 'Heat'} to ${f(s.T)} K @ ${f(s.rate)} K/min`;
    if (s.type === 'hold') return `Hold ${fmtTime(s.dur)}${inf ? ' at ' + f(inf.Tstart) + ' K' : ''}`;
    if (s.type === 'jump') return `Jump to ${f(s.T)} K`;
    if (s.type === 'mdsc') return `MDSC ${s.rate > 0 ? 'to ' + f(s.T) + ' K @ ' + f(s.rate) + ' K/min' : 'quasi-iso ' + fmtTime(s.dur)} ±${f(s.A)} K / ${f(s.P)} s`;
    return s.type;
  }
  function fmtTime(s) { if (s < 120) return (+s).toPrecision(3) + ' s'; if (s < 7200) return (s / 60).toPrecision(3) + ' min'; if (s < 172800) return (s / 3600).toPrecision(3) + ' h'; return (s / 86400).toPrecision(3) + ' d'; }

  /* ---------------- models ---------------- */
  const MODELDEFS = {
    TL: {
      name: 'Takeda–Lucas (TL)',
      params: [
        { k: 'Tg', label: 'T_g', unit: 'K', v: 308.13, lo: 250, hi: 370, free: true, tip: 'temperature where ⟨τ⟩ = 100 s' },
        { k: 'm', label: 'm', unit: '', v: 64.14, lo: 15, hi: 150, free: false, tip: 'fragility index' },
        { k: 'log10tau0', label: 'log₁₀ τ₀', unit: 's', v: -23.41, lo: -45, hi: -8, free: true },
        { k: 'f', label: 'f', unit: '', v: 0.59, lo: 0.10, hi: 0.99, free: true, discrete: 0.01, tip: 'shape of the T_v,i distribution (β-library index)' },
        { k: 'beta0', label: 'β₀', unit: '', v: 1, lo: 0.3, hi: 1, free: false, tip: 'local stretching exponent' },
      ],
      fixed: { N: 200 },
    },
    TNM: {
      name: 'Tool–Narayanaswamy–Moynihan (TNM)',
      params: [
        { k: 'Tg', label: 'T_g', unit: 'K', v: 308.13, lo: 250, hi: 370, free: true, tip: 'τ(T_g) = 100 s' },
        { k: 'm', label: 'm', unit: '', v: 64.14, lo: 15, hi: 150, free: true, tip: 'Δh/R = m ln10 T_g' },
        { k: 'x', label: 'x', unit: '', v: 0.5, lo: 0.05, hi: 1, free: true, tip: 'nonlinearity' },
        { k: 'beta', label: 'β', unit: '', v: 0.55, lo: 0.15, hi: 1, free: true, tip: 'KWW stretching' },
      ],
      fixed: { kernel: 'prony' },
    },
    RP: {
      name: 'RelaxPy (MAP viscosity)',
      params: [
        { k: 'Tg', label: 'T_g', unit: 'K', v: 308.13, lo: 250, hi: 370, free: true, tip: 'η(T_g) = 10¹² Pa·s' },
        { k: 'm', label: 'm', unit: '', v: 64.14, lo: 15, hi: 150, free: true },
        { k: 'B', label: 'B', unit: 'K', v: 9880.3, lo: 0, hi: 200000, free: true, tip: 'ΔH/(k ln10)' },
        { k: 'C', label: 'C', unit: '', v: 0, lo: 0, hi: 3000, free: false, tip: 'S∞/(k ln10)' },
        { k: 'pexp', label: 'p', unit: '', v: 19.77, lo: 0.1, hi: 300, free: true, tip: 'ergodicity exponent' },
        { k: 'A', label: 'A', unit: '', v: 1.2, lo: -200, hi: 300, free: false, tip: 'set by continuity at T_g unless freed' },
        { k: 'eta_inf', label: 'log₁₀ η∞', unit: 'Pa·s', v: -2.9, lo: -8, hi: 2, free: false },
        { k: 'log10Ks', label: 'log₁₀ K_s', unit: 'Pa', v: 10.544068, lo: 6, hi: 14, free: false },
        { k: 'beta', label: 'β (Prony)', unit: '', v: 0.43, lo: 0.1, hi: 1, free: false },
      ],
      fixed: { Aauto: true, pauto: false },
    },
  };
  // p: plain object of parameter values (+ fixed keys)
  function simulate(model, p, hist, opts) {
    opts = opts || {};
    if (model === 'TL') {
      const q = { Tg: p.Tg, m: p.m, log10tau0: p.log10tau0, f: Math.round(p.f * 100) / 100, beta0: p.beta0, N: p.N || 200 };
      const d = TL.derived(q); if (!(d.D > 0) || !(d.Tv > 0)) throw new Error('TL: parameters give D ≤ 0 or T_v ≤ 0');
      const r = TL.run(q, hist.T, hist.t, { keepTfi: !!opts.keepTfi });
      return { Tf: r.Tf, tau: r.tau, tauEq: r.tauEq, sigTf: r.sigTf, raw: r };
    }
    if (model === 'TNM') {
      const r = MODELS.runTNM({ Tg: p.Tg, m: p.m, x: p.x, beta: p.beta, kernel: opts.exact ? 'exact' : 'prony' }, hist.T, hist.t);
      return { Tf: r.Tf, tau: r.tau, tauEq: r.tauEq };
    }
    if (model === 'RP') {
      const q = { Tg: p.Tg, m: p.m, eta_inf: p.eta_inf, log10Ks: p.log10Ks, A: p.A, B: p.B, C: p.C, pexp: p.pexp, betaName: 'custom', beta: p.beta };
      if (p.Aauto) q.A = MODELS.continuityA(q);
      if (p.pauto) q.pexp = 0.3082153 * q.m;
      const r = MODELS.runRelaxPy(q, hist.T, hist.t);
      return { Tf: r.Tf, tau: r.tau, tauEq: r.tauEq, logEta: r.logEta, A: q.A, pexp: q.pexp };
    }
    throw new Error('unknown model');
  }

  /* ---------------- data kinds ---------------- */
  const KINDS = {
    cp_norm: { label: 'DSC — normalized C_p (dT_f/dT) vs T', axis: 'T', segs: ['ramp'], ylab: 'C_p,norm', scaleOpt: true },
    cp_raw:  { label: 'DSC — C_p or heat flow vs T (glass/liquid baselines fitted)', axis: 'T', segs: ['ramp'], ylab: 'C_p or HF' },
    H_T:     { label: 'Enthalpy vs T (H = a + b·T + ΔC_p·T_f fitted)', axis: 'T', segs: ['ramp', 'mdsc'], ylab: 'H' },
    V_T:     { label: 'Volume / density / length vs T (dilatometry)', axis: 'T', segs: ['ramp', 'mdsc'], ylab: 'V' },
    tf_T:    { label: 'Fictive temperature T_f vs T', axis: 'T', segs: ['ramp', 'mdsc'], ylab: 'T_f (K)' },
    relax_t: { label: 'Annealing — normalized relaxation φ(t) = (T_f − T)/(T_f,0 − T)', axis: 't', segs: ['hold'], ylab: 'φ', scaleOpt: true },
    tf_t:    { label: 'Annealing — T_f(t)', axis: 't', segs: ['hold'], ylab: 'T_f (K)' },
    P_t:     { label: 'Annealing — enthalpy / volume / refractive index vs t (a + b·T_f fitted)', axis: 't', segs: ['hold'], ylab: 'property' },
    mdsc_re: { label: "MDSC — C_p′ (reversing), normalized", axis: 'T', segs: ['mdsc'], ylab: "C_p′", scaleOpt: true },
    mdsc_im: { label: 'MDSC — C_p″, normalized', axis: 'T', segs: ['mdsc'], ylab: 'C_p″', scaleOpt: true },
  };

  // model series on a segment: {x, y, T, Tf} ; x = T (mid for cp) or t since segment start
  function segRange(hist, si) { const inf = hist.info[si]; if (!inf || inf.n < 1) return null; return [Math.max(1, inf.i0), inf.i1]; }
  function cpSeries(hist, sim, si) {
    const r = segRange(hist, si); if (!r) return { x: [], y: [] }; const { T } = hist, Tf = sim.Tf, pts = [];
    for (let i = r[0]; i <= r[1]; i++) { const d = T[i] - T[i - 1]; if (Math.abs(d) < 1e-12) continue; pts.push([(T[i] + T[i - 1]) / 2, (Tf[i] - Tf[i - 1]) / d]); }
    pts.sort((a, b) => a[0] - b[0]); return { x: pts.map(p => p[0]), y: pts.map(p => p[1]) };
  }
  function tSeries(hist, sim, si) { // along T (ramp): T and Tf, include the step before the segment
    const r = segRange(hist, si); if (!r) return { x: [], y: [] }; const pts = [];
    for (let i = r[0] - 1; i <= r[1]; i++) pts.push([hist.T[i], sim.Tf[i]]);
    pts.sort((a, b) => a[0] - b[0]); return { x: pts.map(p => p[0]), y: pts.map(p => p[1]) };
  }
  function holdSeries(hist, sim, si) {
    const r = segRange(hist, si); if (!r) return { x: [], y: [], Th: NaN, Tf0: NaN }; const i0 = r[0] - 1;
    const x = [0], y = [sim.Tf[i0]];
    for (let i = r[0]; i <= r[1]; i++) { x.push(hist.t[i] - hist.t[i0]); y.push(sim.Tf[i]); }
    return { x, y, Th: hist.T[r[1]], Tf0: sim.Tf[i0] };
  }
  // MDSC: complex normalized C_p per period window (Fourier ratio of dT_f/dt and dT/dt at ω)
  // H_true/H_disc for a Debye element (time constant τ) driven by a staircase with step h and integrated exactly per step:
  // H_disc = (1 − a)/(1 − a e^{−iωh}), a = e^{−h/τ}; H_true = 1/(1 + iωτ). Limits: e^{−iωh/2} for τ ≫ h, 1 for τ ≪ h.
  function stepCorr(w, h, tau) {
    if (!(tau > 0) || !isFinite(tau)) return [Math.cos(PHSIGN * w * h / 2), Math.sin(PHSIGN * w * h / 2)];
    const eps = -Math.expm1(-h / tau), a = 1 - eps, th = w * h, sh = Math.sin(th / 2);
    const nr = eps + 2 * a * sh * sh, ni = a * Math.sin(th), dr = eps, di = eps * w * tau, dd = dr * dr + di * di;
    return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
  }
  function mdscSeries(hist, sim, si, seg) {
    const r = segRange(hist, si); if (!r) return { T: [], re: [], im: [] };
    const ppp = Math.max(8, Math.round(seg.ppp || 40)), P = +seg.P, w = 2 * Math.PI / P;
    const out = { T: [], re: [], im: [] }, i0 = r[0], n = r[1] - r[0] + 1, stride = Math.max(1, Math.round(ppp / 4));
    const t0 = hist.t[i0 - 1];
    for (let s = 0; s + ppp <= n; s += stride) {
      // one modulation period: remove the linear (underlying) trend of dT_f/dt and dT/dt, then take the ω component
      const a = new Float64Array(ppp), b = new Float64Array(ppp), tt = new Float64Array(ppp); let Tsum = 0;
      for (let k = 0; k < ppp; k++) { const i = i0 + s + k, dt = hist.t[i] - hist.t[i - 1]; tt[k] = (hist.t[i] + hist.t[i - 1]) / 2 - t0; a[k] = (sim.Tf[i] - sim.Tf[i - 1]) / dt; b[k] = (hist.T[i] - hist.T[i - 1]) / dt; Tsum += (hist.T[i] + hist.T[i - 1]) / 2; }
      // least-squares fit of v(t) = p0 + p1·t + C·cos ωt + D·sin ωt removes the underlying trend without leaking into the ω component
      const harm = v => { const X = [tt.map(() => 1), Array.from(tt), tt.map(x => Math.cos(w * x)), tt.map(x => Math.sin(w * x))]; const r = lstsq(X, Array.from(v)); return r ? [r.b[2], r.b[3]] : [0, 0]; };
      const [Ca, Da] = MDSC_DETREND ? harm(a) : [0, 0], [Cb, Db] = MDSC_DETREND ? harm(b) : [0, 0];
      let xr = 0, xi = 0, yr = 0, yi = 0;
      if (MDSC_DETREND) { xr = Ca; xi = -Da; yr = Cb; yi = -Db; }
      else for (let k = 0; k < ppp; k++) { const c = Math.cos(w * tt[k]), sn = Math.sin(w * tt[k]); xr += a[k] * c; xi -= a[k] * sn; yr += b[k] * c; yi -= b[k] * sn; }
      const den = yr * yr + yi * yi; if (!(den > 0)) continue;
      let Rr = (xr * yr + xi * yi) / den, Ri = (xi * yr - xr * yi) / den;
      // the simulated input is a staircase and each step is integrated exactly, which adds a lag that depends on τ/Δt:
      // Δt/2 when τ ≫ Δt, none when τ ≪ Δt (liquid). Remove it with the exact Debye factor at the window's mean ln τ.
      let lt = 0; for (let k = 0; k < ppp; k++) lt += Math.log(sim.tau[i0 + s + k]);
      const [cr, ci] = stepCorr(w, P / ppp, Math.exp(lt / ppp)); [Rr, Ri] = [Rr * cr - Ri * ci, Rr * ci + Ri * cr];
      out.T.push(Tsum / ppp); out.re.push(Rr); out.im.push(-Ri);
    }
    const ord = out.T.map((v, i) => i).sort((a, b) => out.T[a] - out.T[b]);
    return { T: ord.map(i => out.T[i]), re: ord.map(i => out.re[i]), im: ord.map(i => out.im[i]) };
  }
  function interp(xs, ys, x) {
    let lo = 0, hi = xs.length - 1; if (hi < 1 || !(x >= xs[0] && x <= xs[hi])) return NaN;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const d = xs[hi] - xs[lo]; return d > 0 ? ys[lo] + (x - xs[lo]) / d * (ys[hi] - ys[lo]) : ys[lo];
  }
  // small linear least squares y ≈ X b (columns with ~zero variance other than intercept are dropped)
  function lstsq(cols, y, names) {
    const n = y.length; const keep = [];
    cols.forEach((c, j) => { if (j === 0) { keep.push(j); return; } let mu = 0; for (const v of c) mu += v; mu /= n; let s = 0; for (const v of c) s += (v - mu) ** 2; if (s / n > 1e-18 * (1 + mu * mu)) keep.push(j); });
    const X = keep.map(j => cols[j]), p = X.length, M = Array.from({ length: p }, () => new Float64Array(p + 1));
    for (let a = 0; a < p; a++) { for (let b = 0; b < p; b++) { let s = 0; for (let i = 0; i < n; i++) s += X[a][i] * X[b][i]; M[a][b] = s; } let s = 0; for (let i = 0; i < n; i++) s += X[a][i] * y[i]; M[a][p] = s; }
    for (let a = 0; a < p; a++) M[a][a] *= 1 + 1e-12;
    for (let c = 0; c < p; c++) { let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c]; if (Math.abs(d) < 1e-300) return null; for (let k = c; k <= p; k++) M[c][k] /= d; for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; } }
    const b = new Array(cols.length).fill(0); keep.forEach((j, a) => b[j] = M[a][p]);
    const yhat = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < cols.length; j++) s += b[j] * cols[j][i]; yhat[i] = s; }
    return { b, yhat, names };
  }

  // prediction for one dataset. ds: {kind, seg, x[], y[], scale:bool, xmin, xmax}
  function predict(ds, hist, sim, segs) {
    const K = KINDS[ds.kind], si = ds.seg, inf = hist.info[si];
    const out = { yhat: new Float64Array(ds.x.length).fill(NaN), curve: { x: [], y: [] }, lin: null, nOut: 0, err: null };
    if (!inf) { out.err = 'linked segment missing'; return out; }
    if (!K.segs.includes(inf.type)) { out.err = `a ${ds.kind} dataset needs a ${K.segs.join('/')} segment`; return out; }
    const X = ds.x, n = X.length;
    let base = null, curve = null, extra = null;
    if (ds.kind === 'cp_norm' || ds.kind === 'cp_raw') { const s = cpSeries(hist, sim, si); curve = s; base = X.map(x => interp(s.x, s.y, x)); }
    else if (ds.kind === 'tf_T' || ds.kind === 'H_T' || ds.kind === 'V_T') { const s = tSeries(hist, sim, si); curve = s; base = X.map(x => interp(s.x, s.y, x)); }
    else if (ds.kind === 'relax_t' || ds.kind === 'tf_t' || ds.kind === 'P_t') {
      const s = holdSeries(hist, sim, si);
      if (ds.kind === 'relax_t') { const den = s.Tf0 - s.Th; const y = s.y.map(v => Math.abs(den) > 1e-9 ? (v - s.Th) / den : NaN); curve = { x: s.x, y }; }
      else curve = { x: s.x, y: s.y };
      base = X.map(x => interp(curve.x, curve.y, x)); extra = s;
    }
    else if (ds.kind === 'mdsc_re' || ds.kind === 'mdsc_im') { const s = mdscSeries(hist, sim, si, segs[si]); curve = { x: s.T, y: ds.kind === 'mdsc_re' ? s.re : s.im }; base = X.map(x => interp(curve.x, curve.y, x)); }
    // valid points
    const idx = []; for (let i = 0; i < n; i++) if (isFinite(base[i])) idx.push(i); out.nOut = n - idx.length;
    if (idx.length < 2) { out.curve = curve; return out; }
    const yv = idx.map(i => ds.y[i]);
    let fitVals = null, lin = null, curveY = curve.y.slice();
    const colsFor = (xs, bs) => {
      if (ds.kind === 'cp_raw') return [xs.map(() => 1), xs, bs, xs.map((x, i) => x * bs[i])];
      if (ds.kind === 'H_T' || ds.kind === 'V_T') return [xs.map(() => 1), xs, bs];
      if (ds.kind === 'P_t') return [xs.map(() => 1), bs];
      if (K.scaleOpt && ds.scale) return [xs.map(() => 1), bs];
      return null;
    };
    const xsv = idx.map(i => X[i]), bsv = idx.map(i => base[i]);
    // for H_T / V_T the T column is the temperature itself (x)
    const cols = colsFor(xsv, bsv);
    if (cols) {
      const names = ds.kind === 'cp_raw' ? ['a', 'b·T', 'c·C_p', 'd·T·C_p'] : (ds.kind === 'H_T' || ds.kind === 'V_T') ? ['a', 'b·T', 'c·T_f'] : ['offset', 'scale'];
      lin = lstsq(cols, yv, names);
      if (!lin) { out.err = 'linear scaling failed'; out.curve = curve; return out; }
      fitVals = lin.yhat;
      const cc = colsFor(curve.x, curve.y); curveY = curve.y.map((v, i) => { let s = 0; for (let j = 0; j < cc.length; j++) s += lin.b[j] * cc[j][i]; return s; });
    } else fitVals = bsv;
    idx.forEach((i, k) => out.yhat[i] = fitVals[k]);
    out.curve = { x: curve.x, y: curveY }; out.lin = lin; out.extra = extra;
    return out;
  }

  /* ---------------- objective & statistics ---------------- */
  // datasets: [{..., weight, enabled}] ; returns {res: Float64Array (weighted), sse, perDs:[...]}
  function evaluate(model, p, hist, segs, datasets, opts) {
    opts = opts || {};
    const sim = simulate(model, p, hist, opts);
    const res = [], perDs = [];
    for (const ds of datasets) {
      if (!ds.enabled) { perDs.push(null); continue; }
      const pr = predict(ds, hist, sim, segs);
      const n = ds.x.length, sd = ds._sd || 1, w = Math.sqrt((ds.weight || 1) / (opts.perPoint ? 1 : Math.max(1, n))) / sd;
      let ss = 0, st = 0, nv = 0, mu = 0; for (let i = 0; i < n; i++) mu += ds.y[i]; mu /= n;
      for (let i = 0; i < n; i++) {
        const yh = pr.yhat[i];
        if (isFinite(yh)) { const e = ds.y[i] - yh; res.push(e * w); ss += e * e; nv++; } else res.push(opts.outPenalty !== undefined ? opts.outPenalty * w * sd : 2 * w * sd);
        st += (ds.y[i] - mu) ** 2;
      }
      perDs.push({ pr, n, nValid: nv, sse: ss, rmse: Math.sqrt(ss / Math.max(1, nv)), R2: 1 - ss / st, nLin: pr.lin ? pr.lin.b.filter(v => v !== 0).length : 0 });
    }
    let sse = 0; for (const r of res) sse += r * r;
    return { sim, res: Float64Array.from(res), sse, perDs };
  }
  function dsPrepare(ds) { let mu = 0; for (const v of ds.y) mu += v; mu /= ds.y.length; let s = 0; for (const v of ds.y) s += (v - mu) ** 2; ds._sd = Math.sqrt(s / Math.max(1, ds.y.length - 1)) || 1; }

  /* ---------------- optimisation ---------------- */
  // free: [{k, lo, hi, discrete}] ; base: full param object
  const sig = u => 1 / (1 + Math.exp(-u)), logit = x => Math.log(x / (1 - x));
  function toU(free, p) { return free.map(q => { const z = Math.min(1 - 1e-9, Math.max(1e-9, (p[q.k] - q.lo) / (q.hi - q.lo))); return logit(z); }); }
  function fromU(free, base, u) { const p = { ...base }; free.forEach((q, i) => { let v = q.lo + (q.hi - q.lo) * sig(u[i]); if (q.discrete) v = Math.round(v / q.discrete) * q.discrete; p[q.k] = v; }); return p; }

  function* nelderMead(f, x0, step, maxEval, tol) {
    const n = x0.length; let S = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; S.push(x); }
    let F = []; for (const x of S) { F.push(f(x)); yield Math.min(...F); }
    let nev = n + 1;
    while (nev < maxEval) {
      const ord = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = ord.map(i => S[i]); F = ord.map(i => F[i]);
      let size = 0; for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) size = Math.max(size, Math.abs(S[i][j] - S[0][j]));
      if (size < tol || Math.abs(F[n] - F[0]) <= 1e-12 * (1 + Math.abs(F[0]))) break;
      const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
      const pt = a => c.map((v, j) => v + a * (S[n][j] - v));
      const xr = pt(-1), fr = f(xr); nev++; yield Math.min(F[0], fr);
      if (fr < F[0]) { const xe = pt(-2), fe = f(xe); nev++; yield Math.min(F[0], fe); if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; } }
      else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
      else {
        const xc = fr < F[n] ? pt(-0.5) : pt(0.5), fc = f(xc); nev++; yield Math.min(F[0], fc);
        if (fc < Math.min(fr, F[n])) { S[n] = xc; F[n] = fc; }
        else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); nev++; yield F[0]; }
      }
    }
    const b = F.indexOf(Math.min(...F)); return { x: S[b], fx: F[b], nev };
  }
// Levenberg–Marquardt on the weighted residual vector, in the bounded (logit) coordinates
  function ssqInit(v) { let s = 0; for (const x of v) s += x * x; return s; }
  function* levenbergMarquardt(resFn, u0, maxEval) {
    let u = u0.slice(), r = resFn(u), nev = 1; yield ssqInit(r);
    const ssq = v => { let s = 0; for (const x of v) s += x * x; return s; };
    let S = ssq(r), lam = 1e-2; const k = u.length;
    for (let it = 0; it < 200 && nev < maxEval; it++) {
      const J = []; for (let j = 0; j < k; j++) { const h = 1e-3, uu = u.slice(); uu[j] += h; const rj = resFn(uu); nev++; yield S; const col = new Float64Array(r.length); for (let i = 0; i < r.length; i++) col[i] = (rj[i] - r[i]) / h; J.push(col); }
      const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => { let s = 0; for (let i = 0; i < r.length; i++) s += J[a][i] * J[b][i]; return s; }));
      const g = Array.from({ length: k }, (_, a) => { let s = 0; for (let i = 0; i < r.length; i++) s += J[a][i] * r[i]; return s; });
      let accepted = false;
      for (let tries = 0; tries < 10 && nev < maxEval; tries++) {
        const M = A.map((row, a) => row.map((v, b) => a === b ? v * (1 + lam) + 1e-12 : v)), inv = invert(M);
        if (!inv) { lam *= 10; continue; }
        const d = inv.map(row => -row.reduce((s, v, b) => s + v * g[b], 0));
        const un = u.map((v, j) => Math.max(-14, Math.min(14, v + d[j]))), rn = resFn(un); nev++; const Sn = ssq(rn); yield Math.min(S, Sn);
        if (Sn < S) { const rel = (S - Sn) / Math.max(S, 1e-300); u = un; r = rn; S = Sn; lam = Math.max(1e-9, lam / 4); accepted = true;
          if (rel < 1e-10 || Math.max(...d.map(Math.abs)) < 1e-8) return { x: u, fx: S, nev };
          break; }
        lam *= 5;
      }
      if (!accepted) break;
    }
    return { x: u, fx: S, nev };
  }
  function* diffEvolution(f, d, pop, gens, rng) {
    const P = [], F = []; let fb = Infinity; for (let i = 0; i < pop; i++) { const x = Array.from({ length: d }, () => logit(0.02 + 0.96 * rng())); P.push(x); F.push(f(x)); fb = Math.min(fb, F[i]); yield fb; }
    for (let g = 0; g < gens; g++) {
      for (let i = 0; i < pop; i++) {
        let a, b, c; do a = Math.floor(rng() * pop); while (a === i); do b = Math.floor(rng() * pop); while (b === i || b === a); do c = Math.floor(rng() * pop); while (c === i || c === a || c === b);
        const jr = Math.floor(rng() * d), Fm = 0.5 + 0.4 * rng(), y = P[i].slice();
        for (let j = 0; j < d; j++) if (rng() < 0.9 || j === jr) y[j] = P[a][j] + Fm * (P[b][j] - P[c][j]);
        for (let j = 0; j < d; j++) y[j] = Math.max(-12, Math.min(12, y[j]));
        const fy = f(y); if (fy <= F[i]) { P[i] = y; F[i] = fy; } fb = Math.min(fb, fy); yield fb;
      }
    }
    const ord = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); return { x: P[ord[0]], fx: F[ord[0]], P: ord.map(i => P[i]), F: ord.map(i => F[i]) };
  }
  function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Jacobian-based standard errors for continuous free parameters (natural units)
  function uncertainty(model, pBest, free, hist, segs, datasets, opts) {
    const cont = free.filter(q => !q.discrete); if (!cont.length) return null;
    const e0 = evaluate(model, pBest, hist, segs, datasets, opts), r0 = e0.res, m = r0.length, k = cont.length;
    const J = cont.map(q => {
      const h = Math.max(1e-6 * Math.abs(pBest[q.k]), 1e-4 * (q.hi - q.lo));
      const pp = { ...pBest, [q.k]: pBest[q.k] + h }, pm = { ...pBest, [q.k]: pBest[q.k] - h };
      let rp, rm; try { rp = evaluate(model, pp, hist, segs, datasets, opts).res; rm = evaluate(model, pm, hist, segs, datasets, opts).res; } catch (e) { return null; }
      const col = new Float64Array(m); for (let i = 0; i < m; i++) col[i] = (rp[i] - rm[i]) / (2 * h); return col;
    });
    if (J.some(c => !c)) return null;
    const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * J[b][i]; return s; }));
    const inv = invert(A); if (!inv) return { singular: true, names: cont.map(q => q.k) };
    const nData = datasets.filter(d => d.enabled).reduce((s, d) => s + d.x.length, 0);
    const s2 = e0.sse / Math.max(1, m - free.length);
    const se = cont.map((q, a) => Math.sqrt(Math.max(0, inv[a][a] * s2)));
    const corr = cont.map((qa, a) => cont.map((qb, b) => inv[a][b] / Math.sqrt(Math.abs(inv[a][a] * inv[b][b]))));
    return { names: cont.map(q => q.k), se, corr, s2, nData };
  }
  function invert(A) {
    const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; if (Math.abs(d) < 1e-300) return null; for (let k = 0; k < 2 * n; k++) M[c][k] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; } }
    return M.map(r => r.slice(n));
  }

  /* ---------------- fit orchestration ---------------- */
  // opts: {method:'local'|'global', maxEval, seed, restarts}
  function* fit(model, base, free, hist, segs, datasets, opts) {
    opts = opts || {}; const maxEval = opts.maxEval || 1500; let nev = 0; const trace = [];
    datasets.forEach(dsPrepare);
    let nRes = null;
    const resid = (p) => { nev++; try { const e = evaluate(model, p, hist, segs, datasets, { perPoint: opts.perPoint, exact: false }); nRes = e.res.length; if (isFinite(e.sse)) return e.res; } catch (err) {} return new Float64Array(nRes || 1).fill(1e10); };
    const cost = (p) => { const r = resid(p); let s = 0; for (const v of r) s += v * v; return s; };
    let best = { ...base }, fbest = cost(best); trace.push([nev, fbest]); yield { nev, fbest, phase: 'start', best };
    const cont = free.filter(q => !q.discrete), disc = free.filter(q => q.discrete);
    if (opts.method === 'global' && free.length) {
      const rng = mulberry(opts.seed || 12345), d = free.length, pop = Math.max(15, 8 * d), gens = Math.max(8, Math.floor((maxEval * 0.5) / pop) - 1);
      const g = diffEvolution(u => cost(fromU(free, best, u)), d, pop, gens, rng); let s;
      while (!(s = g.next()).done) { const cur = Math.min(fbest, s.value); if (nev % 5 === 0) { trace.push([nev, cur]); yield { nev, fbest: cur, phase: 'global search (differential evolution)', best }; } }
      trace.push([nev, Math.min(fbest, s.value.fx)]);
      // polish the best few distinct members of the final population with Nelder–Mead
      const starts = []; for (let i = 0; i < s.value.P.length && starts.length < 4; i++) { const x = s.value.P[i]; if (starts.every(y => y.some((v, j) => Math.abs(v - x[j]) > 0.3))) starts.push(x); }
      const perStart = Math.max(60, Math.floor((maxEval - nev) * 0.6 / Math.max(1, starts.length)));
      for (let si = 0; si < starts.length; si++) {
        const p0 = fromU(free, best, starts[si]);
        if (cont.length) { const gn = levenbergMarquardt(u => resid(fromU(cont, p0, u)), toU(cont, p0), perStart); let r;
          while (!(r = gn.next()).done) { const cur = Math.min(fbest, r.value); if (nev % 3 === 0) { trace.push([nev, cur]); yield { nev, fbest: cur, phase: `polishing candidate ${si + 1}/${starts.length}`, best }; } }
          const pp = fromU(cont, p0, r.value.x); if (r.value.fx < fbest) { fbest = r.value.fx; best = pp; } }
        else { const c = cost(p0); if (c < fbest) { fbest = c; best = p0; } }
        trace.push([nev, fbest]);
      }
      yield { nev, fbest, phase: 'global search done', best };
    }
    for (let round = 0; round < 4 && nev < maxEval; round++) {
      const f0 = fbest;
      if (cont.length) {
        const budget = Math.max(50, maxEval - nev);
        const g = opts.optimizer === 'nm' ? nelderMead(u => cost(fromU(cont, best, u)), toU(cont, best), 0.6, Math.min(budget, 800), 1e-5) : levenbergMarquardt(u => resid(fromU(cont, best, u)), toU(cont, best), budget); let s;
        while (!(s = g.next()).done) { const cur = Math.min(fbest, s.value); if (nev % 2 === 0) { trace.push([nev, cur]); yield { nev, fbest: cur, phase: `local search (round ${round + 1})`, best }; } }
        if (s.value.fx <= fbest) { fbest = s.value.fx; best = fromU(cont, best, s.value.x); } trace.push([nev, fbest]);
      }
      for (const q of disc) { // coordinate search on the grid
        let improved = true;
        while (improved && nev < maxEval) {
          improved = false;
          for (const dstep of [1, -1, 2, -2, 5, -5]) { const v = Math.round((best[q.k] + dstep * q.discrete) / q.discrete) * q.discrete; if (v < q.lo - 1e-12 || v > q.hi + 1e-12) continue;
            const c = cost({ ...best, [q.k]: v }); yield { nev, fbest, phase: `grid search on ${q.k}`, best }; if (c < fbest - 1e-14) { fbest = c; best = { ...best, [q.k]: v }; improved = true; break; } }
        }
        trace.push([nev, fbest]);
      }
      if (!(fbest < f0 * (1 - 1e-6))) break;
    }
    return { best, fbest, nev, trace };
  }

  return { fit, compile, describeSeg, fmtTime, MODELDEFS, simulate, KINDS, cpSeries, tSeries, holdSeries, mdscSeries, stepCorr, predict, evaluate, dsPrepare, toU, fromU, nelderMead, diffEvolution, mulberry, uncertainty, interp, lstsq };
})();
if (typeof module !== 'undefined') module.exports = ENGINE;
