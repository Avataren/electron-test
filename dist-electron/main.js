import { BrowserWindow as u, protocol as T, BrowserView as A, ipcMain as r, app as g } from "electron";
import { fileURLToPath as I } from "node:url";
import l from "node:path";
import b from "node:fs/promises";
const f = {
  urls: [
    "https://www.testufo.com/",
    "https://cubed.no",
    "https://www.github.com",
    "https://www.wikipedia.org",
    "https://news.ycombinator.com"
  ],
  window: {
    width: 1920,
    height: 1080,
    controlBarHeight: 120
  },
  timing: {
    rotationInterval: 1e4,
    refreshInterval: 3e4,
    transitionDuration: 2500
  },
  rendering: {
    frameRate: 10,
    jpegQuality: 85
  }
};
class B {
  window = null;
  config;
  viteDevServerUrl;
  rendererDist;
  publicPath;
  devToolsWindows = /* @__PURE__ */ new Map();
  appProtocolRegistered = !1;
  constructor(e, t, s, i) {
    this.config = e, this.viteDevServerUrl = t, this.rendererDist = l.resolve(s), this.publicPath = i;
  }
  createWindow(e) {
    this.window = new u({
      width: this.config.window.width,
      height: this.config.window.height,
      icon: l.join(this.publicPath, "favicon.ico"),
      webPreferences: {
        preload: e,
        nodeIntegration: !1,
        contextIsolation: !0,
        sandbox: !0
      }
    }), this.window.webContents.on("did-finish-load", () => {
      this.sendToRenderer("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    });
    try {
      this.window.webContents.session.webRequest.onHeadersReceived({ urls: ["*://*/*", "file://*/*", "app://*/*"] }, (s, i) => {
        const n = this.window?.webContents.id;
        if (!n || s.webContentsId !== n) {
          i({ responseHeaders: s.responseHeaders });
          return;
        }
        const o = Object.assign({}, s.responseHeaders || {});
        o["Cross-Origin-Opener-Policy"] = ["same-origin"], o["Cross-Origin-Embedder-Policy"] = ["require-corp"], o["Cross-Origin-Resource-Policy"] = ["same-origin"], i({ responseHeaders: o });
      });
    } catch (t) {
      console.warn("[WindowManager] failed to enable COOP/COEP headers", t);
    }
    return this.viteDevServerUrl ? (this.window.webContents.on("before-input-event", (t, s) => {
      s.type === "keyDown" && s.key.toLowerCase() === "i" && (s.control || s.meta) && s.shift && (t.preventDefault(), this.openDetachedDevTools(this.window?.webContents));
    }), this.window.webContents.once("did-frame-finish-load", () => {
      this.openDetachedDevTools(this.window?.webContents);
    }), this.window.loadURL(this.viteDevServerUrl)) : this.ensureAppProtocol().then(() => {
      this.isValid() && this.window.loadURL("app://-/index.html");
    }).catch((t) => {
      console.warn("[WindowManager] Failed to register app protocol", t), this.isValid() && this.window.loadFile(l.join(this.rendererDist, "index.html"));
    }), this.window;
  }
  getWindow() {
    return this.window;
  }
  isValid() {
    return this.window !== null && !this.window.isDestroyed();
  }
  sendToRenderer(e, ...t) {
    this.isValid() && this.window.webContents.send(e, ...t);
  }
  /**
   * Send a message to the renderer using postMessage which supports
   * transfer lists (ArrayBuffers, MessagePorts). Use this when sending
   * large binary buffers like SharedArrayBuffer to avoid serialization errors.
   */
  postMessageToRenderer(e, t, s) {
    if (this.isValid()) {
      try {
        this.window.webContents.postMessage(e, t, s || []);
        return;
      } catch (i) {
        console.warn("[WindowManager] postMessage failed, falling back to send", i);
      }
      try {
        this.window.webContents.send(e, t);
      } catch (i) {
        console.error("[WindowManager] send fallback failed", i);
      }
    }
  }
  getContentBounds() {
    return this.isValid() ? this.window.getContentBounds() : null;
  }
  destroy() {
    this.window && !this.window.isDestroyed() && this.window.destroy(), this.window = null, this.devToolsWindows.forEach((e) => {
      e.isDestroyed() || e.close();
    }), this.devToolsWindows.clear();
  }
  openDetachedDevTools(e) {
    if (!e || e.isDestroyed()) return;
    if (e.isDevToolsOpened()) {
      const i = this.devToolsWindows.get(e.id);
      if (i && !i.isDestroyed()) {
        i.focus();
        return;
      }
    }
    let t = this.devToolsWindows.get(e.id) || null;
    (!t || t.isDestroyed()) && (t = new u({
      width: Math.max(960, Math.floor(this.config.window.width * 0.6)),
      height: Math.max(720, Math.floor(this.config.window.height * 0.6)),
      title: "DevTools",
      autoHideMenuBar: !0
    }), t.on("closed", () => {
      this.devToolsWindows.delete(e.id), !e.isDestroyed() && e.isDevToolsOpened() && e.closeDevTools();
    }), this.devToolsWindows.set(e.id, t));
    try {
      e.setDevToolsWebContents(t.webContents);
    } catch (i) {
      console.warn("[WindowManager] Failed to attach detached devtools window", i), t && !t.isDestroyed() && t.close(), this.devToolsWindows.delete(e.id), e.openDevTools({ mode: "undocked", activate: !0 });
      return;
    }
    const s = () => {
      e.removeListener("devtools-closed", s), e.removeListener("destroyed", s);
      const i = this.devToolsWindows.get(e.id);
      i && !i.isDestroyed() && i.close(), this.devToolsWindows.delete(e.id);
    };
    e.once("devtools-closed", s), e.once("destroyed", s), e.isDevToolsOpened() || e.openDevTools({ mode: "detach", activate: !0 }), t.show(), t.focus();
  }
  async ensureAppProtocol() {
    if (this.appProtocolRegistered) return;
    if (!T.registerBufferProtocol("app", (t, s) => {
      const i = (n, o, a) => {
        const c = this.createRendererHeaders(a);
        s({
          statusCode: n,
          headers: c,
          data: o,
          mimeType: a ? this.getMimeType(a) : void 0
        });
      };
      this.readRendererAsset(t.url).then(({ data: n, filePath: o }) => {
        i(200, n, o);
      }).catch((n) => {
        console.warn("[WindowManager] Failed to load asset for app protocol", n), i(404, Buffer.from("Not Found", "utf8"));
      });
    }))
      throw new Error("Failed to register app:// protocol handler");
    this.appProtocolRegistered = !0;
  }
  async readRendererAsset(e) {
    const t = new URL(e), s = [], i = t.hostname;
    i && i !== "-" && s.push(i);
    const n = decodeURIComponent(t.pathname || "");
    n && n !== "/" && s.push(n.replace(/^\/+/, ""));
    let o = s.join("/");
    o || (o = "index.html");
    let a = l.resolve(this.rendererDist, o);
    if (!a.startsWith(this.rendererDist + l.sep) && a !== this.rendererDist)
      throw new Error("Attempted to access file outside renderer dist");
    try {
      return { data: await b.readFile(a), filePath: a };
    } catch (c) {
      if (!l.extname(a))
        return a = l.resolve(this.rendererDist, "index.html"), { data: await b.readFile(a), filePath: a };
      throw c;
    }
  }
  createRendererHeaders(e) {
    const t = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin"
    };
    return e && (t["Content-Type"] = this.getMimeType(e)), t;
  }
  getMimeType(e) {
    switch (l.extname(e).toLowerCase()) {
      case ".html":
        return "text/html";
      case ".js":
      case ".mjs":
        return "text/javascript";
      case ".cjs":
        return "application/javascript";
      case ".css":
        return "text/css";
      case ".json":
        return "application/json";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      case ".ico":
        return "image/x-icon";
      case ".woff":
        return "font/woff";
      case ".woff2":
        return "font/woff2";
      case ".txt":
        return "text/plain";
      default:
        return "application/octet-stream";
    }
  }
}
class F {
  views = /* @__PURE__ */ new Map();
  config;
  mainWindow = null;
  isDev = !!process.env.VITE_DEV_SERVER_URL;
  devToolsListeners = [];
  devToolsInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  constructor(e) {
    this.config = e;
  }
  setMainWindow(e) {
    this.mainWindow = e, this.setupResizeHandler(), this.setupDevToolsHandlers();
  }
  setupResizeHandler() {
    this.mainWindow && this.mainWindow.on("resize", () => {
      this.updateBounds();
    });
  }
  setupDevToolsHandlers() {
    if (!this.mainWindow) return;
    const e = () => {
      this.updateBounds();
    }, t = this.mainWindow.webContents, s = () => {
      this.clearDevToolsListeners(), this.updateDevToolsInsets(), e();
      const i = t.devToolsWebContents;
      if (i) {
        const n = () => {
          this.updateDevToolsInsets(), this.updateBounds();
        }, o = (a, c) => {
          this.updateDevToolsInsets(), this.updateBounds();
        };
        i.on("destroyed", n), i.on("did-finish-load", n), i.on("did-stop-loading", n), i.on("dom-ready", n), i.on("preferred-size-changed", o), this.devToolsListeners.push(() => {
          i.removeListener("destroyed", n), i.removeListener("did-finish-load", n), i.removeListener("did-stop-loading", n), i.removeListener("dom-ready", n), i.removeListener("preferred-size-changed", o);
        });
      }
    };
    t.on("devtools-opened", s), t.on("devtools-focused", () => {
      this.updateDevToolsInsets(), e();
    }), t.on("devtools-closed", () => {
      this.clearDevToolsListeners(), this.resetDevToolsInsets(), e();
    });
  }
  createViews(e) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const t = this.mainWindow.getContentBounds();
    e.forEach((s, i) => {
      const n = new A({
        webPreferences: {
          nodeIntegration: !1,
          contextIsolation: !0
        }
      });
      n.setBackgroundColor("#000000"), i === 0 && this.mainWindow && this.isDev && n.webContents.once("did-finish-load", () => {
        n.webContents.openDevTools({ mode: "detach", activate: !0 });
      }), this.setBounds(n, t), n.setAutoResize({ width: !0, height: !0 }), n.webContents.loadURL(s), this.views.set(i, n), i === 0 && this.mainWindow && this.mainWindow.addBrowserView(n), this.setupViewEventHandlers(n, i, s);
    });
  }
  setBounds(e, t) {
    const s = this.calculateViewBounds(t);
    e.setBounds(s);
  }
  calculateViewBounds(e) {
    const t = Math.max(
      0,
      e.width - this.devToolsInsets.left - this.devToolsInsets.right
    ), s = Math.max(
      0,
      e.height - this.devToolsInsets.top - this.devToolsInsets.bottom - this.config.window.controlBarHeight
    );
    return {
      x: this.devToolsInsets.left,
      y: this.devToolsInsets.top,
      width: t,
      height: s
    };
  }
  setupViewEventHandlers(e, t, s) {
    e.webContents.on("did-finish-load", () => {
      console.log(`Setup view ${t} loaded: ${s}`);
    }), e.webContents.on("did-fail-load", (i, n, o) => {
      console.error(`Setup view ${t} failed to load: ${o}`);
    });
  }
  updateBounds() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.updateDevToolsInsets();
    const e = this.mainWindow.getContentBounds();
    this.views.forEach((t) => {
      this.setBounds(t, e);
    });
  }
  showView(e) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.views.forEach((s) => {
      this.mainWindow.removeBrowserView(s);
    });
    const t = this.views.get(e);
    t && (this.mainWindow.addBrowserView(t), this.updateBounds(), this.isDev && (t.webContents.isDevToolsOpened() ? t.webContents.devToolsWebContents?.focus?.() : t.webContents.openDevTools({ mode: "detach", activate: !0 })));
  }
  cleanup() {
    this.clearDevToolsListeners(), this.views.forEach((e) => {
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.removeBrowserView(e), e.webContents.destroy();
    }), this.views.clear();
  }
  getViews() {
    return this.views;
  }
  clearDevToolsListeners() {
    this.devToolsListeners.forEach((e) => e()), this.devToolsListeners.length = 0, this.resetDevToolsInsets();
  }
  resetDevToolsInsets() {
    this.devToolsInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  }
  updateDevToolsInsets() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.resetDevToolsInsets();
      return;
    }
    const e = this.mainWindow.webContents;
    if (!e.isDevToolsOpened?.()) {
      this.resetDevToolsInsets();
      return;
    }
    const t = e.devToolsWebContents;
    if (!t) {
      this.resetDevToolsInsets();
      return;
    }
    const s = t?.getOwnerBrowserWindow?.() ?? null;
    if (!s) {
      this.resetDevToolsInsets();
      return;
    }
    const i = this.mainWindow.getBounds(), n = s.getBounds(), o = 2, a = Math.abs(n.width - i.width) <= o, c = Math.abs(n.height - i.height) <= o, h = { top: 0, right: 0, bottom: 0, left: 0 };
    if (a && n.height < i.height) {
      const d = Math.abs(n.y - i.y);
      Math.abs(
        i.y + i.height - (n.y + n.height)
      ) <= d ? h.bottom = n.height : h.top = n.height;
    } else if (c && n.width < i.width) {
      const d = Math.abs(n.x - i.x);
      Math.abs(
        i.x + i.width - (n.x + n.width)
      ) <= d ? h.right = n.width : h.left = n.width;
    } else {
      const d = t.getPreferredSize?.();
      d && (d.height && d.height < i.height ? h.bottom = d.height : d.width && d.width < i.width && (h.right = d.width));
    }
    this.devToolsInsets = {
      top: Math.max(0, h.top),
      right: Math.max(0, h.right),
      bottom: Math.max(0, h.bottom),
      left: Math.max(0, h.left)
    };
  }
}
class P {
  windows = /* @__PURE__ */ new Map();
  config;
  windowManager;
  paintingEnabled = /* @__PURE__ */ new Set();
  // Reuse SharedArrayBuffers per window to avoid reallocating on every frame
  sharedBuffers = /* @__PURE__ */ new Map();
  // Track whether the renderer has acknowledged the first applied frame
  acknowledgedFirstFrame = /* @__PURE__ */ new Map();
  // Track whether we're waiting for the initial ack for an index
  waitingForAck = /* @__PURE__ */ new Map();
  // Track last send timestamp per index (ms)
  lastSentAt = /* @__PURE__ */ new Map();
  // Pending frame per index (coalesce rapid paint events)
  pendingFrames = /* @__PURE__ */ new Map();
  // Per-index send timers to schedule next allowed send
  sendTimers = /* @__PURE__ */ new Map();
  // Initial ACK timeouts per index
  initialAckTimeouts = /* @__PURE__ */ new Map();
  // How long to wait for an initial-frame ACK before sending a fallback (ms)
  initialAckTimeoutMs = 4e3;
  constructor(e, t) {
    this.config = e, this.windowManager = t;
  }
  // Called by IPC handler when renderer confirms it applied the initial frame
  handleInitialAck(e) {
    this.acknowledgedFirstFrame.set(e, !0), this.waitingForAck.delete(e), console.info(`[OffscreenRenderer] received initial-frame ACK for ${e}`);
    const t = this.initialAckTimeouts.get(e);
    t && (clearTimeout(t), this.initialAckTimeouts.delete(e)), this.pendingFrames.has(e) && this.scheduleFrameSend(e, !0);
  }
  createOffscreenWindows(e) {
    e.forEach((t, s) => {
      const i = new u({
        width: this.config.window.width,
        height: this.config.window.height,
        show: !1,
        webPreferences: {
          offscreen: !0,
          nodeIntegration: !1,
          contextIsolation: !0
        }
      });
      i.loadURL(t), this.windows.set(s, i), this.setupPaintHandler(i, s), this.setupLoadHandlers(i, s, t), s === 0 && this.enablePainting(s);
    });
  }
  setupPaintHandler(e, t) {
    e.webContents.on("paint", (s, i, n) => {
      if (!this.paintingEnabled.has(t)) return;
      const o = n.toBitmap(), a = n.getSize();
      try {
        this.pendingFrames.set(t, { buffer: Buffer.from(o), size: a }), this.scheduleFrameSend(t, !0);
      } catch (c) {
        console.error("[OffscreenRenderer] Failed to forward paint frame", { index: t, err: c });
      }
    });
  }
  ensureSharedBuffer(e, t) {
    const s = this.sharedBuffers.get(e);
    if (s && s.byteLength === t)
      return s;
    const i = new SharedArrayBuffer(t);
    return this.sharedBuffers.set(e, i), i;
  }
  writeFrameToSharedBuffer(e, t) {
    const s = Math.max(1, t.size.width) * Math.max(1, t.size.height) * 4, i = this.ensureSharedBuffer(e, s), n = new Uint8Array(i), o = t.buffer.subarray(0, Math.min(t.buffer.length, n.length));
    return n.set(o), o.length < n.length && n.fill(0, o.length), i;
  }
  sendFrame(e, t, s) {
    if (typeof SharedArrayBuffer == "function")
      try {
        const n = this.writeFrameToSharedBuffer(e, t);
        return this.windowManager.postMessageToRenderer("webview-frame", {
          index: e,
          buffer: n,
          size: t.size,
          format: "sabs",
          byteLength: n.byteLength,
          timestamp: Date.now()
        }), s || this.pendingFrames.delete(e), !0;
      } catch (n) {
        console.warn("[OffscreenRenderer] failed to send SharedArrayBuffer frame, falling back", {
          index: e,
          err: n
        });
      }
    try {
      const n = t.buffer.buffer.slice(
        t.buffer.byteOffset,
        t.buffer.byteOffset + t.buffer.byteLength
      );
      return this.windowManager.postMessageToRenderer(
        "webview-frame",
        { index: e, buffer: n, size: t.size, format: "raw" },
        [n]
      ), s || this.pendingFrames.delete(e), !0;
    } catch (n) {
      console.error("[OffscreenRenderer] failed to send frame payload", { index: e, err: n });
    }
    return !1;
  }
  scheduleFrameSend(e, t) {
    if (!this.pendingFrames.get(e)) return;
    const i = this.sendTimers.get(e);
    if (i && (clearTimeout(i), this.sendTimers.delete(e)), t) {
      this.dispatchFrame(e);
      return;
    }
    const n = this.config.rendering.frameRate || 30, o = Math.max(0, Math.floor(1e3 / n)), a = setTimeout(() => {
      this.sendTimers.delete(e), this.dispatchFrame(e);
    }, o);
    this.sendTimers.set(e, a);
  }
  dispatchFrame(e) {
    const t = this.pendingFrames.get(e);
    if (!t) return;
    const s = !!this.acknowledgedFirstFrame.get(e), i = !!this.waitingForAck.get(e);
    if (!s) {
      if (i)
        return;
      this.sendFrame(e, t, !0) && (this.waitingForAck.set(e, !0), this.lastSentAt.set(e, Date.now()), console.info(`[OffscreenRenderer] sent initial frame for ${e}, awaiting ACK`), this.startInitialAckTimeout(e));
      return;
    }
    const n = this.config.rendering.frameRate || 30, o = Math.max(0, Math.floor(1e3 / n)), a = this.lastSentAt.get(e) || 0, c = Date.now(), h = c - a;
    if (h < o) {
      const d = o - h, v = setTimeout(() => {
        this.sendTimers.delete(e), this.dispatchFrame(e);
      }, d);
      this.sendTimers.set(e, v);
      return;
    }
    this.sendFrame(e, t, !1) && this.lastSentAt.set(e, c);
  }
  startInitialAckTimeout(e) {
    try {
      const t = this.initialAckTimeouts.get(e);
      t && clearTimeout(t);
      const s = setTimeout(() => {
        if (this.waitingForAck.get(e)) {
          console.warn(
            `[OffscreenRenderer] initial-frame ACK timeout for ${e}, sending fallback frame`
          ), this.waitingForAck.delete(e), this.acknowledgedFirstFrame.set(e, !0);
          try {
            const n = { buffer: Buffer.from([255, 255, 255, 255]), size: { width: 1, height: 1 } };
            this.sendFrame(e, n, !0), this.windowManager.sendToRenderer("webview-load-timeout", { index: e });
          } catch (i) {
            console.error("[OffscreenRenderer] failed to send fallback frame after timeout", i);
          }
          this.pendingFrames.has(e) && this.scheduleFrameSend(e, !0);
        }
        this.initialAckTimeouts.delete(e);
      }, this.initialAckTimeoutMs);
      this.initialAckTimeouts.set(e, s);
    } catch (t) {
      console.warn("[OffscreenRenderer] failed to schedule initial ACK timeout", t);
    }
  }
  setupLoadHandlers(e, t, s) {
    e.webContents.on("did-finish-load", () => {
      console.log(`Offscreen window ${t} loaded: ${s}`), this.windowManager.sendToRenderer("webview-loaded", { index: t, url: s });
    }), e.webContents.on("did-fail-load", (i, n, o) => {
      console.error(`Offscreen window ${t} failed to load: ${o}`);
    });
  }
  enablePainting(e) {
    const t = this.windows.get(e);
    if (t && !t.isDestroyed() && !this.paintingEnabled.has(e)) {
      this.paintingEnabled.add(e);
      try {
        t.webContents.setFrameRate(this.config.rendering.frameRate);
      } catch (s) {
        console.warn("[OffscreenRenderer] setFrameRate failed on enable", { index: e, err: s });
      }
      setTimeout(() => {
        console.log(`Enabled painting for window ${e}`);
      }, 60);
    }
  }
  disablePainting(e) {
    const t = this.windows.get(e);
    t && !t.isDestroyed() && this.paintingEnabled.has(e) && (this.paintingEnabled.delete(e), t.webContents.setFrameRate(0), console.log(`Disabled painting for window ${e}`));
  }
  setActivePaintingWindows(e) {
    this.windows.forEach((t, s) => {
      e.includes(s) || this.disablePainting(s);
    }), e.forEach((t) => {
      this.enablePainting(t);
    });
  }
  reload(e) {
    const t = this.windows.get(e);
    t && !t.isDestroyed() && t.webContents.reload();
  }
  /**
   * Resize a specific offscreen window. Width/height should be in device
   * pixels (DIP). This triggers a repaint at the new size which will be
   * emitted via the 'paint' event.
   */
  resize(e, t, s) {
    const i = this.windows.get(e);
    i && !i.isDestroyed() && (console.info(`[OffscreenRenderer] resize window ${e} -> ${t}x${s}`), i.setSize(t, s));
  }
  /** Resize all offscreen windows to the provided dimensions. */
  resizeAll(e, t) {
    this.windows.forEach((s) => {
      s.isDestroyed() || (console.info(`[OffscreenRenderer] resizeAll -> ${e}x${t}`), s.setSize(e, t));
    });
  }
  /** Resize only the provided indices. */
  resizeIndices(e, t, s) {
    e.forEach((i) => {
      const n = this.windows.get(i);
      n && !n.isDestroyed() && (console.info(`[OffscreenRenderer] resizeIndices - window ${i} -> ${t}x${s}`), n.setSize(t, s));
    });
  }
  navigate(e, t) {
    const s = this.windows.get(e);
    s && !s.isDestroyed() && s.loadURL(t);
  }
  cleanup() {
    this.windows.forEach((e) => {
      e.isDestroyed() || e.destroy();
    }), this.windows.clear(), this.paintingEnabled.clear(), this.sharedBuffers.clear(), this.pendingFrames.clear(), this.acknowledgedFirstFrame.clear(), this.waitingForAck.clear(), this.lastSentAt.clear(), this.sendTimers.forEach((e) => clearTimeout(e)), this.sendTimers.clear(), this.initialAckTimeouts.forEach((e) => clearTimeout(e)), this.initialAckTimeouts.clear();
  }
  getWindows() {
    return this.windows;
  }
}
class E {
  config;
  viewManager;
  offscreenRenderer;
  windowManager;
  onSetupComplete;
  constructor(e, t, s, i, n) {
    this.config = e, this.viewManager = t, this.offscreenRenderer = s, this.windowManager = i, this.onSetupComplete = n;
  }
  register() {
    r.handle("get-webview-urls", () => this.config.urls), r.handle("show-setup-view", (e, t) => {
      this.viewManager.showView(t);
    }), r.handle("finish-setup", () => {
      this.viewManager.cleanup(), this.offscreenRenderer.createOffscreenWindows(this.config.urls), this.windowManager.sendToRenderer("setup-complete"), this.onSetupComplete();
    }), r.handle("reload-webview", (e, t) => {
      this.offscreenRenderer.reload(t);
    }), r.handle("navigate-webview", (e, t, s) => {
      this.offscreenRenderer.navigate(t, s);
    }), r.handle("set-active-painting-windows", (e, t) => {
      this.offscreenRenderer.setActivePaintingWindows(t);
    }), r.handle("resize-offscreen-windows", (e, t, s) => {
      this.offscreenRenderer.resizeAll(t, s);
    }), r.handle("resize-active-offscreen-windows", (e, t, s, i) => {
      this.offscreenRenderer.resizeIndices(t, s, i);
    }), r.handle("enable-painting", (e, t) => {
      this.offscreenRenderer.enablePainting(t);
    }), r.handle("disable-painting", (e, t) => {
      this.offscreenRenderer.disablePainting(t);
    }), r.on("initial-frame-ack", (e, t) => {
      try {
        const s = t?.index;
        typeof s == "number" && this.offscreenRenderer.handleInitialAck(s);
      } catch (s) {
        console.warn("[IPC] failed handling initial-frame-ack", s);
      }
    }), r.on("texture-applied", (e, t) => {
    }), r.on("frame-stats", (e, t) => {
    }), r.on("plane-state", (e, t) => {
    }), r.on("renderer-error", (e, t) => {
      try {
        console.error("[IPC] renderer-error", t);
      } catch (s) {
        console.warn("[IPC] failed to log renderer-error", s);
      }
    });
  }
  unregister() {
    r.removeHandler("get-webview-urls"), r.removeHandler("show-setup-view"), r.removeHandler("finish-setup"), r.removeHandler("reload-webview"), r.removeHandler("navigate-webview"), r.removeHandler("set-active-painting-windows"), r.removeHandler("enable-painting"), r.removeHandler("disable-painting"), r.removeAllListeners("initial-frame-ack"), r.removeAllListeners("texture-applied"), r.removeAllListeners("frame-stats"), r.removeAllListeners("plane-state"), r.removeAllListeners("render-stats"), r.removeAllListeners("renderer-error");
  }
}
const D = l.dirname(I(import.meta.url));
process.env.APP_ROOT = l.join(D, "..");
T.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: !0,
      secure: !0,
      supportFetchAPI: !0,
      corsEnabled: !0,
      stream: !0
    }
  }
]);
const y = process.env.VITE_DEV_SERVER_URL, z = l.join(process.env.APP_ROOT, "dist-electron"), R = l.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = y ? l.join(process.env.APP_ROOT, "public") : R;
const m = new B(
  f,
  y,
  R,
  process.env.VITE_PUBLIC || ""
), p = new F(f), C = new P(f, m), M = new E(
  f,
  p,
  C,
  m,
  () => {
  }
);
function W() {
  const w = l.join(D, "preload.js"), e = m.createWindow(w);
  p.setMainWindow(e), p.createViews(f.urls), M.register();
}
g.on("window-all-closed", () => {
  process.platform !== "darwin" && (C.cleanup(), p.cleanup(), M.unregister(), m.destroy(), g.quit());
});
g.on("activate", () => {
  u.getAllWindows().length === 0 && W();
});
g.whenReady().then(W);
export {
  z as MAIN_DIST,
  R as RENDERER_DIST,
  y as VITE_DEV_SERVER_URL
};
