import { BrowserWindow, BrowserView, ipcMain, app } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
const defaultConfig = {
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
class WindowManager {
  window = null;
  config;
  viteDevServerUrl;
  rendererDist;
  publicPath;
  devToolsWindows = /* @__PURE__ */ new Map();
  constructor(config, viteDevServerUrl, rendererDist, publicPath) {
    this.config = config;
    this.viteDevServerUrl = viteDevServerUrl;
    this.rendererDist = rendererDist;
    this.publicPath = publicPath;
  }
  createWindow(preloadPath) {
    this.window = new BrowserWindow({
      width: this.config.window.width,
      height: this.config.window.height,
      icon: path.join(this.publicPath, "favicon.ico"),
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    this.window.webContents.on("did-finish-load", () => {
      this.sendToRenderer("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    });
    try {
      const ses = this.window.webContents.session;
      ses.webRequest.onHeadersReceived({ urls: ["*://*/*"] }, (details, callback) => {
        const responseHeaders = Object.assign({}, details.responseHeaders || {});
        responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
        responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
        callback({ responseHeaders });
      });
    } catch (err) {
      console.warn("[WindowManager] failed to enable COOP/COEP headers", err);
    }
    if (this.viteDevServerUrl) {
      this.window.webContents.on("before-input-event", (event, input) => {
        const isToggle = input.type === "keyDown" && input.key.toLowerCase() === "i" && (input.control || input.meta) && input.shift;
        if (isToggle) {
          event.preventDefault();
          this.openDetachedDevTools(this.window?.webContents);
        }
      });
      this.window.webContents.once("did-frame-finish-load", () => {
        this.openDetachedDevTools(this.window?.webContents);
      });
      this.window.loadURL(this.viteDevServerUrl);
    } else {
      this.window.loadFile(path.join(this.rendererDist, "index.html"));
    }
    return this.window;
  }
  getWindow() {
    return this.window;
  }
  isValid() {
    return this.window !== null && !this.window.isDestroyed();
  }
  sendToRenderer(channel, ...args) {
    if (this.isValid()) {
      this.window.webContents.send(channel, ...args);
    }
  }
  /**
   * Send a message to the renderer using postMessage which supports
   * transfer lists (ArrayBuffers, MessagePorts). Use this when sending
   * large binary buffers like SharedArrayBuffer to avoid serialization errors.
   */
  postMessageToRenderer(channel, message, transfer) {
    if (this.isValid()) {
      try {
        this.window.webContents.postMessage(channel, message, transfer || []);
      } catch (err) {
        this.window.webContents.send(channel, message);
      }
    }
  }
  getContentBounds() {
    if (this.isValid()) {
      return this.window.getContentBounds();
    }
    return null;
  }
  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.devToolsWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.close();
      }
    });
    this.devToolsWindows.clear();
  }
  openDetachedDevTools(target) {
    if (!target || target.isDestroyed()) return;
    if (target.isDevToolsOpened()) {
      const existing = this.devToolsWindows.get(target.id);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return;
      }
    }
    let devToolsWindow = this.devToolsWindows.get(target.id) || null;
    if (!devToolsWindow || devToolsWindow.isDestroyed()) {
      devToolsWindow = new BrowserWindow({
        width: Math.max(960, Math.floor(this.config.window.width * 0.6)),
        height: Math.max(720, Math.floor(this.config.window.height * 0.6)),
        title: "DevTools",
        autoHideMenuBar: true
      });
      devToolsWindow.on("closed", () => {
        this.devToolsWindows.delete(target.id);
        if (!target.isDestroyed() && target.isDevToolsOpened()) {
          target.closeDevTools();
        }
      });
      this.devToolsWindows.set(target.id, devToolsWindow);
    }
    try {
      target.setDevToolsWebContents(devToolsWindow.webContents);
    } catch (err) {
      console.warn("[WindowManager] Failed to attach detached devtools window", err);
      if (devToolsWindow && !devToolsWindow.isDestroyed()) {
        devToolsWindow.close();
      }
      this.devToolsWindows.delete(target.id);
      target.openDevTools({ mode: "undocked", activate: true });
      return;
    }
    const cleanup = () => {
      target.removeListener("devtools-closed", cleanup);
      target.removeListener("destroyed", cleanup);
      const win = this.devToolsWindows.get(target.id);
      if (win && !win.isDestroyed()) {
        win.close();
      }
      this.devToolsWindows.delete(target.id);
    };
    target.once("devtools-closed", cleanup);
    target.once("destroyed", cleanup);
    if (!target.isDevToolsOpened()) {
      target.openDevTools({ mode: "detach", activate: true });
    }
    devToolsWindow.show();
    devToolsWindow.focus();
  }
}
class ViewManager {
  views = /* @__PURE__ */ new Map();
  config;
  mainWindow = null;
  isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  devToolsListeners = [];
  devToolsInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  constructor(config) {
    this.config = config;
  }
  setMainWindow(window) {
    this.mainWindow = window;
    this.setupResizeHandler();
    this.setupDevToolsHandlers();
  }
  setupResizeHandler() {
    if (!this.mainWindow) return;
    this.mainWindow.on("resize", () => {
      this.updateBounds();
    });
  }
  setupDevToolsHandlers() {
    if (!this.mainWindow) return;
    const update = () => {
      this.updateBounds();
    };
    const webContents = this.mainWindow.webContents;
    const handleOpened = () => {
      this.clearDevToolsListeners();
      this.updateDevToolsInsets();
      update();
      const devToolsContents = webContents.devToolsWebContents;
      if (devToolsContents) {
        const handleDevToolsResize = () => {
          this.updateDevToolsInsets();
          this.updateBounds();
        };
        const handlePreferredSizeChanged = (_event, _size) => {
          this.updateDevToolsInsets();
          this.updateBounds();
        };
        devToolsContents.on("destroyed", handleDevToolsResize);
        devToolsContents.on("did-finish-load", handleDevToolsResize);
        devToolsContents.on("did-stop-loading", handleDevToolsResize);
        devToolsContents.on("dom-ready", handleDevToolsResize);
        devToolsContents.on("preferred-size-changed", handlePreferredSizeChanged);
        this.devToolsListeners.push(() => {
          devToolsContents.removeListener("destroyed", handleDevToolsResize);
          devToolsContents.removeListener("did-finish-load", handleDevToolsResize);
          devToolsContents.removeListener("did-stop-loading", handleDevToolsResize);
          devToolsContents.removeListener("dom-ready", handleDevToolsResize);
          devToolsContents.removeListener("preferred-size-changed", handlePreferredSizeChanged);
        });
      }
    };
    webContents.on("devtools-opened", handleOpened);
    webContents.on("devtools-focused", () => {
      this.updateDevToolsInsets();
      update();
    });
    webContents.on("devtools-closed", () => {
      this.clearDevToolsListeners();
      this.resetDevToolsInsets();
      update();
    });
  }
  createViews(urls) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const bounds = this.mainWindow.getContentBounds();
    urls.forEach((url, index) => {
      const view = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      view.setBackgroundColor("#000000");
      if (index === 0 && this.mainWindow && this.isDev) {
        view.webContents.once("did-finish-load", () => {
          view.webContents.openDevTools({ mode: "detach", activate: true });
        });
      }
      this.setBounds(view, bounds);
      view.setAutoResize({ width: true, height: true });
      view.webContents.loadURL(url);
      this.views.set(index, view);
      if (index === 0 && this.mainWindow) {
        this.mainWindow.addBrowserView(view);
      }
      this.setupViewEventHandlers(view, index, url);
    });
  }
  setBounds(view, windowBounds) {
    const bounds = this.calculateViewBounds(windowBounds);
    view.setBounds(bounds);
  }
  calculateViewBounds(windowBounds) {
    const availableWidth = Math.max(
      0,
      windowBounds.width - this.devToolsInsets.left - this.devToolsInsets.right
    );
    const availableHeight = Math.max(
      0,
      windowBounds.height - this.devToolsInsets.top - this.devToolsInsets.bottom - this.config.window.controlBarHeight
    );
    return {
      x: this.devToolsInsets.left,
      y: this.devToolsInsets.top,
      width: availableWidth,
      height: availableHeight
    };
  }
  setupViewEventHandlers(view, index, url) {
    view.webContents.on("did-finish-load", () => {
      console.log(`Setup view ${index} loaded: ${url}`);
    });
    view.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error(`Setup view ${index} failed to load: ${errorDescription}`);
    });
  }
  updateBounds() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.updateDevToolsInsets();
    const bounds = this.mainWindow.getContentBounds();
    this.views.forEach((view) => {
      this.setBounds(view, bounds);
    });
  }
  showView(index) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.views.forEach((view2) => {
      this.mainWindow.removeBrowserView(view2);
    });
    const view = this.views.get(index);
    if (view) {
      this.mainWindow.addBrowserView(view);
      this.updateBounds();
      if (this.isDev) {
        if (view.webContents.isDevToolsOpened()) {
          view.webContents.devToolsWebContents?.focus?.();
        } else {
          view.webContents.openDevTools({ mode: "detach", activate: true });
        }
      }
    }
  }
  cleanup() {
    this.clearDevToolsListeners();
    this.views.forEach((view) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.removeBrowserView(view);
      }
      view.webContents.destroy();
    });
    this.views.clear();
  }
  getViews() {
    return this.views;
  }
  clearDevToolsListeners() {
    this.devToolsListeners.forEach((remove) => remove());
    this.devToolsListeners.length = 0;
    this.resetDevToolsInsets();
  }
  resetDevToolsInsets() {
    this.devToolsInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  }
  updateDevToolsInsets() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.resetDevToolsInsets();
      return;
    }
    const webContents = this.mainWindow.webContents;
    if (!webContents.isDevToolsOpened?.()) {
      this.resetDevToolsInsets();
      return;
    }
    const devToolsContents = webContents.devToolsWebContents;
    if (!devToolsContents) {
      this.resetDevToolsInsets();
      return;
    }
    const ownerWindow = devToolsContents?.getOwnerBrowserWindow?.() ?? null;
    if (!ownerWindow) {
      this.resetDevToolsInsets();
      return;
    }
    const windowBounds = this.mainWindow.getBounds();
    const devToolsBounds = ownerWindow.getBounds();
    const tolerance = 2;
    const matchesWidth = Math.abs(devToolsBounds.width - windowBounds.width) <= tolerance;
    const matchesHeight = Math.abs(devToolsBounds.height - windowBounds.height) <= tolerance;
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };
    if (matchesWidth && devToolsBounds.height < windowBounds.height) {
      const distanceTop = Math.abs(devToolsBounds.y - windowBounds.y);
      const distanceBottom = Math.abs(
        windowBounds.y + windowBounds.height - (devToolsBounds.y + devToolsBounds.height)
      );
      if (distanceBottom <= distanceTop) {
        insets.bottom = devToolsBounds.height;
      } else {
        insets.top = devToolsBounds.height;
      }
    } else if (matchesHeight && devToolsBounds.width < windowBounds.width) {
      const distanceLeft = Math.abs(devToolsBounds.x - windowBounds.x);
      const distanceRight = Math.abs(
        windowBounds.x + windowBounds.width - (devToolsBounds.x + devToolsBounds.width)
      );
      if (distanceRight <= distanceLeft) {
        insets.right = devToolsBounds.width;
      } else {
        insets.left = devToolsBounds.width;
      }
    } else {
      const preferredSize = devToolsContents.getPreferredSize?.();
      if (preferredSize) {
        if (preferredSize.height && preferredSize.height < windowBounds.height) {
          insets.bottom = preferredSize.height;
        } else if (preferredSize.width && preferredSize.width < windowBounds.width) {
          insets.right = preferredSize.width;
        }
      }
    }
    this.devToolsInsets = {
      top: Math.max(0, insets.top),
      right: Math.max(0, insets.right),
      bottom: Math.max(0, insets.bottom),
      left: Math.max(0, insets.left)
    };
  }
}
class OffscreenRenderer {
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
  constructor(config, windowManager2) {
    this.config = config;
    this.windowManager = windowManager2;
  }
  // Called by IPC handler when renderer confirms it applied the initial frame
  handleInitialAck(index) {
    this.acknowledgedFirstFrame.set(index, true);
    this.waitingForAck.delete(index);
    console.info(`[OffscreenRenderer] received initial-frame ACK for ${index}`);
    const t = this.initialAckTimeouts.get(index);
    if (t) {
      clearTimeout(t);
      this.initialAckTimeouts.delete(index);
    }
  }
  createOffscreenWindows(urls) {
    urls.forEach((url, index) => {
      const offscreenWin = new BrowserWindow({
        width: this.config.window.width,
        height: this.config.window.height,
        show: false,
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      offscreenWin.loadURL(url);
      this.windows.set(index, offscreenWin);
      this.setupPaintHandler(offscreenWin, index);
      this.setupLoadHandlers(offscreenWin, index, url);
      if (index === 0) {
        this.enablePainting(index);
      }
    });
  }
  setupPaintHandler(window, index) {
    window.webContents.on("paint", (event, dirty, image) => {
      if (!this.paintingEnabled.has(index)) return;
      const bitmap = image.toBitmap();
      const size = image.getSize();
      try {
        const buf = Buffer.from(bitmap);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        this.pendingFrames.set(index, { buffer: ab, size });
        const existingTimer = this.sendTimers.get(index);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        const attemptSend = () => {
          const pending = this.pendingFrames.get(index);
          if (!pending) return;
          const hasAck = !!this.acknowledgedFirstFrame.get(index);
          const waiting = !!this.waitingForAck.get(index);
          if (!hasAck) {
            if (waiting) {
              return;
            }
            try {
              this.waitingForAck.set(index, true);
              this.windowManager.postMessageToRenderer("webview-frame", { index, buffer: pending.buffer, size: pending.size, format: "raw" }, [pending.buffer]);
              this.lastSentAt.set(index, Date.now());
              console.info(`[OffscreenRenderer] sent initial frame (ArrayBuffer) for ${index}, awaiting ACK`);
              try {
                const t = setTimeout(() => {
                  if (this.waitingForAck.get(index)) {
                    console.warn(`[OffscreenRenderer] initial-frame ACK timeout for ${index}, sending fallback frame`);
                    this.waitingForAck.delete(index);
                    this.acknowledgedFirstFrame.set(index, true);
                    try {
                      const fallback = new Uint8ClampedArray([255, 255, 255, 255]);
                      const fallbackAb = fallback.buffer.slice(0);
                      this.windowManager.postMessageToRenderer("webview-frame", { index, buffer: fallbackAb, size: { width: 1, height: 1 }, format: "raw" }, [fallbackAb]);
                      this.windowManager.sendToRenderer("webview-load-timeout", { index });
                    } catch (err) {
                      console.error("[OffscreenRenderer] failed to send fallback frame after timeout", err);
                    }
                  }
                  this.initialAckTimeouts.delete(index);
                }, this.initialAckTimeoutMs);
                this.initialAckTimeouts.set(index, t);
              } catch (err) {
                console.warn("[OffscreenRenderer] failed to schedule initial ACK timeout", err);
              }
            } catch (err) {
              console.warn("[OffscreenRenderer] failed to post initial ArrayBuffer frame, falling back to send", err);
              try {
                this.windowManager.sendToRenderer("webview-frame", { index, buffer: Buffer.from(pending.buffer), size: pending.size, format: "raw" });
              } catch (e) {
                console.error("[OffscreenRenderer] fallback send also failed", e);
              }
            }
            return;
          }
          const frameRate = this.config.rendering.frameRate || 30;
          const minInterval = Math.max(0, Math.floor(1e3 / frameRate));
          const last = this.lastSentAt.get(index) || 0;
          const now = Date.now();
          const elapsed = now - last;
          if (elapsed < minInterval) {
            const delay = minInterval - elapsed;
            const t = setTimeout(attemptSend, delay);
            this.sendTimers.set(index, t);
            return;
          }
          try {
            const nextAb = pending.buffer.slice(0);
            this.windowManager.postMessageToRenderer("webview-frame", { index, buffer: nextAb, size: pending.size, format: "raw" }, [nextAb]);
            this.lastSentAt.set(index, now);
            this.pendingFrames.delete(index);
          } catch (err) {
            console.warn("[OffscreenRenderer] failed to post ArrayBuffer frame, falling back to send", err);
            try {
              this.windowManager.sendToRenderer("webview-frame", { index, buffer: Buffer.from(pending.buffer), size: pending.size, format: "raw" });
              this.lastSentAt.set(index, now);
              this.pendingFrames.delete(index);
            } catch (e) {
              console.error("[OffscreenRenderer] fallback send also failed", e);
            }
          }
        };
        attemptSend();
      } catch (err) {
        console.error("[OffscreenRenderer] Failed to forward paint frame", { index, err });
      }
    });
  }
  setupLoadHandlers(window, index, url) {
    window.webContents.on("did-finish-load", () => {
      console.log(`Offscreen window ${index} loaded: ${url}`);
      this.windowManager.sendToRenderer("webview-loaded", { index, url });
    });
    window.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error(`Offscreen window ${index} failed to load: ${errorDescription}`);
    });
  }
  enablePainting(index) {
    const window = this.windows.get(index);
    if (window && !window.isDestroyed() && !this.paintingEnabled.has(index)) {
      this.paintingEnabled.add(index);
      try {
        window.webContents.setFrameRate(this.config.rendering.frameRate);
      } catch (err) {
        console.warn("[OffscreenRenderer] setFrameRate failed on enable", { index, err });
      }
      setTimeout(() => {
        console.log(`Enabled painting for window ${index}`);
      }, 60);
    }
  }
  disablePainting(index) {
    const window = this.windows.get(index);
    if (window && !window.isDestroyed() && this.paintingEnabled.has(index)) {
      this.paintingEnabled.delete(index);
      window.webContents.setFrameRate(0);
      console.log(`Disabled painting for window ${index}`);
    }
  }
  setActivePaintingWindows(indices) {
    this.windows.forEach((_, index) => {
      if (!indices.includes(index)) {
        this.disablePainting(index);
      }
    });
    indices.forEach((index) => {
      this.enablePainting(index);
    });
  }
  reload(index) {
    const window = this.windows.get(index);
    if (window && !window.isDestroyed()) {
      window.webContents.reload();
    }
  }
  /**
   * Resize a specific offscreen window. Width/height should be in device
   * pixels (DIP). This triggers a repaint at the new size which will be
   * emitted via the 'paint' event.
   */
  resize(index, width, height) {
    const window = this.windows.get(index);
    if (window && !window.isDestroyed()) {
      console.info(`[OffscreenRenderer] resize window ${index} -> ${width}x${height}`);
      window.setSize(width, height);
    }
  }
  /** Resize all offscreen windows to the provided dimensions. */
  resizeAll(width, height) {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        console.info(`[OffscreenRenderer] resizeAll -> ${width}x${height}`);
        win.setSize(width, height);
      }
    });
  }
  /** Resize only the provided indices. */
  resizeIndices(indices, width, height) {
    indices.forEach((i) => {
      const win = this.windows.get(i);
      if (win && !win.isDestroyed()) {
        console.info(`[OffscreenRenderer] resizeIndices - window ${i} -> ${width}x${height}`);
        win.setSize(width, height);
      }
    });
  }
  navigate(index, url) {
    const window = this.windows.get(index);
    if (window && !window.isDestroyed()) {
      window.loadURL(url);
    }
  }
  cleanup() {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    });
    this.windows.clear();
    this.paintingEnabled.clear();
  }
  getWindows() {
    return this.windows;
  }
}
class IPCHandlers {
  config;
  viewManager;
  offscreenRenderer;
  windowManager;
  onSetupComplete;
  constructor(config, viewManager2, offscreenRenderer2, windowManager2, onSetupComplete) {
    this.config = config;
    this.viewManager = viewManager2;
    this.offscreenRenderer = offscreenRenderer2;
    this.windowManager = windowManager2;
    this.onSetupComplete = onSetupComplete;
  }
  register() {
    ipcMain.handle("get-webview-urls", () => {
      return this.config.urls;
    });
    ipcMain.handle("show-setup-view", (event, index) => {
      this.viewManager.showView(index);
    });
    ipcMain.handle("finish-setup", () => {
      this.viewManager.cleanup();
      this.offscreenRenderer.createOffscreenWindows(this.config.urls);
      this.windowManager.sendToRenderer("setup-complete");
      this.onSetupComplete();
    });
    ipcMain.handle("reload-webview", (event, index) => {
      this.offscreenRenderer.reload(index);
    });
    ipcMain.handle("navigate-webview", (event, index, url) => {
      this.offscreenRenderer.navigate(index, url);
    });
    ipcMain.handle("set-active-painting-windows", (event, indices) => {
      this.offscreenRenderer.setActivePaintingWindows(indices);
    });
    ipcMain.handle("resize-offscreen-windows", (event, width, height) => {
      this.offscreenRenderer.resizeAll(width, height);
    });
    ipcMain.handle("resize-active-offscreen-windows", (event, indices, width, height) => {
      this.offscreenRenderer.resizeIndices(indices, width, height);
    });
    ipcMain.handle("enable-painting", (event, index) => {
      this.offscreenRenderer.enablePainting(index);
    });
    ipcMain.handle("disable-painting", (event, index) => {
      this.offscreenRenderer.disablePainting(index);
    });
    ipcMain.on("initial-frame-ack", (event, data) => {
      try {
        const idx = data?.index;
        if (typeof idx === "number") {
          this.offscreenRenderer.handleInitialAck(idx);
        }
      } catch (err) {
        console.warn("[IPC] failed handling initial-frame-ack", err);
      }
    });
    ipcMain.on("texture-applied", (event, data) => {
    });
    ipcMain.on("frame-stats", (event, data) => {
    });
    ipcMain.on("plane-state", (event, data) => {
    });
    ipcMain.on("renderer-error", (_event, data) => {
      try {
        console.error("[IPC] renderer-error", data);
      } catch (err) {
        console.warn("[IPC] failed to log renderer-error", err);
      }
    });
  }
  unregister() {
    ipcMain.removeHandler("get-webview-urls");
    ipcMain.removeHandler("show-setup-view");
    ipcMain.removeHandler("finish-setup");
    ipcMain.removeHandler("reload-webview");
    ipcMain.removeHandler("navigate-webview");
    ipcMain.removeHandler("set-active-painting-windows");
    ipcMain.removeHandler("enable-painting");
    ipcMain.removeHandler("disable-painting");
    ipcMain.removeAllListeners("initial-frame-ack");
    ipcMain.removeAllListeners("texture-applied");
    ipcMain.removeAllListeners("frame-stats");
    ipcMain.removeAllListeners("plane-state");
    ipcMain.removeAllListeners("render-stats");
    ipcMain.removeAllListeners("renderer-error");
  }
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const windowManager = new WindowManager(
  defaultConfig,
  VITE_DEV_SERVER_URL,
  RENDERER_DIST,
  process.env.VITE_PUBLIC || ""
);
const viewManager = new ViewManager(defaultConfig);
const offscreenRenderer = new OffscreenRenderer(defaultConfig, windowManager);
const ipcHandlers = new IPCHandlers(
  defaultConfig,
  viewManager,
  offscreenRenderer,
  windowManager,
  () => {
  }
);
function initialize() {
  const preloadPath = path.join(__dirname, "preload.js");
  const mainWindow = windowManager.createWindow(preloadPath);
  viewManager.setMainWindow(mainWindow);
  viewManager.createViews(defaultConfig.urls);
  ipcHandlers.register();
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    offscreenRenderer.cleanup();
    viewManager.cleanup();
    ipcHandlers.unregister();
    windowManager.destroy();
    app.quit();
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initialize();
  }
});
app.whenReady().then(initialize);
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
