// GARASU (Glass Aging, Relaxation And Simulation Utility) — Electron shell
// One window. The home page and each tool (Learn, Lab, Fitter, Data Analysis) is a self-contained HTML page in ./app,
// loaded once into its own view and kept alive, so switching tools with the rail never loses work.
// Updates: electron-updater checks the "publish" feed configured in package.json (GitHub Releases by default).
const { app, BaseWindow, WebContentsView, Menu, dialog, shell, ipcMain } = require("electron");
const path = require("path");
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { autoUpdater = null; }

const PAGES = {
  home: { file: "index.html", title: "GARASU Beta" },
  learn: { file: "learn.html", title: "GARASU Beta · Learn" },
  explorer: { file: "explorer.html", title: "GARASU Beta · Lab" },
  fitter: { file: "fitter.html", title: "GARASU Beta · Fitter" },
  analysis: { file: "analysis.html", title: "GARASU Beta · Data Analysis" },
};
function pageForUrl(url) {
  if (!/^file:/.test(url)) return null;
  const m = /\/([a-z]+\.html)(#.*)?$/.exec(url.split("?")[0]); if (!m) return null;
  for (const [k, p] of Object.entries(PAGES)) if (p.file === m[1]) return { key: k, hash: m[2] || "" };
  return null;
}
let win = null, current = null;
const views = {};

function fit() {
  if (!win) return; const b = win.getContentBounds();
  for (const v of Object.values(views)) v.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
}
function makeView(key) {
  const v = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true } });
  const wc = v.webContents;
  wc.loadFile(path.join(__dirname, "app", PAGES[key].file));
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => {
    if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); return; }
    const t = pageForUrl(url);
    if (t && t.key === key) return;                      // an anchor on this page
    e.preventDefault(); if (t) show(t.key, t.hash);      // a link to another page: switch to its view
  });
  win.contentView.addChildView(v); views[key] = v; fit();
  return v;
}
function show(key, hash) {
  if (!PAGES[key]) return;
  if (!win || win.isDestroyed()) createWindow();
  const v = views[key] || makeView(key);
  for (const [k, o] of Object.entries(views)) o.setVisible(k === key);
  current = key; win.setTitle(PAGES[key].title); v.webContents.focus();
  if (hash) v.webContents.executeJavaScript(`location.hash=${JSON.stringify(hash)}`).catch(() => {});
  if (win.isMinimized()) win.restore(); win.focus();
}
function createWindow() {
  win = new BaseWindow({ width: 1500, height: 950, minWidth: 900, minHeight: 600, title: PAGES.home.title, backgroundColor: "#F3F1EC" });
  win.on("resize", fit);
  win.on("closed", () => { win = null; current = null; for (const k of Object.keys(views)) delete views[k]; });
}
const openLauncher = () => show("home");
const openTool = key => show(key);
const cur = () => current && views[current] ? views[current].webContents : null;

/* ---------------- updates ---------------- */
let manualCheck = false;
// macOS installs an update in place only when both versions carry the same Developer ID signature. Ad-hoc signed
// builds (no certificate configured) therefore point the user to the download page instead of downloading.
let MAC_SIGNED = true; try { MAC_SIGNED = require("./package.json").macSigned !== false; } catch (e) {}
const manualMac = () => process.platform === "darwin" && !MAC_SIGNED;
const RELEASES_URL = "https://github.com/wtakeda-research/GARASU/releases/latest";
let offered = null;
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = !manualMac();
  autoUpdater.on("update-available", info => {
    if (manualMac()) {
      if (!manualCheck && offered === info.version) return;   // remind once per version on automatic checks
      offered = info.version; manualCheck = false;
      dialog.showMessageBox({ type: "info", buttons: ["Download", "Later"], defaultId: 0, message: `GARASU ${info.version} is available (you have ${app.getVersion()}).`, detail: "Download the new DMG and drag GARASU into Applications, replacing the old copy." })
        .then(r => { if (r.response === 0) shell.openExternal(RELEASES_URL); });
      return;
    }
    if (manualCheck) dialog.showMessageBox({ message: `Version ${info.version} is available and is downloading in the background.` });
  });
  autoUpdater.on("update-not-available", () => { if (manualCheck) dialog.showMessageBox({ message: `You are up to date (version ${app.getVersion()}).` }); manualCheck = false; });
  let downloaded = null;
  autoUpdater.on("error", err => {
    // an update was downloaded but macOS refused to install it (signature mismatch): offer the download page
    if (downloaded && process.platform === "darwin") {
      dialog.showMessageBox({ type: "warning", buttons: ["Download", "Later"], defaultId: 0, message: `GARASU ${downloaded} could not be installed automatically.`, detail: "Download the new DMG and drag GARASU into Applications, replacing the old copy.\n\n" + String(err && err.message || err) })
        .then(r => { if (r.response === 0) shell.openExternal(RELEASES_URL); });
      downloaded = null; manualCheck = false; return;
    }
    if (manualCheck) dialog.showMessageBox({ type: "warning", message: "Could not check for updates.", detail: String(err && err.message || err) }); manualCheck = false;
  });
  autoUpdater.on("update-downloaded", info => {
    manualCheck = false; downloaded = info.version;
    dialog.showMessageBox({ type: "info", buttons: ["Restart now", "Later"], defaultId: 0, message: `Version ${info.version} has been downloaded.`, detail: "Restart the app to install the update." })
      .then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
}
function checkForUpdatesManually() {
  if (!app.isPackaged || !autoUpdater) { dialog.showMessageBox({ message: "Update checks run only in the installed app." }); return; }
  manualCheck = true; autoUpdater.checkForUpdates().catch(() => {});
}

/* ---------------- menu ---------------- */
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: "about" }, { label: "Check for Updates…", click: checkForUpdatesManually }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    { label: "File", submenu: [
      { label: "Home", accelerator: "CmdOrCtrl+0", click: openLauncher },
      { label: "Learn", accelerator: "CmdOrCtrl+1", click: () => openTool("learn") },
      { label: "Lab", accelerator: "CmdOrCtrl+2", click: () => openTool("explorer") },
      { label: "Fitter", accelerator: "CmdOrCtrl+3", click: () => openTool("fitter") },
      { label: "Data Analysis", accelerator: "CmdOrCtrl+4", click: () => openTool("analysis") },
      { type: "separator" }, isMac ? { role: "close" } : { role: "quit" } ] },
    { role: "editMenu" },
    { label: "View", submenu: [
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => cur() && cur().reload() },
      { label: "Toggle Developer Tools", accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I", click: () => cur() && cur().toggleDevTools() },
      { type: "separator" },
      { label: "Actual Size", accelerator: "CmdOrCtrl+Shift+0", click: () => cur() && cur().setZoomLevel(0) },
      { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => cur() && cur().setZoomLevel(cur().getZoomLevel() + 0.5) },
      { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => cur() && cur().setZoomLevel(cur().getZoomLevel() - 0.5) },
      { type: "separator" }, { label: "Toggle Full Screen", accelerator: isMac ? "Ctrl+Cmd+F" : "F11", click: () => win && win.setFullScreen(!win.isFullScreen()) }] },
    { role: "windowMenu" },
    { role: "help", submenu: [...(isMac ? [] : [{ label: "Check for Updates…", click: checkForUpdatesManually }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("open-tool", (_e, key) => openTool(key));
ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("check-updates", () => checkForUpdatesManually());

app.whenReady().then(() => { buildMenu(); openLauncher(); setupUpdater(); });
app.on("activate", () => { if (!win) openLauncher(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
