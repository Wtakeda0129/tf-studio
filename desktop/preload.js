const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  openTool: key => ipcRenderer.invoke("open-tool", key),
  version: () => ipcRenderer.invoke("app-version"),
  checkUpdates: () => ipcRenderer.invoke("check-updates"),
});
