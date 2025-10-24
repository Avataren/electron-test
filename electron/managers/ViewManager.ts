import { BrowserView, BrowserWindow } from 'electron'
import { AppConfig } from '../config'

export class ViewManager {
  private readonly views: Map<number, BrowserView> = new Map()
  private readonly config: AppConfig
  private mainWindow: BrowserWindow | null = null

  constructor(config: AppConfig) {
    this.config = config
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    this.setupResizeHandler()
  }

  private setupResizeHandler(): void {
    if (!this.mainWindow) return

    this.mainWindow.on('resize', () => {
      this.updateBounds()
    })
  }

  createViews(urls: string[]): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    const bounds = this.mainWindow.getContentBounds()

    urls.forEach((url, index) => {
      const view = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      this.setBounds(view, bounds)
      view.setAutoResize({ width: true, height: true })
      view.webContents.loadURL(url)

      this.views.set(index, view)

      if (index === 0) {
        this.mainWindow.addBrowserView(view)
      }

      this.setupViewEventHandlers(view, index, url)
    })
  }

  private setBounds(view: BrowserView, windowBounds: any): void {
    view.setBounds({
      x: 0,
      y: 0,
      width: windowBounds.width,
      height: windowBounds.height - this.config.window.controlBarHeight,
    })
  }

  private setupViewEventHandlers(view: BrowserView, index: number, url: string): void {
    view.webContents.on('did-finish-load', () => {
      console.log(`Setup view ${index} loaded: ${url}`)
    })

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`Setup view ${index} failed to load: ${errorDescription}`)
    })
  }

  updateBounds(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    const bounds = this.mainWindow.getContentBounds()
    this.views.forEach((view) => {
      this.setBounds(view, bounds)
    })
  }

  showView(index: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    this.views.forEach((view) => {
      this.mainWindow!.removeBrowserView(view)
    })

    const view = this.views.get(index)
    if (view) {
      this.mainWindow.addBrowserView(view)
      this.updateBounds()
    }
  }

  cleanup(): void {
    this.views.forEach((view) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.removeBrowserView(view)
      }
      // @ts-ignore - webContents.destroy() exists but isn't in types
      view.webContents.destroy()
    })
    this.views.clear()
  }

  getViews(): Map<number, BrowserView> {
    return this.views
  }
}
