/* Learn page, Part I: draw the simulated experiments for the selected model */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const svg = PLOT.svg, logTicks = PLOT.logTicks;
  const MC = { TL: "var(--mTL)", TNM: "var(--mTNM)", MAP: "var(--mMAP)" };
  const PAL = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
  const cache = {};
  let model = "TL";
  const L10 = Math.log10;
  const leg = items => `<div class="legend">${items.map(([c, t, d]) => `<span><i class="${d ? "d" : ""}" style="border-color:${c}"></i>${t}</span>`).join("")}</div>`;
  const logs = a => a.map(v => (v > 0 ? L10(v) : NaN));
  const TLAB = "T<tspan dy='3' font-size='9'>f</tspan>";

  function get(name, fn) { const k = model + ":" + name; if (!(k in cache)) cache[k] = fn(); return cache[k]; }

  /* ---- 2. annealing ---- */
  function drawAnneal() {
    const A = get("anneal", () => EXP.anneal(model));
    const lines = [];
    A.forEach((o, j) => {
      lines.push({ x: logs(o.t), y: o.phi, color: PAL[j], w: 2.2 });
      lines.push({ x: logs(o.t), y: o.kww, color: PAL[j], w: 1.3, dash: "5 4" });
    });
    $("#x-anneal").innerHTML = svg({ W: 560, H: 250, xdom: [-1, 7], ydom: [0, 1.02], xticks: logTicks(-1, 7), xlabel: "annealing time t (s)", ylabel: "φ(t)", lines })
      + leg(A.map((o, j) => [PAL[j], `T<sub>a</sub> = ${o.Ta} K (T<sub>g</sub> − ${(EXP.G.Tg - o.Ta).toFixed(0)} K)`]));
    const o = A[1], k = o.t.findIndex(x => x >= o.tauEq), nm = model === "MAP" ? "MAP" : model;
    const tlb = model === "TL" ? LEARN.tlBeta(0.6, o.Ta) : null;
    $("#x-anneal-note").innerHTML = `<p>At T<sub>a</sub> = ${o.Ta} K the equilibrium relaxation time is <b>τ<sub>eq</sub> = ${o.tauEq.toPrecision(3)} s</b>. At t = τ<sub>eq</sub> a linear KWW curve has reached φ = e<sup>−1</sup> = 0.37, and the ${nm} curve is at φ = <b>${o.phi[k].toFixed(2)}</b>.</p>
      <p>A KWW fit to the simulated curve gives <b>β<sub>app</sub> = ${o.bApp.toFixed(2)}</b> and <b>τ<sub>app</sub> = ${o.tauApp.toPrecision(3)} s</b>. The input values are β = ${EXP.beta().toFixed(2)} at T<sub>g</sub> and τ<sub>eq</sub> = ${o.tauEq.toPrecision(3)} s. The difference is <b>nonlinearity</b>. After a down-jump T<sub>f</sub> > T<sub>a</sub>, so τ(T<sub>a</sub>, T<sub>f</sub>) starts shorter than τ<sub>eq</sub>. The glass then slows down as T<sub>f</sub> approaches T<sub>a</sub>, which broadens the curve.${tlb ? ` In the TL model β<sub>KWW</sub> itself falls with temperature (${tlb.toFixed(2)} at T<sub>a</sub>), which broadens it further and pushes τ<sub>app</sub> above τ<sub>eq</sub>.` : ""}</p>
      <p class="small">β<sub>app</sub> at the three temperatures: ${A.map(a => `${a.Ta} K → ${a.bApp.toFixed(2)}`).join(", ")}. All three models share τ = 100 s and the same β at T<sub>g</sub>.</p>`;
  }

  /* ---- 3. Kovacs ---- */
  function drawKovacs() {
    const S = get("asym", () => EXP.asym(model)), M = get("memory", () => EXP.memory(model));
    const dn = S[0], up = S[1];
    const ymax = Math.max(...dn.y, ...up.y.map(v => -v));
    $("#x-asym").innerHTML = svg({ W: 560, H: 250, xdom: [-1, 6], ydom: [0, ymax * 1.05], xticks: logTicks(-1, 6), xlabel: "time after the jump (s)", ylabel: "|T<tspan dy='3' font-size='9'>f</tspan><tspan dy='-3'> − T| (K)</tspan>",
      lines: [{ x: logs(dn.t), y: dn.y, color: PAL[0], w: 2.4 }, { x: logs(up.t), y: up.y.map(v => -v), color: PAL[1], w: 2.4 }] })
      + leg([[PAL[0], `down-jump ${dn.from} → ${dn.T} K (contraction)`], [PAL[1], `up-jump ${up.from} → ${up.T} K (expansion)`]]);
    const lines = [], dots = [];
    M.forEach((o, j) => { lines.push({ x: logs(o.t), y: o.y, color: PAL[j + 2], w: 2.4 }); dots.push({ x: L10(o.tpeak), y: o.peak, color: PAL[j + 2], r: 3.5 }); });
    const pk = Math.max(...M.map(o => o.peak));
    lines.push({ x: [-2, 8], y: [0, 0], color: "var(--muted)", w: 1, dash: "4 3" });
    $("#x-memory").innerHTML = svg({ W: 560, H: 250, xdom: [-1, 6], ydom: [-0.05 * pk, pk * 1.15], xticks: logTicks(-1, 6), xlabel: "time at T<tspan dy='3' font-size='9'>2</tspan><tspan dy='-3'> (s)</tspan>", ylabel: "⟨T<tspan dy='3' font-size='9'>f</tspan><tspan dy='-3'>⟩ − T</tspan><tspan dy='3' font-size='9'>2</tspan><tspan dy='-3'> (K)</tspan>", lines, dots })
      + leg(M.map((o, j) => [PAL[j + 2], `T<sub>1</sub> = ${o.T1} K, aged ${o.t1.toPrecision(2)} s: hump ${o.peak.toFixed(2)} K`]));
  }

  /* ---- 4. DSC ---- */
  function drawDSC() {
    const D = get("dsc", () => EXP.dsc(model));
    const all = D.runs.flatMap(r => r.heat.y), top = Math.min(4, Math.max(...all) * 1.05), clipped = Math.max(...all) > 4;
    const lines = D.runs.map((r, j) => ({ x: r.heat.x, y: r.heat.y, color: PAL[j], w: 2 }));
    const c10 = D.runs[2].cool; lines.push({ x: c10.x, y: c10.y, color: "var(--muted)", w: 1.6, dash: "5 4" });
    $("#x-dsc").innerHTML = svg({ W: 560, H: 260, xdom: [EXP.G.Tg - 70, EXP.G.Tg + 45], ydom: [Math.min(-0.1, ...all), top], xlabel: "T (K)", ylabel: "normalized C<tspan dy='3' font-size='9'>p</tspan>", lines,
      vlines: [{ x: EXP.G.Tg, color: "var(--muted)", dash: "2 3", w: 1 }] })
      + leg(D.runs.map((r, j) => [PAL[j], `q<sub>c</sub> = ${r.q} K/min (T<sub>f</sub>′ = ${r.TfPrime.toFixed(1)} K)`]).concat([["var(--muted)", "cooling, 10 K/min", 1]]))
      + (clipped ? `<div class="small">The slowest-cooled peak goes off scale (maximum ${Math.max(...all).toFixed(1)}).</div>` : "");
    const xs = D.runs.map(r => 1000 / r.TfPrime), ys = D.runs.map(r => L10(r.q));
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length, sl = -D.dhR / Math.log(10) / 1000;
    const x0 = Math.min(...xs) - 0.01, x1 = Math.max(...xs) + 0.01;
    $("#x-moyn").innerHTML = svg({ W: 560, H: 260, xdom: [x0, x1], ydom: [-0.3, 2.3], yticks: [[0, "1"], [1, "10"], [2, "100"]], xlabel: "1000 / T<tspan dy='3' font-size='9'>f</tspan><tspan dy='-3'>′ (1/K)</tspan>", ylabel: "q<tspan dy='3' font-size='9'>c</tspan><tspan dy='-3'> (K/min)</tspan>",
      lines: [{ x: [x0, x1], y: [my + sl * (x0 - mx), my + sl * (x1 - mx)], color: MC[model], w: 1.6, dash: "5 4" }],
      dots: xs.map((x, j) => ({ x, y: ys[j], color: PAL[j], r: 4.5 })) })
      + `<div class="read" style="font-size:14px">Slope → apparent Δh/R = <b>${(D.dhR / 1000).toFixed(1)} × 10³ K</b>, so m<sub>app</sub> = <b>${D.mApp.toFixed(1)}</b> (T<sub>g</sub> taken as T<sub>f</sub>′ at 10 K/min). Input: m = ${EXP.G.m}, Δh/R = ${(EXP.G.m * Math.log(10) * EXP.G.Tg / 1000).toFixed(1)} × 10³ K.</div>`;
  }

  /* ---- 5. enthalpy recovery ---- */
  function drawRecovery() {
    const R = get("recovery", () => EXP.recovery(model));
    const all = R.runs.flatMap(r => r.heat.y);
    const lab = t => (t === 0 ? "unaged" : "t<sub>a</sub> = 10<sup>" + L10(t).toFixed(0) + "</sup> s");
    $("#x-rec").innerHTML = svg({ W: 560, H: 260, xdom: [EXP.G.Tg - 40, EXP.G.Tg + 45], ydom: [Math.min(-0.05, ...all), Math.max(...all) * 1.05], xlabel: "T (K)", ylabel: "normalized C<tspan dy='3' font-size='9'>p</tspan>",
      lines: R.runs.map((r, j) => ({ x: r.heat.x, y: r.heat.y, color: PAL[j], w: j ? 2 : 1.6, dash: j ? null : "5 4" })), vlines: [{ x: R.Ta, color: "var(--muted)", dash: "2 3", w: 1 }] })
      + leg(R.runs.map((r, j) => [PAL[j], lab(r.ta), !j]));
    const inf = R.dHinf;
    $("#x-dh").innerHTML = svg({ W: 560, H: 260, xdom: [0, 8], ydom: [0, inf * 1.12], xticks: logTicks(0, 8), xlabel: "annealing time t<tspan dy='3' font-size='9'>a</tspan><tspan dy='-3'> (s)</tspan>", ylabel: "ΔH/ΔC<tspan dy='3' font-size='9'>p</tspan><tspan dy='-3'> (K)</tspan>",
      lines: [{ x: logs(R.t), y: R.dH, color: MC[model], w: 2.4 }, { x: [0, 8], y: [inf, inf], color: "var(--muted)", w: 1.2, dash: "5 4" }],
      dots: R.runs.filter(r => r.ta > 0).map(r => ({ x: L10(r.ta), y: r.dH, color: PAL[R.runs.indexOf(r)], r: 4.5 })) })
      + `<div class="read" style="font-size:14px">T<sub>a</sub> = ${R.Ta} K. ΔH<sub>∞</sub>/ΔC<sub>p</sub> = T<sub>f</sub>(0) − T<sub>a</sub> = <b>${inf.toFixed(1)} K</b>. Half of it is recovered after about <b>${(R.t[R.dH.findIndex(v => v >= inf / 2)] || NaN).toPrecision(2)} s</b>.</div>`;
  }

  /* ---- 6. MDSC ---- */
  function drawMDSC() {
    const dir = $("#md-dir").value, P = +$("#md-P").value;
    const M = get(`mdsc-${dir}-${P}`, () => EXP.mdsc(model, P, dir));
    const Tlo = EXP.G.Tg - 50, Thi = EXP.G.Tg + 60;
    const vals = [...M.total, ...M.rev, ...M.nonrev, ...M.im].filter(isFinite);
    $("#x-md").innerHTML = svg({ W: 560, H: 270, xdom: [Tlo, Thi], ydom: [Math.min(-0.1, ...vals) - 0.05, Math.min(3, Math.max(...vals)) + 0.1], xlabel: "T (K)", ylabel: "normalized C<tspan dy='3' font-size='9'>p</tspan>",
      lines: [{ x: M.T, y: M.total, color: "var(--ink)", w: 2.2 }, { x: M.T, y: M.rev, color: PAL[0], w: 2.2 }, { x: M.T, y: M.nonrev, color: PAL[1], w: 2 }, { x: M.T, y: M.im, color: PAL[2], w: 1.8, dash: "5 4" }, { x: [Tlo, Thi], y: [0, 0], color: "var(--muted)", w: 0.8 }],
      vlines: [{ x: EXP.G.Tg, color: "var(--muted)", dash: "2 3", w: 1 }] })
      + leg([["var(--ink)", "total ⟨Φ⟩/q"], [PAL[0], "reversing |C*|"], [PAL[1], "non-reversing"], [PAL[2], "C″ (loss)", 1]]);
    const Ps = [40, 120, 400], lines = [];
    Ps.forEach((p, j) => { const r = get(`mdsc-${dir}-${p}`, () => EXP.mdsc(model, p, dir)); lines.push({ x: r.T, y: r.rev, color: PAL[j + 3], w: p === P ? 2.8 : 1.8 }); });
    lines.push({ x: M.T, y: M.total, color: "var(--ink)", w: 2, dash: "5 4" });
    $("#x-md2").innerHTML = svg({ W: 560, H: 270, xdom: [Tlo, Thi], ydom: [-0.05, Math.min(3, Math.max(1.1, ...M.total.filter(isFinite)) + 0.05)], xlabel: "T (K)", ylabel: "normalized C<tspan dy='3' font-size='9'>p</tspan>", lines,
      vlines: [{ x: EXP.G.Tg, color: "var(--muted)", dash: "2 3", w: 1 }] })
      + leg(Ps.map((p, j) => [PAL[j + 3], `|C*|, P = ${p} s (ωτ = 1 where τ = ${(p / 2 / Math.PI).toFixed(0)} s)`]).concat([["var(--ink)", "total (conventional DSC)", 1]]));
  }

  const DRAW = [drawAnneal, drawKovacs, drawDSC, drawRecovery, drawMDSC];
  let job = 0;
  function redrawAll() {
    const my = ++job; document.querySelectorAll("#x-anneal,#x-asym,#x-memory,#x-dsc,#x-moyn,#x-rec,#x-dh,#x-md,#x-md2").forEach(e => e.classList.add("busy"));
    let i = 0;
    const next = () => {
      if (my !== job) return;
      if (i >= DRAW.length) { document.querySelectorAll(".busy").forEach(e => e.classList.remove("busy")); return; }
      try { DRAW[i](); } catch (e) { console.error(e); }
      i++; setTimeout(next, 0);
    };
    setTimeout(next, 0);
  }
  function setModel(m) {
    model = m;
    document.querySelectorAll(".modelsw button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
    redrawAll();
  }
  document.querySelectorAll(".modelsw button").forEach(b => b.addEventListener("click", () => setModel(b.dataset.m)));
  ["#md-dir", "#md-P"].forEach(id => $(id).addEventListener("change", () => { try { drawMDSC(); } catch (e) { console.error(e); } }));
  redrawAll();
})();
