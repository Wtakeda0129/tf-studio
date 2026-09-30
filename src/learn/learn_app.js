/* Learn page: interactive comparison of the T_f,i distributions of TNM, MAP (RelaxPy) and TL */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const COL = { TNM: "var(--mTNM)", MAP: "var(--mMAP)", TL: "var(--mTL)" };
  let R = null, TLQ = [], DOM = null, BETA = null, timer = null;

  const svg = PLOT.svg;

  /* ---------- history axis: left half = cooling (T), right half = annealing (log t) ---------- */
  let HX = null;
  function makeHX(H) {
    const nc = H.nCool, lt0 = -1, lt1 = Math.log10(H.t[H.t.length - 1] - H.tCool);
    const pos = new Float64Array(H.T.length);
    for (let i = 0; i < H.T.length; i++) pos[i] = i < nc ? 0.5 * i / (nc - 1) : 0.5 + 0.5 * (Math.log10(H.t[i] - H.tCool) - lt0) / (lt1 - lt0);
    const ticks = [];
    const T0 = H.T[0], Ta = H.T[nc - 1];
    for (let T = Math.ceil(Ta / 20) * 20; T <= T0; T += 20) ticks.push([0.5 * (T0 - T) / (T0 - Ta), String(T)]);
    for (let e = 0; e <= lt1; e += 2) ticks.push([0.5 + 0.5 * (e - lt0) / (lt1 - lt0), e === 0 ? "1 s" : "10<tspan dy='-4' font-size='8'>" + e + "</tspan>"]);
    return { pos, ticks };
  }

  /* ---------- run + precompute ---------- */
  function compute() {
    const q = +$("#q").value, Ta = +$("#Ta").value, f = +$("#f").value;
    R = LEARN.runAll({ q, Ta, f, tmax: 1e6 });
    HX = makeHX(R.H);
    // TL domains at cumulative weight quantiles (Tv,i increases with i)
    const Y = R.Y, N = R.N; TLQ = [];
    let c = 0, qi = 0; const qs = [0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85, 0.95];
    for (let k = 0; k < N && qi < qs.length; k++) { c += Y[k]; while (qi < qs.length && c >= qs[qi]) { TLQ.push(k); qi++; } }
    // shared y range for the trajectory plots and x range for the distributions
    let lo = Infinity, hi = -Infinity; const n = R.H.T.length;
    const upd = v => { if (v < lo) lo = v; if (v > hi) hi = v; };
    for (let i = 0; i < n; i++) { upd(R.H.T[i]); TLQ.forEach(k => upd(R.tl.TfiAll[i * N + k])); }
    DOM = [Math.floor((lo - 3) / 5) * 5, Math.ceil((hi + 3) / 5) * 5];
    // β_KWW(T) in equilibrium
    if (!BETA || BETA.f !== f) {
      const Ts = [], b = [];
      for (let T = LEARN.GLASS.Tg - 30; T <= LEARN.GLASS.Tg + 120.1; T += 5) { Ts.push(T); b.push(LEARN.tlBeta(f, T)); }
      BETA = { f, Ts, b };
    }
    $("#step").max = n - 1;
    $("#TaO").textContent = Ta.toFixed(2) + " K"; $("#fO").textContent = f.toFixed(2);
    $("#betaNote").innerHTML = `TNM and MAP use β = ${R.beta.toFixed(2)} (the TL β<sub>KWW</sub> at T<sub>g</sub>), MAP with a ${R.NP}-term Prony series. TNM x = ${LEARN.TNM_X}.`;
    drawStatic();
  }

  /* ---------- static plots (redrawn when parameters change) ---------- */
  let staticTraj = {};
  function trajCfg(model) {
    const n = R.H.T.length, X = HX.pos, lines = [];
    lines.push({ x: X, y: R.H.T, color: "var(--muted)", w: 1.3, dash: "4 3" });
    if (model === "TNM") lines.push({ x: X, y: R.tnm.Tf, color: COL.TNM, w: 2.6 });
    if (model === "MAP") {
      const wmax = Math.max(...R.w);
      for (let q = 0; q < R.NP; q++) { const y = new Float64Array(n); for (let i = 0; i < n; i++) y[i] = R.map.comp[i * R.NP + q]; lines.push({ x: X, y, color: COL.MAP, w: 1.2, op: 0.18 + 0.8 * Math.sqrt(R.w[q] / wmax) }); }
      lines.push({ x: X, y: R.map.Tf, color: COL.MAP, w: 2.8 });
    }
    if (model === "TL") {
      TLQ.forEach(k => { const y = new Float64Array(n); for (let i = 0; i < n; i++) y[i] = R.tl.TfiAll[i * R.N + k]; lines.push({ x: X, y, color: COL.TL, w: 1.1, op: 0.55 }); });
      lines.push({ x: X, y: R.tl.Tf, color: COL.TL, w: 2.8 });
    }
    return { W: 380, H: 220, xdom: [0, 1], ydom: DOM, xticks: HX.ticks, lines, shade: [[0.5, 1]], xlabel: "cooling: T (K)   |   annealing: t (s)", ylabel: "T<tspan dy='3' font-size='9'>f,i</tspan><tspan dy='-3'> (K)</tspan>" };
  }
  function drawStatic() { ["TNM", "MAP", "TL"].forEach(k => { staticTraj[k] = trajCfg(k); }); drawStep(); }

  /* ---------- per-step plots ---------- */
  function distCfg(model, i) {
    const T = R.H.T[i], cfg = { W: 380, H: 170, xdom: DOM, xlabel: "T<tspan dy='3' font-size='9'>f,i</tspan><tspan dy='-3'> (K)</tspan>", ylabel: "weight", vlines: [{ x: T, color: "var(--muted)", dash: "4 3" }] };
    let mean, sd;
    if (model === "TNM") { mean = R.tnm.Tf[i]; sd = 0; cfg.ydom = [0, 1.1]; cfg.sticks = [{ x: mean, y: 1, color: COL.TNM, w: 4 }]; }
    if (model === "MAP") {
      const v = Array.from({ length: R.NP }, (_, q) => R.map.comp[i * R.NP + q]); [mean, sd] = LEARN.wstats(R.w, v);
      cfg.ydom = [0, Math.max(...R.w) * 1.15]; cfg.sticks = v.map((x, q) => ({ x, y: R.w[q], color: COL.MAP, w: 3, op: 0.8 }));
    }
    if (model === "TL") {
      const v = new Float64Array(R.N); for (let k = 0; k < R.N; k++) v[k] = R.tl.TfiAll[i * R.N + k]; [mean, sd] = LEARN.wstats(R.Y, v);
      const nb = 48, w = (DOM[1] - DOM[0]) / nb, h = new Float64Array(nb);
      for (let k = 0; k < R.N; k++) { const b = Math.floor((v[k] - DOM[0]) / w); if (b >= 0 && b < nb) h[b] += R.Y[k]; }
      cfg.bars = Array.from(h, (y, b) => ({ x0: DOM[0] + b * w, x1: DOM[0] + (b + 1) * w, y, color: COL.TL, op: 0.6 }));
      cfg.ydom = [0, Math.max(0.02, ...h) * 1.15];
    }
    cfg.vlines.push({ x: mean, color: COL[model], w: 2 });
    return { cfg, mean, sd };
  }
  function drawStep() {
    if (!R) return;
    const i = +$("#step").value, H = R.H, nc = H.nCool, T = H.T[i];
    const phase = i < nc ? `Cooling at ${$("#q").value} K/min: <b>T = ${T.toFixed(1)} K</b> (T − T<sub>g</sub> = ${(T - LEARN.GLASS.Tg).toFixed(1)} K)` : `Annealing at <b>T<sub>a</sub> = ${T.toFixed(1)} K</b> for <b>t = ${(H.t[i] - H.tCool).toPrecision(2)} s</b>`;
    $("#state").innerHTML = phase + (i === 0 ? ". Equilibrium liquid." : "");
    ["TNM", "MAP", "TL"].forEach(k => {
      const card = document.getElementById("c-" + k), st = staticTraj[k];
      const dots = [];
      const x = HX.pos[i];
      if (k === "TNM") dots.push({ x, y: R.tnm.Tf[i], color: COL.TNM, r: 4 });
      if (k === "MAP") { for (let q = 0; q < R.NP; q++) dots.push({ x, y: R.map.comp[i * R.NP + q], color: COL.MAP, r: 2.4, op: 0.8 }); dots.push({ x, y: R.map.Tf[i], color: COL.MAP, r: 4 }); }
      if (k === "TL") { TLQ.forEach(q => dots.push({ x, y: R.tl.TfiAll[i * R.N + q], color: COL.TL, r: 2.4, op: 0.8 })); dots.push({ x, y: R.tl.Tf[i], color: COL.TL, r: 4 }); }
      card.querySelector(".traj").innerHTML = svg({ ...st, vlines: [{ x, color: "var(--ink)", w: 1, dash: "2 3" }], dots });
      const d = distCfg(k, i);
      card.querySelector(".dist").innerHTML = svg(d.cfg);
      card.querySelector(".read").innerHTML = `⟨T<sub>f</sub>⟩ = <b>${d.mean.toFixed(1)} K</b> · δT<sub>f</sub> = <b>${d.sd.toFixed(2)} K</b>` + (k === "MAP" || k === "TNM" ? (d.sd < 0.05 ? " · single value" : "") : "");
    });
    // δT_f vs history
    const X = HX.pos, zero = new Float64Array(X.length);
    const smax = Math.max(...R.sig.TL, ...R.sig.MAP) * 1.1;
    $("#sig").innerHTML = svg({ W: 560, H: 220, xdom: [0, 1], ydom: [0, smax], xticks: HX.ticks, shade: [[0.5, 1]], xlabel: "cooling: T (K)   |   annealing: t (s)", ylabel: "δT<tspan dy='3' font-size='9'>f</tspan><tspan dy='-3'> (K)</tspan>",
      lines: [{ x: X, y: zero, color: COL.TNM, w: 2.2 }, { x: X, y: R.sig.MAP, color: COL.MAP, w: 2.2 }, { x: X, y: R.sig.TL, color: COL.TL, w: 2.2 }],
      vlines: [{ x: X[i], color: "var(--ink)", w: 1, dash: "2 3" }],
      dots: [{ x: X[i], y: 0, color: COL.TNM }, { x: X[i], y: R.sig.MAP[i], color: COL.MAP }, { x: X[i], y: R.sig.TL[i], color: COL.TL }] }) + legend();
    // β_KWW(T)
    const bT = BETA.Ts, bb = BETA.b, flat = bT.map(() => R.beta);
    $("#beta").innerHTML = svg({ W: 560, H: 220, xdom: [bT[0], bT[bT.length - 1]], ydom: [Math.min(...bb, R.beta) - 0.05, Math.max(...bb, R.beta) + 0.05], xlabel: "T (K), equilibrium", ylabel: "β<tspan dy='3' font-size='9'>KWW</tspan>",
      lines: [{ x: bT, y: flat, color: COL.TNM, w: 2.2, dash: "7 4" }, { x: bT, y: flat, color: COL.MAP, w: 2.2, dash: "2 5" }, { x: bT, y: bb, color: COL.TL, w: 2.4 }],
      vlines: [{ x: LEARN.GLASS.Tg, color: "var(--muted)", dash: "4 3" }], notes: [] }) + legend() + `<div class="small">Dashed vertical line: T<sub>g</sub>. Below T<sub>g</sub> the TL curve is the equilibrium (⟨T<sub>f</sub>⟩ = T) value.</div>`;
  }
  const legend = () => `<div class="legend"><span><i style="border-color:${COL.TNM}"></i>TNM</span><span><i style="border-color:${COL.MAP}"></i>MAP / RelaxPy</span><span><i style="border-color:${COL.TL}"></i>TL</span></div>`;

  /* ---------- controls ---------- */
  function stop() { if (timer) { clearInterval(timer); timer = null; $("#play").textContent = "▶ Play"; } }
  $("#play").addEventListener("click", () => {
    if (timer) { stop(); return; }
    const s = $("#step"); if (+s.value >= +s.max) s.value = 0;
    $("#play").textContent = "❚❚ Pause";
    timer = setInterval(() => { const v = +s.value + 3; s.value = Math.min(v, +s.max); drawStep(); if (v >= +s.max) stop(); }, 30);
  });
  $("#step").addEventListener("input", () => { stop(); drawStep(); });
  ["#q", "#Ta", "#f"].forEach(id => $(id).addEventListener("input", () => {
    const frac = +$("#step").value / Math.max(1, +$("#step").max); stop(); compute();
    $("#step").value = Math.round(frac * +$("#step").max); drawStep();
  }));

  /* ---------- table of contents highlight ---------- */
  const links = [...document.querySelectorAll("#toc a")], secs = links.map(a => document.querySelector(a.getAttribute("href")));
  const onScroll = () => { let k = 0; secs.forEach((s, j) => { if (s && s.getBoundingClientRect().top < 120) k = j; }); links.forEach((a, j) => a.classList.toggle("on", j === k)); };
  document.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* ---------- desktop app: open the other tools in their own windows ---------- */
  if (window.desktop) document.querySelectorAll("[data-tool]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); window.desktop.openTool(a.dataset.tool); }));

  compute();
})();
