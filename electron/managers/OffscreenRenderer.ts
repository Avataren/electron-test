import { BrowserWindow } from 'electron'
import { AppConfig } from '../config'
import { WindowManager } from './WindowManager'

export class OffscreenRenderer {
  private readonly windows: Map<number, BrowserWindow> = new Map()
  private readonly config: AppConfig
  private readonly windowManager: WindowManager
  private readonly paintingEnabled: Set<number> = new Set()
  // Reuse SharedArrayBuffers per window to avoid reallocating on every frame
  private readonly sharedBuffers: Map<number, SharedArrayBuffer> = new Map()

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

      // Only enable painting for the first window initially
      if (index === 0) {
        this.enablePainting(index)
      }
    })
  }

  private setupPaintHandler(window: BrowserWindow, index: number): void {
    window.webContents.on('paint', (event, dirty, image) => {
      // Only send frames if painting is enabled for this window
      if (!this.paintingEnabled.has(index)) return

      // Send raw bitmap data (BGRA) to the renderer so we can avoid
      // lossy JPEG encoding and retain exact pixel data and dimensions.
      // NativeImage.toBitmap returns a Buffer with BGRA order.
      const bitmap: Buffer = image.toBitmap()
      const size = image.getSize()

      // Try to reuse a SharedArrayBuffer for this window to avoid
      // allocating a new SAB every frame. If the size changed, reallocate.
      let sab = this.sharedBuffers.get(index)
      if (!sab || sab.byteLength < bitmap.length) {
        sab = new SharedArrayBuffer(bitmap.length)
        this.sharedBuffers.set(index, sab)
      }

      // Copy into the shared buffer (one copy). Renderer will read from it
      // directly without further copies.
      const dest = new Uint8Array(sab)
      dest.set(bitmap)

      // Use postMessage with transfer so we can pass the SharedArrayBuffer
      // without structured cloning errors.
      try {
        this.windowManager.postMessageToRenderer('webview-frame', { index, buffer: sab, size, format: 'sabs' }, [sab])
      } catch (err) {
        // Fallback to normal send (may fail if SAB cannot be serialized)
        this.windowManager.sendToRenderer('webview-frame', { index, buffer: sab, size, format: 'sabs' })
      }
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

  enablePainting(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed() && !this.paintingEnabled.has(index)) {
      this.paintingEnabled.add(index)
      window.webContents.setFrameRate(this.config.rendering.frameRate)
      console.log(`Enabled painting for window ${index}`)
    }
  }

  disablePainting(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed() && this.paintingEnabled.has(index)) {
      this.paintingEnabled.delete(index)
      window.webContents.setFrameRate(0) // Stop painting
      console.log(`Disabled painting for window ${index}`)
    }
  }

  setActivePaintingWindows(indices: number[]): void {
    // Disable all
    this.windows.forEach((_, index) => {
      if (!indices.includes(index)) {
        this.disablePainting(index)
      }
    })

    // Enable only specified indices
    indices.forEach((index) => {
      this.enablePainting(index)
    })
  }

  reload(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      window.webContents.reload()
    }
  }

  /**
   * Resize a specific offscreen window. Width/height should be in device
   * pixels (DIP). This triggers a repaint at the new size which will be
   * emitted via the 'paint' event.
   */
  resize(index: number, width: number, height: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      window.setSize(width, height)
    }
  }

  /** Resize all offscreen windows to the provided dimensions. */
  resizeAll(width: number, height: number): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.setSize(width, height)
      }
    })
  }

  /** Resize only the provided indices. */
  resizeIndices(indices: number[], width: number, height: number): void {
    indices.forEach((i) => {
      const win = this.windows.get(i)
      if (win && !win.isDestroyed()) {
        win.setSize(width, height)
      }
    })
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
    this.paintingEnabled.clear()
  }

  getWindows(): Map<number, BrowserWindow> {
    return this.windows
  }
}
