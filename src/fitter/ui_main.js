(function () {
"use strict";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const E = ENGINE, css = v => `var(${v})`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = (v, p = 4) => (v === undefined || v === null || !isFinite(v)) ? "–" : (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? (+v).toExponential(p - 1) : String(+(+v).toPrecision(p)));
const MODEL_NAMES = { TL: "TL", TNM: "TNM", RP: "RelaxPy" };
const DS_COLORS = ["--c1", "--c2", "--c3", "--c4", "--c6", "--c7", "--c5", "--c8"];
const TIME_UNITS = { s: 1, min: 60, h: 3600, d: 86400 };

/* ================= state ================= */
function freshParams() {
  const P = {};
  for (const [m, def] of Object.entries(E.MODELDEFS)) {
    P[m] = { v: {}, free: {}, lo: {}, hi: {}, opt: { ...def.fixed } };
    def.params.forEach(q => { P[m].v[q.k] = q.v; P[m].free[q.k] = q.free; P[m].lo[q.k] = q.lo; P[m].hi[q.k] = q.hi; });
  }
  P.TNM.opt.simKernel = "exact";
  return P;
}
const S = {
  step: 1, T0: 229.73, segs: [], datasets: [], model: "TL", P: freshParams(),
  opts: { method: "local", maxEval: 1500, perPoint: false, seed: 1 },
  hist: null, histErr: null, sim: null, simErr: null, simMs: 0, evalRes: null, fitRes: null, fitUndo: null,
  selSeg: 0, selDs: -1, tlBeta: false, unit: "K", tmode: "auto", live: true, editor: null, job: null, dirtySim: true, mode4: "compute", compRes: null, autoComp: true,
};
function defaultHistory(Tg) {
  S.T0 = +(Tg + 40).toFixed(2);
  S.segs = [{ type: "ramp", T: +(Tg - 60).toFixed(2), rate: 10, dT: 0.5 }, { type: "ramp", T: +(Tg + 40).toFixed(2), rate: 10, dT: 0.5 }];
}
defaultHistory(308.13);

/* ================= helpers ================= */
// time axis: "auto" = linear (real time) whenever the history has a dynamic temperature (ramp or MDSC), log otherwise;
// plots that only cover isothermal holds (φ(t), time-domain hold data) stay logarithmic in auto mode
const dynHist = () => S.segs.some(s => s.type === "ramp" || s.type === "mdsc");
const HL = () => S.tmode === "log" || (S.tmode === "auto" && !dynHist());
const holdLog = () => S.tmode !== "lin";
const tU = v => v + (S.unit === "C" ? -273.15 : 0), uL = () => S.unit === "C" ? "°C" : "K";
// inputs are shown in the chosen unit and stored in K; tK converts a typed value back to K
const tK = v => v + (S.unit === "C" ? 273.15 : 0);
const tIn = v => +tU(+v).toPrecision(10);                         // absolute temperature for an input field
const ABS_T = new Set(["Tg"]);                                     // model parameters that are absolute temperatures
const pUnit = q => (ABS_T.has(q.k) ? uL() : q.unit);
const pShow = (k, v) => (ABS_T.has(k) ? tU(v) : v), pStore = (k, v) => (ABS_T.has(k) ? tK(v) : v);
function segColor(i) { const s = S.segs[i], inf = S.hist && S.hist.info[i]; if (!s) return "--c8"; if (s.type === "ramp") return inf && inf.Tend < inf.Tstart ? "--c1" : "--c2"; return { hold: "--c3", jump: "--c5", mdsc: "--c4" }[s.type]; }
function segLabel(i) {
  const s = S.segs[i], inf = S.hist && S.hist.info[i], f = v => (+v).toPrecision(5).replace(/\.?0+$/, ""), T = v => f(tU(v)) + " " + uL(), r = uL() + "/min";
  let d;
  if (s.type === "ramp") d = `${inf && inf.Tend < inf.Tstart ? "Cool" : "Heat"} to ${T(s.T)} @ ${f(s.rate)} ${r}`;
  else if (s.type === "hold") d = `Hold ${E.fmtTime(s.dur)}${inf ? " at " + T(inf.Tstart) : ""}`;
  else if (s.type === "jump") d = `Jump to ${T(s.T)}`;
  else if (s.type === "mdsc") d = `MDSC ${s.rate > 0 ? "to " + T(s.T) + " @ " + f(s.rate) + " " + r : "quasi-iso " + E.fmtTime(s.dur)} ±${f(s.A)} ${uL()} / ${f(s.P)} s`;
  else d = E.describeSeg(s, inf);
  return `#${i + 1} ${d}`;
}
function params(model) { const P = S.P[model]; return { ...P.v, ...P.opt }; }
function freeList(model) { const P = S.P[model]; return E.MODELDEFS[model].params.filter(q => P.free[q.k]).map(q => ({ k: q.k, lo: +P.lo[q.k], hi: +P.hi[q.k], discrete: q.discrete })); }
function recompile() { try { S.hist = E.compile(S.T0, S.segs); S.histErr = null; } catch (e) { S.hist = null; S.histErr = e.message; } S.dirtySim = true; }
function dsFilter(ds) { const x = [], y = []; for (let i = 0; i < ds.xAll.length; i++) { const X = ds.xAll[i], Y = ds.yAll[i]; if (!isFinite(X) || !isFinite(Y)) continue; if (isFinite(ds.xmin) && X < ds.xmin) continue; if (isFinite(ds.xmax) && X > ds.xmax) continue; x.push(X); y.push(Y); } ds.x = x; ds.y = y; }
function activeDatasets() { return S.datasets.filter(d => d.enabled && d.x.length >= 2); }
// Nothing is computed while the history, data or parameters are edited: the model runs only when the user clicks
// Compute or Run fit in step 4 (runModel). Every edit just invalidates the previous result (simulateNow = invalidate).
function invalidate() { S.sim = null; S.evalRes = null; S.simErr = null; S.fitRes = null; S.compRes = null; S.dirtySim = true; }
const simulateNow = invalidate;
function runModel() {
  S.sim = null; S.evalRes = null; S.simErr = null;
  if (!S.hist) { S.simErr = S.histErr || "no thermal history"; return; }
  const t0 = performance.now();
  try {
    const p = params(S.model);
    // TL: keep every local T_f,i for the β_KWW, δT_f and T_f,i-map plots (skipped for very long histories)
    const keepTfi = S.model === "TL" && S.hist.T.length * (S.P.TL.opt.N || 200) <= 1.2e7;
    S.sim = E.simulate(S.model, p, S.hist, { keepTfi, exact: S.model === "TNM" && S.P.TNM.opt.simKernel === "exact" && S.hist.T.length < 4000 });
    const ds = activeDatasets(); ds.forEach(E.dsPrepare);
    if (ds.length) S.evalRes = E.evaluate(S.model, p, S.hist, S.segs, ds, { perPoint: S.opts.perPoint, exact: S.model === "TNM" && S.P.TNM.opt.simKernel === "exact" && S.hist.T.length < 4000 });
  } catch (e) { S.simErr = e.message; S.sim = null; }
  S.simMs = performance.now() - t0; S.dirtySim = false;
}
function evalFor(ds) { if (!S.evalRes || S.step !== 4) return null; const act = activeDatasets(); const j = act.indexOf(ds); return j >= 0 ? S.evalRes.perDs[j] : null; }
let simTimer = null;
function scheduleSim() { invalidate(); renderStepper(); if (S.step === 4) refresh4(); }
function refresh4() { const rb = $("#resBox"); if (rb) rb.innerHTML = ""; const st = $("#cStat"); if (st) st.textContent = "Parameters changed. Click Compute to run the model."; renderStepper(); renderRight4(); }
function dl(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

/* ================= stepper / layout ================= */
function renderStepper() {
  $$(".step").forEach(b => { b.setAttribute("aria-current", +b.dataset.step === S.step); });
  const h = S.hist;
  $("#st1").textContent = h ? `${S.segs.length} segments · ${h.T.length.toLocaleString()} steps · ${E.fmtTime(h.t[h.t.length - 1])}` : (S.histErr || "—");
  const nd = S.datasets.filter(d => d.enabled).length; $("#st2").textContent = S.datasets.length ? `${nd} of ${S.datasets.length} datasets active` : "none (simulation only)";
  $("#st3").textContent = `${MODEL_NAMES[S.model]} · ${freeList(S.model).length} free parameters`;
  const CR = curRes(); $("#st4").textContent = CR ? `${CR.kind === "fit" ? "fitted" : "computed"}${CR.perDs.length ? ` · R² ${CR.R2tot.toFixed(4)}` : ""}` : (S.sim ? "simulated" : "not run");
  $$(".step").forEach(b => b.classList.toggle("done", (+b.dataset.step === 1 && !!h) || (+b.dataset.step === 2 && nd > 0) || (+b.dataset.step === 4 && !!curRes())));
}
function go(step) { S.step = step; render(); $("#left").scrollTop = 0; $("#right").scrollTop = 0; }
function render() { renderStepper(); [null, renderLeft1, renderLeft2, renderLeft3, renderLeft4][S.step](); renderRight(); }
function renderRight() { [null, renderRight1, renderRight2, renderRight3, renderRight4][S.step](); }
function navbar(prev, next, nextLabel) { return `<div class="navbar">${prev ? `<button class="btn" data-go="${prev}">← Back</button>` : "<span></span>"}${next ? `<button class="btn primary" data-go="${next}">${nextLabel || "Next →"}</button>` : ""}</div>`; }

/* ================= plotting helpers ================= */
function card(id, cls) { return `<div class="plotcard ${cls || ""}" id="${id}"><div class="plotbox"></div></div>`; }
function P(elId, cfg) {
  const el = document.getElementById(elId); if (!el || !cfg) return; const box = el.querySelector(".plotbox") || el;
  // one plot that cannot be drawn must never blank the rest of the panel
  try { plot(box, { id: elId, ...cfg }); } catch (e) { console.error(e); box.innerHTML = `<div class="banner err">Could not draw “${esc(cfg.title || elId)}”: ${esc(e.message)}</div>`; }
}
function histPlotCfg(opts) {
  opts = opts || {}; const h = S.hist; if (!h) return null;
  const tx = Array.from(h.t, (v, i) => HL() ? (i === 0 ? NaN : v) : v);
  const series = [];
  const many = h.T.length > 4000;
  S.segs.forEach((s, si) => { const inf = h.info[si]; if (!inf.n) return; const a = Math.max(0, inf.i0 - 1), x = [], y = []; for (let i = a; i <= inf.i1; i++) { x.push(tx[i]); y.push(tU(h.T[i])); }
    series.push({ name: "", x, y, color: css(segColor(si)), w: si === S.selSeg ? 2.6 : 1.6 });
    if (!many && opts.dots !== false) series.push({ name: "", x: x.slice(1), y: y.slice(1), color: css(segColor(si)), pts: true, r: si === S.selSeg ? 2.2 : 1.5, op: .9 }); });
  const showTf = S.sim && S.step === 4 && opts.tf !== false;
  if (showTf) series.push({ name: `T_f (${MODEL_NAMES[S.model]})`, x: tx, y: Array.from(S.sim.Tf, tU), color: css("--ink"), w: 1.6, dash: "5 3" });
  const bands = []; const sel = opts.band !== undefined ? opts.band : S.selSeg; const inf = h.info[sel];
  if (inf && inf.n) bands.push({ x0: HL() ? Math.max(inf.tstart, h.t[Math.max(1, inf.i0)] * 0.9) : inf.tstart, x1: inf.tend, color: css(segColor(sel)) });
  return { title: opts.title || "Temperature program" + (showTf ? " and fictive temperature" : ""), xlabel: "time (s)", ylabel: `T (${uL()})`, xlog: HL(), series, bands, xshort: "t", yshort: "T" };
}
function dtPlotCfg() {
  const h = S.hist; if (!h) return null; const series = [];
  S.segs.forEach((s, si) => { const inf = h.info[si]; if (!inf.n) return; const x = [], y = []; for (let i = Math.max(1, inf.i0); i <= inf.i1; i++) { const d = h.t[i] - h.t[i - 1]; if (d > 0) { x.push(h.t[i]); y.push(d); } }
    series.push({ name: segLabel(si), x, y, color: css(segColor(si)), pts: true, r: si === S.selSeg ? 2.4 : 1.6 }); });
  return { title: "Time step Δt of every simulation step", xlabel: "time (s)", ylabel: "Δt (s)", xlog: HL(), ylog: true, series, xshort: "t", yshort: "Δt" };
}
// simulation overview plots into a container
function simOverviewHTML(prefix) {
  const h = S.hist; if (!h) return "";
  const hasRamp = S.segs.some(s => s.type === "ramp"), hasHold = S.segs.some(s => s.type === "hold"), hasM = S.segs.some(s => s.type === "mdsc");
  const tl = S.model === "TL" && S.sim && S.sim.raw;
  const tlCards = tl ? `${S.tlBeta ? card(prefix + "beta") : ""}${card(prefix + "sig")}${S.sim.raw.TfiAll ? `<div class="plotcard wide" id="${prefix}map"><div class="plotbox"></div><div class="cbar" id="${prefix}cbar"></div></div>` : ""}` : "";
  return `<div class="plots">${card(prefix + "Tt")}${hasRamp ? card(prefix + "cp") : ""}${hasHold ? card(prefix + "phi") : ""}${hasM ? card(prefix + "md") : ""}${card(prefix + "tau")}${tlCards}</div>`;
}
function simOverviewPlot(prefix) {
  const h = S.hist, sim = S.sim; if (!h) return;
  P(prefix + "Tt", histPlotCfg({ dots: false, band: -1 }));
  if (!sim) return;
  if (document.getElementById(prefix + "cp")) { const series = []; S.segs.forEach((s, si) => { if (s.type !== "ramp") return; const c = E.cpSeries(h, sim, si); const cool = h.info[si].Tend < h.info[si].Tstart; series.push({ name: segLabel(si), x: c.x.map(tU), y: c.y, color: css(DS_COLORS[si % DS_COLORS.length]), w: 2, dash: cool ? "6 4" : null }); });
    P(prefix + "cp", { title: "Normalized C_p = dT_f/dT on each ramp", xlabel: `Temperature (${uL()})`, ylabel: "C_p,norm", series, xshort: "T", yshort: "Cp" }); }
  if (document.getElementById(prefix + "phi")) { const series = []; S.segs.forEach((s, si) => { if (s.type !== "hold") return; const hs = E.holdSeries(h, sim, si); const den = hs.Tf0 - hs.Th; series.push({ name: segLabel(si), x: holdLog() ? hs.x.slice(1) : hs.x, y: (holdLog() ? hs.y.slice(1) : hs.y).map(v => Math.abs(den) > 1e-9 ? (v - hs.Th) / den : NaN), color: css(DS_COLORS[si % DS_COLORS.length]), w: 2 }); });
    P(prefix + "phi", { title: "Relaxation during holds  φ(t) = (T_f − T)/(T_f,0 − T)", xlabel: "time since hold start (s)", ylabel: "φ", xlog: holdLog(), series, xshort: "t", yshort: "φ" }); }
  if (document.getElementById(prefix + "md")) { const series = []; S.segs.forEach((s, si) => { if (s.type !== "mdsc") return; const m = E.mdscSeries(h, sim, si, s); const c = css(DS_COLORS[si % DS_COLORS.length]); series.push({ name: `${segLabel(si)} C_p′`, x: m.T.map(tU), y: m.re, color: c, w: 2 }, { name: "C_p″", x: m.T.map(tU), y: m.im, color: c, w: 2, dash: "6 4" }); });
    P(prefix + "md", { title: "MDSC complex heat capacity (normalized)", xlabel: `Temperature (${uL()})`, ylabel: "C_p′, C_p″", series, xshort: "T", yshort: "Cp" }); }
  const tx = Array.from(h.t, (v, i) => HL() ? (i === 0 ? NaN : v) : v);
  if (S.model === "TL" && sim.raw) tlPlots(prefix);
  P(prefix + "tau", { title: "Relaxation time", xlabel: "time (s)", ylabel: "log₁₀ τ (s)", xlog: HL(), series: [{ name: "τ (model)", x: tx, y: Array.from(sim.tau, Math.log10), color: css("--c4"), w: 2 }, { name: "τ_eq(T)", x: tx, y: Array.from(sim.tauEq, Math.log10), color: css("--eq"), w: 1.4, dash: "4 3" }], xshort: "t", yshort: "log τ" });
}
function simStatus() {
  if (S.simErr) return `<div class="banner err">Simulation: ${esc(S.simErr)}</div>`;
  return "";
}


/* ---------------- TL only: β_KWW, δT_f and the T_f,i map ---------------- */
// β_KWW at sampled steps (instantaneous, from the X_i weights at T and ⟨T_f⟩; equilibrium: ⟨T_f⟩ = T), cached on the result
function tlDerived() {
  const sim = S.sim, raw = sim.raw, h = S.hist;
  if (!sim._tl) sim._tl = { idx: null, beta: new Map(), betaEq: new Map(), betaDone: false, sig: Float64Array.from(raw.sigTf, v => Math.sqrt(Math.max(0, v))) };
  const D = sim._tl;
  if (S.tlBeta && !D.betaDone && raw.TfiAll) {   // only when "instantaneous β_KWW" is ticked: one KWW fit per sampled step
    const n = h.T.length, pick = new Set([0]);
    S.segs.forEach((s, si) => { const inf = h.info[si]; if (!inf || inf.n < 1) return; const a = Math.max(1, inf.i0), b = inf.i1, m = s.type === "hold" ? 40 : 70;
      for (let k = 0; k <= m; k++) pick.add(Math.min(b, Math.round(a + (b - a) * k / m))); });
    D.idx = [...pick].filter(i => i >= 0 && i < n).sort((x, y) => x - y);
    D.idx.forEach(i => { const sn = TL.snapshot(raw, i); D.beta.set(i, sn.ne.beta); D.betaEq.set(i, sn.eq.beta); });
    D.betaDone = true;
  }
  return D;
}
const VIRIDIS = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]];
function viridis(u) { u = Math.min(1, Math.max(0, u)) * (VIRIDIS.length - 1); const k = Math.min(VIRIDIS.length - 2, Math.floor(u)), f = u - k, a = VIRIDIS[k], b = VIRIDIS[k + 1]; return [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * f)); }
// density of T_f,i on a uniform T_f grid: each domain's weight Y_i is spread over its own cell (midpoints to its
// neighbours in T_f), and the cells are integrated over uniform bins, so the map is homogeneous in T_f
function rebinDensity(vals, w, edges, out) {
  const N = vals.length, ord = Array.from({ length: N }, (_, k) => k).sort((a, b) => vals[a] - vals[b]);
  const v = ord.map(k => vals[k]), wt = ord.map(k => w[k]);
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const gl = k > 0 ? v[k] - v[k - 1] : (N > 1 ? v[1] - v[0] : 1), gr = k < N - 1 ? v[k + 1] - v[k] : gl;
    lo[k] = v[k] - Math.max(gl, 1e-9) / 2; hi[k] = v[k] + Math.max(gr, 1e-9) / 2;
  }
  out.fill(0); const nb = edges.length - 1;
  for (let k = 0; k < N; k++) {
    if (!(wt[k] > 0)) continue; const dens = wt[k] / (hi[k] - lo[k]);
    let b0 = Math.max(0, Math.floor((lo[k] - edges[0]) / (edges[1] - edges[0]))), b1 = Math.min(nb - 1, Math.floor((hi[k] - edges[0]) / (edges[1] - edges[0])));
    for (let b = b0; b <= b1; b++) { const ov = Math.min(hi[k], edges[b + 1]) - Math.max(lo[k], edges[b]); if (ov > 0) out[b] += dens * ov; }
  }
  const dw = edges[1] - edges[0]; for (let b = 0; b < nb; b++) out[b] /= dw;   // probability per kelvin
}
function tlPlots(prefix) {
  const h = S.hist, sim = S.sim, raw = sim.raw, D = tlDerived();
  // β_KWW and δT_f vs temperature, one line per non-hold segment; holds are shown against time in the map
  const bS = [], sS = [];
  S.segs.forEach((s, si) => { const inf = h.info[si]; if (!inf || inf.n < 1 || s.type === "hold") return; const a = Math.max(1, inf.i0) - 1, b = inf.i1;
    const col = css(DS_COLORS[si % DS_COLORS.length]), cool = inf.Tend < inf.Tstart, dash = cool ? "6 4" : null;
    const ib = D.betaDone ? D.idx.filter(i => i >= a && i <= b && D.beta.has(i)) : [];
    if (ib.length) bS.push({ name: segLabel(si), x: ib.map(i => tU(h.T[i])), y: ib.map(i => D.beta.get(i)), color: col, w: 2, dash });
    const xs = [], ys = []; for (let i = a; i <= b; i++) { xs.push(tU(h.T[i])); ys.push(D.sig[i]); } sS.push({ name: segLabel(si), x: xs, y: ys, color: col, w: 2, dash });
  });
  // equilibrium references (⟨T_f⟩ = T): β_KWW from the eq weights, δT_f = T·σ(T_v)/⟨T_v⟩
  const eqI = D.betaDone ? D.idx.filter(i => D.betaEq.has(i)).sort((a, b) => h.T[a] - h.T[b]) : [];
  if (eqI.length) bS.push({ name: "equilibrium (⟨T_f⟩ = T)", x: eqI.map(i => tU(h.T[i])), y: eqI.map(i => D.betaEq.get(i)), color: css("--eq"), w: 1.4, dash: "3 3" });
  const d = raw.dist; let mu = 0, v2 = 0; for (let k = 0; k < d.N; k++) mu += d.Yi[k] * d.Tvi[k]; for (let k = 0; k < d.N; k++) v2 += d.Yi[k] * (d.Tvi[k] - mu) ** 2; const rel = Math.sqrt(v2) / mu;
  let Tmin = Infinity, Tmax = -Infinity; for (const T of h.T) { if (T < Tmin) Tmin = T; if (T > Tmax) Tmax = T; }
  sS.push({ name: "equilibrium T·σ(T_v)/⟨T_v⟩", x: [tU(Tmin), tU(Tmax)], y: [Tmin * rel, Tmax * rel], color: css("--eq"), w: 1.4, dash: "3 3" });
  if (S.tlBeta) P(prefix + "beta", raw.TfiAll ? { title: "Nonexponentiality β_KWW (TL)", xlabel: `Temperature (${uL()})`, ylabel: "β_KWW", series: bS, xshort: "T", yshort: "β" }
    : { title: "β_KWW (TL): history too long to keep all T_f,i", xlabel: "", ylabel: "", series: [] });
  P(prefix + "sig", { title: "Fictive-temperature fluctuation δT_f (TL)", xlabel: `Temperature (${uL()})`, ylabel: `δT_f (${uL() === "°C" ? "K" : "K"})`, series: sS, xshort: "T", yshort: "δT_f" });
  if (raw.TfiAll) tlMap(prefix);
}
function tlMap(prefix) {
  const h = S.hist, raw = S.sim.raw, N = raw.dist.N, n = h.T.length, A = raw.TfiAll, Y = raw.dist.Yi;
  // time columns uniform on the displayed axis (log or linear); each takes the nearest simulation step
  const t0 = HL() ? Math.max(h.t[1] || 1e-3, 1e-6) : 0, t1 = h.t[n - 1]; if (!(t1 > t0)) return;
  // T_f,i at each column time is interpolated linearly between the two neighbouring simulation steps
  const NC = 360, NB = 140, cols = new Int32Array(NC), frac = new Float64Array(NC);
  const fx = HL() ? Math.log10 : (v => v), X0 = fx(t0), X1 = fx(t1);
  for (let c = 0, j = 0; c < NC; c++) { const x = X0 + (X1 - X0) * (c + 0.5) / NC, tt = HL() ? Math.pow(10, x) : x;
    while (j < n - 2 && h.t[j + 1] <= tt) j++; const dt = h.t[j + 1] - h.t[j]; cols[c] = j; frac[c] = dt > 0 ? Math.min(1, Math.max(0, (tt - h.t[j]) / dt)) : 1; }
  const colVals = (c, out) => { const i = cols[c], f = frac[c], i2 = Math.min(n - 1, i + 1); for (let k = 0; k < N; k++) out[k] = A[i * N + k] * (1 - f) + A[i2 * N + k] * f; return out; };
  // T_f grid: 0.5–99.5 % weight range over the whole run
  let lo = Infinity, hi = -Infinity; const order = Array.from({ length: N }, (_, k) => k);
  const tmp = new Float64Array(N);
  for (let c = 0; c < NC; c++) { const v = Array.from(colVals(c, tmp)); const s = order.slice().sort((a, b) => v[a] - v[b]); let cum = 0; for (const k of s) { cum += Y[k]; if (cum >= 0.005) { lo = Math.min(lo, v[k]); break; } } cum = 0; for (let q = s.length - 1; q >= 0; q--) { cum += Y[s[q]]; if (cum >= 0.005) { hi = Math.max(hi, v[s[q]]); break; } } }
  for (let i = 0; i < n; i++) { lo = Math.min(lo, h.T[i]); hi = Math.max(hi, h.T[i]); }
  const pad = (hi - lo) * 0.03 || 1; lo -= pad; hi += pad;
  const edges = Float64Array.from({ length: NB + 1 }, (_, b) => lo + (hi - lo) * b / NB), dens = new Float64Array(NB), img = new Float64Array(NC * NB), vals = new Float64Array(N);
  for (let c = 0; c < NC; c++) { colVals(c, vals); rebinDensity(vals, Y, edges, dens); img.set(dens, c * NB); }
  const sorted = Array.from(img).filter(v => v > 0).sort((a, b) => a - b), vmax = sorted.length ? sorted[Math.floor(sorted.length * 0.995)] : 1;
  const cv = document.createElement("canvas"); cv.width = NC; cv.height = NB; const cx = cv.getContext("2d"), id = cx.createImageData(NC, NB);
  for (let c = 0; c < NC; c++) for (let b = 0; b < NB; b++) { const [r, g, bl] = viridis(img[c * NB + b] / vmax), o = ((NB - 1 - b) * NC + c) * 4; id.data[o] = r; id.data[o + 1] = g; id.data[o + 2] = bl; id.data[o + 3] = 255; }
  cx.putImageData(id, 0, 0);
  const tx = Array.from(h.t, (v, i) => HL() ? (i === 0 ? NaN : v) : v);
  P(prefix + "map", { title: "Local fictive temperatures T_f,i vs time (TL), rebinned on a uniform T_f grid", xlabel: "time (s)", ylabel: `T_f,i (${uL()})`, xlog: HL(), W: 1120, H: 360,
    xdom: [t0, t1], ydom: [tU(lo), tU(hi)], image: { href: cv.toDataURL(), x0: t0, x1: t1, y0: tU(lo), y1: tU(hi) },
    series: [{ name: "T (white, dashed)", x: tx, y: Array.from(h.T, tU), color: "#ffffff", w: 1.3, dash: "5 4" }, { name: "⟨T_f⟩", x: tx, y: Array.from(S.sim.Tf, tU), color: "#ff6b6b", w: 1.8 }], xshort: "t", yshort: "T_f,i" });
  const cb = document.getElementById(prefix + "cbar");
  if (cb) cb.innerHTML = `<span>0</span><i style="background:linear-gradient(90deg,${VIRIDIS.map(c => `rgb(${c})`).join(",")})"></i><span>${nf(vmax, 3)} K⁻¹</span><span class="note" style="margin:0 0 0 8px">probability density of T_f,i (weights Y_i per kelvin; colours saturate at the 99.5th percentile)</span>`;
}

/* ================= STEP 1: thermal history ================= */
const TEMPLATES = {
  dsc: { name: "DSC cycle: cool → heat (10 K/min)", f: (Tg, q = 10) => [{ type: "ramp", T: Tg - 60, rate: q, dT: 0.5 }, { type: "ramp", T: Tg + 40, rate: q, dT: 0.5 }] },
  series: { name: "Cooling-rate series (0.5, 1, 5, 10 K/min), each heated at 10", f: Tg => [0.5, 1, 5, 10].flatMap(q => [{ type: "ramp", T: Tg - 60, rate: q, dT: 0.5 }, { type: "ramp", T: Tg + 40, rate: 10, dT: 0.5 }]) },
  aging: { name: "Aging below T_g, then DSC heating", f: Tg => [{ type: "ramp", T: Tg - 15, rate: 10, dT: 0.5 }, { type: "hold", dur: 1e5, n: 100, t1: 0.1 }, { type: "ramp", T: Tg - 60, rate: 10, dT: 0.5 }, { type: "ramp", T: Tg + 40, rate: 10, dT: 0.5 }] },
  kovacs: { name: "Kovacs memory: age, then up-jump and hold", f: Tg => [{ type: "ramp", T: Tg - 25, rate: 10, dT: 0.5 }, { type: "hold", dur: 3e4, n: 100, t1: 0.1 }, { type: "jump", T: Tg - 10 }, { type: "hold", dur: 1e5, n: 100, t1: 0.1 }] },
  tjump: { name: "Isothermal T-jump (Kovacs asymmetry)", f: Tg => [{ type: "jump", T: Tg - 10 }, { type: "hold", dur: 1e5, n: 100, t1: 0.1 }] },
  mdsc: { name: "MDSC heating (2 K/min, ±0.5 K, 60 s) after cooling", f: Tg => [{ type: "ramp", T: Tg - 50, rate: 10, dT: 0.5 }, { type: "mdsc", T: Tg + 40, rate: 2, A: 0.5, P: 60, ppp: 30 }] },
  qiso: { name: "Quasi-isothermal MDSC steps", f: Tg => { const o = [{ type: "ramp", T: Tg - 20, rate: 10, dT: 0.5 }]; for (let T = Tg - 20; T <= Tg + 20; T += 5) { if (T > Tg - 20) o.push({ type: "jump", T }); o.push({ type: "mdsc", rate: 0, dur: 1200, T, A: 0.5, P: 100, ppp: 30 }); } return o; } },
};
function segCard(s, i) {
  const inf = S.hist && S.hist.info[i], pc = segColor(i), sel = i === S.selSeg;
  const num = (k, v, step, extra) => `<input type="number" data-i="${i}" data-k="${k}" value="${v}" step="${step || "any"}" ${extra || ""}>`;
  let body = "";
  if (s.type === "ramp") {
    body = `<div class="grid3"><label class="f">to T (${uL()})${num("T", tIn(s.T))}</label><label class="f">rate (${uL()}/min)${num("rate", s.rate, "any", 'min="0"')}</label><label class="f">ΔT step (${uL()})${num("dT", s.dT, "any", 'min="0.001"')}</label></div>
      <div class="inrow" style="margin-top:5px"><span class="note" style="margin:0;width:62px">resolution</span><input type="range" min="-2" max="1" step="0.01" data-i="${i}" data-k="dTlog" value="${Math.log10(s.dT)}" title="ΔT step (log scale 0.01–10 ${uL()})"></div>`;
  } else if (s.type === "hold") {
    const u = s.durUnit || (s.dur >= 259200 ? "d" : s.dur >= 7200 ? "h" : s.dur >= 120 ? "min" : "s");
    body = `<div class="grid3" style="grid-template-columns:1.5fr 1fr 1fr"><label class="f">duration<span class="inrow">${num("durU", +(s.dur / TIME_UNITS[u]).toPrecision(6), "any")}<select data-i="${i}" data-k="durUnit">${Object.keys(TIME_UNITS).map(k => `<option ${k === u ? "selected" : ""}>${k}</option>`).join("")}</select></span></label>
      <label class="f">log-spaced points${num("n", s.n, 1, 'min="2" max="2000"')}</label><label class="f">first step t₁ (s)${num("t1", s.t1, "any", 'min="0"')}</label></div>
      <div class="inrow" style="margin-top:5px"><span class="note" style="margin:0;width:62px">points</span><input type="range" min="5" max="400" step="1" data-i="${i}" data-k="nr" value="${s.n}"></div>`;
  } else if (s.type === "jump") {
    body = `<div class="grid3"><label class="f">to T (${uL()})${num("T", tIn(s.T))}</label></div>`;
  } else if (s.type === "mdsc") {
    body = `<div class="grid3"><label class="f">to T (${uL()})${num("T", tIn(s.T))}</label><label class="f" title="underlying heating/cooling rate; 0 = quasi-isothermal">rate (${uL()}/min)${num("rate", s.rate, "any", 'min="0"')}</label><label class="f" ${s.rate > 0 ? "hidden" : ""}>duration (s)${num("dur", s.dur || 1200, "any")}</label>
      <label class="f">amplitude ±A (${uL()})${num("A", s.A, "any")}</label><label class="f">period (s)${num("P", s.P, "any")}</label><label class="f">points / period${num("ppp", s.ppp, 1, 'min="8"')}</label></div>
      <div class="inrow" style="margin-top:5px"><span class="note" style="margin:0;width:62px">resolution</span><input type="range" min="8" max="200" step="1" data-i="${i}" data-k="pppr" value="${s.ppp}"></div>`;
  }
  return `<div class="seg ${sel ? "sel" : ""}" style="--pc:${css(pc)}" data-seg="${i}">
    <div class="top"><span class="pill" style="--pc:${css(pc)}">${s.type}</span><span class="desc" data-selseg="${i}" title="Highlight in the plots">${esc(segLabel(i))}</span>
      <button class="btn icon" data-mv="${i}" data-d="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn icon" data-mv="${i}" data-d="1" title="Move down" ${i === S.segs.length - 1 ? "disabled" : ""}>↓</button>
      <button class="btn icon" data-dup="${i}" title="Duplicate">⧉</button><button class="btn icon danger" data-del="${i}" title="Remove">×</button></div>
    ${body}<div class="res" id="res-${i}">${segRes(i)}</div></div>`;
}
function segRes(i) {
  const s = S.segs[i], inf = S.hist && S.hist.info[i]; if (!inf) return S.histErr ? `<span style="color:var(--warn)">${esc(S.histErr)}</span>` : "";
  const dur = inf.tend - inf.tstart;
  if (s.type === "ramp") return `${inf.n} steps · Δt = ${nf(inf.n ? dur / inf.n : 0, 3)} s · ${E.fmtTime(dur)} · ${nf(tU(inf.Tstart), 5)} → ${nf(tU(inf.Tend), 5)} ${uL()}`;
  if (s.type === "hold") { const dec = Math.log10(s.dur / Math.min(s.t1, s.dur)); return `${inf.n} points over ${dec.toFixed(1)} decades (${nf(inf.n / Math.max(dec, 1e-9), 3)} per decade) · at ${nf(tU(inf.Tstart), 5)} ${uL()}`; }
  if (s.type === "jump") return `instantaneous: ${nf(tU(inf.Tstart), 5)} → ${nf(tU(inf.Tend), 5)} ${uL()}`;
  if (s.type === "mdsc") return `${Math.round(inf.n / s.ppp)} periods · ${inf.n} steps (Δt = ${nf(s.P / s.ppp, 3)} s) · ${E.fmtTime(dur)}`;
  return "";
}
function renderLeft1() {
  const h = S.hist, tot = h ? h.t[h.t.length - 1] : 0;
  $("#left").innerHTML = `
  <div class="card"><h2>Start <span class="sub">system equilibrated: T_f = T₀</span></h2><div class="body"><div class="grid2">
    <label class="f">Start temperature T₀ (${uL()})<input type="number" id="T0" value="${tIn(S.T0)}" step="any"></label>
    <label class="f">Insert template<select id="tpl"><option value="">— choose —</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("")}</select></label>
  </div><p class="note">Templates are placed around the current model T<sub>g</sub> (${nf(tU(S.P[S.model].v.Tg), 5)} ${uL()}) and replace the segment list.</p></div></div>
  <div class="card"><h2>Segments <span class="sub">${S.segs.length}</span></h2><div class="body">
    <div id="segList">${S.segs.map(segCard).join("")}</div>
    <div class="addrow"><button class="btn small" data-add="ramp">+ Ramp</button><button class="btn small" data-add="hold">+ Hold / anneal</button><button class="btn small" data-add="jump">+ T-jump</button><button class="btn small" data-add="mdsc">+ MDSC</button></div>
    <div class="summary" id="histSummary">${histSummary()}</div>
  </div></div>
  ${navbar(null, 2, "Next: data →")}`;
}
function histSummary() {
  const h = S.hist; if (!h) return `<div class="stat full" style="grid-column:1/-1;color:var(--warn)">${esc(S.histErr || "")}</div>`;
  return `<div class="stat"><b>${h.T.length.toLocaleString()}</b><span>simulation steps</span></div><div class="stat"><b>${E.fmtTime(h.t[h.t.length - 1])}</b><span>total time</span></div><div class="stat"><b>${S.sim ? nf(S.simMs, 3) + " ms" : "–"}</b><span>${MODEL_NAMES[S.model]} run time</span></div>`;
}
function renderRight1() {
  $("#right").innerHTML = `<div class="rhead"><h3>Thermal history</h3><span class="spacer"></span>
    
</div>
    ${S.histErr ? `<div class="banner err">${esc(S.histErr)}</div>` : ""}
    <div class="plots">${card("p1T")}${card("p1dt")}</div>${notYet()}`;
  if (!S.hist) return;
  P("p1T", histPlotCfg()); P("p1dt", dtPlotCfg());
}
function onSegInput(t, isChange) {
  const i = +t.dataset.i, k = t.dataset.k, s = S.segs[i]; if (!s) return;
  const v = parseFloat(t.value);
  if (k === "dTlog") { s.dT = +Math.pow(10, v).toPrecision(3); const box = t.closest(".seg").querySelector('[data-k="dT"]'); if (box) box.value = s.dT; }
  else if (k === "nr") { s.n = Math.round(v); const box = t.closest(".seg").querySelector('[data-k="n"]'); if (box) box.value = s.n; }
  else if (k === "pppr") { s.ppp = Math.round(v); const box = t.closest(".seg").querySelector('[data-k="ppp"]'); if (box) box.value = s.ppp; }
  else if (k === "durU") { if (isFinite(v)) s.dur = v * TIME_UNITS[s.durUnit || t.parentElement.querySelector("select").value]; }
  else if (k === "durUnit") { const box = t.parentElement.querySelector('[data-k="durU"]'); s.durUnit = t.value; box.value = +(s.dur / TIME_UNITS[t.value]).toPrecision(6); }
  else if (isFinite(v)) { s[k] = k === "T" ? tK(v) : v; if (k === "dT") { const r = t.closest(".seg").querySelector('[data-k="dTlog"]'); if (r) r.value = Math.log10(v); } if (k === "n") { const r = t.closest(".seg").querySelector('[data-k="nr"]'); if (r) r.value = v; } if (k === "ppp") { const r = t.closest(".seg").querySelector('[data-k="pppr"]'); if (r) r.value = v; } }
  S.selSeg = i; recompile(); S.fitRes = null; S.compRes = null;
  if (isChange && k === "rate" && s.type === "mdsc") { renderLeft1(); }
  S.segs.forEach((_, j) => { const el = document.getElementById("res-" + j); if (el) el.innerHTML = segRes(j); const d = document.querySelector(`[data-selseg="${j}"]`); if (d) d.textContent = segLabel(j); });
  $$(".seg").forEach(el => { const j = +el.dataset.seg; el.classList.toggle("sel", j === S.selSeg); el.style.setProperty("--pc", css(segColor(j))); el.querySelector(".pill").style.setProperty("--pc", css(segColor(j))); });
  const sm = $("#histSummary"); if (sm) sm.innerHTML = histSummary();
  S.sim = null; S.evalRes = null; S.simErr = null; S.dirtySim = true;
  renderStepper(); P("p1T", histPlotCfg()); P("p1dt", dtPlotCfg());
}

/* ================= STEP 2: data ================= */
function parseTable(text) {
  const lines = text.split(/\r?\n/); const rows = []; let header = null;
  for (const ln of lines) {
    const raw = ln.trim(); if (!raw) continue;
    const tok = raw.split(/\s*[,;\t]\s*|\s+/);
    const nums = tok.map(v => v === "" ? NaN : Number(v)); const nNum = nums.filter(isFinite).length;
    if (nNum >= 2 && nNum >= tok.filter(v => v !== "").length * 0.5) rows.push(nums);
    else if (!rows.length) header = raw.split(/\s*[,;\t]\s*/);
  }
  const nc = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols = Array.from({ length: nc }, (_, j) => rows.map(r => r[j] !== undefined ? r[j] : NaN));
  const names = Array.from({ length: nc }, (_, j) => header && header[j] ? header[j] : `column ${j + 1}`);
  return { cols, names, n: rows.length };
}
function compatSegs(kind) { const K = E.KINDS[kind]; return S.segs.map((s, i) => i).filter(i => K.segs.includes(S.segs[i].type)); }
function newEditor(kind) {
  kind = kind || "cp_norm";
  const cs = compatSegs(kind), heat = cs.find(i => S.hist && S.hist.info[i] && S.hist.info[i].Tend > S.hist.info[i].Tstart);
  return { mode: "new", kind, src: "paste", text: "", parsed: null, xcol: 0, ycol: 1, xunit: E.KINDS[kind].axis === "T" ? S.unit : "s", yscale: 1, seg: heat !== undefined ? heat : (cs[0] !== undefined ? cs[0] : 0), xmin: "", xmax: "", weight: 1, scale: false, name: "",
    syn: { x0: "", x1: "", n: 80, noise: 0.01, a: 0, b: 1, c: 0.4, d: 0 } };
}
function dsCard(ds, i) {
  const pc = DS_COLORS[i % DS_COLORS.length], ev = evalFor(ds);
  return `<div class="dsitem ${i === S.selDs ? "sel" : ""}" style="--pc:${css(pc)}" data-selds="${i}">
    <input type="checkbox" data-en="${i}" ${ds.enabled ? "checked" : ""} title="Use in fit"><span class="nm">${esc(ds.name)}</span>
    <span class="row"><button class="btn icon" data-edit="${i}" title="Edit">✎</button><button class="btn icon danger" data-deld="${i}" title="Delete">×</button></span>
    <span class="meta">${esc(E.KINDS[ds.kind].label.split(" (")[0])} · ${esc(S.segs[ds.seg] ? segLabel(ds.seg) : "segment missing")} · ${ds.x.length} pts${ev && ev.pr.err ? ` · <span style="color:var(--warn)">${esc(ev.pr.err)} — edit to relink</span>` : ev ? ` · R² ${ev.R2.toFixed(4)}` : ""}${ev && !ev.pr.err && ev.pr.nOut ? ` · <span style="color:var(--warn)">${ev.pr.nOut} pts outside segment</span>` : ""}</span></div>`;
}
function editorHTML() {
  const ed = S.editor, K = E.KINDS[ed.kind], cs = compatSegs(ed.kind);
  const segOpts = cs.length ? cs.map(i => `<option value="${i}" ${i === ed.seg ? "selected" : ""}>${esc(segLabel(i))}</option>`).join("") : `<option value="">(no ${K.segs.join("/")} segment in the history)</option>`;
  const colOpts = sel => ed.parsed ? ed.parsed.names.map((n, j) => `<option value="${j}" ${j === sel ? "selected" : ""}>${esc(n)}</option>`).join("") : "";
  const xU = K.axis === "T" ? `<option ${ed.xunit === "K" ? "selected" : ""}>K</option><option value="C" ${ed.xunit === "C" ? "selected" : ""}>°C</option>` : Object.keys(TIME_UNITS).map(u => `<option ${ed.xunit === u ? "selected" : ""}>${u}</option>`).join("");
  const isNew = ed.mode === "new";
  return `<div class="card" id="editor"><h2>${isNew ? "Add dataset" : "Edit dataset"}<button class="btn icon" id="edClose" title="Close">×</button></h2><div class="body">
    <div class="grid2">
      <label class="f full">Data type<select id="edKind">${Object.entries(E.KINDS).map(([k, v]) => `<option value="${k}" ${k === ed.kind ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
      <label class="f full">Linked history segment<select id="edSeg">${segOpts}</select></label>
    </div>
    ${isNew ? `<div class="tabs2"><button data-src="paste" aria-selected="${ed.src === "paste"}">Paste / file</button><button data-src="synth" aria-selected="${ed.src === "synth"}">Synthesize from model</button></div>` : ""}
    ${isNew && ed.src === "paste" ? `
      <label class="f">Paste two or more columns (header optional), or load a file<textarea id="edText" rows="5" placeholder="T, Cp&#10;300, 0.01&#10;...">${esc(ed.text)}</textarea></label>
      <div class="row" style="margin-top:5px"><label class="btn small" style="cursor:pointer">Load file…<input type="file" id="edFile" accept=".csv,.txt,.dat,.tsv" hidden></label><span class="note" style="margin:0">${ed.parsed ? `${ed.parsed.n} rows × ${ed.parsed.cols.length} columns detected` : ""}</span></div>
      ${ed.parsed ? `<div class="grid3" style="margin-top:6px"><label class="f">x column (${K.axis === "T" ? "temperature" : "time"})<select id="edX">${colOpts(ed.xcol)}</select></label><label class="f">x unit<select id="edXU">${xU}</select></label><label class="f">y column<select id="edY">${colOpts(ed.ycol)}</select></label></div>` : ""}` : ""}
    ${isNew && ed.src === "synth" ? `
      <p class="note">Generates data from the current ${MODEL_NAMES[S.model]} simulation on the linked segment — useful for testing a fit or planning an experiment.</p>
      <div class="grid3"><label class="f">x from (${K.axis === "T" ? uL() : "s"})<input type="number" id="syX0" value="${ed.syn.x0}" step="any" placeholder="auto"></label><label class="f">x to<input type="number" id="syX1" value="${ed.syn.x1}" step="any" placeholder="auto"></label><label class="f">points<input type="number" id="syN" value="${ed.syn.n}" min="3" step="1"></label>
      <label class="f">noise σ<input type="number" id="syNoise" value="${ed.syn.noise}" step="any"></label>
      ${["cp_raw", "H_T", "V_T", "P_t"].includes(ed.kind) ? `<label class="f">a<input type="number" id="syA" value="${ed.syn.a}" step="any"></label><label class="f">b<input type="number" id="syB" value="${ed.syn.b}" step="any"></label><label class="f">c<input type="number" id="syC" value="${ed.syn.c}" step="any"></label>${ed.kind === "cp_raw" ? `<label class="f">d<input type="number" id="syD" value="${ed.syn.d}" step="any"></label>` : ""}` : ""}</div>
      <p class="note">${{ cp_raw: "y = a + b·T + (c + d·T)·dT_f/dT", H_T: "y = a + b·T + c·T_f", V_T: "y = a + b·T + c·T_f", P_t: "y = a + b·T_f" }[ed.kind] || ""}</p>` : ""}
    <div class="grid3" style="margin-top:6px">
      <label class="f">use x ≥${K.axis === "T" ? ` (${uL()})` : ""}<input type="number" id="edXmin" value="${ed.xmin}" step="any" placeholder="all"></label><label class="f">use x ≤<input type="number" id="edXmax" value="${ed.xmax}" step="any" placeholder="all"></label>
      <label class="f">weight<input type="number" id="edW" value="${ed.weight}" step="any" min="0"></label>
      ${isNew && ed.src === "paste" ? `<label class="f">y multiplier<input type="number" id="edYS" value="${ed.yscale}" step="any"></label>` : ""}
      <label class="f ${isNew && ed.src === "paste" ? "" : "full"}" style="grid-column:span 2">name<input type="text" id="edName" value="${esc(ed.name)}" placeholder="auto"></label>
    </div>
    ${K.scaleOpt ? `<label class="chk" style="margin-top:6px"><input type="checkbox" id="edScale" ${ed.scale ? "checked" : ""}> fit an offset and a scale factor for this dataset (y = a + b·model)</label>` : ""}
    <p class="note">x limits are in K for temperature data and seconds (from the start of the hold) for annealing data.</p>
    <div class="row" style="margin-top:8px"><button class="btn primary small" id="edOk">${isNew ? "Add dataset" : "Save changes"}</button><span class="note" id="edMsg" style="margin:0"></span></div>
  </div></div>`;
}
function renderLeft2() {
  const ex = Object.keys(EXAMPLES.geasse || {});
  $("#left").innerHTML = `
  <div class="card"><h2>Datasets <span class="sub">optional — skip to simulate only</span></h2><div class="body">
    <div id="dsList">${S.datasets.length ? S.datasets.map(dsCard).join("") : `<p class="note" style="margin:0 0 6px">No data yet. Each dataset is compared with the model on one segment of the thermal history.</p>`}</div>
    <div class="row"><button class="btn small primary" id="dsAdd">+ Add dataset</button></div>
  </div></div>
  ${S.editor ? editorHTML() : ""}
  ${ex.length ? `<div class="card"><h2>Example data <span class="sub">Ge–As–Se DSC, 10 K/min</span></h2><div class="body">
    <div class="inrow"><select id="exComp" style="flex:1;width:auto">${ex.map(c => `<option>${c}</option>`).join("")}</select><button class="btn small" id="exLoad">Load</button></div>
    <p class="note">Loads normalized cooling + heating C<sub>p</sub>, builds the matching history (cool then heat at 10 K/min), and sets TL parameters from the 0.5/1/5 K/min fit. Replaces the current history and data.</p>
  </div></div>` : ""}
  ${navbar(1, 3, "Next: model →")}`;
}
function renderRight2() {
  const ds = S.datasets[S.selDs];
  if (!ds) { $("#right").innerHTML = `<div class="rhead"><h3>Data</h3></div><div class="empty">Add a dataset or load an example to see it here, together with the linked part of the thermal history.</div><div style="height:10px"></div><div class="plots">${card("p2T")}</div>`; if (S.hist) P("p2T", histPlotCfg({ tf: false })); return; }
  $("#right").innerHTML = `<div class="rhead"><h3>${esc(ds.name)}</h3></div>
    <div class="plots">${card("p2d")}${card("p2T")}</div>
    <div class="card" style="margin-top:10px"><h2>First rows <span class="sub">${ds.x.length} of ${ds.xAll.length} points used</span></h2><div class="body" style="overflow-x:auto">
    <table class="dt"><tr><th>x (${E.KINDS[ds.kind].axis === "T" ? uL() : "s"})</th><th>y</th></tr>${ds.x.slice(0, 8).map((x, i) => `<tr><td>${nf(E.KINDS[ds.kind].axis === "T" ? tU(x) : x, 6)}</td><td>${nf(ds.y[i], 6)}</td></tr>`).join("")}</table></div></div>`;
  plotDataset("p2d", ds, S.selDs);
  if (S.hist) P("p2T", histPlotCfg({ band: ds.seg, title: "Linked segment in the thermal history" }));
}
function plotDataset(elId, ds, i, withRes) {
  const K = E.KINDS[ds.kind], ev = evalFor(ds), col = css(DS_COLORS[i % DS_COLORS.length]), isT = K.axis === "T";
  const xf = v => isT ? tU(v) : v;
  const series = [{ name: "data", x: ds.x.map(xf), y: ds.y, color: col, pts: true, r: 2.2, op: .6 }];
  if (ev && ev.pr && ev.pr.curve) series.push({ name: `${MODEL_NAMES[S.model]} model`, x: ev.pr.curve.x.map(xf), y: ev.pr.curve.y, color: css("--ink"), w: 2 });
  let xdom = null; if (ds.x.length) { const lo = Math.min(...ds.x), hi = Math.max(...ds.x), pad = isT ? (hi - lo) * 0.03 : 0; xdom = isT ? [xf(lo - pad), xf(hi + pad)] : holdLog() ? [lo / 1.3, hi * 1.3] : [0, hi * 1.05]; }
  const xl = isT ? `Temperature (${uL()})` : "time since hold start (s)";
  P(elId, { title: `${ds.name}${ev ? ` · R² ${ev.R2.toFixed(4)}` : ""}`, xlabel: withRes ? "" : xl, ylabel: K.ylab, xlog: !isT && holdLog(), series, xdom, xshort: isT ? "T" : "t", yshort: "y", H: withRes ? 250 : 310 });
  if (withRes && ev) {
    const rx = [], ry = []; ds.x.forEach((x, k) => { const yh = ev.pr.yhat[k]; if (isFinite(yh)) { rx.push(xf(x)); ry.push(ds.y[k] - yh); } });
    const el = document.getElementById(elId); const rb = document.createElement("div"); rb.className = "resbox"; el.appendChild(rb);
    plot(rb, { id: elId + "r", title: "", xlabel: xl, ylabel: "residual", xlog: !isT && holdLog(), xdom, H: 130, series: [{ name: "", x: xdom || [0, 1], y: [0, 0], color: css("--eq"), w: 1, dash: "3 3" }, { name: "", x: rx, y: ry, color: col, pts: true, r: 1.8 }], xshort: isT ? "T" : "t", yshort: "res" });
  }
}
function commitEditor() {
  const ed = S.editor, msg = $("#edMsg"); const K = E.KINDS[ed.kind];
  if (!compatSegs(ed.kind).includes(+ed.seg)) { msg.textContent = `Needs a ${K.segs.join("/")} segment in the history.`; return; }
  const lim = v => v === "" ? NaN : (K.axis === "T" ? tK(+v) : +v), xmin = lim(ed.xmin), xmax = lim(ed.xmax);
  if (ed.mode === "edit") {
    const ds = S.datasets[ed.idx]; Object.assign(ds, { kind: ed.kind, seg: +ed.seg, xmin, xmax, weight: +ed.weight || 1, scale: !!ed.scale, name: ed.name || ds.name }); dsFilter(ds);
  } else {
    let xAll, yAll;
    if (ed.src === "paste") {
      if (!ed.parsed || ed.parsed.n < 2) { msg.textContent = "Paste or load at least two numeric rows."; return; }
      const cx = ed.parsed.cols[ed.xcol], cy = ed.parsed.cols[ed.ycol];
      const conv = K.axis === "T" ? (ed.xunit === "C" ? v => v + 273.15 : v => v) : v => v * TIME_UNITS[ed.xunit];
      xAll = cx.map(conv); yAll = cy.map(v => v * (+ed.yscale || 1));
    } else {
      runModel(); if (!S.sim) { msg.textContent = "Simulation failed — check the model."; return; }
      const raw = { cp_raw: "cp_norm", H_T: "tf_T", V_T: "tf_T", P_t: "tf_t" }[ed.kind] || ed.kind;
      const pr = E.predict({ kind: raw, seg: +ed.seg, x: [], y: [] }, S.hist, S.sim, S.segs); const c = pr.curve; if (!c || c.x.length < 2) { msg.textContent = "The linked segment gives no model curve."; return; }
      const xin = v => K.axis === "T" ? tK(+v) : +v;
      let lo = ed.syn.x0 === "" ? c.x[0] : xin(ed.syn.x0), hi = ed.syn.x1 === "" ? c.x[c.x.length - 1] : xin(ed.syn.x1); const n = Math.max(3, Math.round(+ed.syn.n || 80));
      if (K.axis === "t") { lo = Math.max(lo, c.x[1] || 1e-3); xAll = Array.from({ length: n }, (_, k) => lo * Math.pow(hi / lo, k / (n - 1))); } else xAll = Array.from({ length: n }, (_, k) => lo + (hi - lo) * k / (n - 1));
      const rng = E.mulberry(Date.now() & 0xffff), gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
      const a = +ed.syn.a, b = +ed.syn.b, cc = +ed.syn.c, d = +ed.syn.d;
      yAll = xAll.map(x => { const m = E.interp(c.x, c.y, x); let y = m;
        if (ed.kind === "cp_raw") y = a + b * x + (cc + d * x) * m; else if (ed.kind === "H_T" || ed.kind === "V_T") y = a + b * x + cc * m; else if (ed.kind === "P_t") y = a + b * m;
        return y + (+ed.syn.noise || 0) * gauss(); });
    }
    const ds = { name: ed.name || `${E.KINDS[ed.kind].label.split(" —")[0].split(" (")[0]} · seg ${+ed.seg + 1}${ed.src === "synth" ? " (synthetic)" : ""}`, kind: ed.kind, seg: +ed.seg, xAll, yAll, xmin, xmax, weight: +ed.weight || 1, scale: !!ed.scale, enabled: true };
    dsFilter(ds); if (ds.x.length < 2) { msg.textContent = "Fewer than two usable points (check columns, units and limits)."; return; }
    S.datasets.push(ds); S.selDs = S.datasets.length - 1;
  }
  S.editor = null; S.fitRes = null; S.compRes = null; S.dirtySim = true; simulateNow(); render();
}

/* ================= STEP 3: model & parameters ================= */
const TL_PRESETS = { "Glycerol": [189.73, 52.25, -25.40, 0.64, 0.82], "Selenium": [308.13, 64.14, -23.41, 0.59, 1], "B₂O₃": [559.66, 36.28, -15.39, 0.60, 1], "OTP": [246.15, 106.16, -25.48, 0.59, 1], "PVAc": [313.06, 92.36, -37.87, 0.52, 0.85], "D-sorbitol": [265.7, 88.76, -35.61, 0.57, 1] };
function renderLeft3() {
  const m = S.model, def = E.MODELDEFS[m], Pm = S.P[m];
  const desc = { TL: "heterogeneous Adam–Gibbs domains with a T_v distribution (JCP 2024)", TNM: "single fictive temperature, KWW kernel, nonlinearity x", RP: "MAP nonequilibrium viscosity with Prony-series T_f components" };
  const rows = def.params.map(q => { const fr = Pm.free[q.k]; const auto = (m === "RP" && ((q.k === "A" && Pm.opt.Aauto) || (q.k === "pexp" && Pm.opt.pauto)));
    return `<tr class="${fr ? "" : "fixed"}"><td><input type="checkbox" data-pf="${q.k}" ${fr ? "checked" : ""} ${auto ? "disabled" : ""} title="Free in the fit"></td>
      <td class="nm" title="${esc(q.tip || "")}">${q.label}${pUnit(q) ? ` <span class="note">(${pUnit(q)})</span>` : ""}${q.discrete ? ` <span class="note">step ${q.discrete}</span>` : ""}</td>
      <td><input type="number" data-pv="${q.k}" value="${+(+pShow(q.k, Pm.v[q.k])).toPrecision(7)}" step="any" ${auto ? "disabled" : ""}></td>
      <td><input class="b" type="number" data-plo="${q.k}" value="${+(+pShow(q.k, Pm.lo[q.k])).toPrecision(7)}" step="any"></td><td><input class="b" type="number" data-phi="${q.k}" value="${+(+pShow(q.k, Pm.hi[q.k])).toPrecision(7)}" step="any"></td></tr>`; }).join("");
  $("#left").innerHTML = `
  <div class="card"><h2>Model</h2><div class="body">
    ${Object.keys(E.MODELDEFS).map(k => `<label class="mcard ${k === m ? "sel" : ""}"><input type="radio" name="model" value="${k}" ${k === m ? "checked" : ""}><b>${E.MODELDEFS[k].name}</b><span>${desc[k]}</span></label>`).join("")}
  </div></div>
  <div class="card"><h2>Parameters <span class="sub">tick = free in the fit</span></h2><div class="body">
    <div class="row" style="margin-bottom:6px">${m === "TL" ? `<select id="tlPreset"><option value="">Preset (Table I, JCP 2024)…</option>${Object.keys(TL_PRESETS).map(k => `<option>${k}</option>`).join("")}</select>` : ""}
      ${m === "RP" ? `<button class="btn small" id="rpExample">RelaxPy example glass</button>` : ""}
      <button class="btn small" id="autoB" title="Set min/max around the current values">Bounds around values</button></div>
    <table class="pt"><tr><th></th><th>parameter</th><th>value</th><th>min</th><th>max</th></tr>${rows}</table>
    ${m === "TL" ? `<div class="grid2" style="margin-top:8px"><label class="f">N (T_v,i domains)<input type="number" id="tlN" value="${Pm.opt.N}" min="20" max="400" step="10"></label></div><p class="note">f uses the embedded β-library (0.01 grid); it is fitted by a grid search around the current value.</p>` : ""}
    ${m === "TNM" ? `<div class="grid2" style="margin-top:8px"><label class="f">Kernel for simulation<select id="tnmK"><option value="exact" ${Pm.opt.simKernel === "exact" ? "selected" : ""}>exact KWW summation</option><option value="prony" ${Pm.opt.simKernel === "prony" ? "selected" : ""}>Prony series</option></select></label></div><p class="note">Fits always use the Prony kernel (β-continuous blend of the fitted Prony tables); the exact kernel is used for display when the history has &lt; 4 000 steps.</p>` : ""}
    ${m === "RP" ? `<label class="chk" style="margin-top:8px"><input type="checkbox" id="rpA" ${Pm.opt.Aauto ? "checked" : ""}> A from continuity η_ne = η_eq at T = T_f = T_g</label><br><label class="chk"><input type="checkbox" id="rpP" ${Pm.opt.pauto ? "checked" : ""}> p = 0.3082·m (RelaxPy default)</label><p class="note">β uses a β-continuous Prony blend; T_g is defined at η = 10¹² Pa·s (τ_K = η/K_s).</p>` : ""}
  </div></div>
  ${navbar(2, 4, "Next: compute / fit →")}`;
}
function renderRight3() {
  const act = activeDatasets();
  $("#right").innerHTML = `<div class="rhead"><h3>Thermal history${act.length ? " and data" : ""}</h3><span class="spacer"></span></div>
    <div class="plots">${card("p3T")}${act.map((d, j) => card("p3d" + j)).join("")}</div>${notYet()}`;
  if (S.hist) P("p3T", histPlotCfg({ band: -1 }));
  act.forEach((d, j) => plotDataset("p3d" + j, d, S.datasets.indexOf(d)));
}
// shown in steps 1–3: the model has not been run
function notYet() { return `<div class="empty" style="margin-top:10px">The model runs only when you click <b>Compute</b> (or <b>Run fit</b>) in step 4. Until then only the thermal history${S.datasets.length ? " and the data are" : " is"} shown.</div>`; }

/* ================= STEP 4: fit & evaluate ================= */
function renderLeft4() {
  const mode = S.mode4;
  const tabs = `<div class="tabs2" style="margin:0 0 10px"><button data-mode4="compute" aria-selected="${mode === "compute"}">Compute with chosen parameters</button><button data-mode4="fit" aria-selected="${mode === "fit"}">Fit parameters</button></div>`;
  if (mode === "compute") {
    const m = S.model, def = E.MODELDEFS[m], Pm = S.P[m];
    const rows = def.params.map(q => { const auto = m === "RP" && ((q.k === "A" && Pm.opt.Aauto) || (q.k === "pexp" && Pm.opt.pauto));
      return `<tr><td class="nm" title="${esc(q.tip || "")}">${q.label}${pUnit(q) ? ` <span class="note">(${pUnit(q)})</span>` : ""}</td><td><input type="number" data-cv="${q.k}" value="${+(+pShow(q.k, Pm.v[q.k])).toPrecision(7)}" step="any" ${auto ? "disabled" : ""}></td><td class="note">${auto ? (q.k === "A" ? "continuity" : "0.3082·m") : (q.discrete ? `step ${q.discrete}` : "")}</td></tr>`; }).join("");
    $("#left").innerHTML = `${tabs}
    <div class="card"><h2>Model &amp; parameters <span class="sub">forward calculation, no fitting</span></h2><div class="body">
      <label class="f">Model<select id="cModel">${Object.keys(E.MODELDEFS).map(k => `<option value="${k}" ${k === m ? "selected" : ""}>${E.MODELDEFS[k].name}</option>`).join("")}</select></label>
      <table class="pt" style="margin-top:8px"><tr><th>parameter</th><th>value</th><th></th></tr>${rows}</table>
      ${m === "TL" ? `<div class="grid2" style="margin-top:8px"><label class="f">N (T_v,i domains)<input type="number" id="cN" value="${Pm.opt.N}" min="20" max="400" step="10"></label></div>` : ""}
      ${m === "TNM" ? `<div class="grid2" style="margin-top:8px"><label class="f">Kernel<select id="tnmK"><option value="exact" ${Pm.opt.simKernel === "exact" ? "selected" : ""}>exact KWW summation</option><option value="prony" ${Pm.opt.simKernel === "prony" ? "selected" : ""}>Prony series</option></select></label></div>` : ""}
      ${m === "RP" ? `<div style="margin-top:8px"><label class="chk"><input type="checkbox" id="rpA" ${Pm.opt.Aauto ? "checked" : ""}> A from continuity at T_g</label><br><label class="chk"><input type="checkbox" id="rpP" ${Pm.opt.pauto ? "checked" : ""}> p = 0.3082·m</label></div>` : ""}
      ${S.model === "TL" ? `<label class="chk" style="margin-top:8px" title="One KWW fit of the X_i-weighted relaxation per sampled step (adds about a second)"><input type="checkbox" id="tlBeta" ${S.tlBeta ? "checked" : ""}> also compute the instantaneous β_KWW(T) (slower)</label>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn primary" id="cGo">Compute</button><span class="spacer"></span><button class="btn small" id="csvSim" ${S.sim ? "" : "disabled"}>Simulation (.csv)</button></div>
      <p class="note" id="cStat">${S.compRes ? esc(S.compRes.msg) : ""}</p>
      <p class="note">These are the same values as in step 3 (and are updated by a fit). ${activeDatasets().length ? "Active datasets are compared with the result below." : "No active datasets — the result is the simulation only."}</p>
    </div></div>
    <div id="resBox">${S.compRes ? resultsHTML(S.compRes) : ""}</div>
    ${navbar(3, null)}`;
    return;
  }
  const act = activeDatasets(), fr = freeList(S.model), job = S.job, R = S.fitRes;
  const canFit = act.length > 0 && fr.length > 0 && !!S.hist;
  const why = !S.hist ? "Build a valid thermal history first." : !act.length ? "No active datasets — use “Compute with chosen parameters”, or add data in step 2." : !fr.length ? "No free parameters — tick some in step 3." : "";
  $("#left").innerHTML = `${tabs}
  <div class="card"><h2>Fit settings</h2><div class="body">
    <div class="grid2">
      <label class="f full">Method<select id="fMethod"><option value="local" ${S.opts.method === "local" ? "selected" : ""}>Local — Levenberg–Marquardt</option><option value="global" ${S.opts.method === "global" ? "selected" : ""}>Global — differential evolution + LM polish</option></select></label>
      <label class="f">Max model runs<input type="number" id="fMax" value="${S.opts.maxEval}" min="50" step="50"></label>
      <label class="f full">Weighting<select id="fW"><option value="ds" ${!S.opts.perPoint ? "selected" : ""}>each dataset counts equally (residuals / σ_y / √N)</option><option value="pt" ${S.opts.perPoint ? "selected" : ""}>each point counts equally (residuals / σ_y)</option></select></label>
    </div>
    <p class="note">Free: ${fr.length ? fr.map(q => `${E.MODELDEFS[S.model].params.find(p => p.k === q.k).label} ∈ [${nf(pShow(q.k, q.lo))}, ${nf(pShow(q.k, q.hi))}]${ABS_T.has(q.k) ? " " + uL() : ""}`).join(", ") : "none"}. Linear scale/baseline coefficients of each dataset are solved exactly at every step.</p>
    ${S.model === "TL" ? `<label class="chk" style="margin-top:8px" title="One KWW fit of the X_i-weighted relaxation per sampled step (adds about a second)"><input type="checkbox" id="tlBeta" ${S.tlBeta ? "checked" : ""}> also compute the instantaneous β_KWW(T) (slower)</label>` : ""}
    <div class="row" style="margin-top:8px"><button class="btn primary" id="fGo" ${canFit && !job ? "" : "disabled"}>Run fit</button><button class="btn" id="fStop" ${job ? "" : "disabled"}>Stop</button><button class="btn" id="fUndo" ${S.fitUndo && !job ? "" : "disabled"}>Undo fit</button></div>
    ${why ? `<p class="note">${why}</p>` : ""}
    <div class="progress" ${job ? "" : "hidden"}><div id="fBar"></div></div><p class="note" id="fStat">${job ? "" : (R ? esc(R.msg) : "")}</p>
  </div></div>
  ${R ? resultsHTML(R) : ""}
  ${navbar(3, null)}`;
}
function resultsHTML(R) {
  R = R || curRes(); const def = E.MODELDEFS[R.model], U = R.unc, isFit = R.kind === "fit";
  const rows = def.params.map(q => { const v = R.best[q.k]; const fr = R.free.find(f => f.k === q.k); const j = U && U.names ? U.names.indexOf(q.k) : -1; const se = j >= 0 && U.se ? U.se[j] : NaN;
    const atB = fr && (Math.abs(v - fr.lo) < 1e-3 * (fr.hi - fr.lo) || Math.abs(v - fr.hi) < 1e-3 * (fr.hi - fr.lo));
    return `<tr><td class="nm">${q.label}${ABS_T.has(q.k) ? ` <span class="note">(${uL()})</span>` : ""}</td><td class="num">${nf(pShow(q.k, v), 6)}</td><td class="num">${fr ? (isFinite(se) ? "± " + nf(se, 2) : (q.discrete ? "grid" : "–")) : "fixed"}</td><td class="num">${fr ? `[${nf(pShow(q.k, fr.lo))}, ${nf(pShow(q.k, fr.hi))}]` : ""}</td><td>${atB ? '<span class="flag">at bound</span>' : ""}${fr && isFinite(se) && Math.abs(se) > Math.abs(v) && v !== 0 ? '<span class="flag">poorly determined</span>' : ""}</td></tr>`; }).join("");
  const dsRows = R.perDs.map(d => `<tr><td>${esc(d.name)}</td><td class="num">${d.nValid}/${d.n}</td><td class="num">${d.R2.toFixed(4)}</td><td class="num">${nf(d.rmse, 3)}</td><td style="font-size:11px">${d.lin ? d.lin.names.map((n, k) => d.lin.b[k] ? `${n}=${nf(d.lin.b[k], 3)}` : "").filter(Boolean).join(", ") : ""}</td></tr>`).join("");
  const exportRow = `<div class="row" style="margin-top:8px"><button class="btn small" id="expRep">Export report (.json)</button>${R.perDs.length ? `<button class="btn small" id="expCurves">Model vs data (.csv)</button>` : ""}<button class="btn small" id="csvSim">Simulation (.csv)</button></div>`;
  if (!isFit && !R.perDs.length) return `<div class="card"><h2>Result</h2><div class="body"><p class="note" style="margin:0">Simulation computed. Add data in step 2 to see R², RMSE and residuals.</p>${exportRow}</div></div>`;
  const qualityCard = `<div class="card"><h2>${isFit ? "Quality of fit" : "Agreement with data"}</h2><div class="body" style="overflow-x:auto">
    <table class="metrics"><tr><th>dataset</th><th>N</th><th>R²</th><th>RMSE</th><th>linear coefficients</th></tr>${dsRows}</table>
    <div class="summary" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
      <div class="stat"><b>${R.R2tot.toFixed(4)}</b><span>overall R² (weighted)</span></div><div class="stat"><b>${nf(R.chi2red, 3)}</b><span>reduced χ² (weighted)</span></div><div class="stat"><b>${R.k}</b><span>${isFit ? "fitted parameters (incl. linear)" : "linear coefficients solved"}</span></div>
      <div class="stat"><b>${nf(R.aic, 5)}</b><span>AIC</span></div><div class="stat"><b>${nf(R.bic, 5)}</b><span>BIC</span></div><div class="stat"><b>${isFit ? R.nev : nf(R.secs * 1000, 3) + " ms"}</b><span>${isFit ? `model runs · ${nf(R.secs, 3)} s` : "compute time"}</span></div>
    </div>
    ${R.nOut ? `<p class="note" style="color:var(--warn)">${R.nOut} data points fall outside the simulated range of their segment${isFit ? " and were penalized" : ""} — check segment limits.</p>` : ""}
    ${exportRow}
  </div></div>`;
  if (!isFit) return qualityCard;
  return `<div class="card"><h2>Parameters <span class="sub">${MODEL_NAMES[R.model]} · ±1 standard error</span></h2><div class="body" style="overflow-x:auto">
    <table class="metrics"><tr><th>parameter</th><th>value</th><th>SE</th><th>range</th><th></th></tr>${rows}</table>
    ${U && U.singular ? `<p class="note" style="color:var(--warn)">The Jacobian is singular — some free parameters are not identifiable from these data.</p>` : ""}</div></div>
  ${qualityCard}`;
}
function renderRight4() {
  const act = activeDatasets(), R0 = curRes(), R = R0 && R0.kind === "fit" ? R0 : null;
  if (!R0 || !S.sim) {   // nothing computed yet (or parameters changed since): history and data only
    const what = S.mode4 === "fit" ? "<b>Run fit</b>" : "<b>Compute</b>";
    $("#right").innerHTML = `<div class="rhead"><h3>Not computed yet</h3><span class="spacer"></span></div>${simStatus()}
      <div class="empty" style="margin-bottom:10px">Click ${what} to run the ${MODEL_NAMES[S.model]} model with the thermal history${act.length ? " and compare it with the data" : ""}.</div>
      <div class="plots">${card("p4T")}${act.map((d, j) => card("p4d" + j)).join("")}</div>`;
    if (S.hist) P("p4T", histPlotCfg({ band: -1 }));
    act.forEach((d, j) => plotDataset("p4d" + j, d, S.datasets.indexOf(d)));
    return;
  }
  $("#right").innerHTML = `<div class="rhead"><h3>${R ? "Fit result" : act.length ? `${MODEL_NAMES[S.model]} vs data (chosen parameters)` : `${MODEL_NAMES[S.model]} simulation`}</h3><span class="spacer"></span></div>${simStatus()}
    ${act.length ? `<div class="plots">${act.map((d, j) => card("p4d" + j)).join("")}</div><div style="height:10px"></div>` : ""}
    ${R ? `<div class="plots">${card("p4conv")}<div class="plotcard"><h3>Parameter correlation</h3><div id="corr" style="overflow-x:auto;padding:4px 0"></div></div></div><div style="height:10px"></div>` : ""}
    ${simOverviewHTML("o4")}`;
  act.forEach((d, j) => plotDataset("p4d" + j, d, S.datasets.indexOf(d), true));
  if (R) {
    P("p4conv", { title: "Convergence", xlabel: "model runs", ylabel: "weighted SSE", ylog: true, series: [{ name: "best so far", x: R.trace.map(p => p[0]), y: R.trace.map(p => p[1]), color: css("--c1"), w: 2 }], xshort: "runs", yshort: "SSE" });
    const U = R.unc, el = $("#corr");
    if (U && U.corr) { const lab = k => E.MODELDEFS[R.model].params.find(p => p.k === k).label;
      el.innerHTML = `<table class="corr"><tr><th></th>${U.names.map(n => `<th>${lab(n)}</th>`).join("")}</tr>${U.names.map((n, a) => `<tr><th>${lab(n)}</th>${U.corr[a].map((c, b) => { const v = Math.abs(c); const bg = a === b ? "var(--soft)" : `color-mix(in srgb, ${c > 0 ? "var(--c1)" : "var(--c2)"} ${Math.round(v * 70)}%, transparent)`; return `<td style="background:${bg};${v > 0.95 && a !== b ? "font-weight:700" : ""}">${a === b ? "1" : c.toFixed(2)}</td>`; }).join("")}</tr>`).join("")}</table><p class="note">|r| &gt; 0.95 (bold) means the two parameters trade off and are not separately determined by these data.</p>`; }
    else el.innerHTML = `<p class="note">${U && U.singular ? "Singular — parameters not identifiable." : "Only grid-searched parameters are free, so no covariance is available."}</p>`;
  }
  simOverviewPlot("o4");
}
function runFit() {
  const act = activeDatasets(); if (!act.length || S.job) return;
  const model = S.model, free = freeList(model), base = params(model);
  S.fitUndo = { model, v: { ...S.P[model].v } };
  const g = E.fit(model, base, free, S.hist, S.segs, act, { method: S.opts.method, maxEval: +S.opts.maxEval, perPoint: S.opts.perPoint, seed: S.opts.seed });
  S.job = { stop: false, t0: performance.now() }; S.fitRes = null; S.compRes = null; renderLeft4();
  const tick = () => {
    const tEnd = performance.now() + 35; let s;
    while (performance.now() < tEnd) { if (S.job.stop) break; s = g.next(); if (s.done) break; S.job.last = s.value; }
    const last = S.job.last;
    if (!S.job.stop && !(s && s.done)) { const bar = $("#fBar"); if (bar) bar.style.width = Math.min(100, 100 * last.nev / S.opts.maxEval) + "%"; const st = $("#fStat"); if (st) st.textContent = `${last.phase} · ${last.nev} model runs · weighted SSE ${nf(last.fbest, 4)}`; setTimeout(tick, 0); return; }
    const res = s && s.done ? s.value : { best: last.best, fbest: last.fbest, nev: last.nev, trace: [[0, last.fbest], [last.nev, last.fbest]] };
    finishFit(model, free, act, res, S.job.stop ? "Stopped early." : "Fit finished.");
  };
  setTimeout(tick, 0);
}
function curRes() { return S.mode4 === "fit" ? S.fitRes : S.compRes; }
// quality metrics of the current parameters of `model` against the active datasets
function metrics(model, free, act) {
  const best = params(model), ev = E.evaluate(model, best, S.hist, S.segs, act, { perPoint: S.opts.perPoint, exact: S.model === "TNM" && S.P.TNM.opt.simKernel === "exact" && S.hist.T.length < 4000 });
  const perDs = act.map((d, j) => ({ name: d.name, ...ev.perDs[j], lin: ev.perDs[j].pr.lin }));
  const nTot = ev.res.length, kLin = perDs.reduce((s, d) => s + (d.lin ? d.lin.b.filter(v => v !== 0).length : 0), 0), k = free.length + kLin;
  let wy = 0; act.forEach(d => { const w = (d.weight || 1) / (S.opts.perPoint ? 1 : d.x.length) / (d._sd * d._sd); let mu = 0; d.y.forEach(v => mu += v); mu /= d.y.length; d.y.forEach(v => wy += w * (v - mu) ** 2); });
  const wss = ev.sse;
  return { model, free, best, fbest: wss, perDs, R2tot: nTot ? 1 - wss / wy : NaN, chi2red: wss / Math.max(1, nTot - k), aic: nTot ? nTot * Math.log(wss / nTot) + 2 * k : NaN, bic: nTot ? nTot * Math.log(wss / nTot) + k * Math.log(nTot) : NaN, k, nOut: perDs.reduce((s, d) => s + (d.n - d.nValid), 0) };
}
function finishFit(model, free, act, res, msg) {
  const secs = (performance.now() - S.job.t0) / 1000; S.job = null;
  E.MODELDEFS[model].params.forEach(q => { S.P[model].v[q.k] = res.best[q.k]; });
  if (model === "RP") { if (S.P.RP.opt.Aauto) S.P.RP.v.A = MODELS.continuityA({ ...res.best }); if (S.P.RP.opt.pauto) S.P.RP.v.pexp = 0.3082153 * res.best.m; }
  runModel();
  let unc = null; try { unc = E.uncertainty(model, params(model), free, S.hist, S.segs, act, { perPoint: S.opts.perPoint }); } catch (e) { unc = null; }
  const M = metrics(model, free, act);
  S.fitRes = { kind: "fit", ...M, nev: res.nev, trace: res.trace && res.trace.length ? res.trace : [[0, M.fbest]], unc, secs, msg: `${msg} ${res.nev} model runs in ${nf(secs, 3)} s.` };
  S.compRes = null; render();
}
// forward calculation with the chosen parameters (no fitting)
function computeNow() {
  const t0 = performance.now(); runModel();
  if (!S.sim) { S.compRes = null; return; }
  const act = activeDatasets(); act.forEach(E.dsPrepare);
  const M = metrics(S.model, [], act);
  S.compRes = { kind: "compute", ...M, nev: 1, secs: (performance.now() - t0) / 1000, unc: null, trace: [], msg: `Computed with the chosen ${MODEL_NAMES[S.model]} parameters in ${nf(performance.now() - t0, 3)} ms.` };
}
let compTimer = null;
function scheduleCompute() { clearTimeout(compTimer); compTimer = setTimeout(() => { computeNow(); const rb = $("#resBox"); if (rb) rb.innerHTML = S.compRes ? resultsHTML(S.compRes) : ""; const st = $("#cStat"); if (st) st.textContent = S.simErr ? "" : (S.compRes ? S.compRes.msg : ""); renderStepper(); renderRight4(); }, 200); }

/* ================= exports ================= */
function exportSimCSV() {
  if (!S.sim) return; const h = S.hist, s = S.sim; const rows = ["t_s,T_K,Tf_K,tau_s,tau_eq_s,segment"];
  for (let i = 0; i < h.T.length; i++) rows.push([h.t[i], h.T[i], s.Tf[i], s.tau[i], s.tauEq[i], h.seg[i] + 1].join(","));
  dl(new Blob([rows.join("\n")], { type: "text/csv" }), `simulation_${S.model}.csv`);
}
function exportCurves() {
  const rows = ["dataset,kind,segment,x,y_data,y_model,residual"];
  activeDatasets().forEach(d => { const ev = evalFor(d); d.x.forEach((x, k) => { const yh = ev ? ev.pr.yhat[k] : NaN; rows.push([`"${d.name}"`, d.kind, d.seg + 1, x, d.y[k], isFinite(yh) ? yh : "", isFinite(yh) ? d.y[k] - yh : ""].join(",")); }); });
  dl(new Blob([rows.join("\n")], { type: "text/csv" }), "model_vs_data.csv");
}
function exportReport() {
  const R = curRes(); if (!R) return;
  const rep = { created: new Date().toISOString(), model: R.model, mode: R.kind, parameters: Object.fromEntries(E.MODELDEFS[R.model].params.map(q => [q.k, { value: R.best[q.k], free: !!R.free.find(f => f.k === q.k), se: R.unc && R.unc.names ? R.unc.se[R.unc.names.indexOf(q.k)] ?? null : null }])),
    correlation: R.unc && R.unc.corr ? { names: R.unc.names, matrix: R.unc.corr } : null, quality: R.perDs.length ? { R2_weighted: R.R2tot, chi2_reduced: R.chi2red, AIC: R.aic, BIC: R.bic, model_runs: R.nev } : null,
    datasets: R.perDs.map(d => ({ name: d.name, n: d.n, n_valid: d.nValid, R2: d.R2, rmse: d.rmse, linear: d.lin ? Object.fromEntries(d.lin.names.map((n, k) => [n, d.lin.b[k]])) : null })), history: { T0: S.T0, segments: S.segs }, fit_options: S.opts };
  dl(new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" }), `${R.kind === "fit" ? "fit" : "compute"}_report_${R.model}.json`);
}
function saveProject() {
  const proj = { app: "Relaxation Fitter", version: 1, T0: S.T0, segs: S.segs, model: S.model, P: S.P, opts: S.opts,
    datasets: S.datasets.map(d => ({ name: d.name, kind: d.kind, seg: d.seg, xAll: d.xAll, yAll: d.yAll, xmin: isFinite(d.xmin) ? d.xmin : null, xmax: isFinite(d.xmax) ? d.xmax : null, weight: d.weight, scale: d.scale, enabled: d.enabled })) };
  dl(new Blob([JSON.stringify(proj)], { type: "application/json" }), "relaxation_project.json");
}
function openProject(obj) {
  if (!obj || !Array.isArray(obj.segs)) throw new Error("not a Relaxation Fitter project");
  S.T0 = obj.T0; S.segs = obj.segs; S.model = obj.model || "TL"; const fresh = freshParams();
  for (const m of Object.keys(fresh)) if (obj.P && obj.P[m]) for (const part of ["v", "free", "lo", "hi", "opt"]) Object.assign(fresh[m][part], obj.P[m][part] || {});
  S.P = fresh; S.opts = { ...S.opts, ...(obj.opts || {}) };
  S.datasets = (obj.datasets || []).map(d => { const ds = { ...d, xmin: d.xmin === null ? NaN : d.xmin, xmax: d.xmax === null ? NaN : d.xmax }; dsFilter(ds); return ds; });
  S.selDs = S.datasets.length ? 0 : -1; S.selSeg = 0; S.fitRes = null; S.compRes = null; S.fitUndo = null; S.editor = null; recompile(); simulateNow();
}

/* ================= examples ================= */
function autoBounds(m) {
  const Pm = S.P[m], v = Pm.v;
  const set = (k, lo, hi) => { if (k in v) { Pm.lo[k] = +lo.toPrecision(4); Pm.hi[k] = +hi.toPrecision(4); } };
  set("Tg", v.Tg - 40, v.Tg + 40); set("m", Math.max(12, v.m * 0.5), v.m * 2);
  if (m === "TL") { set("log10tau0", v.log10tau0 - 10, Math.min(-5, v.log10tau0 + 10)); }
  if (m === "RP") { set("B", 0, Math.max(2e4, v.B * 5)); set("C", 0, Math.max(500, v.C * 5)); set("pexp", 0.1, Math.max(50, v.pexp * 5)); set("A", v.A - 50, v.A + 50); }
}
function loadGeAsSe(c) {
  const e = EXAMPLES.geasse[c]; if (!e) return;
  S.T0 = e.Tmax; S.segs = [{ type: "ramp", T: e.Tmin, rate: 10, dT: 0.5 }, { type: "ramp", T: e.Tmax, rate: 10, dT: 0.5 }];
  S.datasets = []; ["cooling", "heating"].forEach((d, j) => { const cv = e.curves[d]; if (!cv) return; const ds = { name: `${c} ${d} 10 K/min`, kind: "cp_norm", seg: j, xAll: cv.T, yAll: cv.y, xmin: NaN, xmax: NaN, weight: 1, scale: false, enabled: true }; dsFilter(ds); S.datasets.push(ds); });
  S.model = "TL";
  if (e.fit) { const v = S.P.TL.v; v.Tg = +e.fit.Tg_K.toFixed(3); v.m = e.fit.m; v.log10tau0 = +e.fit.log10_tau0.toFixed(4); v.f = Math.round(e.fit.f * 100) / 100; v.beta0 = e.fit.beta0; }
  else { const cv = e.curves.cooling; let Tg = (e.Tmin + e.Tmax) / 2; if (cv) for (let i = 1; i < cv.T.length; i++) if ((cv.y[i - 1] - 0.5) * (cv.y[i] - 0.5) <= 0) { Tg = cv.T[i]; break; } S.P.TL.v.Tg = Tg; }
  ["TNM", "RP"].forEach(m => { S.P[m].v.Tg = S.P.TL.v.Tg; S.P[m].v.m = S.P.TL.v.m; });
  ["TL", "TNM", "RP"].forEach(autoBounds);
  S.selDs = 1; S.selSeg = 1; S.fitRes = null; S.compRes = null; S.fitUndo = null; S.editor = null; recompile(); simulateNow();
}
function synthExample(kind) {
  const gl = TL_PRESETS["Selenium"]; S.model = kind === "aging" ? "TNM" : "TL"; S.P = freshParams();
  const v = S.P.TL.v; [v.Tg, v.m, v.log10tau0, v.f, v.beta0] = gl; S.P.TNM.v.Tg = gl[0]; S.P.TNM.v.m = gl[1]; ["TL", "TNM", "RP"].forEach(autoBounds);
  const Tg = gl[0]; S.T0 = Tg + 40; S.datasets = []; S.fitRes = null; S.compRes = null; S.fitUndo = null; S.editor = null;
  if (kind === "aging") S.segs = TEMPLATES.aging.f(Tg).map(s => ({ ...s, T: s.T !== undefined ? +s.T.toFixed(2) : s.T }));
  else S.segs = TEMPLATES.mdsc.f(Tg).map(s => ({ ...s, T: +s.T.toFixed(2) }));
  recompile();
  // truth parameters differ from the starting values, so the fit has something to do
  const truth = kind === "aging" ? { Tg: Tg + 3, m: 58, x: 0.42, beta: 0.52 } : { ...S.P.TL.v, Tg: Tg + 2, f: 0.58, N: 200 };
  const model = S.model, sim = E.simulate(model, { ...params(model), ...truth }, S.hist), rng = E.mulberry(11), gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  const make = (name, kind2, seg, xs, noise, f) => { const raw = { cp_raw: "cp_norm", P_t: "tf_t" }[kind2] || kind2; const c = E.predict({ kind: raw, seg, x: [], y: [] }, S.hist, sim, S.segs).curve;
    const y = xs.map(x => { const m = E.interp(c.x, c.y, x); return (f ? f(x, m) : m) + noise * gauss(); }); const ds = { name, kind: kind2, seg, xAll: xs, yAll: y, xmin: NaN, xmax: NaN, weight: 1, scale: false, enabled: true }; dsFilter(ds); S.datasets.push(ds); };
  const lin = (a, b, n) => Array.from({ length: n }, (_, k) => a + (b - a) * k / (n - 1)), logs = (a, b, n) => Array.from({ length: n }, (_, k) => a * Math.pow(b / a, k / (n - 1)));
  if (kind === "aging") { make("enthalpy relaxation during aging (synthetic)", "P_t", 1, logs(3, 1e5, 25), 0.02, (x, tf) => 0.35 * tf); make("DSC heating C_p, raw (synthetic)", "cp_raw", 3, lin(Tg - 50, Tg + 35, 120), 0.004, (T, c) => 1.2 + 0.002 * T + 0.45 * c); }
  else { make("MDSC C_p′ (synthetic)", "mdsc_re", 1, lin(Tg - 40, Tg + 35, 90), 0.01); make("MDSC C_p″ (synthetic)", "mdsc_im", 1, lin(Tg - 40, Tg + 35, 90), 0.006); }
  S.selDs = 0; S.selSeg = 1; simulateNow();
}
function buildExampleMenu() {
  $("#exList").innerHTML = `<button class="item" data-ex="default">Selenium DSC cycle (TL, simulation only)</button>
    <button class="item" data-ex="aging">Aging + DSC with synthetic enthalpy data (TNM)</button>
    <button class="item" data-ex="mdsc">MDSC with synthetic C_p′ / C_p″ (TL)</button>
    ${Object.keys(EXAMPLES.geasse || {}).length ? `<hr><div class="note" style="padding:0 8px 4px">Ge–As–Se DSC (10 K/min) — also in step 2</div>
    <div class="inrow" style="padding:0 6px 4px"><select id="exComp2" style="flex:1;width:auto">${Object.keys(EXAMPLES.geasse || {}).map(c => `<option>${c}</option>`).join("")}</select><button class="btn small" data-ex="geasse">Load</button></div>` : ""}`;
}

/* ================= events ================= */
document.addEventListener("click", e => {
  const t = e.target.closest("button,[data-selseg],[data-selds],label.mcard,.item");
  if (!e.target.closest(".menu")) $$(".menu").forEach(m => m.classList.remove("open"));
  if (!t) return;
  if (t.dataset.menu !== undefined) { const m = t.parentElement; const was = m.classList.contains("open"); $$(".menu").forEach(x => x.classList.remove("open")); if (!was) m.classList.add("open"); return; }
  if (t.dataset.step) { go(+t.dataset.step); return; }
  if (t.dataset.go) { go(+t.dataset.go); return; }
  if (t.dataset.ex) { const k = t.dataset.ex; $$(".menu").forEach(m => m.classList.remove("open"));
    if (k === "default") { S.P = freshParams(); S.model = "TL"; defaultHistory(308.13); S.datasets = []; S.selDs = -1; S.fitRes = null; S.compRes = null; recompile(); simulateNow(); }
    else if (k === "geasse") loadGeAsSe($("#exComp2").value); else synthExample(k);
    go(k === "default" ? 1 : 2); return; }
  if (t.id === "pNew") { if (confirm("Start a new project? Unsaved changes are lost.")) { S.P = freshParams(); S.model = "TL"; defaultHistory(308.13); S.datasets = []; S.selDs = -1; S.fitRes = null; S.compRes = null; S.fitUndo = null; recompile(); simulateNow(); go(1); } return; }
  if (t.id === "pSave") { saveProject(); return; }
  if (t.id === "themeBtn") { const r = document.documentElement, cur = r.dataset.theme || "light"; r.dataset.theme = cur === "dark" ? "light" : "dark"; renderRight(); return; }
  if (t.id === "csvSim") { exportSimCSV(); return; }
  // step 1
  if (t.dataset.add) { const last = S.hist ? S.hist.T[S.hist.T.length - 1] : S.T0, Tg = S.P[S.model].v.Tg;
    const seg = { ramp: { type: "ramp", T: +(last > Tg ? Tg - 60 : Tg + 40).toFixed(2), rate: 10, dT: 0.5 }, hold: { type: "hold", dur: 3600, n: 100, t1: 0.1 }, jump: { type: "jump", T: +(last + 10).toFixed(2) }, mdsc: { type: "mdsc", T: +(last > Tg ? Tg - 40 : Tg + 40).toFixed(2), rate: 2, A: 0.5, P: 60, ppp: 30 } }[t.dataset.add];
    S.segs.push(seg); S.selSeg = S.segs.length - 1; recompile(); S.fitRes = null; S.compRes = null; invalidate(); render(); return; }
  if (t.dataset.del !== undefined) { const i = +t.dataset.del; S.segs.splice(i, 1); S.datasets.forEach(d => { if (d.seg > i) d.seg--; else if (d.seg === i) d.seg = -1; }); S.selSeg = Math.max(0, Math.min(S.selSeg, S.segs.length - 1)); recompile(); S.fitRes = null; S.compRes = null; invalidate(); render(); return; }
  if (t.dataset.dup !== undefined) { const i = +t.dataset.dup; S.segs.splice(i + 1, 0, JSON.parse(JSON.stringify(S.segs[i]))); S.datasets.forEach(d => { if (d.seg > i) d.seg++; }); S.selSeg = i + 1; recompile(); invalidate(); render(); return; }
  if (t.dataset.mv !== undefined) { const i = +t.dataset.mv, j = i + (+t.dataset.d); if (j < 0 || j >= S.segs.length) return; [S.segs[i], S.segs[j]] = [S.segs[j], S.segs[i]]; S.datasets.forEach(d => { if (d.seg === i) d.seg = j; else if (d.seg === j) d.seg = i; }); S.selSeg = j; recompile(); invalidate(); render(); return; }
  if (t.dataset.selseg !== undefined) { S.selSeg = +t.dataset.selseg; $$(".seg").forEach(el => el.classList.toggle("sel", +el.dataset.seg === S.selSeg)); if (S.step === 1) { P("p1T", histPlotCfg()); P("p1dt", dtPlotCfg()); } return; }
  // step 2
  if (t.id === "dsAdd") { S.editor = newEditor(); renderLeft2(); return; }
  if (t.id === "edClose") { S.editor = null; renderLeft2(); return; }
  if (t.dataset.src) { S.editor.src = t.dataset.src; renderLeft2(); return; }
  if (t.id === "edOk") { commitEditor(); return; }
  if (t.dataset.edit !== undefined) { e.stopPropagation(); const i = +t.dataset.edit, d = S.datasets[i]; S.editor = { ...newEditor(d.kind), mode: "edit", idx: i, seg: d.seg, xmin: isFinite(d.xmin) ? (E.KINDS[d.kind].axis === "T" ? tIn(d.xmin) : d.xmin) : "", xmax: isFinite(d.xmax) ? (E.KINDS[d.kind].axis === "T" ? tIn(d.xmax) : d.xmax) : "", weight: d.weight, scale: d.scale, name: d.name }; S.selDs = i; render(); return; }
  if (t.dataset.deld !== undefined) { e.stopPropagation(); S.datasets.splice(+t.dataset.deld, 1); S.selDs = Math.min(S.selDs, S.datasets.length - 1); S.fitRes = null; S.compRes = null; S.editor = null; simulateNow(); render(); return; }
  if (t.dataset.selds !== undefined && !e.target.matches("input")) { S.selDs = +t.dataset.selds; renderLeft2(); renderRight2(); return; }
  if (t.id === "exLoad") { loadGeAsSe($("#exComp").value); render(); return; }
  // step 3
  if (t.id === "autoB") { autoBounds(S.model); renderLeft3(); return; }
  if (t.id === "rpExample") { Object.assign(S.P.RP.v, { Tg: 734.5, m: 35.3, eta_inf: -2.9, A: 45.19, B: 4136.7, C: 135.09, pexp: 10.88, log10Ks: 10.544068, beta: 3 / 7 }); S.P.RP.opt.Aauto = false; S.P.RP.opt.pauto = false; autoBounds("RP"); scheduleSim(); renderLeft3(); return; }
  // step 4
  if (t.dataset.mode4) { S.mode4 = t.dataset.mode4; render(); return; }
  if (t.id === "cGo") { computeNow(); render(); return; }
  if (t.id === "fGo") { runFit(); return; }
  if (t.id === "fStop") { if (S.job) S.job.stop = true; return; }
  if (t.id === "fUndo") { const u = S.fitUndo; if (!u) return; Object.assign(S.P[u.model].v, u.v); S.model = u.model; S.fitUndo = null; S.fitRes = null; S.compRes = null; simulateNow(); render(); return; }
  if (t.id === "expRep") { exportReport(); return; }
  if (t.id === "expCurves") { exportCurves(); return; }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.i !== undefined && t.closest("#segList")) { onSegInput(t, false); return; }
  if (t.id === "T0") { const v = parseFloat(t.value); if (isFinite(v)) { S.T0 = tK(v); recompile(); S.fitRes = null; S.compRes = null; S.segs.forEach((_, j) => { const el = document.getElementById("res-" + j); if (el) el.innerHTML = segRes(j); }); renderStepper(); invalidate(); renderStepper(); P("p1T", histPlotCfg()); P("p1dt", dtPlotCfg()); } return; }
  // editor fields
  if (S.editor && t.closest("#editor")) {
    const ed = S.editor, map = { edXmin: "xmin", edXmax: "xmax", edW: "weight", edYS: "yscale", edName: "name" };
    if (map[t.id]) ed[map[t.id]] = t.value;
    const sy = { syX0: "x0", syX1: "x1", syN: "n", syNoise: "noise", syA: "a", syB: "b", syC: "c", syD: "d" }; if (sy[t.id]) ed.syn[sy[t.id]] = t.value;
    if (t.id === "edText") { ed.text = t.value; clearTimeout(ed._t); ed._t = setTimeout(() => { ed.parsed = parseTable(ed.text); if (ed.parsed.cols.length < 2) ed.parsed = null; else { ed.xcol = 0; ed.ycol = Math.min(1, ed.parsed.cols.length - 1); } const pos = t.selectionStart; renderLeft2(); const ta = $("#edText"); if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = pos; } }, 400); }
    return;
  }
  // params
  if (t.dataset.pv) { const v = parseFloat(t.value); if (isFinite(v)) { S.P[S.model].v[t.dataset.pv] = pStore(t.dataset.pv, v); S.fitRes = null; S.compRes = null; scheduleSim(renderRight3); } return; }
  if (t.dataset.plo) { const v = parseFloat(t.value); if (isFinite(v)) S.P[S.model].lo[t.dataset.plo] = pStore(t.dataset.plo, v); renderStepper(); return; }
  if (t.dataset.phi) { const v = parseFloat(t.value); if (isFinite(v)) S.P[S.model].hi[t.dataset.phi] = pStore(t.dataset.phi, v); renderStepper(); return; }
  if (t.dataset.cv) { const v = parseFloat(t.value); if (isFinite(v)) { S.P[S.model].v[t.dataset.cv] = pStore(t.dataset.cv, v); invalidate(); refresh4(); } return; }
  if (t.id === "cN") { const v = Math.round(+t.value); if (v >= 20 && v <= 400) { S.P.TL.opt.N = v; invalidate(); refresh4(); } return; }
  if (t.id === "tlN") { const v = Math.round(+t.value); if (v >= 20 && v <= 400) { S.P.TL.opt.N = v; scheduleSim(renderRight3); } return; }
  if (t.id === "fMax") { S.opts.maxEval = Math.max(50, +t.value || 1500); return; }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.i !== undefined && t.closest("#segList")) { onSegInput(t, true); return; }
  if (t.id === "tpl" && t.value) { const Tg = S.P[S.model].v.Tg; S.segs = TEMPLATES[t.value].f(Tg).map(s => { const o = { ...s }; if (o.T !== undefined) o.T = +o.T.toFixed(2); return o; }); S.T0 = +(t.value === "tjump" || t.value === "qiso" ? Tg + 5 : Tg + 40).toFixed(2); if (t.value === "qiso") S.T0 = +(Tg + 5).toFixed(2); S.selSeg = 0; S.datasets.forEach(d => { if (d.seg >= S.segs.length) d.seg = -1; }); recompile(); S.fitRes = null; S.compRes = null; simulateNow(); render(); return; }
  if (t.id === "unit") { S.unit = t.value; render(); return; }
  if (t.id === "tlBeta") { S.tlBeta = t.checked; if (S.step === 4 && S.sim) { const w = $("#right"), y = w.scrollTop; renderRight4(); w.scrollTop = y; } return; }
  if (t.id === "tscale") { S.tmode = t.value; renderRight(); return; }
  if (t.id === "pOpen") { const f = t.files[0]; if (!f) return; f.text().then(txt => { try { openProject(JSON.parse(txt)); go(1); } catch (err) { alert("Could not open project: " + err.message); } }); t.value = ""; return; }
  // datasets
  if (t.dataset.en !== undefined) { S.datasets[+t.dataset.en].enabled = t.checked; S.fitRes = null; S.compRes = null; simulateNow(); renderStepper(); renderRight2(); return; }
  if (S.editor && t.closest("#editor")) {
    const ed = S.editor;
    if (t.id === "edKind") { ed.kind = t.value; const cs = compatSegs(ed.kind); if (!cs.includes(+ed.seg)) ed.seg = cs[0] !== undefined ? cs[0] : ""; ed.xunit = E.KINDS[ed.kind].axis === "T" ? S.unit : "s"; renderLeft2(); return; }
    if (t.id === "edSeg") { ed.seg = +t.value; return; }
    if (t.id === "edX") { ed.xcol = +t.value; return; } if (t.id === "edY") { ed.ycol = +t.value; return; } if (t.id === "edXU") { ed.xunit = t.value; return; }
    if (t.id === "edScale") { ed.scale = t.checked; return; }
    if (t.id === "edFile") { const f = t.files[0]; if (!f) return; f.text().then(txt => { ed.text = txt.length > 400000 ? txt.slice(0, 400000) : txt; ed.parsed = parseTable(txt); if (ed.parsed.cols.length < 2) ed.parsed = null; if (!ed.name) ed.name = f.name.replace(/\.[^.]+$/, ""); renderLeft2(); }); return; }
  }
  // model
  if (t.id === "cModel") { S.model = t.value; invalidate(); render(); return; }
  if (t.name === "model") { S.model = t.value; S.fitRes = null; S.compRes = null; simulateNow(); render(); return; }
  if (t.dataset.pf) { S.P[S.model].free[t.dataset.pf] = t.checked; t.closest("tr").classList.toggle("fixed", !t.checked); renderStepper(); return; }
  if (t.id === "tlPreset" && t.value) { const pr = TL_PRESETS[t.value], v = S.P.TL.v; [v.Tg, v.m, v.log10tau0, v.f, v.beta0] = pr; autoBounds("TL"); simulateNow(); render(); return; }
  if (t.id === "tnmK") { S.P.TNM.opt.simKernel = t.value; invalidate(); render(); return; }
  if (t.id === "rpA") { S.P.RP.opt.Aauto = t.checked; if (t.checked) S.P.RP.free.A = false; invalidate(); render(); return; }
  if (t.id === "rpP") { S.P.RP.opt.pauto = t.checked; if (t.checked) S.P.RP.free.pexp = false; invalidate(); render(); return; }
  // fit options
  if (t.id === "fMethod") { S.opts.method = t.value; if (t.value === "global" && S.opts.maxEval < 3000) { S.opts.maxEval = 3000; renderLeft4(); } return; }
  if (t.id === "fW") { S.opts.perPoint = t.value === "pt"; S.fitRes = null; S.compRes = null; simulateNow(); render(); return; }
});

/* ================= init ================= */
buildExampleMenu(); recompile(); simulateNow(); render();
})();
