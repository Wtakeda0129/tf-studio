// Synthetic example data for the Data Analysis page (TL model, selenium parameters from JCP 2024, Table I):
// raw DSC heat flow (mW, endo up) for cooling/heating scans and for heating scans after annealing, and a
// volume-relaxation (specific volume) series during isothermal annealing. Run: node build_examples.js
const fs = require("fs"), path = require("path"), F = path.join(__dirname, "../fitter/");
global.TL = require(F + "tl_core.js"); global.MODELS = require(F + "models_extra.js"); const E = require(F + "engine.js");
TL.setLibrary(JSON.parse(fs.readFileSync(F + "beta_library.json"))); MODELS.setTables(JSON.parse(fs.readFileSync(F + "prony_fit.json")), JSON.parse(fs.readFileSync(F + "relaxpy_prony.json")));
const p = { Tg: 308.13, m: 64.14, log10tau0: -23.41, f: 0.59, beta0: 1, N: 200 };
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const mass = 10.0;                                    // mg
const cpg = T => 0.320 + 0.00030 * (T - 250);          // J/(g K), glassy Se
const cpl = T => 0.505 - 0.00010 * (T - 250);          // J/(g K), liquid Se (ΔC_p ≈ 0.17 J/(g K) at T_g)
const r4 = v => +v.toFixed(4), r5 = v => +v.toPrecision(7);
function scan(segs, si, q, noise) {                   // heat flow of segment si (mW, endo up)
  const h = E.compile(p.Tg + 40, segs), s = E.simulate("TL", p, h, {}), c = E.cpSeries(h, s, si);
  const T = [], HF = [];
  for (let i = 0; i < c.x.length; i += 2) { const t = c.x[i], cpN = c.y[i]; const cp = cpg(t) + (cpl(t) - cpg(t)) * cpN;
    T.push(r4(t)); HF.push(r5(mass * cp * q / 60 + 0.004 * (t - 250) / 60 + noise * gauss())); }
  if (q < 0) { T.reverse(); HF.reverse(); }           // as recorded: cooling runs go from high to low T
  return { T, HF };
}
const lo = p.Tg - 70, hi = p.Tg + 40, Ta = +(p.Tg - 12).toFixed(2);
const runs = [];
const cool = scan([{ type: "ramp", T: lo, rate: 10, dT: 0.1 }], 0, -10, 0.0012);
runs.push({ name: "Cooling 10 K/min", kind: "cool", q: 10, mass, ta: null, Ta: null, ...cool });
const ref = scan([{ type: "ramp", T: lo, rate: 10, dT: 0.1 }, { type: "ramp", T: hi, rate: 10, dT: 0.1 }], 1, 10, 0.0012);
runs.push({ name: "Heating 10 K/min (reference, unaged)", kind: "heat", q: 10, mass, ta: 0, Ta: null, ...ref });
for (const ta of [1e2, 1e3, 1e4, 1e5]) {
  const segs = [{ type: "ramp", T: Ta, rate: 10, dT: 0.1 }, { type: "hold", dur: ta, n: 100, t1: 0.1 }, { type: "ramp", T: lo, rate: 10, dT: 0.1 }, { type: "ramp", T: hi, rate: 10, dT: 0.1 }];
    const sup = { 2: "²", 3: "³", 4: "⁴", 5: "⁵" }[Math.round(Math.log10(ta))];
  const hh = E.compile(p.Tg + 40, segs), ss = E.simulate("TL", p, hh, {});
  const truth = { Tf0: ss.Tf[hh.info[0].i1], TfA: ss.Tf[hh.info[1].i1] };
  runs.push({ name: `Heating 10 K/min after 10${sup} s at ${Ta} K`, kind: "heat", q: 10, mass, ta, Ta, truth, ...scan(segs, 3, 10, 0.0012) });
}
// volume relaxation at Ta after cooling at 10 K/min: v = v∞ [1 + Δα (T_f − T_a)]
const hv = E.compile(p.Tg + 40, [{ type: "ramp", T: Ta, rate: 10, dT: 0.1 }, { type: "hold", dur: 1e7, n: 100, t1: 1 }]);
const sv = E.simulate("TL", p, hv, {}), inf = hv.info[1], vinf = 0.23360, dalpha = 1.5e-4;
const vt = [], vv = [];
for (let i = inf.i0; i <= inf.i1; i++) { vt.push(+(hv.t[i] - hv.t[inf.i0 - 1]).toPrecision(6)); vv.push(+(vinf * (1 + dalpha * (sv.Tf[i] - Ta)) + 2e-7 * gauss()).toFixed(8)); }
const out = { note: "Synthetic data from the Takeda–Lucas model (selenium parameters, JCP 160, 174504 (2024)) with noise; heat flow in mW (endo up), sample mass 10 mg.",
  model: p, runs, volume: [{ name: `Specific volume during annealing at ${Ta} K (after cooling at 10 K/min)`, Ta, unit: "cm³/g", t: vt, v: vv }] };
fs.writeFileSync(path.join(__dirname, "examples.json"), JSON.stringify(out));
console.log("runs", runs.map(r => `${r.name}: ${r.T.length} pts, HF ${Math.min(...r.HF).toFixed(3)}..${Math.max(...r.HF).toFixed(3)}`).join("\n"), "\nvolume pts", vt.length, "v range", Math.min(...vv), Math.max(...vv));
