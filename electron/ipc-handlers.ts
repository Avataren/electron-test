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
  private resizeDebounceTimer: NodeJS.Timeout | null = null

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
    ipcMain.handle('get-performance-mode', () => {
      return Boolean(this.config.performanceMode)
    })
    ipcMain.handle('get-webview-urls', () => {
      return this.config.urls
    })

    ipcMain.handle('get-transition-config', () => {
      return this.config.transitions
    })

    // Expose timing configuration (rotation/refresh/transition durations) to renderer
    ipcMain.handle('get-timing-config', () => {
      return this.config.timing
    })

    ipcMain.handle('show-setup-view', (event, index: number) => {
      if (this.config.performanceMode) {
        const urls = this.config.urls || []
        const target = urls[index]
        if (typeof target === 'string') {
          // In performance mode, we only keep a single BrowserView at index 0.
          // Navigate that view to the requested URL, and ensure it is visible.
          this.viewManager.navigate(0, target)
          this.viewManager.showView(0)
        } else {
          // If invalid index, keep current view visible.
          this.viewManager.showView(0)
        }
      } else {
        this.viewManager.showView(index)
      }
    })

    ipcMain.handle('finish-setup', () => {
      // Hide control bar so browser views use full window height during slideshow
      this.viewManager.setControlBarVisible(false)

      if (!this.config.performanceMode) {
        // Get actual window dimensions to ensure offscreen windows match BrowserView size
        const bounds = this.windowManager.getContentBounds()
        const width = bounds?.width ?? this.config.window.width
        const height = bounds?.height ?? this.config.window.height

        this.offscreenRenderer.createOffscreenWindows(this.config.urls, width, height)

        // Set up window resize handler to keep offscreen windows in sync with BrowserView
        this.setupOffscreenResizeHandler()
      }

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
      if (this.config.performanceMode) {
        // Lightweight path: just navigate the single BrowserView
        this.viewManager.navigate(0, url)
      } else {
        this.offscreenRenderer.navigate(index, url)
      }
    })

    // Performance mode helpers: direct BrowserView navigation/reload
    ipcMain.handle('navigate-browser-view', (event, index: number, url: string) => {
      this.viewManager.navigate(index, url)
    })

    ipcMain.handle('reload-browser-view', (event, index: number) => {
      this.viewManager.reload(index)
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

    // Mirror user input from the visible BrowserView into the corresponding
    // offscreen window so state (scrolling, drag interactions, etc.) stays in sync.
    ipcMain.on('mirror-input', (event, payload: any) => {
      try {
        const senderId = event.sender.id
        const idx = this.viewManager.getIndexByWebContentsId(senderId)
        if (idx == null) return

        const type = String(payload?.type || '')
        if (!type) return

        // Map payload into Electron InputEvent shapes
        const base: any = { type }
        if ('x' in payload && 'y' in payload) {
          base.x = Number(payload.x) || 0
          base.y = Number(payload.y) || 0
        }
        if (payload.button) base.button = payload.button
        if (payload.clickCount) base.clickCount = Number(payload.clickCount) || 1
        if (payload.deltaX != null) base.deltaX = Number(payload.deltaX) || 0
        if (payload.deltaY != null) base.deltaY = Number(payload.deltaY) || 0
        if (Array.isArray(payload.modifiers)) base.modifiers = payload.modifiers
        if (payload.keyCode) base.keyCode = String(payload.keyCode)

        this.offscreenRenderer.forwardInputEvent(idx, base)
      } catch (err) {
        console.warn('[IPCHandlers] failed to mirror input', err)
      }
    })

    // Capture page from BrowserView directly
    ipcMain.handle('capture-browser-view', async (event, index: number) => {
      const captureResult = await this.viewManager.capturePage(index)
      if (!captureResult) {
        console.warn(`[IPCHandlers] Failed to capture BrowserView ${index}`)
        return null
      }

      const { bitmap, imageSize } = captureResult

      // Get the CSS bounds of the BrowserView
      const bounds = await this.getBrowserViewSize(index)
      if (!bounds) {
        console.warn(`[IPCHandlers] Failed to get BrowserView bounds for ${index}`)
        return null
      }

      // Calculate actual bitmap dimensions from buffer size
      // imageSize.getSize() returns CSS pixels, but bitmap contains physical pixels
      // This is the same calculation used in OffscreenRenderer.ts
      const bytesPerPixel = 4 // BGRA format
      const actualPixelCount = bitmap.length / bytesPerPixel
      const cssPixelCount = imageSize.width * imageSize.height
      const scaleFactor = Math.sqrt(actualPixelCount / cssPixelCount)
      const backingWidth = Math.round(imageSize.width * scaleFactor)
      const backingHeight = Math.round(imageSize.height * scaleFactor)

      console.log(`[IPCHandlers] Captured BrowserView ${index}: CSS ${bounds.width}x${bounds.height}, backing ${backingWidth}x${backingHeight}, bitmap bytes: ${bitmap.length}, scale factor: ${scaleFactor.toFixed(2)}`)

      // Return the bitmap with complete size information
      // Format must be 'raw' so applyFrameToTexture processes it as raw BGRA pixel data
      return {
        index,
        buffer: bitmap,
        size: {
          width: bounds.width,      // CSS pixels
          height: bounds.height,     // CSS pixels
          backingWidth,              // Physical pixels (calculated from bitmap size)
          backingHeight              // Physical pixels (calculated from bitmap size)
        },
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

  private async getBrowserViewSize(index: number): Promise<{ width: number; height: number; backingWidth?: number; backingHeight?: number } | null> {
    const views = this.viewManager.getViews()
    const view = views.get(index)
    if (!view) return null

    const bounds = view.getBounds()

    // Get the zoom factor to account for DPI scaling
    // BrowserView uses zoomFactor 1.0, so we need to detect the actual backing scale
    // from the captured bitmap size. For now, return CSS dimensions and let the
    // renderer infer backing dimensions from the bitmap data.
    return {
      width: bounds.width,
      height: bounds.height,
      // Note: backingWidth/backingHeight will be inferred by useWebviewFrames
      // from the actual bitmap buffer size and devicePixelRatio
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
      // Clear any pending resize
      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer)
      }

      // Debounce resize to avoid rapid repeated calls
      this.resizeDebounceTimer = setTimeout(() => {
        const bounds = this.windowManager.getContentBounds()
        if (!bounds) return

        console.info(`[IPCHandlers] Window resized to ${bounds.width}x${bounds.height}`)

        // Resize all offscreen windows to match the new window size
        // This ensures captured frames match the BrowserView size
        this.offscreenRenderer.resizeAll(bounds.width, bounds.height)

        // Notify renderer about the resize so it can handle its own resize logic
        // which includes devicePixelRatio calculations and texture updates
        this.windowManager.sendToRenderer('main-window-resized', {
          width: bounds.width,
          height: bounds.height
        })
      }, 100) // 100ms debounce
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

    // Clean up debounce timer
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer)
      this.resizeDebounceTimer = null
    }

    ipcMain.removeHandler('get-webview-urls')
    ipcMain.removeHandler('get-performance-mode')
    ipcMain.removeHandler('get-transition-config')
    ipcMain.removeHandler('get-timing-config')
    ipcMain.removeHandler('show-setup-view')
    ipcMain.removeHandler('finish-setup')
    ipcMain.removeHandler('reload-webview')
    ipcMain.removeHandler('navigate-webview')
    ipcMain.removeHandler('navigate-browser-view')
    ipcMain.removeHandler('reload-browser-view')
    ipcMain.removeHandler('set-active-painting-windows')
    ipcMain.removeHandler('enable-painting')
    ipcMain.removeHandler('disable-painting')
    ipcMain.removeAllListeners('mirror-input')
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
