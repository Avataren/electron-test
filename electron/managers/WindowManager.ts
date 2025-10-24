import { BrowserWindow } from 'electron'
import path from 'node:path'
import { AppConfig } from './config'

export class WindowManager {
  private window: BrowserWindow | null = null
  private readonly config: AppConfig
  private readonly viteDevServerUrl?: string
  private readonly rendererDist: string
  private readonly publicPath: string

  constructor(
    config: AppConfig,
    viteDevServerUrl: string | undefined,
    rendererDist: string,
    publicPath: string,
  ) {
    this.config = config
    this.viteDevServerUrl = viteDevServerUrl
    this.rendererDist = rendererDist
    this.publicPath = publicPath
  }

  createWindow(preloadPath: string): BrowserWindow {
    this.window = new BrowserWindow({
      width: this.config.window.width,
      height: this.config.window.height,
      icon: path.join(this.publicPath, 'favicon.ico'),
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    this.window.webContents.on('did-finish-load', () => {
      this.sendToRenderer('main-process-message', new Date().toLocaleString())
    })

    if (this.viteDevServerUrl) {
      this.window.loadURL(this.viteDevServerUrl)
      this.window.webContents.openDevTools()
    } else {
      this.window.loadFile(path.join(this.rendererDist, 'index.html'))
    }

    return this.window
  }

  getWindow(): BrowserWindow | null {
    return this.window
  }

  isValid(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  sendToRenderer(channel: string, ...args: any[]): void {
    if (this.isValid()) {
      this.window!.webContents.send(channel, ...args)
    }
  }

  getContentBounds() {
    if (this.isValid()) {
      return this.window!.getContentBounds()
    }
    return null
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }
}
