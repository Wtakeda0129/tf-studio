/* GARASU · export one plot panel as SVG, PNG, JPEG (title and legend drawn into the image) or CSV (every curve). */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const plain = s => String(s == null ? "" : s).replace(/<[^>]+>/g, "");
  const slug = s => plain(s).replace(/[^\w\- .()=]+/g, "_").replace(/_+/g, "_").trim().slice(0, 70) || "panel";

  /* physics labels: T_f → T<sub>f</sub>, C_p^N → C<sub>p</sub><sup>N</sup>, T_f,i, β_KWW … (known symbols only, so user names stay as typed) */
  const LBL = /(^|[^A-Za-z])(HF|ΔC|ΔH|dT|δT|C|T|H|t|β|τ|σ|φ)_(\{[^}]*\}|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)?)(?:\^(\{[^}]*\}|[A-Za-z0-9]+))?(?![A-Za-z0-9])/g;
  const unb = s => s.replace(/^\{|\}$/g, "");
  const GLabel = {
    html: s => String(s == null ? "" : s).replace(LBL, (m, a, b, sub, sup) => `${a}${b}<sub>${unb(sub)}</sub>${sup ? `<sup>${unb(sup)}</sup>` : ""}`),
    svg: s => String(s == null ? "" : s).replace(LBL, (m, a, b, sub, sup) => `${a}${b}<tspan baseline-shift="-0.25em" font-size="74%">${unb(sub)}</tspan>${sup ? `<tspan baseline-shift="0.55em" font-size="74%">${unb(sup)}</tspan>` : ""}`),
    plain: s => String(s == null ? "" : s)
  };
  window.GLabel = GLabel;
  const FONTS = /*%%FONTS64%%*/null;
  const fontCSS = () => FONTS ? `<style>${FONTS.map(f => `@font-face{font-family:'Source Sans 3';font-weight:${f.w};src:url(data:font/woff2;base64,${f.b}) format('woff2')${f.r ? `;unicode-range:${f.r}` : ""}}`).join("")}</style>` : "";
  function dl(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  // a self-contained SVG: the plot with CSS variables resolved, plus the title above and the legend below
  function standalone(svg, cfg, series) {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    const ink = v("--ink") || "#22252a", muted = v("--muted") || "#6e6c66";
    const vb = (svg.getAttribute("viewBox") || "0 0 560 310").split(/\s+/).map(Number), W = vb[2], H = vb[3];
    let inner = new XMLSerializer().serializeToString(svg);
    inner = inner.replace(/var\((--[a-z0-9-]+)\)/g, (_, n) => v(n) || "#000")
      .replace(/<g class="hov"[\s\S]*?<\/g>/, "").replace(/<rect class="cap"[^>]*\/>/, "")
      .replace(/<g class="axis">/, `<g class="axis" fill="${muted}" font-size="11">`)
      .replace(/<text class="axlabel"/g, `<text fill="${ink}" font-size="12"`).replace(/<text class="axis"/g, "<text")
      .replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const title = plain(cfg.title || ""), tH = title ? 26 : 6;
    const items = (series || []).filter(s => s.name && s.x && s.x.length);
    // legend rows: estimate text width (≈6.2 px per character at 11.5 px)
    const rows = [[]]; let x = 0; const maxW = W - 16;
    items.forEach(s => { const w = 30 + plain(s.name).length * 6.2 + 16; if (x + w > maxW && rows[rows.length - 1].length) { rows.push([]); x = 0; } rows[rows.length - 1].push({ s, x }); x += w; });
    const lH = items.length ? rows.length * 18 + 6 : 0, TH = tH + H + lH;
    let leg = "";
    rows.forEach((r, k) => r.forEach(({ s, x }) => {
      const y = tH + H + 12 + k * 18, X = 8 + x;
      leg += s.pts ? `<circle cx="${X + 10}" cy="${y}" r="3.5" fill="${s.color}"/>` : `<line x1="${X}" x2="${X + 22}" y1="${y}" y2="${y}" stroke="${s.color}" stroke-width="${s.w || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`;
      leg += `<text x="${X + 28}" y="${y + 4}" fill="${muted}" font-size="11.5">${GLabel.svg(esc(plain(s.name)))}</text>`;
    }));
    return { W, H: TH, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TH}" viewBox="0 0 ${W} ${TH}" font-family="'Source Sans 3', Helvetica, Arial, sans-serif">${fontCSS()}` +
      `<rect width="100%" height="100%" fill="#ffffff"/>${title ? `<text x="8" y="17" fill="${ink}" font-size="13.5" font-weight="600">${GLabel.svg(esc(title))}</text>` : ""}` +
      `<g transform="translate(0 ${tH})">${inner}</g>${leg}</svg>` };
  }
  function raster(svg, cfg, series, type) {
    const st = standalone(svg, cfg, series), scale = 3, img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = Math.round(st.W * scale); c.height = Math.round(st.H * scale);
      const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => dl(b, `${slug(cfg.title || cfg.id)}.${type === "image/png" ? "png" : "jpg"}`), type, 0.95);
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(st.svg);
  }
  function csv(cfg, series) {
    const S = (series || []).filter(s => s.x && s.x.length);
    const q = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const xn = plain(cfg.xshort || "x"), yn = plain(cfg.yshort || "y");
    const L = [`# ${plain(cfg.title || cfg.id || "")}`, `# x: ${plain(cfg.xlabel || xn)}`, `# y: ${plain(cfg.ylabel || yn)}`];
    L.push(S.map((s, i) => { const n = plain(s.name) || `series ${i + 1}`; return `${q(n + " " + xn)},${q(n + " " + yn)}`; }).join(","));
    const n = Math.max(0, ...S.map(s => s.x.length));
    for (let k = 0; k < n; k++) L.push(S.map(s => k < s.x.length ? `${isFinite(s.x[k]) ? s.x[k] : ""},${isFinite(s.y[k]) ? s.y[k] : ""}` : ",").join(","));
    dl(new Blob([L.join("\n")], { type: "text/csv" }), `${slug(cfg.title || cfg.id)}.csv`);
  }
  let open = null;
  function menu(btn, svg, cfg, series) {
    if (open) { open.remove(); const was = open._btn; open = null; if (was === btn) return; }
    const m = document.createElement("div"); m.className = "px-menu"; m._btn = btn;
    m.innerHTML = `<button data-f="png">PNG image</button><button data-f="jpg">JPEG image</button><button data-f="svg">SVG (vector)</button><button data-f="csv">CSV data</button>`;
    const r = btn.getBoundingClientRect(); m.style.top = (r.bottom + window.scrollY + 4) + "px"; m.style.left = Math.max(8, r.right + window.scrollX - 150) + "px";
    document.body.appendChild(m); open = m;
    m.addEventListener("click", e => { const f = e.target.closest("[data-f]"); if (!f) return; m.remove(); open = null;
      if (f.dataset.f === "svg") dl(new Blob([standalone(svg, cfg, series).svg], { type: "image/svg+xml" }), `${slug(cfg.title || cfg.id)}.svg`);
      else if (f.dataset.f === "png") raster(svg, cfg, series, "image/png");
      else if (f.dataset.f === "jpg") raster(svg, cfg, series, "image/jpeg");
      else csv(cfg, series); });
  }
  document.addEventListener("mousedown", e => { if (open && !open.contains(e.target) && e.target !== open._btn) { open.remove(); open = null; } });
  window.PanelExport = { menu, standalone, csv };
})();
