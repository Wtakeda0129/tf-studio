/* ============================================================
   Tf Studio · Data Analysis — numerical core (no DOM)
   - parse pasted / uploaded tables
   - DSC heat flow: linear glass and liquid baselines → normalized C_p^N = (HF − HF_g)/(HF_l − HF_g),
     fictive temperature T_f(T) by integration (Moynihan area matching), limiting T_f′
   - enthalpy recovery: aged heating scan aligned to the unaged reference, ΔHF(T), ΔH = ∫ΔHF dT / q
   - KWW fits of φ(t) and of property relaxation V(t) = V∞ + (V₀ − V∞)·exp[−(t/τ)^β]
   ============================================================ */
const AN = (function () {
  /* ---------- tables ---------- */
  function parseTable(text) {
    const rows = [], lines = String(text || "").split(/\r?\n/);
    let names = null;
    for (const raw of lines) {
      const line = raw.trim(); if (!line) continue;
      // delimiters: comma, semicolon or tab when present (headers may contain spaces), otherwise whitespace
      const tok = (/[,;\t]/.test(line) ? line.split(/\s*[,;\t]\s*/) : line.split(/\s+/)).map(s => s.trim()).filter(s => s !== "");
      const num = tok.map(s => Number(s.replace(/^"|"$/g, "")));
      const nNum = num.filter(v => isFinite(v)).length;
      if (nNum >= 2 && nNum >= tok.length - 1) rows.push(num);
      else if (!rows.length && tok.length >= 2) names = tok.map(s => s.replace(/^"|"$/g, ""));
    }
    const nc = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const cols = Array.from({ length: nc }, (_, j) => rows.map(r => (j < r.length ? r[j] : NaN)));
    const nm = Array.from({ length: nc }, (_, j) => (names && names[j]) || `column ${j + 1}`);
    return { cols, names: nm, n: rows.length };
  }

  /* ---------- small numerics ---------- */
  function linfit(x, y) {   // y = a + b x
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < x.length; i++) { const X = x[i], Y = y[i]; if (!isFinite(X) || !isFinite(Y)) continue; n++; sx += X; sy += Y; sxx += X * X; sxy += X * Y; }
    if (n < 2) return null; const d = n * sxx - sx * sx; if (!(Math.abs(d) > 0)) return { a: sy / n, b: 0, n };
    const b = (n * sxy - sx * sy) / d; return { a: (sy - b * sx) / n, b, n };
  }
  function interp(xs, ys, x) {   // xs ascending
    const n = xs.length; if (n < 2 || !(x >= xs[0] && x <= xs[n - 1])) return NaN;
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const d = xs[hi] - xs[lo]; return d > 0 ? ys[lo] + (x - xs[lo]) / d * (ys[hi] - ys[lo]) : ys[lo];
  }
  function trapz(x, y, a, b) {   // ∫_a^b y dx over ascending x (linear interpolation at the ends)
    if (!(b > a)) return 0; let s = 0;
    const pts = [[a, interp(x, y, a)]];
    for (let i = 0; i < x.length; i++) if (x[i] > a && x[i] < b) pts.push([x[i], y[i]]);
    pts.push([b, interp(x, y, b)]);
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (isFinite(y0) && isFinite(y1)) s += (x1 - x0) * (y0 + y1) / 2; }
    return s;
  }
  function sortByX(x, y) { const idx = x.map((_, i) => i).filter(i => isFinite(x[i]) && isFinite(y[i])).sort((a, b) => x[a] - x[b]); return { x: idx.map(i => x[i]), y: idx.map(i => y[i]) }; }
  function inRange(x, r) { return x >= Math.min(r[0], r[1]) && x <= Math.max(r[0], r[1]); }
  function nelderMead(f, x0, step, iters) {
    const n = x0.length; let P = [x0.slice()]; for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step[i]; P.push(p); }
    let F = P.map(f);
    for (let it = 0; it < (iters || 400); it++) {
      const o = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); P = o.map(i => P[i]); F = o.map(i => F[i]);
      if (Math.abs(F[n] - F[0]) < 1e-14 * (1 + Math.abs(F[0]))) break;
      const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += P[i][j] / n;
      const xr = c.map((v, j) => v + (v - P[n][j])), fr = f(xr);
      if (fr < F[0]) { const xe = c.map((v, j) => v + 2 * (v - P[n][j])), fe = f(xe); if (fe < fr) { P[n] = xe; F[n] = fe; } else { P[n] = xr; F[n] = fr; } }
      else if (fr < F[n - 1]) { P[n] = xr; F[n] = fr; }
      else { const xc = c.map((v, j) => v + 0.5 * (P[n][j] - v)), fc = f(xc);
        if (fc < F[n]) { P[n] = xc; F[n] = fc; } else { for (let i = 1; i <= n; i++) { P[i] = P[i].map((v, j) => P[0][j] + 0.5 * (v - P[0][j])); F[i] = f(P[i]); } } }
    }
    const o = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); return { x: P[o[0]], f: F[o[0]] };
  }
  const gammaFn = z => { // Lanczos
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  };

  /* ---------- DSC normalization ---------- */
  // run: {T[], HF[]} (any order); r: {g:[T1,T2], l:[T3,T4]} in K. Returns sorted arrays and derived quantities.
  function defaultRanges(T) {
    const lo = Math.min(...T), hi = Math.max(...T), s = hi - lo;
    return { g: [lo + 0.05 * s, lo + 0.25 * s], l: [hi - 0.2 * s, hi - 0.03 * s] };
  }
  function normalize(run, r) {
    const { x: T, y: HF } = sortByX(run.T, run.HF);
    const gx = [], gy = [], lx = [], ly = [];
    T.forEach((t, i) => { if (inRange(t, r.g)) { gx.push(t); gy.push(HF[i]); } if (inRange(t, r.l)) { lx.push(t); ly.push(HF[i]); } });
    const fg = linfit(gx, gy), fl = linfit(lx, ly);
    if (!fg || !fl) return { ok: false, msg: "Each range needs at least two data points.", T, HF };
    const g = t => fg.a + fg.b * t, l = t => fl.a + fl.b * t;
    const cpN = T.map((t, i) => (HF[i] - g(t)) / (l(t) - g(t)));
    // T_f(T) = T* − ∫_T^{T*} C_p^N dT', with T* at the start of the liquid range (T_f = T above it)
    const Ts = Math.min(r.l[0], r.l[1]), Tf = new Array(T.length);
    let acc = 0, k = T.findIndex(t => t >= Ts); if (k < 0) k = T.length - 1;
    for (let i = T.length - 1; i >= 0; i--) {
      if (T[i] >= Ts) { Tf[i] = T[i]; continue; }
      const hiT = i + 1 < T.length ? Math.min(T[i + 1], Ts) : Ts, hiC = i + 1 < T.length && T[i + 1] <= Ts ? cpN[i + 1] : interp(T, cpN, Ts);
      acc += (hiT - T[i]) * (cpN[i] + hiC) / 2; Tf[i] = Ts - acc;
    }
    const Tg2 = Math.max(r.g[0], r.g[1]), TfPrime = interp(T, Tf, Tg2);
    // midpoint temperature (C_p^N = 0.5) inside the transition
    let Tmid = NaN; for (let i = 1; i < T.length; i++) if (T[i] > Tg2 && T[i - 1] < Ts && (cpN[i - 1] - 0.5) * (cpN[i] - 0.5) <= 0 && cpN[i] !== cpN[i - 1]) { Tmid = T[i - 1] + (0.5 - cpN[i - 1]) * (T[i] - T[i - 1]) / (cpN[i] - cpN[i - 1]); break; }
    return { ok: true, T, HF, cpN, Tf, fg, fl, g, l, TfPrime, Tmid, dHF: t => l(t) - g(t) };
  }

  /* ---------- enthalpy recovery ---------- */
  // ref, aged: normalize() results (heating scans at the same rate). o: {g, l, mode: "liquid"|"linear", int:[a,b]}
  function recovery(ref, aged, o) {
    const lo = Math.max(ref.T[0], aged.T[0]), hi = Math.min(ref.T[ref.T.length - 1], aged.T[aged.T.length - 1]);
    const step = Math.max(0.02, Math.min(0.5, (hi - lo) / 1500)), x = [];
    for (let t = lo; t <= hi + 1e-9; t += step) x.push(t);
    const hr = x.map(t => interp(ref.T, ref.HF, t)), ha = x.map(t => interp(aged.T, aged.HF, t)), d = x.map((t, i) => ha[i] - hr[i]);
    let base;
    if (o.mode === "linear") { const bx = [], by = []; x.forEach((t, i) => { if (inRange(t, o.g) || inRange(t, o.l)) { bx.push(t); by.push(d[i]); } }); const f = linfit(bx, by) || { a: 0, b: 0 }; base = t => f.a + f.b * t; }
    else { let s = 0, n = 0; x.forEach((t, i) => { if (inRange(t, o.l)) { s += d[i]; n++; } }); const c = n ? s / n : 0; base = () => c; }
    const aligned = ha.map((v, i) => v - base(x[i])), dHF = x.map((t, i) => aligned[i] - hr[i]);
    const a = Math.max(lo, Math.min(o.int[0], o.int[1])), b = Math.min(hi, Math.max(o.int[0], o.int[1]));
    return { x, ref: hr, aged: aligned, dHF, integral: trapz(x, dHF, a, b), int: [a, b] };
  }

  /* ---------- KWW fits ---------- */
  // φ(t) = exp[−(t/τ)^β]; returns {tau, beta, mean τ, sse}
  function kwwFit(t, phi) {
    const pts = t.map((v, i) => [v, phi[i]]).filter(p => p[0] > 0 && isFinite(p[1]));
    if (pts.length < 3) return null;
    const lt = pts.map(p => Math.log(p[0])), guess = (() => { let k = pts.findIndex(p => p[1] < Math.exp(-1)); return k < 0 ? lt[lt.length - 1] : lt[k]; })();
    const f = u => { const tau = Math.exp(u[0]), b = u[1]; if (!(b > 0.05 && b <= 1.5)) return 1e9; let s = 0; for (const [x, y] of pts) { const r = y - Math.exp(-Math.pow(x / tau, b)); s += r * r; } return s; };
    const r = nelderMead(f, [guess, 0.6], [1, 0.15], 600);
    const tau = Math.exp(r.x[0]), beta = r.x[1];
    return { tau, beta, meanTau: tau / beta * gammaFn(1 / beta), sse: r.f, n: pts.length };
  }
  // property relaxation during annealing: V(t) = V∞ + ΔV·exp[−(t/τ)^β]; V∞ and ΔV are solved linearly for every (τ, β)
  function relaxFit(t, v, vinfFixed) {
    const pts = t.map((x, i) => [x, v[i]]).filter(p => p[0] >= 0 && isFinite(p[1])); if (pts.length < 4) return null;
    const lin = (tau, b) => {
      const e = pts.map(p => Math.exp(-Math.pow(p[0] / tau, b)));
      if (isFinite(vinfFixed)) { let se = 0, sy = 0; pts.forEach((p, i) => { se += e[i] * e[i]; sy += e[i] * (p[1] - vinfFixed); }); const dv = se > 0 ? sy / se : 0; return { vinf: vinfFixed, dv, e }; }
      const f = linfit(e, pts.map(p => p[1])); return f ? { vinf: f.a, dv: f.b, e } : null;
    };
    const sse = u => { const tau = Math.exp(u[0]), b = u[1]; if (!(b > 0.05 && b <= 1.5)) return 1e30; const L = lin(tau, b); if (!L) return 1e30; let s = 0; pts.forEach((p, i) => { const r = p[1] - (L.vinf + L.dv * L.e[i]); s += r * r; }); return s; };
    const lts = pts.filter(p => p[0] > 0).map(p => Math.log(p[0])); if (!lts.length) return null;
    let best = null;   // coarse grid for a robust start
    for (let k = 0; k <= 16; k++) for (const b of [0.3, 0.5, 0.7, 0.9]) { const u = [lts[0] + (lts[lts.length - 1] - lts[0]) * k / 16, b], s = sse(u); if (!best || s < best.s) best = { u, s }; }
    const r = nelderMead(sse, best.u, [0.7, 0.1], 800), tau = Math.exp(r.x[0]), beta = r.x[1], L = lin(tau, beta);
    const ys = pts.map(p => p[1]), mu = ys.reduce((a, b) => a + b, 0) / ys.length, sst = ys.reduce((a, y) => a + (y - mu) ** 2, 0);
    return { tau, beta, vinf: L.vinf, dv: L.dv, v0: L.vinf + L.dv, meanTau: tau / beta * gammaFn(1 / beta), R2: 1 - r.f / sst, sse: r.f, n: pts.length };
  }

  return { parseTable, linfit, interp, trapz, sortByX, defaultRanges, normalize, recovery, kwwFit, relaxFit, nelderMead, gammaFn };
})();
if (typeof module !== "undefined") module.exports = AN;
