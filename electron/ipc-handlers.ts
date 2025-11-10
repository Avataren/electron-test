import { ipcMain } from 'electron'
import type { AppConfig } from './config'
import { ViewManager } from './managers/ViewManager'
import { OffscreenRenderer } from './managers/OffscreenRenderer'
import { WindowManager } from './managers/WindowManager'

export class IPCHandlers {
  private readonly config: AppConfig
  private readonly viewManager: ViewManager
  private readonly offscreenRenderer: OffscreenRenderer
  private readonly windowManager: WindowManager
  private readonly onSetupComplete: () => void
  private offscreenResizeHandler: (() => void) | null = null

  constructor(
    config: AppConfig,
    viewManager: ViewManager,
    offscreenRenderer: OffscreenRenderer,
    windowManager: WindowManager,
    onSetupComplete: () => void,
  ) {
    this.config = config
    this.viewManager = viewManager
    this.offscreenRenderer = offscreenRenderer
    this.windowManager = windowManager
    this.onSetupComplete = onSetupComplete
  }

  register(): void {
    ipcMain.handle('get-webview-urls', () => {
      return this.config.urls
    })

    ipcMain.handle('show-setup-view', (event, index: number) => {
      this.viewManager.showView(index)
    })

    ipcMain.handle('finish-setup', () => {
      // Hide control bar so browser views use full window height during slideshow
      this.viewManager.setControlBarVisible(false)

      // Get actual window dimensions to ensure offscreen windows match BrowserView size
      const bounds = this.windowManager.getContentBounds()
      const width = bounds?.width ?? this.config.window.width
      const height = bounds?.height ?? this.config.window.height

      this.offscreenRenderer.createOffscreenWindows(this.config.urls, width, height)

      // Set up window resize handler to keep offscreen windows in sync with BrowserView
      this.setupOffscreenResizeHandler()

      this.windowManager.sendToRenderer('setup-complete')
      this.onSetupComplete()
    })

    ipcMain.handle('show-browser-view', (_event, index: number) => {
      this.viewManager.showView(index)
    })

    ipcMain.handle('hide-browser-views', () => {
      this.viewManager.hideAllViews()
    })

    ipcMain.handle('reload-webview', (event, index: number) => {
      this.offscreenRenderer.reload(index)
    })

    ipcMain.handle('navigate-webview', (event, index: number, url: string) => {
      this.offscreenRenderer.navigate(index, url)
    })

    // New handlers for controlling painting
    ipcMain.handle('set-active-painting-windows', (event, indices: number[]) => {
      this.offscreenRenderer.setActivePaintingWindows(indices)
    })

    // Resize offscreen windows (width/height in device pixels)
    ipcMain.handle('resize-offscreen-windows', (event, width: number, height: number) => {
      this.offscreenRenderer.resizeAll(width, height)
    })

    ipcMain.handle('resize-active-offscreen-windows', (event, indices: number[], width: number, height: number) => {
      this.offscreenRenderer.resizeIndices(indices, width, height)
    })

    ipcMain.handle('enable-painting', (event, index: number) => {
      this.offscreenRenderer.enablePainting(index)
    })

    ipcMain.handle('disable-painting', (event, index: number) => {
      this.offscreenRenderer.disablePainting(index)
    })

    // Capture page from BrowserView directly
    ipcMain.handle('capture-browser-view', async (event, index: number) => {
      const bitmap = await this.viewManager.capturePage(index)
      if (!bitmap) {
        console.warn(`[IPCHandlers] Failed to capture BrowserView ${index}`)
        return null
      }

      // Return the bitmap with size information
      // Format must be 'raw' so applyFrameToTexture processes it as raw BGRA pixel data
      const size = await this.getBrowserViewSize(index)
      return {
        index,
        buffer: bitmap,
        size,
        format: 'raw'
      }
    })

      // Receive initial-frame ACKs from renderer and forward to offscreen renderer
      ipcMain.on('initial-frame-ack', (event, data: { index: number }) => {
        try {
          const idx = data?.index
          if (typeof idx === 'number') {
            this.offscreenRenderer.handleInitialAck(idx)
          }
        } catch (err) {
          console.warn('[IPC] failed handling initial-frame-ack', err)
        }
      })

    // Diagnostic: listen for renderer acknowledgements that a texture was applied
    ipcMain.on('texture-applied', (event, data) => {
      try {
        //console.log('[IPC] texture-applied from renderer', data)
      } catch (err) {
        console.warn('[IPC] failed to log texture-applied', err)
      }
    })

    ipcMain.on('frame-stats', (event, data) => {
      try {
        //console.log('[IPC] frame-stats', data)
      } catch (err) {
        console.warn('[IPC] failed to log frame-stats', err)
      }
    })

    ipcMain.on('plane-state', (event, data) => {
      try {
        //console.log('[IPC] plane-state', data)
      } catch (err) {
        console.warn('[IPC] failed to log plane-state', err)
      }
    })

    // ipcMain.on('render-stats', (event, data) => {
    //   try {
    //     console.log('[IPC] render-stats', data)
    //   } catch (err) {
    //     console.warn('[IPC] failed to log render-stats', err)
    //   }
    // })

    ipcMain.on('renderer-error', (_event, data) => {
      try {
        console.error('[IPC] renderer-error', data)
      } catch (err) {
        console.warn('[IPC] failed to log renderer-error', err)
      }
    })
  }

  private async getBrowserViewSize(index: number): Promise<{ width: number; height: number } | null> {
    const views = this.viewManager.getViews()
    const view = views.get(index)
    if (!view) return null

    const bounds = view.getBounds()
    return {
      width: bounds.width,
      height: bounds.height
    }
  }

  private setupOffscreenResizeHandler(): void {
    const mainWindow = this.windowManager.getWindow()
    if (!mainWindow) {
      console.warn('[IPCHandlers] Cannot setup resize handler: main window not available')
      return
    }

    // Remove existing handler if any
    if (this.offscreenResizeHandler) {
      mainWindow.off('resize', this.offscreenResizeHandler)
    }

    // Create new resize handler
    this.offscreenResizeHandler = () => {
      const bounds = this.windowManager.getContentBounds()
      if (!bounds) return

      console.info(`[IPCHandlers] Window resized to ${bounds.width}x${bounds.height}, resizing offscreen windows`)

      // Notify renderer about the resize so it can handle its own resize logic
      // which includes devicePixelRatio calculations and texture updates
      this.windowManager.sendToRenderer('main-window-resized', {
        width: bounds.width,
        height: bounds.height
      })
    }

    // Attach to window resize event
    mainWindow.on('resize', this.offscreenResizeHandler)
    console.info('[IPCHandlers] Offscreen resize handler attached')
  }

  unregister(): void {
    // Clean up resize handler
    if (this.offscreenResizeHandler) {
      const mainWindow = this.windowManager.getWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.off('resize', this.offscreenResizeHandler)
      }
      this.offscreenResizeHandler = null
    }

    ipcMain.removeHandler('get-webview-urls')
    ipcMain.removeHandler('show-setup-view')
    ipcMain.removeHandler('finish-setup')
    ipcMain.removeHandler('reload-webview')
    ipcMain.removeHandler('navigate-webview')
    ipcMain.removeHandler('set-active-painting-windows')
    ipcMain.removeHandler('enable-painting')
    ipcMain.removeHandler('disable-painting')
    ipcMain.removeHandler('capture-browser-view')
    ipcMain.removeHandler('show-browser-view')
    ipcMain.removeHandler('hide-browser-views')
      ipcMain.removeAllListeners('initial-frame-ack')
    ipcMain.removeAllListeners('texture-applied')
    ipcMain.removeAllListeners('frame-stats')
    ipcMain.removeAllListeners('plane-state')
    ipcMain.removeAllListeners('render-stats')
    ipcMain.removeAllListeners('renderer-error')
  }
}
