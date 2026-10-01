/* ============================================================
   GARASU · projects (shared by Data Analysis, the Fitter and the home page)
   A project is a named collection of items saved on this computer:
     cp-normalized   one normalized DSC run (C_p^N, T_f, glass/liquid baselines)    — from Data Analysis
     an-session      the whole Data Analysis state (raw runs, ranges, settings)     — from Data Analysis
     recovery        enthalpy-recovery results (ΔH, T_f, φ, KWW)                   — from Data Analysis
     relax-fit       property relaxation data and stretched-exponential fit         — from Data Analysis
     fit-result      model vs data, parameters ± SE, quality, baselines, session    — from the Fitter
   Storage: IndexedDB (database "garasu"), with a localStorage fallback. The current project id is in
   localStorage; other open pages (or desktop views) are told about changes through a BroadcastChannel.
   Projects can be exported to / imported from a single .garasu.json file.
   ============================================================ */
(function () {
  "use strict";
  const DBN = "garasu", ST = "projects", CUR = "garasu.currentProject";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => new Date().toISOString();
  const fmtDate = s => { try { const d = new Date(s); return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch (e) { return s; } };

  /* ---------------- storage ---------------- */
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no IndexedDB"));
      const rq = indexedDB.open(DBN, 1);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(ST)) db.createObjectStore(ST, { keyPath: "id" }); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }).catch(e => { console.warn("GARASU projects: IndexedDB unavailable, using localStorage", e); return null; });
    return dbp;
  }
  const lsKey = "garasu.projects";
  const lsAll = () => { try { return JSON.parse(localStorage.getItem(lsKey) || "[]"); } catch (e) { return []; } };
  const lsPut = arr => localStorage.setItem(lsKey, JSON.stringify(arr));
  async function all() {
    const db = await idb(); if (!db) return lsAll();
    return new Promise((res, rej) => { const rq = db.transaction(ST).objectStore(ST).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); });
  }
  async function get(id) {
    if (!id) return null; const db = await idb(); if (!db) return lsAll().find(p => p.id === id) || null;
    return new Promise((res, rej) => { const rq = db.transaction(ST).objectStore(ST).get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
  }
  async function put(p) {
    p.updated = now(); const db = await idb();
    if (!db) { const a = lsAll().filter(x => x.id !== p.id); a.push(p); lsPut(a); }
    else await new Promise((res, rej) => { const tx = db.transaction(ST, "readwrite"); tx.objectStore(ST).put(p); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    notify(); return p;
  }
  async function del(id) {
    const db = await idb();
    if (!db) lsPut(lsAll().filter(x => x.id !== id));
    else await new Promise((res, rej) => { const tx = db.transaction(ST, "readwrite"); tx.objectStore(ST).delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    if (curId() === id) setCur(null); notify();
  }

  /* ---------------- current project and change notification ---------------- */
  const curId = () => { try { return localStorage.getItem(CUR) || null; } catch (e) { return null; } };
  function setCur(id) { try { id ? localStorage.setItem(CUR, id) : localStorage.removeItem(CUR); } catch (e) {} notify(); }
  let bc = null; try { bc = new BroadcastChannel("garasu-projects"); } catch (e) {}
  const listeners = [];
  function notify() { try { bc && bc.postMessage("changed"); } catch (e) {} fire(); }
  function fire() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); refreshUI(); }
  if (bc) bc.onmessage = () => fire();
  window.addEventListener("storage", e => { if (e.key === CUR || e.key === lsKey) fire(); });

  /* ---------------- public API ---------------- */
  const GP = {
    list: async () => (await all()).map(p => ({ id: p.id, name: p.name, created: p.created, updated: p.updated, n: (p.items || []).length })).sort((a, b) => (b.updated || "").localeCompare(a.updated || "")),
    get, currentId: curId,
    current: async () => get(curId()),
    open(id) { setCur(id); },
    async create(name, notes) { const p = { id: uid(), name: name || "Untitled project", notes: notes || "", created: now(), updated: now(), items: [] }; await put(p); setCur(p.id); return p; },
    async rename(id, name) { const p = await get(id); if (!p) return; p.name = name; await put(p); },
    remove: del,
    // add an item to the current project; items with the same type and key replace the earlier version
    async addItem(it) {
      const p = await GP.current(); if (!p) throw new Error("No project is open.");
      const item = { id: uid(), created: now(), ...it };
      if (it.key) { const old = p.items.find(x => x.type === it.type && x.key === it.key); if (old) { item.id = old.id; item.created = old.created; item.revised = now(); p.items = p.items.filter(x => x !== old); } }
      p.items.push(item); await put(p); return item;
    },
    async item(id) { const p = await GP.current(); return p ? p.items.find(x => x.id === id) || null : null; },
    async deleteItem(id) { const p = await GP.current(); if (!p) return; p.items = p.items.filter(x => x.id !== id); await put(p); },
    async exportFile(id) {
      const p = await get(id || curId()); if (!p) return;
      download(new Blob([JSON.stringify({ format: "garasu-project", version: 1, exported: now(), project: p })], { type: "application/json" }), `${safe(p.name)}.garasu.json`);
    },
    async importFile(file) {
      const obj = JSON.parse(await file.text());
      const p = obj && obj.format === "garasu-project" ? obj.project : null; if (!p || !Array.isArray(p.items)) throw new Error("This is not a GARASU project file.");
      const ex = await get(p.id); if (ex) { p.id = uid(); p.name = p.name + " (imported)"; }
      await put(p); setCur(p.id); return p;
    },
    onChange(f) { listeners.push(f); },
    register(type, actions) { (HANDLERS[type] = HANDLERS[type] || []).push(...actions); refreshUI(); },
    csv: itemCSV, download, safe, esc, fmtDate,
    ask, confirmBox, toast,
  };
  window.GP = GP;
  function safe(s) { return String(s || "project").replace(/[^\w\- .()]+/g, "_").trim().slice(0, 80) || "project"; }
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  /* ---------------- item descriptions and CSV ---------------- */
  const TYPES = {
    "cp-normalized": { label: "Normalized heat capacity", tool: "analysis" },
    "an-session": { label: "Data Analysis sessions", tool: "analysis" },
    "recovery": { label: "Enthalpy recovery", tool: "analysis" },
    "relax-fit": { label: "Property relaxation fits", tool: "analysis" },
    "fit-result": { label: "Fit results", tool: "fitter" },
  };
  const ORDER = ["cp-normalized", "fit-result", "recovery", "relax-fit", "an-session"];
  const TOOLNAME = { analysis: "Data Analysis", fitter: "Fitter" };
  const HANDLERS = {};
  function itemCSV(it) {
    const d = it.data || {}, L = [];
    const row = a => L.push(a.map(v => typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : (v == null || (typeof v === "number" && !isFinite(v)) ? "" : v)).join(","));
    if (it.type === "cp-normalized") {
      L.push(`# ${it.name}`, `# scan: ${d.kind}, |q| = ${d.q} K/min${d.ta ? `, annealed ${d.ta} s at ${d.Ta} K` : ""}`,
        `# glass line HF_g = a + b*T: a = ${d.baseline.glass.a}, b = ${d.baseline.glass.b}, range ${d.baseline.glass.range.join("-")} K`,
        `# liquid line HF_l = a + b*T: a = ${d.baseline.liquid.a}, b = ${d.baseline.liquid.b}, range ${d.baseline.liquid.range.join("-")} K`,
        `# Tf' = ${d.TfPrime} K, midpoint = ${d.Tmid} K, dCp = ${d.dCp} ${d.cpUnit || ""}`);
      row(["T_K", `HF_${d.hfUnit || "raw"}`, "Cp_norm", "Tf_K"]); d.T.forEach((t, i) => row([t, d.HF[i], d.cpN[i], d.Tf[i]]));
    } else if (it.type === "fit-result") {
      L.push(`# ${it.name}`, `# model: ${d.modelName}, ${d.mode === "fit" ? "fitted" : "computed with chosen parameters"}; weighted R2 = ${d.quality && d.quality.R2_weighted}`);
      Object.entries(d.parameters || {}).forEach(([k, p]) => L.push(`# ${k} = ${p.value}${p.free ? (p.se != null ? ` ± ${p.se}` : p.grid_step ? ` (free, grid search in steps of ${p.grid_step}; no standard error)` : " (free)") : " (fixed)"}`));
      row(["dataset", "x", "y_data", "y_model", "residual"]);
      (d.datasets || []).forEach(s => s.x.forEach((x, k) => row([s.name, x, s.y[k], s.yModel[k], s.yModel[k] == null ? null : s.y[k] - s.yModel[k]])));
    } else if (it.type === "recovery") {
      L.push(`# ${it.name}`, `# reference: ${d.reference}, Tf'(ref) = ${d.TfRef} K, dCp = ${d.dCp}, Ta = ${d.Ta} K${d.kww ? `, KWW tau = ${d.kww.tau} s, beta = ${d.kww.beta}` : ""}`);
      row(["t_a_s", `dH_${d.hUnit}`, "dH_over_dCp_K", "Tf_from_dH_K", "Tf_area_K", "phi"]); (d.rows || []).forEach(r => row([r.ta, r.dH, r.dT, r.TfH, r.TfArea, r.phi]));
    } else if (it.type === "relax-fit") {
      L.push(`# ${it.name}`, `# fit: tau = ${d.fit && d.fit.tau} s, beta = ${d.fit && d.fit.beta}, V0 = ${d.fit && d.fit.v0}, Vinf = ${d.fit && d.fit.vinf}, R2 = ${d.fit && d.fit.R2}`);
      row(["t_s", d.pu || "value", "phi", "fit"]); d.t.forEach((t, k) => row([t, d.v[k], d.phi ? d.phi[k] : null, d.yfit ? d.yfit[k] : null]));
    } else return null;
    return L.join("\n");
  }

  /* ---------------- small dialogs (window.prompt does not exist in the desktop app) ---------------- */
  function modal(html, onReady) {
    const w = document.createElement("div"); w.className = "gp-modal"; w.innerHTML = `<div class="gp-dialog" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(w); const close = () => w.remove(); onReady(w, close);
    w.addEventListener("mousedown", e => { if (e.target === w) close(); });
    w.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    return close;
  }
  function ask(title, label, value, okLabel) {
    return new Promise(res => modal(`<h3>${esc(title)}</h3><label class="gp-f">${esc(label)}<input type="text" value="${esc(value || "")}"></label>
      <div class="gp-row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okLabel || "OK")}</button></div>`, (w, close) => {
      const inp = w.querySelector("input"); inp.focus(); inp.select();
      const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } close(); res(v); };
      w.querySelector("[data-ok]").onclick = ok; w.querySelector("[data-x]").onclick = () => { close(); res(null); };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
    }));
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(res => modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="gp-row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okLabel || "OK")}</button></div>`, (w, close) => {
      w.querySelector("[data-ok]").onclick = () => { close(); res(true); }; w.querySelector("[data-x]").onclick = () => { close(); res(false); }; w.querySelector("[data-ok]").focus();
    }));
  }
  function toast(msg) { const t = document.createElement("div"); t.className = "gp-toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.classList.add("out"), 2600); setTimeout(() => t.remove(), 3200); }

  /* ---------------- header switcher and contents drawer ---------------- */
  let bar = null, drawerOpen = false;
  const TOOL = (document.querySelector(".rail a.rtool.on") || {}).dataset ? (document.querySelector(".rail a.rtool.on") || { dataset: {} }).dataset.tool || "home" : "home";
  function mount() {
    const host = document.querySelector("body>header") || document.querySelector("header.top .wrap") || document.querySelector("header.top .in");
    if (!host || bar) return;
    bar = document.createElement("div"); bar.className = "gp-bar";
    const brand = host.querySelector(".brand"); brand ? brand.after(bar) : host.appendChild(bar);
    bar.addEventListener("click", onBarClick);
    document.addEventListener("click", e => { if (bar && !bar.contains(e.target)) bar.classList.remove("open"); });
    refreshUI();
  }
  let rq = 0;
  async function refreshUI() {
    if (!bar) return; const my = ++rq;
    const [p, list] = await Promise.all([GP.current(), GP.list()]); if (my !== rq) return;
    const open = bar.classList.contains("open");
    bar.innerHTML = `<button class="gp-chip" data-gp="menu" title="Projects keep your normalized data, fits and sessions together">
        <span class="gp-l">Project</span><b>${p ? esc(p.name) : "none"}</b><span aria-hidden="true">▾</span></button>
      ${p ? `<button class="btn small" data-gp="contents" title="Everything saved in this project">Contents · ${p.items.length}</button>` : `<button class="btn small" data-gp="new">New project</button>`}
      <div class="gp-menu">
        ${list.length ? `<div class="gp-h">Open a project</div>${list.slice(0, 12).map(x => `<button class="gp-item ${p && x.id === p.id ? "on" : ""}" data-gp="open" data-id="${x.id}"><b>${esc(x.name)}</b><span>${x.n} item${x.n === 1 ? "" : "s"} · ${esc(fmtDate(x.updated))}</span></button>`).join("")}<hr>` : ""}
        <button class="gp-item" data-gp="new">New project…</button>
        ${p ? `<button class="gp-item" data-gp="rename">Rename “${esc(p.name)}”…</button><button class="gp-item" data-gp="export">Export project file (.garasu.json)</button>` : ""}
        <label class="gp-item" style="cursor:pointer">Import project file…<input type="file" accept=".json,.garasu.json" data-gp-import hidden></label>
        ${p ? `<button class="gp-item" data-gp="close">Close project</button><hr><button class="gp-item danger" data-gp="delete">Delete “${esc(p.name)}”…</button>` : ""}
      </div>`;
    if (open) bar.classList.add("open");
    const imp = bar.querySelector("[data-gp-import]");
    if (imp) imp.onchange = async () => { const f = imp.files[0]; if (!f) return; try { const q = await GP.importFile(f); toast(`Imported “${q.name}”`); } catch (e) { toast(e.message); } };
    if (drawerOpen) renderDrawer(p);
    document.dispatchEvent(new CustomEvent("garasu-project", { detail: p }));
  }
  async function onBarClick(e) {
    const b = e.target.closest("[data-gp]"); if (!b) return; const a = b.dataset.gp; const p = await GP.current();
    if (a === "menu") { bar.classList.toggle("open"); return; }
    bar.classList.remove("open");
    if (a === "new") { const n = await ask("New project", "Name", "", "Create"); if (n) { await GP.create(n); toast(`Project “${n}” created`); } }
    else if (a === "open") GP.open(b.dataset.id);
    else if (a === "rename" && p) { const n = await ask("Rename project", "Name", p.name, "Rename"); if (n) await GP.rename(p.id, n); }
    else if (a === "export" && p) GP.exportFile(p.id);
    else if (a === "close") setCur(null);
    else if (a === "delete" && p) { if (await confirmBox("Delete project", `Delete “${p.name}” and its ${p.items.length} items from this computer? Export it first if you may need it again.`, "Delete")) { await GP.remove(p.id); toast("Project deleted"); } }
    else if (a === "contents") { drawerOpen = true; renderDrawer(p); }
  }
  function renderDrawer(p) {
    let d = document.querySelector(".gp-drawer");
    if (!p) { if (d) d.remove(); drawerOpen = false; return; }
    if (!d) { d = document.createElement("aside"); d.className = "gp-drawer"; document.body.appendChild(d); d.addEventListener("click", onDrawerClick); }
    const groups = ORDER.map(t => [t, p.items.filter(x => x.type === t)]).filter(g => g[1].length);
    d.innerHTML = `<div class="gp-dh"><div><div class="gp-l">Project</div><h3>${esc(p.name)}</h3></div><button class="btn icon" data-gd="close" title="Close">×</button></div>
      <p class="gp-note">Created ${esc(fmtDate(p.created))} · saved on this computer. Use <b>Export project file</b> in the project menu to back it up or share it.</p>
      ${groups.length ? groups.map(([t, items]) => `<section><h4>${esc(TYPES[t] ? TYPES[t].label : t)}</h4>${items.slice().reverse().map(it => itemRow(it)).join("")}</section>`).join("")
        : `<div class="gp-empty">Nothing saved yet. In Data Analysis, normalize your scans and click <b>Save to project</b>; in the Fitter, use data from the project and save the fit result.</div>`}`;
  }
  function itemRow(it) {
    const acts = (HANDLERS[it.type] || []).filter(h => !h.when || h.when(it));
    const home = TYPES[it.type] && TYPES[it.type].tool;
    const goto = !acts.length && home && home !== TOOL ? `<button class="btn small" data-gd="goto" data-id="${it.id}" data-tool="${home}">Open in ${TOOLNAME[home]}</button>` : "";
    const csv = itemCSV({ ...it, data: { ...(it.data || {}), T: [], HF: [], cpN: [], Tf: [], t: [], v: [], datasets: [], rows: [] } }) !== null;
    return `<div class="gp-it"><div class="gp-in"><b>${esc(it.name)}</b><span>${window.GLabel ? GLabel.html(esc(it.summary || "")) : esc(it.summary || "")}</span><span class="gp-d">${esc(fmtDate(it.revised || it.created))}${it.revised ? " (updated)" : ""}</span></div>
      <div class="gp-act">${acts.map((h, k) => `<button class="btn small ${k === 0 ? "primary" : ""}" data-gd="act" data-k="${k}" data-id="${it.id}">${esc(h.label)}</button>`).join("")}${goto}
      ${csv ? `<button class="btn small" data-gd="csv" data-id="${it.id}">CSV</button>` : ""}<button class="btn small" data-gd="json" data-id="${it.id}">JSON</button>
      <button class="btn icon danger" data-gd="del" data-id="${it.id}" title="Delete from project">×</button></div></div>`;
  }
  async function onDrawerClick(e) {
    const b = e.target.closest("[data-gd]"); if (!b) return; const a = b.dataset.gd;
    if (a === "close") { drawerOpen = false; document.querySelector(".gp-drawer").remove(); return; }
    const it = await GP.item(b.dataset.id); if (!it) return;
    if (a === "act") { const acts = (HANDLERS[it.type] || []).filter(h => !h.when || h.when(it)); const h = acts[+b.dataset.k]; if (h) { drawerOpen = false; document.querySelector(".gp-drawer").remove(); await h.run(it); } }
    else if (a === "goto") location.href = `${b.dataset.tool}.html#open=${it.id}`;
    else if (a === "csv") { const s = itemCSV(it); if (s) download(new Blob([s], { type: "text/csv" }), `${safe(it.name)}.csv`); }
    else if (a === "json") download(new Blob([JSON.stringify(it, null, 1)], { type: "application/json" }), `${safe(it.name)}.json`);
    else if (a === "del") { if (await confirmBox("Delete item", `Remove “${it.name}” from this project?`, "Delete")) await GP.deleteItem(it.id); }
  }

  /* ---------------- open an item from a link: tool.html#open=<item id> ---------------- */
  async function openFromHash() {
    const m = /#open=([\w]+)/.exec(location.hash || ""); if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    const it = await GP.item(m[1]); if (!it) { toast("That item is not in the open project."); return; }
    const acts = (HANDLERS[it.type] || []).filter(h => !h.when || h.when(it)); if (acts[0]) acts[0].run(it);
  }
  window.addEventListener("hashchange", openFromHash);
  GP.ready = () => { mount(); setTimeout(openFromHash, 0); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
