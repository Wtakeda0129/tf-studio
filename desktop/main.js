// GARASU (Glass Aging, Relaxation And Simulation Utility) — Electron shell
// Opens a launcher window; each tool (Learn, Lab, Fitter, Data Analysis) is a self-contained HTML page in ./app.
// Updates: electron-updater checks the "publish" feed configured in package.json (GitHub Releases by default).
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const path = require("path");
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { autoUpdater = null; }

const TOOLS = {
  learn: { file: "learn.html", title: "GARASU Beta · Learn" },
  explorer: { file: "explorer.html", title: "GARASU Beta · Lab" },
  fitter: { file: "fitter.html", title: "GARASU Beta · Fitter" },
  analysis: { file: "analysis.html", title: "GARASU Beta · Data Analysis" },
};
// a link to another tool's page opens (or focuses) that tool's own window
function toolForUrl(url) { for (const [k, t] of Object.entries(TOOLS)) if (new RegExp("/" + t.file.replace(".", "\\.") + "(#.*)?$").test(url)) return k; return null; }
let launcher = null;
const toolWindows = {};

function openLauncher() {
  if (launcher && !launcher.isDestroyed()) { launcher.focus(); return; }
  launcher = new BrowserWindow({ width: 980, height: 720, minWidth: 700, minHeight: 500, title: "GARASU Beta",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true } });
  launcher.loadFile(path.join(__dirname, "app", "index.html"));
  launcher.webContents.on("will-navigate", (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  launcher.on("closed", () => { launcher = null; });
}
function openTool(key) {
  const t = TOOLS[key]; if (!t) return;
  const w0 = toolWindows[key]; if (w0 && !w0.isDestroyed()) { w0.focus(); return; }
  const w = new BrowserWindow({ width: 1500, height: 950, minWidth: 900, minHeight: 600, title: t.title, webPreferences: { contextIsolation: true } });
  w.loadFile(path.join(__dirname, "app", t.file));
  // external links open in the default browser
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  w.on("page-title-updated", e => e.preventDefault());   // keep the tool name in the title bar
  // the "GARASU" logo in each tool links to index.html: bring up the launcher instead of navigating away
  w.webContents.on("will-navigate", (e, url) => {
    if (/index\.html(#.*)?$/.test(url)) { e.preventDefault(); openLauncher(); return; }
    if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); return; }
    const k = toolForUrl(url); if (k && k !== key) { e.preventDefault(); openTool(k); }
  });
  toolWindows[key] = w; w.on("closed", () => { delete toolWindows[key]; });
}

/* ---------------- updates ---------------- */
let manualCheck = false;
// macOS installs an update in place only when both versions carry the same Developer ID signature. Ad-hoc signed
// builds (no certificate configured) therefore point the user to the download page instead of downloading.
let MAC_SIGNED = true; try { MAC_SIGNED = require("./package.json").macSigned !== false; } catch (e) {}
const manualMac = () => process.platform === "darwin" && !MAC_SIGNED;
const RELEASES_URL = "https://github.com/Wtakeda0129/tf-studio/releases/latest";
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
      { label: "Launcher", accelerator: "CmdOrCtrl+0", click: openLauncher },
      { label: "Learn", accelerator: "CmdOrCtrl+1", click: () => openTool("learn") },
      { label: "Lab", accelerator: "CmdOrCtrl+2", click: () => openTool("explorer") },
      { label: "Fitter", accelerator: "CmdOrCtrl+3", click: () => openTool("fitter") },
      { label: "Data Analysis", accelerator: "CmdOrCtrl+4", click: () => openTool("analysis") },
      { type: "separator" }, isMac ? { role: "close" } : { role: "quit" } ] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    { role: "help", submenu: [...(isMac ? [] : [{ label: "Check for Updates…", click: checkForUpdatesManually }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("open-tool", (_e, key) => openTool(key));
ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("check-updates", () => checkForUpdatesManually());

app.whenReady().then(() => { buildMenu(); openLauncher(); setupUpdater(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) openLauncher(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
