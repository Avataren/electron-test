import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { AppConfig } from '../config'

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

    // Ensure the renderer is cross-origin isolated so it can receive
    // SharedArrayBuffer objects. Add COOP/COEP headers for the renderer
    // session so postMessage with SABs can be serialized into the page.
    try {
      const ses = this.window.webContents.session
      ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
        const responseHeaders = Object.assign({}, details.responseHeaders || {})
        // Add COOP and COEP to enable SharedArrayBuffer usage in renderer
        responseHeaders['Cross-Origin-Opener-Policy'] = ['same-origin']
        responseHeaders['Cross-Origin-Embedder-Policy'] = ['require-corp']
        callback({ responseHeaders })
      })
    } catch (err) {
      console.warn('[WindowManager] failed to enable COOP/COEP headers', err)
    }

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

  /**
   * Send a message to the renderer using postMessage which supports
   * transfer lists (ArrayBuffers, MessagePorts). Use this when sending
   * large binary buffers like SharedArrayBuffer to avoid serialization errors.
   */
  postMessageToRenderer(channel: string, message: any, transfer?: any[]): void {
    if (this.isValid()) {
      try {
        // webContents.postMessage(channel, message, transfer)
        this.window!.webContents.postMessage(channel, message, transfer || [])
      } catch (err) {
        // Fallback to send which will attempt structured clone (may fail for SAB)
        this.window!.webContents.send(channel, message)
      }
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
