import { app, BrowserWindow, protocol } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defaultConfig } from './config'
import { WindowManager } from './managers/WindowManager'
import { ViewManager } from './managers/ViewManager'
import { OffscreenRenderer } from './managers/OffscreenRenderer'
import { IPCHandlers } from './ipc-handlers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Initialize managers
const windowManager = new WindowManager(
  defaultConfig,
  VITE_DEV_SERVER_URL,
  RENDERER_DIST,
  process.env.VITE_PUBLIC || '',
)

const viewManager = new ViewManager(defaultConfig)
const offscreenRenderer = new OffscreenRenderer(defaultConfig, windowManager)

// Setup mode flag
let setupMode = true

// Initialize IPC handlers
const ipcHandlers = new IPCHandlers(
  defaultConfig,
  viewManager,
  offscreenRenderer,
  windowManager,
  () => {
    setupMode = false
  },
)

function initialize() {
  const preloadPath = path.join(__dirname, 'preload.js')
  // Register IPC handlers before loading the renderer to avoid race conditions
  // where the renderer invokes handlers (e.g., get-webview-urls) before they're registered.
  ipcHandlers.register()

  const mainWindow = windowManager.createWindow(preloadPath)

  viewManager.setMainWindow(mainWindow)
  if (defaultConfig.performanceMode) {
    // Create only a single BrowserView and navigate it during rotation
    const initialUrl: string = defaultConfig.urls?.[0] ?? 'about:blank'
    viewManager.createViews([initialUrl])
  } else {
    viewManager.createViews(defaultConfig.urls)
  }

  // Ensure clean shutdown when the main window is closed.
  // Hidden offscreen BrowserWindows can keep the process alive in release,
  // so proactively tear everything down here.
  mainWindow.on('closed', () => {
    try {
      offscreenRenderer.cleanup()
    } catch {}
    try {
      viewManager.cleanup()
    } catch {}
    try {
      ipcHandlers.unregister()
    } catch {}
    try {
      windowManager?.destroy()
    } catch {}
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    offscreenRenderer.cleanup()
    viewManager.cleanup()
    ipcHandlers.unregister()
    windowManager?.destroy()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initialize()
  }
})

app.whenReady().then(initialize)
