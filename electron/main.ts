import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null
const offscreenWindows: Map<number, BrowserWindow> = new Map()

// URLs to render offscreen
const urls = [
  'https://cubed.no',
  'https://www.github.com',
  'https://www.wikipedia.org',
  'https://news.ycombinator.com',
]

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
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

// IPC handlers
ipcMain.handle('get-webview-urls', () => {
  return urls
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

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
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
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
  createOffscreenWindows()
})
