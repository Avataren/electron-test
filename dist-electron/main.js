import { ipcMain, app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
const offscreenWindows = /* @__PURE__ */ new Map();
const urls = [
  "https://cubed.no",
  "https://www.github.com",
  "https://www.wikipedia.org",
  "https://news.ycombinator.com"
];
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC || "", "favicon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Changed from preload.mjs to preload.js
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
      // Explicitly enable sandbox for security
    }
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
function createOffscreenWindows() {
  urls.forEach((url, index) => {
    const offscreenWin = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    offscreenWin.loadURL(url);
    offscreenWindows.set(index, offscreenWin);
    offscreenWin.webContents.on("paint", (event, dirty, image) => {
      const buffer = image.toJPEG(85);
      if (win && !win.isDestroyed()) {
        win.webContents.send("webview-frame", {
          index,
          buffer,
          size: image.getSize()
        });
      }
    });
    offscreenWin.webContents.setFrameRate(30);
    offscreenWin.webContents.on("did-finish-load", () => {
      console.log(`Offscreen window ${index} loaded: ${url}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send("webview-loaded", { index, url });
      }
    });
    offscreenWin.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error(`Offscreen window ${index} failed to load: ${errorDescription}`);
    });
  });
}
ipcMain.handle("get-webview-urls", () => {
  return urls;
});
ipcMain.handle("reload-webview", (event, index) => {
  const offscreenWin = offscreenWindows.get(index);
  if (offscreenWin && !offscreenWin.isDestroyed()) {
    offscreenWin.webContents.reload();
  }
});
ipcMain.handle("navigate-webview", (event, index, url) => {
  const offscreenWin = offscreenWindows.get(index);
  if (offscreenWin && !offscreenWin.isDestroyed()) {
    offscreenWin.loadURL(url);
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    offscreenWindows.forEach((win2) => {
      if (!win2.isDestroyed()) {
        win2.destroy();
      }
    });
    offscreenWindows.clear();
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  createWindow();
  createOffscreenWindows();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
