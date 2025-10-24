import { app, BrowserWindow, BrowserView, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null
const offscreenWindows: Map<number, BrowserWindow> = new Map()
const setupViews: Map<number, BrowserView> = new Map()
let setupMode = true

// URLs to render offscreen
const urls = [
  'https://cubed.no',
  'https://www.github.com',
  'https://www.wikipedia.org',
  'https://news.ycombinator.com',
]

// Height of the control bar at the bottom (in pixels)
const CONTROL_BAR_HEIGHT = 120

function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 1080,
    icon: path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devtools in development
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Handle window resize to update BrowserView bounds
  win.on('resize', () => {
    updateBrowserViewBounds()
  })
}

function updateBrowserViewBounds() {
  if (!win || win.isDestroyed()) return

  const bounds = win.getContentBounds()
  setupViews.forEach((view) => {
    view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height - CONTROL_BAR_HEIGHT,
    })
  })
}

function createSetupViews() {
  if (!win || win.isDestroyed()) return

  const bounds = win.getContentBounds()

  urls.forEach((url, index) => {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height - CONTROL_BAR_HEIGHT,
    })

    view.setAutoResize({
      width: true,
      height: true,
    })

    view.webContents.loadURL(url)

    setupViews.set(index, view)

    // Show only the first view initially
    if (index === 0) {
      win.addBrowserView(view)
    }

    // Handle page load events
    view.webContents.on('did-finish-load', () => {
      console.log(`Setup view ${index} loaded: ${url}`)
    })

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`Setup view ${index} failed to load: ${errorDescription}`)
    })
  })
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
        contextIsolation: true,
      },
    })

    offscreenWin.loadURL(url)
    offscreenWindows.set(index, offscreenWin)

    // Handle paint events - this fires when the page updates
    offscreenWin.webContents.on('paint', (event, dirty, image) => {
      // Convert image to JPEG buffer for better performance
      const buffer = image.toJPEG(85)

      // Send frame to renderer process
      if (win && !win.isDestroyed()) {
        win.webContents.send('webview-frame', {
          index,
          buffer: buffer,
          size: image.getSize(),
        })
      }
    })

    // Start painting - set frame rate to 30fps
    offscreenWin.webContents.setFrameRate(30)

    // Handle page load events
    offscreenWin.webContents.on('did-finish-load', () => {
      console.log(`Offscreen window ${index} loaded: ${url}`)
      if (win && !win.isDestroyed()) {
        win.webContents.send('webview-loaded', { index, url })
      }
    })

    offscreenWin.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`Offscreen window ${index} failed to load: ${errorDescription}`)
    })
  })
}

function convertToOffscreen() {
  if (!win || win.isDestroyed()) return

  // Remove all BrowserViews
  setupViews.forEach((view) => {
    if (win && !win.isDestroyed()) {
      win.removeBrowserView(view)
    }
    // @ts-ignore - webContents.destroy() exists but isn't in types
    view.webContents.destroy()
  })
  setupViews.clear()

  // Create offscreen windows
  createOffscreenWindows()
  setupMode = false

  // Notify renderer that setup is complete
  if (win && !win.isDestroyed()) {
    win.webContents.send('setup-complete')
  }
}

// IPC handlers
ipcMain.handle('get-webview-urls', () => {
  return urls
})

ipcMain.handle('show-setup-view', (event, index: number) => {
  if (!win || win.isDestroyed()) return

  // Remove current view
  setupViews.forEach((view) => {
    if (win && !win.isDestroyed()) {
      win.removeBrowserView(view)
    }
  })

  // Add the requested view
  const view = setupViews.get(index)
  if (view) {
    win.addBrowserView(view)
    updateBrowserViewBounds()
  }
})

ipcMain.handle('finish-setup', () => {
  convertToOffscreen()
})

ipcMain.handle('reload-webview', (event, index: number) => {
  const offscreenWin = offscreenWindows.get(index)
  if (offscreenWin && !offscreenWin.isDestroyed()) {
    offscreenWin.webContents.reload()
  }
})

ipcMain.handle('navigate-webview', (event, index: number, url: string) => {
  const offscreenWin = offscreenWindows.get(index)
  if (offscreenWin && !offscreenWin.isDestroyed()) {
    offscreenWin.loadURL(url)
  }
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Clean up offscreen windows
    offscreenWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    })
    offscreenWindows.clear()

    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
  createSetupViews()
})
