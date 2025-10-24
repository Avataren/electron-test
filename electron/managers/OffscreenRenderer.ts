import { BrowserWindow } from 'electron'
import { AppConfig } from '../config'
import { WindowManager } from './WindowManager'

export class OffscreenRenderer {
  private readonly windows: Map<number, BrowserWindow> = new Map()
  private readonly config: AppConfig
  private readonly windowManager: WindowManager

  constructor(config: AppConfig, windowManager: WindowManager) {
    this.config = config
    this.windowManager = windowManager
  }

  createOffscreenWindows(urls: string[]): void {
    urls.forEach((url, index) => {
      const offscreenWin = new BrowserWindow({
        width: this.config.window.width,
        height: this.config.window.height,
        show: false,
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      offscreenWin.loadURL(url)
      this.windows.set(index, offscreenWin)

      this.setupPaintHandler(offscreenWin, index)
      this.setupLoadHandlers(offscreenWin, index, url)
      this.startPainting(offscreenWin)
    })
  }

  private setupPaintHandler(window: BrowserWindow, index: number): void {
    window.webContents.on('paint', (event, dirty, image) => {
      const buffer = image.toJPEG(this.config.rendering.jpegQuality)

      this.windowManager.sendToRenderer('webview-frame', {
        index,
        buffer: buffer,
        size: image.getSize(),
      })
    })
  }

  private setupLoadHandlers(window: BrowserWindow, index: number, url: string): void {
    window.webContents.on('did-finish-load', () => {
      console.log(`Offscreen window ${index} loaded: ${url}`)
      this.windowManager.sendToRenderer('webview-loaded', { index, url })
    })

    window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`Offscreen window ${index} failed to load: ${errorDescription}`)
    })
  }

  private startPainting(window: BrowserWindow): void {
    window.webContents.setFrameRate(this.config.rendering.frameRate)
  }

  reload(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      window.webContents.reload()
    }
  }

  navigate(index: number, url: string): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      window.loadURL(url)
    }
  }

  cleanup(): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    })
    this.windows.clear()
  }

  getWindows(): Map<number, BrowserWindow> {
    return this.windows
  }
}
