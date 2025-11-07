import { BrowserView, BrowserWindow } from 'electron'
import type { Rectangle, Size, WebContents } from 'electron'
import type { AppConfig } from '../config'

type DevToolsWebContents = WebContents & {
  getOwnerBrowserWindow?: () => BrowserWindow | null
}

export class ViewManager {
  private readonly views: Map<number, BrowserView> = new Map()
  private readonly config: AppConfig
  private mainWindow: BrowserWindow | null = null
  private readonly isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
  private readonly devToolsListeners: Array<() => void> = []
  private devToolsInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  private controlBarVisible = true

  constructor(config: AppConfig) {
    this.config = config
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    this.setupResizeHandler()
    this.setupDevToolsHandlers()
  }

  private setupResizeHandler(): void {
    if (!this.mainWindow) return

    this.mainWindow.on('resize', () => {
      this.updateBounds()
    })
  }

  private setupDevToolsHandlers(): void {
    if (!this.mainWindow) return

    const update = () => {
      this.updateBounds()
    }

    const webContents = this.mainWindow.webContents

    const handleOpened = () => {
      this.clearDevToolsListeners()
      this.updateDevToolsInsets()
      update()
      const devToolsContents = webContents.devToolsWebContents as DevToolsWebContents | undefined
      if (devToolsContents) {
        const handleDevToolsResize = () => {
          this.updateDevToolsInsets()
          this.updateBounds()
        }
        const handlePreferredSizeChanged = (
          _event: Electron.Event,
          _size: Electron.Size,
        ) => {
          this.updateDevToolsInsets()
          this.updateBounds()
        }
        devToolsContents.on('destroyed', handleDevToolsResize)
        devToolsContents.on('did-finish-load', handleDevToolsResize)
        devToolsContents.on('did-stop-loading', handleDevToolsResize)
        devToolsContents.on('dom-ready', handleDevToolsResize)
        devToolsContents.on('preferred-size-changed', handlePreferredSizeChanged)
        this.devToolsListeners.push(() => {
          devToolsContents.removeListener('destroyed', handleDevToolsResize)
          devToolsContents.removeListener('did-finish-load', handleDevToolsResize)
          devToolsContents.removeListener('did-stop-loading', handleDevToolsResize)
          devToolsContents.removeListener('dom-ready', handleDevToolsResize)
          devToolsContents.removeListener('preferred-size-changed', handlePreferredSizeChanged)
        })
      }
    }

    webContents.on('devtools-opened', handleOpened)
    webContents.on('devtools-focused', () => {
      this.updateDevToolsInsets()
      update()
    })
    webContents.on('devtools-closed', () => {
      this.clearDevToolsListeners()
      this.resetDevToolsInsets()
      update()
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

      // Set background color to match your app background
      view.setBackgroundColor('#000000')

      if (index === 0 && this.mainWindow && this.isDev) {
        view.webContents.once('did-finish-load', () => {
          view.webContents.openDevTools({ mode: 'detach', activate: true })
        })
      }

      this.setBounds(view, bounds)
      view.setAutoResize({ width: true, height: true })
      view.webContents.loadURL(url)

      this.views.set(index, view)

      if (index === 0 && this.mainWindow) {
        this.mainWindow.addBrowserView(view)
      }

      this.setupViewEventHandlers(view, index, url)
    })
  }

  private setBounds(view: BrowserView, windowBounds: Rectangle): void {
    const bounds = this.calculateViewBounds(windowBounds)
    view.setBounds(bounds)
  }

  private calculateViewBounds(windowBounds: Rectangle): Rectangle {
    const availableWidth = Math.max(
      0,
      windowBounds.width - this.devToolsInsets.left - this.devToolsInsets.right,
    )
    const availableHeight = Math.max(
      0,
      windowBounds.height -
        this.devToolsInsets.top -
        this.devToolsInsets.bottom -
        (this.controlBarVisible ? this.config.window.controlBarHeight : 0),
    )

    return {
      x: this.devToolsInsets.left,
      y: this.devToolsInsets.top,
      width: availableWidth,
      height: availableHeight,
    }
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

    this.updateDevToolsInsets()
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
      if (this.isDev) {
        if (view.webContents.isDevToolsOpened()) {
          view.webContents.devToolsWebContents?.focus?.()
        } else {
          view.webContents.openDevTools({ mode: 'detach', activate: true })
        }
      }
    }
  }

  hideAllViews(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    this.views.forEach((view) => {
      this.mainWindow!.removeBrowserView(view)
    })
  }

  setControlBarVisible(visible: boolean): void {
    this.controlBarVisible = visible
    this.updateBounds()
  }

  cleanup(): void {
    this.clearDevToolsListeners()
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

  private clearDevToolsListeners(): void {
    this.devToolsListeners.forEach((remove) => remove())
    this.devToolsListeners.length = 0
    this.resetDevToolsInsets()
  }

  private resetDevToolsInsets(): void {
    this.devToolsInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  }

  private updateDevToolsInsets(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.resetDevToolsInsets()
      return
    }

    const webContents = this.mainWindow.webContents

    if (!webContents.isDevToolsOpened?.()) {
      this.resetDevToolsInsets()
      return
    }

    const devToolsContents = webContents.devToolsWebContents as DevToolsWebContents | undefined

    if (!devToolsContents) {
      this.resetDevToolsInsets()
      return
    }

    const ownerWindow = devToolsContents?.getOwnerBrowserWindow?.() ?? null

    if (!ownerWindow) {
      this.resetDevToolsInsets()
      return
    }

    const windowBounds = this.mainWindow.getBounds()
    const devToolsBounds = ownerWindow.getBounds()

    const tolerance = 2
    const matchesWidth = Math.abs(devToolsBounds.width - windowBounds.width) <= tolerance
    const matchesHeight = Math.abs(devToolsBounds.height - windowBounds.height) <= tolerance

    const insets = { top: 0, right: 0, bottom: 0, left: 0 }

    if (matchesWidth && devToolsBounds.height < windowBounds.height) {
      const distanceTop = Math.abs(devToolsBounds.y - windowBounds.y)
      const distanceBottom = Math.abs(
        windowBounds.y + windowBounds.height - (devToolsBounds.y + devToolsBounds.height),
      )
      if (distanceBottom <= distanceTop) {
        insets.bottom = devToolsBounds.height
      } else {
        insets.top = devToolsBounds.height
      }
    } else if (matchesHeight && devToolsBounds.width < windowBounds.width) {
      const distanceLeft = Math.abs(devToolsBounds.x - windowBounds.x)
      const distanceRight = Math.abs(
        windowBounds.x + windowBounds.width - (devToolsBounds.x + devToolsBounds.width),
      )
      if (distanceRight <= distanceLeft) {
        insets.right = devToolsBounds.width
      } else {
        insets.left = devToolsBounds.width
      }
    } else {
      const preferredSize = (devToolsContents as unknown as {
        getPreferredSize?: () => Size
      }).getPreferredSize?.()
      if (preferredSize) {
        if (preferredSize.height && preferredSize.height < windowBounds.height) {
          insets.bottom = preferredSize.height
        } else if (preferredSize.width && preferredSize.width < windowBounds.width) {
          insets.right = preferredSize.width
        }
      }
    }

    this.devToolsInsets = {
      top: Math.max(0, insets.top),
      right: Math.max(0, insets.right),
      bottom: Math.max(0, insets.bottom),
      left: Math.max(0, insets.left),
    }
  }
}
