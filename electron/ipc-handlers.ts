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
      this.viewManager.cleanup()
      this.offscreenRenderer.createOffscreenWindows(this.config.urls)
      this.windowManager.sendToRenderer('setup-complete')
      this.onSetupComplete()
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
        console.log('[IPC] texture-applied from renderer', data)
      } catch (err) {
        console.warn('[IPC] failed to log texture-applied', err)
      }
    })

    ipcMain.on('frame-stats', (event, data) => {
      try {
        console.log('[IPC] frame-stats', data)
      } catch (err) {
        console.warn('[IPC] failed to log frame-stats', err)
      }
    })

    ipcMain.on('plane-state', (event, data) => {
      try {
        console.log('[IPC] plane-state', data)
      } catch (err) {
        console.warn('[IPC] failed to log plane-state', err)
      }
    })

    ipcMain.on('render-stats', (event, data) => {
      try {
        console.log('[IPC] render-stats', data)
      } catch (err) {
        console.warn('[IPC] failed to log render-stats', err)
      }
    })
  }

  unregister(): void {
    ipcMain.removeHandler('get-webview-urls')
    ipcMain.removeHandler('show-setup-view')
    ipcMain.removeHandler('finish-setup')
    ipcMain.removeHandler('reload-webview')
    ipcMain.removeHandler('navigate-webview')
    ipcMain.removeHandler('set-active-painting-windows')
    ipcMain.removeHandler('enable-painting')
    ipcMain.removeHandler('disable-painting')
      ipcMain.removeAllListeners('initial-frame-ack')
    ipcMain.removeAllListeners('texture-applied')
    ipcMain.removeAllListeners('frame-stats')
    ipcMain.removeAllListeners('plane-state')
    ipcMain.removeAllListeners('render-stats')
  }
}
