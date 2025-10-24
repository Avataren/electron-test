const { ipcRenderer, contextBridge } = require("electron");
const handlers = /* @__PURE__ */ new Map();
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    console.log("[preload] Registering handler for:", channel);
    if (!handlers.has(channel)) handlers.set(channel, /* @__PURE__ */ new Set());
    handlers.get(channel).add(listener);
    return ipcRenderer.on(channel, (e, ...args) => listener(e, ...args));
  },
  off(channel, listener) {
    if (listener && handlers.has(channel)) handlers.get(channel).delete(listener);
    return ipcRenderer.off(channel, listener || void 0);
  },
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});
window.addEventListener("message", (ev) => {
  console.log("[preload] Received message event:", ev.data ? "has data" : "no data");
  const data = ev.data;
  if (!data) return;
  const channel = data.channel || "webview-frame";
  const msg = data.message ?? data;
  console.log("[preload] Forwarding to channel:", channel, "handlers:", handlers.has(channel) ? handlers.get(channel).size : 0);
  const h = handlers.get(channel);
  if (h) h.forEach((fn) => fn(null, msg));
});
console.log("[preload] Initialized");
