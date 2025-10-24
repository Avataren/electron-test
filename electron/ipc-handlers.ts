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
  }

  unregister(): void {
    ipcMain.removeHandler('get-webview-urls')
    ipcMain.removeHandler('show-setup-view')
    ipcMain.removeHandler('finish-setup')
    ipcMain.removeHandler('reload-webview')
    ipcMain.removeHandler('navigate-webview')
  }
}
