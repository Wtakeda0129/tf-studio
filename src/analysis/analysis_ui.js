/* ============================================================
   Tf Studio · Data Analysis — user interface
   Tab 1  Heat-flow scans: import raw DSC heat flow (heating or cooling), linear glass/liquid baselines,
          normalized C_p^N, T_f(T) and T_f′ (area matching)
   Tab 2  Enthalpy recovery: heating scans after annealing vs the unaged reference, aligned, ΔHF(T), ΔH(t_a),
          φ(t_a) and a KWW fit
   Tab 3  Property relaxation: volume (or density, length, refractive index…) during isothermal annealing,
          V(t) = V∞ + ΔV exp[−(t/τ)^β]
   ============================================================ */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (v, p = 4) => (v === undefined || v === null || !isFinite(v)) ? "–" : (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? (+v).toExponential(p - 1) : String(+(+v).toPrecision(p)));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
  const COLS = ["--c1", "--c2", "--c3", "--c4", "--c6", "--c7", "--c5", "--c8"];
  const col = i => css(COLS[i % COLS.length]);
  const TIME = { s: 1, min: 60, h: 3600, d: 86400 };

  const A = {
    tab: 1, unit: "K", logt: true,
    runs: [], sel: -1, ed: null,
    rec: { ref: -1, mode: "liquid", int: null, Ta: "", dcp: "", off: {} },
    vols: [], vsel: -1, ved: null,
  };
  const tU = v => v + (A.unit === "C" ? -273.15 : 0), tK = v => v + (A.unit === "C" ? 273.15 : 0), uL = () => (A.unit === "C" ? "°C" : "K");
  const tIn = v => (isFinite(v) ? +tU(v).toPrecision(8) : "");

  /* ---------- plotting helpers (plot() from ui_plot.js) ---------- */
  function card(id, cls) { return `<div class="plotcard ${cls || ""}" id="${id}"><div class="plotbox"></div></div>`; }
  function P(id, cfg) { const el = document.getElementById(id); if (!el || !cfg) return; const box = el.querySelector(".plotbox") || el; try { plot(box, { id, ...cfg }); } catch (e) { console.error(e); box.innerHTML = `<div class="banner err">Could not draw “${esc(cfg.title || id)}”: ${esc(e.message)}</div>`; } }
  const empty = msg => `<div class="empty">${msg}</div>`;

  /* ---------- units of a run ---------- */
  // ΔH = ∫ΔHF dT / q  (q in K/s). mW → mJ (÷ mass in mg → J/g); W/g → J/g; anything else → HF·s
  function hUnit(r) { return r.hfUnit === "W/g" || (r.hfUnit === "mW" && r.mass > 0) ? "J/g" : r.hfUnit === "mW" ? "mJ" : `${r.hfUnit || "a.u."}·s`; }
  function hScale(r) { const s = 60 / r.q; return r.hfUnit === "mW" && r.mass > 0 ? s / r.mass : s; }
  const cpUnit = r => (hUnit(r) === "J/g" ? "J/(g·K)" : hUnit(r) + "/K");

  /* ---------- normalization cache ---------- */
  function norm(r) { if (!r._N || r._Nkey !== JSON.stringify(r.rg)) { r._N = AN.normalize(r, r.rg); r._Nkey = JSON.stringify(r.rg); } return r._N; }
  function kindLabel(r) { return r.kind === "cool" ? "cooling" : "heating"; }

  /* ================= header / tabs ================= */
  function renderTabs() {
    $$(".step").forEach(b => b.setAttribute("aria-current", +b.dataset.tab === A.tab));
    $("#st1").textContent = A.runs.length ? `${A.runs.length} run${A.runs.length > 1 ? "s" : ""}` : "upload DSC heat flow";
    const aged = A.runs.filter(r => r.kind === "heat" && r.ta > 0).length;
    $("#st2").textContent = aged ? `${aged} annealed scan${aged > 1 ? "s" : ""}` : "heating after annealing";
    $("#st3").textContent = A.vols.length ? `${A.vols.length} dataset${A.vols.length > 1 ? "s" : ""}` : "volume, density, length…";
  }
  function render() { renderTabs(); [null, renderLeft1, renderLeft2, renderLeft3][A.tab](); renderRight(); }
  function renderRight() { [null, renderRight1, renderRight2, renderRight3][A.tab](); }

  /* ================= import editor (shared by tabs 1 and 3) ================= */
  function editorHTML(ed, kind) {
    const p = ed.parsed, opts = (sel) => p ? p.names.map((n, j) => `<option value="${j}" ${+sel === j ? "selected" : ""}>${esc(n)}</option>`).join("") : "";
    const src = `<label class="f">File (.csv, .txt, instrument export)<input type="file" id="edFile" accept=".csv,.txt,.dat,.tsv,text/plain"></label>
      <label class="f" style="margin-top:6px">…or paste columns<textarea id="edText" rows="5" placeholder="T  heat flow\n-80  1.20\n-79.5  1.21\n…">${esc(ed.text || "")}</textarea></label>
      <p class="note">${p ? `<b>${p.n}</b> numeric rows, ${p.cols.length} columns detected.` : "Header lines and unit rows are skipped automatically."}</p>`;
    if (kind === "hf") return `${src}${p ? `
      <div class="grid2" style="margin-top:6px">
        <label class="f">Temperature column<select id="edX">${opts(ed.xcol)}</select></label>
        <label class="f">Heat-flow column<select id="edY">${opts(ed.ycol)}</select></label>
        <label class="f">Temperature unit<select id="edXU"><option value="K" ${ed.xu === "K" ? "selected" : ""}>K</option><option value="C" ${ed.xu === "C" ? "selected" : ""}>°C</option></select></label>
        <label class="f">Heat-flow unit<select id="edYU">${["mW", "W/g", "a.u."].map(u => `<option ${ed.yu === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
        <label class="f">Sign convention<select id="edSign"><option value="up" ${ed.sign === "up" ? "selected" : ""}>endothermic up</option><option value="down" ${ed.sign === "down" ? "selected" : ""}>endothermic down (exo up)</option></select></label>
        <label class="f">Scan<select id="edKind"><option value="auto" ${ed.kind === "auto" ? "selected" : ""}>auto (${autoKind(ed)})</option><option value="heat" ${ed.kind === "heat" ? "selected" : ""}>heating</option><option value="cool" ${ed.kind === "cool" ? "selected" : ""}>cooling</option></select></label>
        <label class="f">Rate |q| (K/min)<input type="number" id="edQ" value="${ed.q}" step="any" min="0"></label>
        <label class="f" ${ed.yu === "mW" ? "" : "hidden"}>Sample mass (mg)<input type="number" id="edM" value="${ed.m}" step="any" min="0"></label>
        <label class="f" title="Leave empty for an unaged scan (e.g. the reference)">Annealing time t<sub>a</sub> (s)<input type="number" id="edTa" value="${ed.ta}" step="any" min="0" placeholder="none"></label>
        <label class="f">Annealing T<sub>a</sub> (${uL()})<input type="number" id="edTaT" value="${ed.TaT}" step="any" placeholder="—"></label>
        <label class="f full">Name<input type="text" id="edName" value="${esc(ed.name || "")}" placeholder="auto"></label>
      </div>` : ""}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="edAdd" ${p ? "" : "disabled"}>Add run</button><button class="btn" id="edCancel">Cancel</button><span class="note" id="edMsg" style="margin:0"></span></div>`;
    return `${src}${p ? `
      <div class="grid2" style="margin-top:6px">
        <label class="f">Time column<select id="edX">${opts(ed.xcol)}</select></label>
        <label class="f">Property column<select id="edY">${opts(ed.ycol)}</select></label>
        <label class="f">Time unit<select id="edXU">${Object.keys(TIME).map(u => `<option ${ed.xu === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
        <label class="f">Property (label, unit)<input type="text" id="edPU" value="${esc(ed.pu || "")}" placeholder="V (cm³/g)"></label>
        <label class="f">Annealing T<sub>a</sub> (${uL()})<input type="number" id="edTaT" value="${ed.TaT}" step="any" placeholder="—"></label>
        <label class="f">Name<input type="text" id="edName" value="${esc(ed.name || "")}" placeholder="auto"></label>
      </div>` : ""}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="edAdd" ${p ? "" : "disabled"}>Add dataset</button><button class="btn" id="edCancel">Cancel</button><span class="note" id="edMsg" style="margin:0"></span></div>`;
  }
  function autoKind(ed) { const p = ed.parsed; if (!p) return "–"; const x = p.cols[+ed.xcol] || []; const a = x.find(isFinite), b = [...x].reverse().find(isFinite); return b >= a ? "heating" : "cooling"; }
  function guessCols(ed, kind) {
    const nm = ed.parsed.names.map(s => s.toLowerCase());
    const find = re => nm.findIndex(s => re.test(s));
    if (kind === "hf") {
      const t = find(/temp|^t\b|°c|\(k\)/), h = find(/heat|flow|hf|mw|w\/g/);
      ed.xcol = t >= 0 ? t : 0; ed.ycol = h >= 0 ? h : Math.min(1, ed.parsed.cols.length - 1);
      if (/°c|\(c\)|celsius/.test(nm[ed.xcol] || "")) ed.xu = "C";
      if (/w\/g/.test(nm[ed.ycol] || "")) ed.yu = "W/g"; else if (/mw/.test(nm[ed.ycol] || "")) ed.yu = "mW";
    } else {
      const t = find(/time|^t\b/); ed.xcol = t >= 0 ? t : 0; ed.ycol = ed.xcol === 0 ? 1 : 0;
      if (/min/.test(nm[ed.xcol] || "")) ed.xu = "min"; else if (/\(h\)|hour/.test(nm[ed.xcol] || "")) ed.xu = "h";
    }
  }
  function setText(ed, text, kind) { ed.text = text; ed.parsed = AN.parseTable(text); if (ed.parsed.n < 2 || ed.parsed.cols.length < 2) ed.parsed = null; else guessCols(ed, kind); }

  /* ================= TAB 1: heat-flow scans ================= */
  function newHfEditor() { return { text: "", parsed: null, xcol: 0, ycol: 1, xu: A.unit, yu: "mW", sign: "up", kind: "auto", q: 10, m: 10, ta: "", TaT: "", name: "" }; }
  function renderLeft1() {
    const r = A.runs[A.sel];
    const list = A.runs.map((x, i) => `<div class="dsitem ${i === A.sel ? "sel" : ""}" data-sel="${i}" style="--pc:${col(i)}">
        <span class="pill" style="--pc:${col(i)}">${x.kind === "cool" ? "cool" : "heat"}</span><span class="nm" title="${esc(x.name)}">${esc(x.name)}</span><button class="btn icon danger" data-del="${i}" title="Remove">×</button>
        <span class="meta">${kindLabel(x)} · ${nf(x.q, 3)} K/min · ${x.T.length} points · HF in ${esc(x.hfUnit)}${x.ta > 0 ? ` · annealed ${nf(x.ta, 3)} s${isFinite(x.Ta) ? " at " + nf(tU(x.Ta), 5) + " " + uL() : ""}` : ""}</span></div>`).join("");
    let norms = "";
    if (r) {
      const N = norm(r), du = cpUnit(r);
      norms = `<div class="card"><h2>Normalization <span class="sub">${esc(r.name)}</span></h2><div class="body">
        <div class="grid2">
          <label class="f">Glass range from (${uL()})<input type="number" data-rg="g0" value="${tIn(r.rg.g[0])}" step="any"></label><label class="f">to<input type="number" data-rg="g1" value="${tIn(r.rg.g[1])}" step="any"></label>
          <label class="f">Liquid range from (${uL()})<input type="number" data-rg="l0" value="${tIn(r.rg.l[0])}" step="any"></label><label class="f">to<input type="number" data-rg="l1" value="${tIn(r.rg.l[1])}" step="any"></label>
        </div>
        <div class="row" style="margin-top:8px"><button class="btn small" id="rgAuto">Auto ranges</button><button class="btn small" id="rgAll" title="Use these glass and liquid ranges for every run">Apply to all runs</button></div>
        <p class="note">Straight lines are fitted to the heat flow in the glass range (HF<sub>g</sub>) and the liquid range (HF<sub>l</sub>) and extrapolated: C<sub>p</sub><sup>N</sup> = (HF − HF<sub>g</sub>)/(HF<sub>l</sub> − HF<sub>g</sub>) = dT<sub>f</sub>/dT. T<sub>f</sub>(T) = T* − ∫<sub>T</sub><sup>T*</sup> C<sub>p</sub><sup>N</sup> dT′ with T* at the start of the liquid range (Moynihan's area matching).</p>
        ${N.ok ? `<div class="summary"><div class="stat"><b>${nf(tU(N.TfPrime), 5)} ${uL()}</b><span>limiting fictive temperature T<sub>f</sub>′</span></div>
          <div class="stat"><b>${nf(tU(N.Tmid), 5)} ${uL()}</b><span>midpoint (C<sub>p</sub><sup>N</sup> = 0.5)</span></div>
          <div class="stat"><b>${nf(N.dHF(N.TfPrime) * hScale(r), 3)}</b><span>ΔC<sub>p</sub> at T<sub>f</sub>′, ${du}</span></div></div>` : `<div class="banner err" style="margin-top:8px">${esc(N.msg)}</div>`}
      </div></div>`;
    }
    $("#left").innerHTML = `
      <div class="card"><h2>Heat-flow runs <span class="sub">${A.runs.length}</span></h2><div class="body">
        ${A.runs.length ? list : `<p class="note" style="margin-top:0">Upload the raw heat flow of a DSC scan (heating or cooling). For enthalpy recovery, add the unaged reference and the heating scans after annealing, with their annealing times.</p>`}
        <div class="row" style="margin-top:6px"><button class="btn small" id="addRun">+ Add run</button><button class="btn small" id="exRuns">Load example data</button>${A.runs.length ? `<span class="spacer"></span><button class="btn small" id="csv1">Export normalized (.csv)</button>` : ""}</div>
      </div></div>
      ${A.ed ? `<div class="card"><h2>Add a heat-flow run</h2><div class="body">${editorHTML(A.ed, "hf")}</div></div>` : ""}
      ${norms}`;
  }
  function renderRight1() {
    const r = A.runs[A.sel];
    if (!r) { $("#right").innerHTML = `<div class="rhead"><h3>Heat-flow scans</h3></div>${empty("Add a run or load the example data (synthetic scans of selenium computed with the TL model).")}`; return; }
    $("#right").innerHTML = `<div class="rhead"><h3>${esc(r.name)}</h3></div><div class="plots">${card("a1raw")}${card("a1cp")}${card("a1tf")}${card("a1all")}</div>`;
    const N = norm(r), c = col(A.sel), X = N.T.map(tU);
    const lo = N.T[0], hi = N.T[N.T.length - 1];
    const bands = [{ x0: tU(Math.min(...r.rg.g)), x1: tU(Math.max(...r.rg.g)), color: css("--c1"), op: 0.12 }, { x0: tU(Math.min(...r.rg.l)), x1: tU(Math.max(...r.rg.l)), color: css("--c2"), op: 0.12 }];
    const series = [{ name: "heat flow", x: X, y: N.HF, color: c, w: 1.8 }];
    if (N.ok) series.push({ name: "glass line HF_g", x: [tU(lo), tU(hi)], y: [N.g(lo), N.g(hi)], color: css("--c1"), w: 1.3, dash: "6 4" }, { name: "liquid line HF_l", x: [tU(lo), tU(hi)], y: [N.l(lo), N.l(hi)], color: css("--c2"), w: 1.3, dash: "6 4" });
    P("a1raw", { title: `Raw heat flow (${r.hfUnit}, endothermic up) with glass and liquid baselines`, xlabel: `Temperature (${uL()})`, ylabel: `HF (${r.hfUnit})`, series, bands, xshort: "T", yshort: "HF" });
    if (!N.ok) return;
    P("a1cp", { title: "Normalized heat capacity C_p^N = dT_f/dT", xlabel: `Temperature (${uL()})`, ylabel: "C_p^N", series: [{ name: "", x: X, y: N.cpN, color: c, w: 2 }, { name: "", x: [X[0], X[X.length - 1]], y: [0, 0], color: css("--eq"), w: 1, dash: "3 3" }, { name: "", x: [X[0], X[X.length - 1]], y: [1, 1], color: css("--eq"), w: 1, dash: "3 3" }], bands, xshort: "T", yshort: "Cp" });
    P("a1tf", { title: `Fictive temperature T_f(T) · T_f′ = ${nf(tU(N.TfPrime), 5)} ${uL()}`, xlabel: `Temperature (${uL()})`, ylabel: `T_f (${uL()})`, series: [{ name: "T_f", x: X, y: N.Tf.map(tU), color: c, w: 2 }, { name: "T_f = T", x: [X[0], X[X.length - 1]], y: [X[0], X[X.length - 1]], color: css("--eq"), w: 1, dash: "4 3" }], xshort: "T", yshort: "T_f" });
    const all = A.runs.map((x, i) => { const n = norm(x); return n.ok ? { name: x.name, x: n.T.map(tU), y: n.cpN, color: col(i), w: i === A.sel ? 2.4 : 1.3, dash: x.kind === "cool" ? "6 4" : null } : null; }).filter(Boolean);
    P("a1all", { title: "All runs, C_p^N (dashed: cooling)", xlabel: `Temperature (${uL()})`, ylabel: "C_p^N", series: all, xshort: "T", yshort: "Cp" });
  }
  function addRunFromEditor() {
    const ed = A.ed, p = ed.parsed, msg = $("#edMsg"); if (!p) return;
    const xs = p.cols[+ed.xcol], ys = p.cols[+ed.ycol];
    const T = [], HF = []; xs.forEach((x, i) => { const y = ys[i]; if (isFinite(x) && isFinite(y)) { T.push(ed.xu === "C" ? x + 273.15 : x); HF.push(ed.sign === "down" ? -y : y); } });
    if (T.length < 10) { msg.textContent = "Fewer than 10 usable rows."; return; }
    const kind = ed.kind === "auto" ? (T[T.length - 1] >= T[0] ? "heat" : "cool") : ed.kind;
    const q = +ed.q; if (!(q > 0)) { msg.textContent = "Enter the scan rate."; return; }
    const ta = ed.ta === "" ? 0 : +ed.ta, TaT = ed.TaT === "" ? NaN : tK(+ed.TaT);
    const r = { name: ed.name || `${kind === "cool" ? "Cooling" : "Heating"} ${nf(q, 3)} K/min${ta > 0 ? ` after ${nf(ta, 3)} s` : ""}`, kind, q, mass: ed.yu === "mW" ? +ed.m : NaN, hfUnit: ed.yu, ta, Ta: TaT, T, HF };
    r.rg = A.runs.length ? JSON.parse(JSON.stringify(A.runs[A.runs.length - 1].rg)) : AN.defaultRanges(T);
    const lo = Math.min(...T), hi = Math.max(...T); if (!(r.rg.g[0] >= lo && r.rg.l[1] <= hi)) r.rg = AN.defaultRanges(T);
    A.runs.push(r); A.sel = A.runs.length - 1; A.ed = null; render();
  }
  function loadExampleRuns() {
    A.runs = EXAMPLES.runs.map(x => ({ name: x.name, kind: x.kind, q: x.q, mass: x.mass, hfUnit: "mW", ta: x.ta || 0, Ta: x.Ta == null ? NaN : x.Ta, T: x.T.slice(), HF: x.HF.slice(), rg: { g: [245, 265], l: [325, 343] } }));
    A.sel = 1; A.ed = null; A.rec.ref = 1; A.rec.int = null; A.rec.Ta = ""; render();
  }
  function exportNorm() {
    const rows = ["run,scan,rate_K_per_min,T_K,HF,Cp_norm,Tf_K"];
    A.runs.forEach(r => { const N = norm(r); if (!N.ok) return; N.T.forEach((t, i) => rows.push([`"${r.name}"`, r.kind, r.q, t, N.HF[i], N.cpN[i], N.Tf[i]].join(","))); });
    dl(new Blob([rows.join("\n")], { type: "text/csv" }), "normalized_Cp.csv");
  }

  /* ================= TAB 2: enthalpy recovery ================= */
  function recState() {
    const heats = A.runs.map((r, i) => i).filter(i => A.runs[i].kind === "heat");
    let ref = A.rec.ref; if (!heats.includes(ref)) ref = heats.find(i => !(A.runs[i].ta > 0)); if (ref === undefined) ref = heats[0];
    A.rec.ref = ref === undefined ? -1 : ref;
    const R = A.runs[A.rec.ref], aged = heats.filter(i => i !== A.rec.ref && A.runs[i].ta > 0).sort((a, b) => A.runs[a].ta - A.runs[b].ta);
    if (!R) return { heats, R: null, aged };
    const NR = norm(R); if (!NR.ok) return { heats, R, NR, aged, bad: true };
    const int = A.rec.int || [Math.min(...R.rg.g), Math.max(...R.rg.l)];
    const Ta = A.rec.Ta !== "" ? tK(+A.rec.Ta) : (aged.map(i => A.runs[i].Ta).find(isFinite));
    const dcpAuto = NR.dHF(NR.TfPrime) * hScale(R), dcp = A.rec.dcp !== "" ? +A.rec.dcp : dcpAuto;
    const res = aged.map(i => {
      const r = A.runs[i], N = norm(r); if (!N.ok) return { i, r, bad: true };
      const rc = AN.recovery(NR, N, { g: R.rg.g, l: R.rg.l, mode: A.rec.mode, int });
      const dH = rc.integral * hScale(R), dT = dH / dcp;
      const TfH = NR.TfPrime - dT, dHinf = isFinite(Ta) ? dcp * (NR.TfPrime - Ta) : NaN;
      return { i, r, N, rc, dH, dT, TfH, phi: isFinite(dHinf) ? 1 - dH / dHinf : NaN, dHinf };
    });
    const ok = res.filter(x => !x.bad && isFinite(x.phi));
    const kww = ok.length >= 3 ? AN.kwwFit(ok.map(x => x.r.ta), ok.map(x => x.phi)) : null;
    return { heats, R, NR, aged, int, Ta, dcp, dcpAuto, res, kww };
  }
  function renderLeft2() {
    const S2 = recState();
    if (!S2.heats.length) { $("#left").innerHTML = `<div class="card"><h2>Enthalpy recovery</h2><div class="body"><p class="note" style="margin-top:0">Add heating scans in tab 1: one unaged reference and scans measured after annealing (give each its annealing time t<sub>a</sub>). Or load the example data there.</p><button class="btn small" id="exRuns">Load example data</button></div></div>`; return; }
    const R = S2.R, u = R ? hUnit(R) : "";
    const refSel = `<select id="recRef">${S2.heats.map(i => `<option value="${i}" ${i === A.rec.ref ? "selected" : ""}>${esc(A.runs[i].name)}</option>`).join("")}</select>`;
    const agedRows = A.runs.map((r, i) => (r.kind === "heat" && i !== A.rec.ref) ? `<tr><td><span class="pill" style="--pc:${col(i)}">&nbsp;</span></td><td class="nm" title="${esc(r.name)}" style="max-width:190px;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</td><td><input type="number" data-ta="${i}" value="${r.ta > 0 ? r.ta : ""}" step="any" min="0" placeholder="—" style="width:90px"></td></tr>` : "").join("");
    const res = (S2.res || []).filter(x => !x.bad).map(x => `<tr><td class="num">${nf(x.r.ta, 3)}</td><td class="num">${nf(x.dH, 4)}</td><td class="num">${nf(x.dT, 4)}</td><td class="num">${nf(tU(x.TfH), 5)}</td><td class="num">${nf(tU(x.N.TfPrime), 5)}</td><td class="num">${nf(x.phi, 3)}</td></tr>`).join("");
    $("#left").innerHTML = `
      <div class="card"><h2>Scans</h2><div class="body">
        <label class="f">Unaged reference (heating)${refSel}</label>
        <table class="pt" style="margin-top:8px"><tr><th></th><th>heating scan</th><th>t<sub>a</sub> (s)</th></tr>${agedRows}</table>
        <p class="note">Scans with an annealing time are compared with the reference. All scans should use the same heating rate.</p>
      </div></div>
      <div class="card"><h2>Alignment and integration</h2><div class="body">
        <div class="grid2">
          <label class="f full">Align each annealed scan to the reference by<select id="recMode"><option value="liquid" ${A.rec.mode === "liquid" ? "selected" : ""}>a constant shift in the liquid range</option><option value="linear" ${A.rec.mode === "linear" ? "selected" : ""}>a straight line through the glass and liquid ranges</option></select></label>
          <label class="f">Integrate from (${uL()})<input type="number" id="int0" value="${S2.int ? tIn(S2.int[0]) : ""}" step="any"></label><label class="f">to<input type="number" id="int1" value="${S2.int ? tIn(S2.int[1]) : ""}" step="any"></label>
          <label class="f">Annealing T<sub>a</sub> (${uL()})<input type="number" id="recTa" value="${A.rec.Ta !== "" ? A.rec.Ta : (isFinite(S2.Ta) ? tIn(S2.Ta) : "")}" step="any" placeholder="needed for φ"></label>
          <label class="f">ΔC<sub>p</sub> (${R ? cpUnit(R) : ""})<input type="number" id="recDcp" value="${A.rec.dcp}" step="any" placeholder="${nf(S2.dcpAuto, 4)} (reference)"></label>
        </div>
        <p class="note">Glass and liquid ranges are the reference run's (tab 1). ΔH = ∫ ΔHF dT / q is the enthalpy lost during annealing and recovered on heating. T<sub>f</sub> = T<sub>f</sub>′(reference) − ΔH/ΔC<sub>p</sub>; φ = 1 − ΔH/ΔH<sub>∞</sub> with ΔH<sub>∞</sub> = ΔC<sub>p</sub>(T<sub>f</sub>′ − T<sub>a</sub>).</p>
      </div></div>
      ${S2.res && S2.res.length ? `<div class="card"><h2>Results <span class="sub">reference T<sub>f</sub>′ = ${nf(tU(S2.NR.TfPrime), 5)} ${uL()}</span></h2><div class="body" style="overflow-x:auto">
        <table class="metrics"><tr><th>t<sub>a</sub> (s)</th><th>ΔH (${u})</th><th>ΔH/ΔC<sub>p</sub> (K)</th><th>T<sub>f</sub> from ΔH</th><th>T<sub>f</sub>′ (area)</th><th>φ</th></tr>${res}</table>
        ${isFinite(S2.res[0] && S2.res[0].dHinf) ? `<p class="note">ΔH<sub>∞</sub> = ${nf(S2.res[0].dHinf, 4)} ${u}${S2.kww ? ` · KWW fit of φ(t<sub>a</sub>): τ = <b>${nf(S2.kww.tau, 4)} s</b>, β = <b>${nf(S2.kww.beta, 3)}</b>, ⟨τ⟩ = ${nf(S2.kww.meanTau, 4)} s` : " · a KWW fit needs at least three annealing times"}</p>` : `<p class="note">Enter T<sub>a</sub> to get φ(t<sub>a</sub>) and a KWW fit.</p>`}
        <div class="row" style="margin-top:6px"><button class="btn small" id="csv2">Export results (.csv)</button><button class="btn small" id="csv2c">Export ΔHF curves (.csv)</button></div>
      </div></div>` : `<div class="card"><h2>Results</h2><div class="body"><p class="note" style="margin-top:0">Enter the annealing time t<sub>a</sub> of at least one heating scan above.</p></div></div>`}`;
  }
  function renderRight2() {
    const S2 = recState();
    if (!S2.R || !S2.res || !S2.res.length) { $("#right").innerHTML = `<div class="rhead"><h3>Enthalpy recovery</h3></div>${empty("Choose the unaged reference and give the annealing times of the other heating scans.")}`; return; }
    $("#right").innerHTML = `<div class="rhead"><h3>Enthalpy recovery</h3></div><div class="plots">${card("a2hf")}${card("a2d")}${card("a2h")}${card("a2phi")}</div>`;
    const R = S2.R, u = hUnit(R), X = x => x.map(tU);
    const ok = S2.res.filter(x => !x.bad);
    const hf = [{ name: `reference: ${R.name}`, x: X(S2.NR.T), y: S2.NR.HF, color: css("--ink"), w: 2 }];
    ok.forEach(x => hf.push({ name: `t_a = ${nf(x.r.ta, 3)} s`, x: X(x.rc.x), y: x.rc.aged, color: col(x.i), w: 1.5 }));
    const bands = [{ x0: tU(S2.int[0]), x1: tU(S2.int[1]), color: css("--eq"), op: 0.08 }];
    P("a2hf", { title: `Heating scans aligned to the reference (${R.hfUnit})`, xlabel: `Temperature (${uL()})`, ylabel: `HF (${R.hfUnit})`, series: hf, bands, xshort: "T", yshort: "HF" });
    P("a2d", { title: "ΔHF = HF(annealed) − HF(reference); shaded: integration range", xlabel: `Temperature (${uL()})`, ylabel: `ΔHF (${R.hfUnit})`, bands,
      series: [{ name: "", x: X([S2.int[0], S2.int[1]]), y: [0, 0], color: css("--eq"), w: 1, dash: "3 3" }].concat(ok.map(x => ({ name: `t_a = ${nf(x.r.ta, 3)} s: ΔH = ${nf(x.dH, 3)} ${u}`, x: X(x.rc.x), y: x.rc.dHF, color: col(x.i), w: 1.8 }))), xshort: "T", yshort: "ΔHF" });
    const ts = ok.map(x => x.r.ta), dHinf = ok[0].dHinf;
    const hs = [{ name: "ΔH(t_a)", x: ts, y: ok.map(x => x.dH), color: css("--c1"), pts: true, r: 4 }];
    if (isFinite(dHinf)) hs.push({ name: "ΔH∞ = ΔC_p (T_f′ − T_a)", x: [Math.min(...ts) / 3, Math.max(...ts) * 3], y: [dHinf, dHinf], color: css("--eq"), w: 1.2, dash: "5 4" });
    if (S2.kww && isFinite(dHinf)) { const tt = logspace(Math.min(...ts) / 3, Math.max(...ts) * 3, 120); hs.push({ name: "KWW fit", x: tt, y: tt.map(t => dHinf * (1 - Math.exp(-Math.pow(t / S2.kww.tau, S2.kww.beta)))), color: css("--c2"), w: 1.6 }); }
    P("a2h", { title: `Recovered enthalpy ΔH (${u}) vs annealing time`, xlabel: "annealing time t_a (s)", ylabel: `ΔH (${u})`, xlog: A.logt, series: hs, xdom: A.logt ? null : [0, Math.max(...ts) * 1.05], xshort: "t_a", yshort: "ΔH" });
    if (isFinite(dHinf)) {
      const ps = [{ name: "φ = 1 − ΔH/ΔH∞", x: ts, y: ok.map(x => x.phi), color: css("--c1"), pts: true, r: 4 }];
      if (S2.kww) { const tt = logspace(Math.min(...ts) / 3, Math.max(...ts) * 3, 120); ps.push({ name: `KWW τ = ${nf(S2.kww.tau, 3)} s, β = ${nf(S2.kww.beta, 3)}`, x: tt, y: tt.map(t => Math.exp(-Math.pow(t / S2.kww.tau, S2.kww.beta))), color: css("--c2"), w: 1.6 }); }
      P("a2phi", { title: `Relaxation function at T_a = ${nf(tU(S2.Ta), 5)} ${uL()}`, xlabel: "annealing time t_a (s)", ylabel: "φ", xlog: A.logt, ydom: [0, 1.05], series: ps, xdom: A.logt ? null : [0, Math.max(...ts) * 1.05], xshort: "t_a", yshort: "φ" });
    } else document.getElementById("a2phi").querySelector(".plotbox").innerHTML = empty("Enter the annealing temperature T<sub>a</sub> to compute φ(t<sub>a</sub>).");
  }
  const logspace = (a, b, n) => Array.from({ length: n }, (_, k) => a * Math.pow(b / a, k / (n - 1)));
  function exportRec(curves) {
    const S2 = recState(); if (!S2.res) return; const u = hUnit(S2.R);
    if (!curves) { const rows = [`t_a_s,dH_${u.replace(/\W+/g, "_")},dH_over_dCp_K,Tf_from_dH_K,Tf_area_K,phi`];
      S2.res.filter(x => !x.bad).forEach(x => rows.push([x.r.ta, x.dH, x.dT, x.TfH, x.N.TfPrime, x.phi].join(",")));
      dl(new Blob([rows.join("\n")], { type: "text/csv" }), "enthalpy_recovery.csv"); return; }
    const rows = ["t_a_s,T_K,HF_reference,HF_annealed_aligned,dHF"];
    S2.res.filter(x => !x.bad).forEach(x => x.rc.x.forEach((t, k) => rows.push([x.r.ta, t, x.rc.ref[k], x.rc.aged[k], x.rc.dHF[k]].join(","))));
    dl(new Blob([rows.join("\n")], { type: "text/csv" }), "dHF_curves.csv");
  }

  /* ================= TAB 3: property relaxation ================= */
  function newVolEditor() { return { text: "", parsed: null, xcol: 0, ycol: 1, xu: "s", pu: "V (cm³/g)", TaT: "", name: "" }; }
  function vfit(v) { const key = `${v.vinfMode}|${v.vinf}`; if (!v._F || v._Fkey !== key) { v._F = AN.relaxFit(v.t, v.v, v.vinfMode === "fixed" ? +v.vinf : NaN); v._Fkey = key; } return v._F; }
  function renderLeft3() {
    const v = A.vols[A.vsel];
    const list = A.vols.map((x, i) => `<div class="dsitem ${i === A.vsel ? "sel" : ""}" data-vsel="${i}" style="--pc:${col(i)}"><span class="pill" style="--pc:${col(i)}">${x.t.length}</span><span class="nm" title="${esc(x.name)}">${esc(x.name)}</span><button class="btn icon danger" data-vdel="${i}" title="Remove">×</button><span class="meta">${esc(x.pu)}${isFinite(x.Ta) ? ` · T_a = ${nf(tU(x.Ta), 5)} ${uL()}` : ""}</span></div>`).join("");
    let fitCard = "";
    if (v) {
      const F = vfit(v);
      fitCard = `<div class="card"><h2>Stretched-exponential fit <span class="sub">${esc(v.name)}</span></h2><div class="body">
        <div class="eqn">${esc(v.pu.split(" (")[0] || "V")}(t) = V∞ + (V₀ − V∞)·exp[−(t/τ)^β]</div>
        <div class="grid2" style="margin-top:8px"><label class="f">Equilibrium value V∞<select id="vinfMode"><option value="free" ${v.vinfMode !== "fixed" ? "selected" : ""}>fitted</option><option value="fixed" ${v.vinfMode === "fixed" ? "selected" : ""}>fixed at</option></select></label>
          <label class="f">V∞ value<input type="number" id="vinfVal" value="${v.vinf}" step="any" ${v.vinfMode === "fixed" ? "" : "disabled"}></label></div>
        ${F ? `<table class="metrics" style="margin-top:8px"><tr><th>parameter</th><th>value</th></tr>
          <tr><td>τ (KWW)</td><td class="num">${nf(F.tau, 4)} s</td></tr><tr><td>β</td><td class="num">${nf(F.beta, 3)}</td></tr><tr><td>⟨τ⟩ = (τ/β) Γ(1/β)</td><td class="num">${nf(F.meanTau, 4)} s</td></tr>
          <tr><td>V₀ (t = 0)</td><td class="num">${nf(F.v0, 7)}</td></tr><tr><td>V∞</td><td class="num">${nf(F.vinf, 7)}</td></tr><tr><td>V₀ − V∞ (relative)</td><td class="num">${nf(F.dv, 4)} (${nf(F.dv / F.vinf * 100, 3)} %)</td></tr>
          <tr><td>R²</td><td class="num">${nf(F.R2, 6)}</td></tr></table>` : `<div class="banner err" style="margin-top:8px">The fit needs at least four points.</div>`}
        <p class="note">φ(t) = (V − V∞)/(V₀ − V∞) is the relaxation function, directly comparable with φ(t<sub>a</sub>) from enthalpy recovery (tab 2) and with the Fitter's "annealing" data.</p>
        <div class="row" style="margin-top:6px"><button class="btn small" id="csv3">Export data, φ and fit (.csv)</button></div>
      </div></div>`;
    }
    $("#left").innerHTML = `
      <div class="card"><h2>Relaxation datasets <span class="sub">${A.vols.length}</span></h2><div class="body">
        ${A.vols.length ? list : `<p class="note" style="margin-top:0">Upload a property measured during isothermal annealing: volume, density, length, refractive index… against time.</p>`}
        <div class="row" style="margin-top:6px"><button class="btn small" id="addVol">+ Add dataset</button><button class="btn small" id="exVol">Load example data</button></div>
      </div></div>
      ${A.ved ? `<div class="card"><h2>Add a relaxation dataset</h2><div class="body">${editorHTML(A.ved, "vol")}</div></div>` : ""}
      ${fitCard}`;
  }
  function renderRight3() {
    const v = A.vols[A.vsel];
    if (!v) { $("#right").innerHTML = `<div class="rhead"><h3>Property relaxation</h3></div>${empty("Add a dataset or load the example (specific volume of selenium during annealing, computed with the TL model).")}`; return; }
    $("#right").innerHTML = `<div class="rhead"><h3>${esc(v.name)}</h3></div><div class="plots">${card("a3v")}${card("a3phi")}${card("a3r")}</div>`;
    const F = vfit(v), c = col(A.vsel), tmax = Math.max(...v.t), tmin = Math.min(...v.t.filter(t => t > 0));
    const tt = A.logt ? logspace(tmin, tmax, 200) : Array.from({ length: 200 }, (_, k) => tmax * k / 199);
    const s1 = [{ name: "data", x: v.t, y: v.v, color: c, pts: true, r: 2.6 }];
    if (F) s1.push({ name: `fit: τ = ${nf(F.tau, 3)} s, β = ${nf(F.beta, 3)}`, x: tt, y: tt.map(t => F.vinf + F.dv * Math.exp(-Math.pow(t / F.tau, F.beta))), color: css("--ink"), w: 1.6 }, { name: "V∞", x: [tt[0], tt[tt.length - 1]], y: [F.vinf, F.vinf], color: css("--eq"), w: 1, dash: "4 3" });
    P("a3v", { title: `${v.pu} during annealing${isFinite(v.Ta) ? ` at ${nf(tU(v.Ta), 5)} ${uL()}` : ""}`, xlabel: "time (s)", ylabel: v.pu, xlog: A.logt, series: s1, xshort: "t", yshort: "V" });
    const s2 = [];
    A.vols.forEach((w, i) => { const G = vfit(w); if (!G) return; s2.push({ name: w.name, x: w.t, y: w.v.map(y => (y - G.vinf) / G.dv), color: col(i), pts: true, r: i === A.vsel ? 2.8 : 2 });
      const ts = A.logt ? logspace(Math.min(...w.t.filter(t => t > 0)), Math.max(...w.t), 150) : Array.from({ length: 150 }, (_, k) => Math.max(...w.t) * k / 149);
      s2.push({ name: "", x: ts, y: ts.map(t => Math.exp(-Math.pow(t / G.tau, G.beta))), color: col(i), w: 1.4 }); });
    P("a3phi", { title: "Relaxation function φ(t) = (V − V∞)/(V₀ − V∞), all datasets", xlabel: "time (s)", ylabel: "φ", xlog: A.logt, series: s2, xshort: "t", yshort: "φ" });
    if (F) P("a3r", { title: "Residuals of the fit", xlabel: "time (s)", ylabel: "residual", xlog: A.logt, series: [{ name: "", x: [tt[0] || tmin, tmax], y: [0, 0], color: css("--eq"), w: 1, dash: "3 3" }, { name: "", x: v.t, y: v.v.map((y, k) => y - (F.vinf + F.dv * Math.exp(-Math.pow(v.t[k] / F.tau, F.beta)))), color: c, pts: true, r: 2.2 }], xshort: "t", yshort: "res" });
  }
  function addVolFromEditor() {
    const ed = A.ved, p = ed.parsed, msg = $("#edMsg"); if (!p) return;
    const t = [], v = []; p.cols[+ed.xcol].forEach((x, i) => { const y = p.cols[+ed.ycol][i]; if (isFinite(x) && isFinite(y)) { t.push(x * TIME[ed.xu]); v.push(y); } });
    if (t.length < 4) { msg.textContent = "Fewer than four usable rows."; return; }
    const o = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
    A.vols.push({ name: ed.name || `${ed.pu || "Property"} relaxation`, pu: ed.pu || "V", Ta: ed.TaT === "" ? NaN : tK(+ed.TaT), t: o.map(i => t[i]), v: o.map(i => v[i]), vinfMode: "free", vinf: "" });
    A.vsel = A.vols.length - 1; A.ved = null; render();
  }
  function exportVol() {
    const v = A.vols[A.vsel]; if (!v) return; const F = vfit(v); const rows = ["t_s,value,phi,fit"];
    v.t.forEach((t, k) => rows.push([t, v.v[k], F ? (v.v[k] - F.vinf) / F.dv : "", F ? F.vinf + F.dv * Math.exp(-Math.pow(t / F.tau, F.beta)) : ""].join(",")));
    dl(new Blob([rows.join("\n")], { type: "text/csv" }), "relaxation_fit.csv");
  }

  /* ================= events ================= */
  document.addEventListener("click", e => {
    const t = e.target.closest("button,[data-sel],[data-vsel]"); if (!t) return;
    if (t.dataset.tab) { A.tab = +t.dataset.tab; render(); return; }
    if (t.id === "themeBtn") { const r = document.documentElement; r.dataset.theme = (r.dataset.theme || "light") === "dark" ? "light" : "dark"; renderRight(); return; }
    // tab 1
    if (t.id === "addRun") { A.ed = newHfEditor(); renderLeft1(); return; }
    if (t.id === "exRuns") { loadExampleRuns(); if (A.tab !== 1) render(); return; }
    if (t.id === "edCancel") { A.ed = null; A.ved = null; render(); return; }
    if (t.id === "edAdd") { if (A.tab === 3) addVolFromEditor(); else addRunFromEditor(); return; }
    if (t.dataset.del !== undefined) { e.stopPropagation(); A.runs.splice(+t.dataset.del, 1); A.sel = Math.min(A.sel, A.runs.length - 1); render(); return; }
    if (t.dataset.sel !== undefined) { A.sel = +t.dataset.sel; render(); return; }
    if (t.id === "rgAuto") { const r = A.runs[A.sel]; r.rg = AN.defaultRanges(r.T); render(); return; }
    if (t.id === "rgAll") { const r = A.runs[A.sel]; A.runs.forEach(x => { x.rg = JSON.parse(JSON.stringify(r.rg)); }); render(); return; }
    if (t.id === "csv1") { exportNorm(); return; }
    // tab 2
    if (t.id === "csv2") { exportRec(false); return; } if (t.id === "csv2c") { exportRec(true); return; }
    // tab 3
    if (t.id === "addVol") { A.ved = newVolEditor(); renderLeft3(); return; }
    if (t.id === "exVol") { EXAMPLES.volume.forEach(x => A.vols.push({ name: x.name, pu: `v (${x.unit})`, Ta: x.Ta, t: x.t.slice(), v: x.v.slice(), vinfMode: "free", vinf: "" })); A.vsel = A.vols.length - 1; render(); return; }
    if (t.dataset.vdel !== undefined) { e.stopPropagation(); A.vols.splice(+t.dataset.vdel, 1); A.vsel = Math.min(A.vsel, A.vols.length - 1); render(); return; }
    if (t.dataset.vsel !== undefined) { A.vsel = +t.dataset.vsel; render(); return; }
    if (t.id === "csv3") { exportVol(); return; }
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "unit") { A.unit = t.value; render(); return; }
    if (t.id === "tscale") { A.logt = t.value === "log"; renderRight(); return; }
    if (t.id === "edFile") { const f = t.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const ed = A.tab === 3 ? A.ved : A.ed; setText(ed, rd.result, A.tab === 3 ? "vol" : "hf"); if (!ed.name) ed.name = f.name.replace(/\.[^.]+$/, ""); A.tab === 3 ? renderLeft3() : renderLeft1(); }; rd.readAsText(f); return; }
    const ed = A.tab === 3 ? A.ved : A.ed;
    if (ed) {
      const map = { edX: "xcol", edY: "ycol", edXU: "xu", edYU: "yu", edSign: "sign", edKind: "kind" };
      if (map[t.id]) { ed[map[t.id]] = t.value; A.tab === 3 ? renderLeft3() : renderLeft1(); return; }
    }
    if (t.id === "recRef") { A.rec.ref = +t.value; A.rec.int = null; render(); return; }
    if (t.id === "recMode") { A.rec.mode = t.value; render(); return; }
    if (t.id === "vinfMode") { const v = A.vols[A.vsel]; v.vinfMode = t.value; if (t.value === "fixed" && v.vinf === "") { const F = vfit(v); v.vinf = F ? +F.vinf.toPrecision(7) : ""; } render(); return; }
  });
  document.addEventListener("input", e => {
    const t = e.target, ed = A.tab === 3 ? A.ved : A.ed;
    if (t.id === "edText" && ed) { setText(ed, t.value, A.tab === 3 ? "vol" : "hf"); const box = t.closest(".body"); const keep = t.selectionStart; (A.tab === 3 ? renderLeft3 : renderLeft1)(); const nt = $("#edText"); if (nt) { nt.focus(); nt.selectionStart = nt.selectionEnd = keep; } return; }
    if (ed) { const map = { edQ: "q", edM: "m", edTa: "ta", edTaT: "TaT", edName: "name", edPU: "pu" }; if (map[t.id]) { ed[map[t.id]] = t.value; return; } }
    if (t.dataset.rg) { const v = parseFloat(t.value); if (!isFinite(v)) return; const r = A.runs[A.sel], k = t.dataset.rg; r.rg[k[0]][+k[1]] = tK(v); r._N = null; renderRight1(); refreshStats1(); return; }
    if (t.dataset.ta) { const v = parseFloat(t.value); A.runs[+t.dataset.ta].ta = isFinite(v) && v > 0 ? v : 0; renderTabs(); debounce(() => { renderLeft2Keep(); renderRight2(); }); return; }
    if (t.id === "int0" || t.id === "int1") { const S2 = recState(), v = parseFloat(t.value); if (!isFinite(v) || !S2.int) return; const a = S2.int.slice(); a[t.id === "int0" ? 0 : 1] = tK(v); A.rec.int = a; debounce(() => { renderLeft2Keep(); renderRight2(); }); return; }
    if (t.id === "recTa") { A.rec.Ta = t.value; debounce(() => { renderLeft2Keep(); renderRight2(); }); return; }
    if (t.id === "recDcp") { A.rec.dcp = t.value; debounce(() => { renderLeft2Keep(); renderRight2(); }); return; }
    if (t.id === "vinfVal") { const v = A.vols[A.vsel]; v.vinf = t.value; debounce(() => { renderLeft3Keep(); renderRight3(); }); return; }
  });
  let tmr = null; const debounce = f => { clearTimeout(tmr); tmr = setTimeout(f, 250); };
  // re-render the left panel without losing the focused input
  function keepFocus(fn) { const a = document.activeElement, id = a && a.id, ds = a && Object.entries(a.dataset || {})[0], pos = a && a.selectionStart; fn(); let el = id ? document.getElementById(id) : ds ? document.querySelector(`[data-${ds[0]}="${ds[1]}"]`) : null; if (el) { el.focus(); try { el.selectionStart = el.selectionEnd = pos; } catch (e) {} } }
  const renderLeft2Keep = () => keepFocus(renderLeft2), renderLeft3Keep = () => keepFocus(renderLeft3);
  function refreshStats1() { keepFocus(renderLeft1); }

  if (window.desktop) document.querySelectorAll("[data-tool]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); window.desktop.openTool(a.dataset.tool); }));
  render();
})();
