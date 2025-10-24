import { BrowserWindow, BrowserView, ipcMain, app } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
const defaultConfig = {
  urls: [
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
    frameRate: 1,
    // Reduced from 30 to 1fps
    jpegQuality: 85
  }
};
class WindowManager {
  window = null;
  config;
  viteDevServerUrl;
  rendererDist;
  publicPath;
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
    if (this.viteDevServerUrl) {
      this.window.loadURL(this.viteDevServerUrl);
      this.window.webContents.openDevTools();
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
  }
}
class ViewManager {
  views = /* @__PURE__ */ new Map();
  config;
  mainWindow = null;
  constructor(config) {
    this.config = config;
  }
  setMainWindow(window) {
    this.mainWindow = window;
    this.setupResizeHandler();
  }
  setupResizeHandler() {
    if (!this.mainWindow) return;
    this.mainWindow.on("resize", () => {
      this.updateBounds();
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
      this.setBounds(view, bounds);
      view.setAutoResize({ width: true, height: true });
      view.webContents.loadURL(url);
      this.views.set(index, view);
      if (index === 0) {
        this.mainWindow.addBrowserView(view);
      }
      this.setupViewEventHandlers(view, index, url);
    });
  }
  setBounds(view, windowBounds) {
    const bounds = {
      x: 0,
      y: 0,
      width: windowBounds.width,
      height: windowBounds.height - this.config.window.controlBarHeight
    };
    console.log("Setting view bounds:", bounds);
    view.setBounds(bounds);
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
    }
  }
  cleanup() {
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
}
class OffscreenRenderer {
  windows = /* @__PURE__ */ new Map();
  config;
  windowManager;
  paintingEnabled = /* @__PURE__ */ new Set();
  constructor(config, windowManager2) {
    this.config = config;
    this.windowManager = windowManager2;
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
      const buffer = image.toJPEG(this.config.rendering.jpegQuality);
      this.windowManager.sendToRenderer("webview-frame", {
        index,
        buffer,
        size: image.getSize()
      });
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
      window.webContents.setFrameRate(this.config.rendering.frameRate);
      console.log(`Enabled painting for window ${index}`);
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
    ipcMain.handle("enable-painting", (event, index) => {
      this.offscreenRenderer.enablePainting(index);
    });
    ipcMain.handle("disable-painting", (event, index) => {
      this.offscreenRenderer.disablePainting(index);
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
