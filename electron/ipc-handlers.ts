import { ipcMain } from 'electron'
import { AppConfig } from './config'
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
  }
}
