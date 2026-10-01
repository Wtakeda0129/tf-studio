/* tiny SVG plotter shared by the Learn page */
const PLOT = (function () {
  /* ---------- tiny SVG plotter ---------- */
  function niceTicks(lo, hi, target) {
    const span = hi - lo || 1, raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, out = [];
    const start = Math.ceil(lo / step - 1e-9), n = Math.floor(hi / step + 1e-9) - start;
    if (!isFinite(step) || !(step > 0) || !isFinite(n) || n > 1000) return [lo, hi];
    for (let i = 0; i <= n; i++) out.push(+((start + i) * step).toPrecision(12));
    return out;
  }
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toPrecision(3) + "");
  // cfg: {W,H,xdom,ydom,xticks:[[pos,label]],yticks?,xlabel,ylabel,lines:[{x,y,color,w,dash,op}],sticks:[{x,y,color,w,op}],bars:[{x0,x1,y,color,op}],vlines:[{x,color,dash,w}],dots:[{x,y,color,r}],notes:[{x,y,text,anchor}]}
  function svg(cfg) {
    const W = cfg.W || 380, H = cfg.H || 230, m = { l: 44, r: 8, t: 8, b: 34 };
    const [x0, x1] = cfg.xdom, [y0, y1] = cfg.ydom;
    const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    let g = `<svg viewBox="0 0 ${W} ${H}">`;
    const xt = cfg.xticks || niceTicks(x0, x1, 5).map(v => [v, fmt(v)]);
    const yt = cfg.yticks || niceTicks(y0, y1, 5).map(v => [v, fmt(v)]);
    xt.forEach(([v, lab]) => { const x = sx(v); if (x < m.l - 1 || x > W - m.r + 1) return; g += `<line x1="${x}" x2="${x}" y1="${H-m.b}" y2="${H-m.b-5}" stroke="var(--frame)"/><line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t+5}" stroke="var(--frame)"/><text x="${x}" y="${H - m.b + 14}" text-anchor="middle">${lab}</text>`; });
    yt.forEach(([v, lab]) => { const y = sy(v); if (y < m.t - 1 || y > H - m.b + 1) return; g += `<line x1="${m.l}" x2="${m.l+5}" y1="${y}" y2="${y}" stroke="var(--frame)"/><line x1="${W-m.r}" x2="${W-m.r-5}" y1="${y}" y2="${y}" stroke="var(--frame)"/><text x="${m.l - 5}" y="${y + 3.5}" text-anchor="end">${lab}</text>`; });
    (cfg.shade || []).forEach(s => { g += `<rect x="${sx(s[0])}" y="${m.t}" width="${sx(s[1]) - sx(s[0])}" height="${H - m.t - m.b}" fill="var(--soft)"/>`; });
    g += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="none" stroke="var(--frame)"/>`;
    const id = "c" + Math.random().toString(36).slice(2, 8);
    g += `<clipPath id="${id}"><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/></clipPath><g clip-path="url(#${id})">`;
    (cfg.bars || []).forEach(b => { const ya = sy(Math.max(b.y, y0)); g += `<rect x="${sx(b.x0).toFixed(1)}" y="${ya.toFixed(1)}" width="${Math.max(0.5, sx(b.x1) - sx(b.x0) - 0.6).toFixed(1)}" height="${(sy(y0) - ya).toFixed(1)}" fill="${b.color}" fill-opacity="${b.op || 0.55}"/>`; });
    (cfg.lines || []).forEach(s => {
      let d = "", pen = false;
      for (let i = 0; i < s.x.length; i++) { const ok = isFinite(s.x[i]) && isFinite(s.y[i]); if (!ok) { pen = false; continue; } d += (pen ? "L" : "M") + sx(s.x[i]).toFixed(1) + " " + sy(s.y[i]).toFixed(1); pen = true; }
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.6}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} ${s.op != null ? `stroke-opacity="${s.op}"` : ""} stroke-linejoin="round"/>`;
    });
    (cfg.sticks || []).forEach(s => { g += `<line x1="${sx(s.x)}" x2="${sx(s.x)}" y1="${sy(y0)}" y2="${sy(s.y)}" stroke="${s.color}" stroke-width="${s.w || 3}" stroke-opacity="${s.op || 0.85}" stroke-linecap="butt"/>`; });
    (cfg.vlines || []).forEach(v => { g += `<line x1="${sx(v.x)}" x2="${sx(v.x)}" y1="${m.t}" y2="${H - m.b}" stroke="${v.color}" stroke-width="${v.w || 1.4}" ${v.dash ? `stroke-dasharray="${v.dash}"` : ""}/>`; });
    (cfg.dots || []).forEach(p => { g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.r || 3}" fill="${p.color}" ${p.op != null ? `fill-opacity="${p.op}"` : ""}/>`; });
    g += `</g>`;
    (cfg.notes || []).forEach(n => { g += `<text class="al" x="${n.x}" y="${n.y}" text-anchor="${n.anchor || "start"}">${n.text}</text>`; });
    g += `<text class="al" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${window.GLabel ? GLabel.svg(cfg.xlabel || "") : (cfg.xlabel || "")}</text>`;
    g += `<text class="al" transform="translate(11 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${window.GLabel ? GLabel.svg(cfg.ylabel || "") : (cfg.ylabel || "")}</text></svg>`;
    return g;
  }

  // log-axis helpers: data are passed as log10 values
  function logTicks(lo, hi, every) { const out = []; every = every || 1; for (let e = Math.ceil(lo); e <= Math.floor(hi); e += every) out.push([e, e === 0 ? "1" : "10<tspan dy='-4' font-size='8'>" + e + "</tspan>"]); return out; }
  return { svg, niceTicks, fmt, logTicks };
})();
