import { BrowserWindow, protocol, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig } from '../config'

export class WindowManager {
  private window: BrowserWindow | null = null
  private readonly config: AppConfig
  private readonly viteDevServerUrl?: string
  private readonly rendererDist: string
  private readonly publicPath: string
  private readonly devToolsWindows = new Map<number, BrowserWindow>()
  private appProtocolRegistered = false

  constructor(
    config: AppConfig,
    viteDevServerUrl: string | undefined,
    rendererDist: string,
    publicPath: string,
  ) {
    this.config = config
    this.viteDevServerUrl = viteDevServerUrl
    this.rendererDist = path.resolve(rendererDist)
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
      ses.webRequest.onHeadersReceived({ urls: ['*://*/*', 'file://*', 'app://*'] }, (details, callback) => {
        const targetId = this.window?.webContents.id
        if (!targetId || details.webContentsId !== targetId) {
          callback({ responseHeaders: details.responseHeaders })
          return
        }

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
      this.window.webContents.on('before-input-event', (event, input) => {
        const isToggle =
          input.type === 'keyDown' &&
          input.key.toLowerCase() === 'i' &&
          (input.control || input.meta) &&
          input.shift
        if (isToggle) {
          event.preventDefault()
          this.openDetachedDevTools(this.window?.webContents)
        }
      })

      this.window.webContents.once('did-frame-finish-load', () => {
        this.openDetachedDevTools(this.window?.webContents)
      })
      this.window.loadURL(this.viteDevServerUrl)
    } else {
      this.ensureAppProtocol()
        .then(() => {
          if (this.isValid()) {
            this.window!.loadURL('app://index.html')
          }
        })
        .catch((err) => {
          console.warn('[WindowManager] Failed to register app protocol', err)
          if (this.isValid()) {
            this.window!.loadFile(path.join(this.rendererDist, 'index.html'))
          }
        })
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
    this.devToolsWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.close()
      }
    })
    this.devToolsWindows.clear()
  }

  private openDetachedDevTools(target?: WebContents | null): void {
    if (!target || target.isDestroyed()) return

    if (target.isDevToolsOpened()) {
      const existing = this.devToolsWindows.get(target.id)
      if (existing && !existing.isDestroyed()) {
        existing.focus()
        return
      }
    }

    let devToolsWindow = this.devToolsWindows.get(target.id) || null
    if (!devToolsWindow || devToolsWindow.isDestroyed()) {
      devToolsWindow = new BrowserWindow({
        width: Math.max(960, Math.floor(this.config.window.width * 0.6)),
        height: Math.max(720, Math.floor(this.config.window.height * 0.6)),
        title: 'DevTools',
        autoHideMenuBar: true,
      })
      devToolsWindow.on('closed', () => {
        this.devToolsWindows.delete(target.id)
        if (!target.isDestroyed() && target.isDevToolsOpened()) {
          target.closeDevTools()
        }
      })
      this.devToolsWindows.set(target.id, devToolsWindow)
    }

    try {
      target.setDevToolsWebContents(devToolsWindow.webContents)
    } catch (err) {
      console.warn('[WindowManager] Failed to attach detached devtools window', err)
      if (devToolsWindow && !devToolsWindow.isDestroyed()) {
        devToolsWindow.close()
      }
      this.devToolsWindows.delete(target.id)
      target.openDevTools({ mode: 'undocked', activate: true })
      return
    }

    const cleanup = () => {
      target.removeListener('devtools-closed', cleanup)
      target.removeListener('destroyed', cleanup)
      const win = this.devToolsWindows.get(target.id)
      if (win && !win.isDestroyed()) {
        win.close()
      }
      this.devToolsWindows.delete(target.id)
    }

    target.once('devtools-closed', cleanup)
    target.once('destroyed', cleanup)

    if (!target.isDevToolsOpened()) {
      target.openDevTools({ mode: 'detach', activate: true })
    }

    devToolsWindow.show()
    devToolsWindow.focus()
  }

  private async ensureAppProtocol(): Promise<void> {
    if (this.appProtocolRegistered) return

    const registered = protocol.registerBufferProtocol('app', (request, callback) => {
      const finalize = (statusCode: number, data: Buffer, filePath?: string) => {
        const headers = this.createRendererHeaders(filePath)
        callback({
          statusCode,
          headers,
          data,
          mimeType: filePath ? this.getMimeType(filePath) : undefined,
        })
      }

      void this.readRendererAsset(request.url)
        .then(({ data, filePath }) => {
          finalize(200, data, filePath)
        })
        .catch((error) => {
          console.warn('[WindowManager] Failed to load asset for app protocol', error)
          finalize(404, Buffer.from('Not Found', 'utf8'))
        })
    })

    if (!registered) {
      throw new Error('Failed to register app:// protocol handler')
    }

    this.appProtocolRegistered = true
  }

  private async readRendererAsset(requestUrl: string): Promise<{ data: Buffer; filePath: string }> {
    const url = new URL(requestUrl)
    let relativePath = decodeURIComponent(url.pathname)
    if (!relativePath || relativePath === '/') {
      relativePath = 'index.html'
    } else {
      relativePath = relativePath.replace(/^\/+/, '')
    }

    let resolvedPath = path.resolve(this.rendererDist, relativePath)
    if (!resolvedPath.startsWith(this.rendererDist + path.sep) && resolvedPath !== this.rendererDist) {
      throw new Error('Attempted to access file outside renderer dist')
    }

    try {
      const data = await fs.readFile(resolvedPath)
      return { data, filePath: resolvedPath }
    } catch (error) {
      const isHtmlRoute = !path.extname(resolvedPath)
      if (isHtmlRoute) {
        resolvedPath = path.resolve(this.rendererDist, 'index.html')
        const data = await fs.readFile(resolvedPath)
        return { data, filePath: resolvedPath }
      }
      throw error
    }
  }

  private createRendererHeaders(filePath?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }

    if (filePath) {
      headers['Content-Type'] = this.getMimeType(filePath)
    }

    return headers
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case '.html':
        return 'text/html'
      case '.js':
      case '.mjs':
        return 'text/javascript'
      case '.cjs':
        return 'application/javascript'
      case '.css':
        return 'text/css'
      case '.json':
        return 'application/json'
      case '.svg':
        return 'image/svg+xml'
      case '.png':
        return 'image/png'
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg'
      case '.gif':
        return 'image/gif'
      case '.webp':
        return 'image/webp'
      case '.ico':
        return 'image/x-icon'
      case '.woff':
        return 'font/woff'
      case '.woff2':
        return 'font/woff2'
      case '.txt':
        return 'text/plain'
      default:
        return 'application/octet-stream'
    }
  }
}
