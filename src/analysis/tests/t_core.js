const AN = require("../analysis_core.js"), ex = require("../examples.json");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
// parseTable with header, commas and a unit row
const t = AN.parseTable("Temp (C),Heat Flow (mW)\n,\n-80, 1.2\n-79.5,1.21\n-79 , 1.22\n");
ok(t.n === 3 && t.names[0].startsWith("Temp") && t.cols[1][2] === 1.22, "parseTable " + JSON.stringify(t.names));
// normalization of the reference heating and the cooling scan
const R = {}; ex.runs.forEach(r => { const rr = { g: [245, 265], l: [325, 343] }; R[r.name] = AN.normalize(r, rr); });
const ref = R[ex.runs[1].name], cool = R[ex.runs[0].name];
ok(ref.ok && Math.abs(ref.cpN[ref.T.findIndex(x => x > 275)]) < 0.05 && Math.abs(ref.cpN[ref.T.findIndex(x => x > 335)] - 1) < 0.05, "C_p^N ≈ 0 in glass, 1 in liquid");
console.log("   T_f' ref heating", ref.TfPrime.toFixed(2), " T_f' cooling", cool.TfPrime.toFixed(2), " Tmid cooling", cool.Tmid.toFixed(2));
ok(Math.abs(ref.TfPrime - cool.TfPrime) < 0.6, "heating and cooling at the same rate give the same T_f' (area matching)");
// enthalpy recovery vs T_f' of the aged scans
ex.runs.slice(2).forEach(r => {
  const ag = R[r.name], rec = AN.recovery(ref, ag, { g: [245, 265], l: [325, 343], mode: "liquid", int: [245, 343] });
  const dcp = ref.dHF(ref.TfPrime) * 60 / r.q, dH = rec.integral * 60 / r.q;                 // mJ/K, mJ
  const dHdCp = dH / dcp, dTf = ref.TfPrime - ag.TfPrime;
  console.log(`   t_a=${r.ta}: ΔH=${(dH / r.mass).toFixed(4)} J/g  ΔH/ΔCp=${dHdCp.toFixed(3)} K  T_f'(ref)−T_f'(aged)=${dTf.toFixed(3)} K  sim T_f after anneal ${r.truth.TfA.toFixed(2)} vs area ${ag.TfPrime.toFixed(2)}`);
  ok(Math.abs(dHdCp - dTf) < 0.03 * Math.max(1, dTf) + 0.15, `t_a=${r.ta}: ΔH/ΔCp agrees with the T_f' difference`);
  ok(Math.abs(ag.TfPrime - r.truth.TfA) < 0.8, `t_a=${r.ta}: area-matched T_f' ≈ simulated T_f after annealing`);
});
// KWW fit recovers τ, β
const tt = Array.from({ length: 60 }, (_, i) => Math.pow(10, -1 + 6 * i / 59)), ph = tt.map(x => Math.exp(-Math.pow(x / 300, 0.55)));
const k = AN.kwwFit(tt, ph); ok(Math.abs(k.tau / 300 - 1) < 1e-3 && Math.abs(k.beta - 0.55) < 1e-3, `kwwFit τ=${k.tau.toFixed(2)} β=${k.beta.toFixed(4)}`);
// relaxation fit on the volume example (V∞ free) and on exact synthetic data
const vs = tt.map(x => 0.79 + 0.002 * Math.exp(-Math.pow(x / 500, 0.45)));
const f1 = AN.relaxFit(tt, vs); ok(Math.abs(f1.tau / 500 - 1) < 1e-3 && Math.abs(f1.beta - 0.45) < 1e-3 && Math.abs(f1.vinf - 0.79) < 1e-7, `relaxFit exact τ=${f1.tau.toFixed(2)} β=${f1.beta.toFixed(4)} V∞=${f1.vinf.toFixed(6)}`);
const V = ex.volume[0], f2 = AN.relaxFit(V.t, V.v); console.log("   volume example:", JSON.stringify({ tau: +f2.tau.toPrecision(4), beta: +f2.beta.toFixed(3), vinf: +f2.vinf.toFixed(6), R2: +f2.R2.toFixed(5) }));
ok(f2.R2 > 0.995 && Math.abs(f2.vinf - 0.23360) < 1e-4, "volume example: stretched exponential (nonlinear relaxation, so not exact) and V∞ ≈ true 0.23360");
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
