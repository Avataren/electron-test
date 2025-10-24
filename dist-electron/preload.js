const { ipcRenderer, contextBridge } = require("electron");
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(channel, listener) {
    return ipcRenderer.off(channel, ...listener ? [listener] : []);
  },
  send(channel, ...args) {
    return ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
  }
});
window.addEventListener("message", (ev) => {
  try {
    const payload = ev.data;
    if (!payload) return;
    const channel = payload.channel || "webview-frame";
    const message = payload.message ?? payload;
    try {
      ipcRenderer.emit(channel, null, message);
    } catch (err) {
      console.warn("[preload] failed to emit postMessage payload to ipcRenderer", err);
    }
  } catch (err) {
    console.warn("[preload] error handling postMessage event", err);
  }
});
