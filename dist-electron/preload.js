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
    if (!handlers.has(channel)) handlers.set(channel, /* @__PURE__ */ new Map());
    const channelHandlers = handlers.get(channel);
    const existingWrapper = channelHandlers.get(listener);
    if (existingWrapper) {
      ipcRenderer.off(channel, existingWrapper);
    }
    const wrapper = (event, ...args) => listener(event, ...args);
    channelHandlers.set(listener, wrapper);
    return ipcRenderer.on(channel, wrapper);
  },
  off(channel, listener) {
    if (listener) {
      const channelHandlers2 = handlers.get(channel);
      const wrapper = channelHandlers2?.get(listener);
      if (channelHandlers2) {
        channelHandlers2.delete(listener);
        if (channelHandlers2.size === 0) handlers.delete(channel);
      }
      if (wrapper) {
        return ipcRenderer.off(channel, wrapper);
      }
      return ipcRenderer;
    }
    const channelHandlers = handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.clear();
      handlers.delete(channel);
    }
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
    registered.forEach((_wrapper, originalListener) => originalListener({}, msg));
  }
});
console.log("[preload] Initialized");
