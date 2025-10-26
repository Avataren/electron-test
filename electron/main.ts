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
      corsEnabled: true,
      stream: true,
    },
  },
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
  const mainWindow = windowManager.createWindow(preloadPath)

  viewManager.setMainWindow(mainWindow)
  viewManager.createViews(defaultConfig.urls)

  ipcHandlers.register()
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    offscreenRenderer.cleanup()
    viewManager.cleanup()
    ipcHandlers.unregister()
    windowManager.destroy()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initialize()
  }
})

app.whenReady().then(initialize)
