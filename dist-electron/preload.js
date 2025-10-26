const { contextBridge, ipcRenderer } = require("electron");
const handlers = /* @__PURE__ */ new Map();
const forwardRendererError = (payload) => {
  try {
    ipcRenderer.send("renderer-error", payload);
  } catch (err) {
    console.debug("[preload] Failed to forward renderer error", err);
  }
};
const serializeArg = (arg) => {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack
    };
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch (_err) {
      return String(arg);
    }
  }
  return String(arg);
};
const exposedIpcRenderer = {
  on(channel, listener) {
    console.log("[preload] Registering handler for:", channel);
    if (!handlers.has(channel)) handlers.set(channel, /* @__PURE__ */ new Set());
    handlers.get(channel).add(listener);
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(channel, listener) {
    if (listener) {
      handlers.get(channel)?.delete(listener);
      return ipcRenderer.off(channel, listener);
    }
    handlers.get(channel)?.clear();
    ipcRenderer.removeAllListeners(channel);
    return ipcRenderer;
  },
  send(channel, ...args) {
    ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
  }
};
contextBridge.exposeInMainWorld("ipcRenderer", exposedIpcRenderer);
window.addEventListener("error", (event) => {
  forwardRendererError({
    type: "error",
    message: event.message,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack ?? null
  });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const stack = typeof reason === "object" && reason !== null ? reason.stack ?? null : null;
  forwardRendererError({
    type: "unhandledrejection",
    message: typeof reason === "object" && reason?.message || (typeof reason === "string" ? reason : void 0) || "Unhandled promise rejection",
    stack
  });
});
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  forwardRendererError({
    type: "console-error",
    arguments: args.map(serializeArg)
  });
  originalConsoleError(...args);
};
window.addEventListener("message", (ev) => {
  console.log("[preload] Received message event:", ev.data ? "has data" : "no data");
  const data = ev.data;
  if (!data) return;
  const channel = data.channel || "webview-frame";
  const msg = data.message ?? data;
  console.log(
    "[preload] Forwarding to channel:",
    channel,
    "handlers:",
    handlers.has(channel) ? handlers.get(channel).size : 0
  );
  const registered = handlers.get(channel);
  if (registered) {
    registered.forEach((fn) => fn({}, msg));
  }
});
console.log("[preload] Initialized");
