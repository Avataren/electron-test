import { BrowserWindow } from 'electron'
import type { AppConfig } from '../config'
import { WindowManager } from './WindowManager'

export class OffscreenRenderer {
  private readonly windows: Map<number, BrowserWindow> = new Map()
  private readonly config: AppConfig
  private readonly windowManager: WindowManager
  private readonly paintingEnabled: Set<number> = new Set()
  // Track whether the renderer has acknowledged the first applied frame
  private readonly acknowledgedFirstFrame: Map<number, boolean> = new Map()
  // Track whether we're waiting for the initial ack for an index
  private readonly waitingForAck: Map<number, boolean> = new Map()
  // Track last send timestamp per index (ms)
  private readonly lastSentAt: Map<number, number> = new Map()
  // Pending frame per index (coalesce rapid paint events)
  private readonly pendingFrames: Map<
    number,
    { buffer: Buffer; size: { width: number; height: number } }
  > = new Map()
  // Per-index send timers to schedule next allowed send
  private readonly sendTimers: Map<number, NodeJS.Timeout> = new Map()
  // Initial ACK timeouts per index
  private readonly initialAckTimeouts: Map<number, NodeJS.Timeout> = new Map()
  // How long to wait for an initial-frame ACK before sending a fallback (ms)
  private readonly initialAckTimeoutMs = 4000
  // Track whether SharedArrayBuffer delivery is blocked so we avoid repeated errors
  private sharedBufferDeliveryBlocked = false
  // Track whether ArrayBuffer transfer lists fail so we fall back to IPC send directly
  private arrayBufferPostMessageBlocked = false

  constructor(config: AppConfig, windowManager: WindowManager) {
    this.config = config
    this.windowManager = windowManager
  }

  // Called by IPC handler when renderer confirms it applied the initial frame
  handleInitialAck(index: number): void {
    this.acknowledgedFirstFrame.set(index, true)
    this.waitingForAck.delete(index)
    console.info(`[OffscreenRenderer] received initial-frame ACK for ${index}`)
    // Clear timeout if one exists
    const t = this.initialAckTimeouts.get(index)
    if (t) {
      clearTimeout(t)
      this.initialAckTimeouts.delete(index)
    }

    if (this.pendingFrames.has(index)) {
      // Flush any pending frame that accumulated while waiting for the ACK
      this.scheduleFrameSend(index, true)
    }
  }

  createOffscreenWindows(urls: string[]): void {
    urls.forEach((url, index) => {
      const offscreenWin = new BrowserWindow({
        width: this.config.window.width,
        height: this.config.window.height,
        show: false,
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      offscreenWin.loadURL(url)
      this.windows.set(index, offscreenWin)

      this.setupPaintHandler(offscreenWin, index)
      this.setupLoadHandlers(offscreenWin, index, url)

      // Only enable painting for the first window initially
      if (index === 0) {
        this.enablePainting(index)
      }
    })
  }

  private setupPaintHandler(window: BrowserWindow, index: number): void {
    window.webContents.on('paint', (event, dirty, image) => {
      // Only send frames if painting is enabled for this window
      if (!this.paintingEnabled.has(index)) return

      // Send raw bitmap data (BGRA) to the renderer so we can avoid
      // lossy JPEG encoding and retain exact pixel data and dimensions.
      // NativeImage.toBitmap returns a Buffer with BGRA order.
      const bitmap: Buffer = image.toBitmap()
      const size = image.getSize()
      // Debug logs: include index, reported size, and bitmap byte length so
      // we can diagnose DPR/backing-store mismatches and GPU copy errors.
      try {
        // Coalesce: store latest frame as pending and schedule a send that
        // respects the configured frameRate. This prevents flooding the
        // renderer/IPC with every paint event which can starve texture
        // application.
        this.pendingFrames.set(index, { buffer: Buffer.from(bitmap), size })

        this.scheduleFrameSend(index, true)
      } catch (err) {
        console.error('[OffscreenRenderer] Failed to forward paint frame', { index, err })
      }
    })
  }

  private sendFrame(
    index: number,
    frame: { buffer: Buffer; size: { width: number; height: number } },
    keepPending: boolean,
  ): boolean {
    const supportsSAB = typeof SharedArrayBuffer === 'function' && !this.sharedBufferDeliveryBlocked

    if (supportsSAB) {
      try {
        const shared = this.writeFrameToSharedBuffer(index, frame)
        const sabMessage = {
          index,
          buffer: shared,
          size: frame.size,
          format: 'sabs' as const,
          byteLength: shared.byteLength,
          timestamp: Date.now(),
        }

        const posted = this.windowManager.postMessageToRenderer('webview-frame', sabMessage)

        if (posted) {
          if (!keepPending) {
            this.pendingFrames.delete(index)
          }

          return true
        }

        console.warn(
          '[OffscreenRenderer] postMessage rejected SharedArrayBuffer payload, falling back to ArrayBuffer',
          { index },
        )
        this.sharedBufferDeliveryBlocked = true
      } catch (err) {
        if (!this.sharedBufferDeliveryBlocked) {
          console.warn('[OffscreenRenderer] failed to send SharedArrayBuffer frame, falling back', {
            index,
            err,
          })
          this.sharedBufferDeliveryBlocked = true
        }
      }
    }

    const timestamp = Date.now()
    const fallbackPayload = {
      index,
      size: frame.size,
      format: 'raw' as const,
      timestamp,
    }

    let ab: ArrayBuffer | null = null
    try {
      ab = frame.buffer.buffer.slice(
        frame.buffer.byteOffset,
        frame.buffer.byteOffset + frame.buffer.byteLength,
      )
    } catch (err) {
      console.error('[OffscreenRenderer] failed to extract ArrayBuffer from frame buffer', { index, err })
      ab = null
    }

    if (!ab) {
      return false
    }

    let posted = false

    if (!this.arrayBufferPostMessageBlocked) {
      try {
        posted = this.windowManager.postMessageToRenderer('webview-frame', {
          ...fallbackPayload,
          buffer: ab,
        })

        if (!posted && !this.arrayBufferPostMessageBlocked) {
          console.warn(
            '[OffscreenRenderer] postMessage rejected ArrayBuffer payload, falling back to ipc send',
            { index },
          )
          this.arrayBufferPostMessageBlocked = true
        }
      } catch (err) {
        if (!this.arrayBufferPostMessageBlocked) {
          console.warn('[OffscreenRenderer] failed to send ArrayBuffer frame, falling back to ipc send', {
            index,
            err,
          })
          this.arrayBufferPostMessageBlocked = true
        }
      }
    }

    if (!posted) {
      const uintView = new Uint8Array(ab)
      this.windowManager.sendToRenderer('webview-frame', {
        index,
        buffer: uintView,
        size: frame.size,
        format: 'raw' as const,
        timestamp: fallbackPayload.timestamp,
      })
    }

    if (!keepPending) {
      this.pendingFrames.delete(index)
    }
    return true
  }

  private scheduleFrameSend(index: number, immediate: boolean): void {
    const pending = this.pendingFrames.get(index)
    if (!pending) return

    const existingTimer = this.sendTimers.get(index)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.sendTimers.delete(index)
    }

    if (immediate) {
      this.dispatchFrame(index)
      return
    }

    const frameRate = this.config.rendering.frameRate || 30
    const minInterval = Math.max(0, Math.floor(1000 / frameRate))

    const timer = setTimeout(() => {
      this.sendTimers.delete(index)
      this.dispatchFrame(index)
    }, minInterval)

    this.sendTimers.set(index, timer)
  }

  private dispatchFrame(index: number): void {
    const pending = this.pendingFrames.get(index)
    if (!pending) return

    const hasAck = !!this.acknowledgedFirstFrame.get(index)
    const waiting = !!this.waitingForAck.get(index)

    if (!hasAck) {
      if (waiting) {
        return
      }

      const sent = this.sendFrame(index, pending, true)
      if (sent) {
        this.waitingForAck.set(index, true)
        this.lastSentAt.set(index, Date.now())
        console.info(`[OffscreenRenderer] sent initial frame for ${index}, awaiting ACK`)
        this.startInitialAckTimeout(index)
      }
      return
    }

    const frameRate = this.config.rendering.frameRate || 30
    const minInterval = Math.max(0, Math.floor(1000 / frameRate))
    const last = this.lastSentAt.get(index) || 0
    const now = Date.now()
    const elapsed = now - last

    if (elapsed < minInterval) {
      const delay = minInterval - elapsed
      const timer = setTimeout(() => {
        this.sendTimers.delete(index)
        this.dispatchFrame(index)
      }, delay)
      this.sendTimers.set(index, timer)
      return
    }

    if (this.sendFrame(index, pending, false)) {
      this.lastSentAt.set(index, now)
    }
  }

  private startInitialAckTimeout(index: number): void {
    try {
      const existing = this.initialAckTimeouts.get(index)
      if (existing) {
        clearTimeout(existing)
      }

      const timer = setTimeout(() => {
        if (this.waitingForAck.get(index)) {
          console.warn(
            `[OffscreenRenderer] initial-frame ACK timeout for ${index}, sending fallback frame`,
          )
          this.waitingForAck.delete(index)
          this.acknowledgedFirstFrame.set(index, true)

          try {
            const fallback = Buffer.from([255, 255, 255, 255])
            const frame = { buffer: fallback, size: { width: 1, height: 1 } }
            this.sendFrame(index, frame, true)
            this.windowManager.sendToRenderer('webview-load-timeout', { index })
          } catch (err) {
            console.error('[OffscreenRenderer] failed to send fallback frame after timeout', err)
          }

          if (this.pendingFrames.has(index)) {
            this.scheduleFrameSend(index, true)
          }
        }

        this.initialAckTimeouts.delete(index)
      }, this.initialAckTimeoutMs)

      this.initialAckTimeouts.set(index, timer)
    } catch (err) {
      console.warn('[OffscreenRenderer] failed to schedule initial ACK timeout', err)
    }
  }

  private setupLoadHandlers(window: BrowserWindow, index: number, url: string): void {
    window.webContents.on('did-finish-load', () => {
      console.log(`Offscreen window ${index} loaded: ${url}`)
      this.windowManager.sendToRenderer('webview-loaded', { index, url })
    })

    window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`Offscreen window ${index} failed to load: ${errorDescription}`)
    })
  }

  enablePainting(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed() && !this.paintingEnabled.has(index)) {
      // Ensure the renderer sees the very first paint event by marking this
      // window as painting-enabled immediately. Any paint event that fires
      // while setFrameRate is being applied will now be captured and queued
      // by the paint handler instead of being dropped outright.
      this.paintingEnabled.add(index)

      try {
        window.webContents.setFrameRate(this.config.rendering.frameRate)
      } catch (err) {
        console.warn('[OffscreenRenderer] setFrameRate failed on enable', { index, err })
      }

      // We still keep a short delay before logging so that downstream
      // observers have a moment to prepare, but the window is already marked
      // as painting-enabled to avoid skipping the initial frame.
      setTimeout(() => {
        console.log(`Enabled painting for window ${index}`)
      }, 60)
    }
  }

  disablePainting(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed() && this.paintingEnabled.has(index)) {
      this.paintingEnabled.delete(index)
      window.webContents.setFrameRate(0) // Stop painting
      console.log(`Disabled painting for window ${index}`)
    }
  }

  setActivePaintingWindows(indices: number[]): void {
    // Disable all
    this.windows.forEach((_, index) => {
      if (!indices.includes(index)) {
        this.disablePainting(index)
      }
    })

    // Enable only specified indices
    indices.forEach((index) => {
      this.enablePainting(index)
    })
  }

  reload(index: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      window.webContents.reload()
    }
  }

  /**
   * Resize a specific offscreen window. Width/height should be in device
   * pixels (DIP). This triggers a repaint at the new size which will be
   * emitted via the 'paint' event.
   */
  resize(index: number, width: number, height: number): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      console.info(`[OffscreenRenderer] resize window ${index} -> ${width}x${height}`)
      window.setSize(width, height)
    }
  }

  /** Resize all offscreen windows to the provided dimensions. */
  resizeAll(width: number, height: number): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        console.info(`[OffscreenRenderer] resizeAll -> ${width}x${height}`)
        win.setSize(width, height)
      }
    })
  }

  /** Resize only the provided indices. */
  resizeIndices(indices: number[], width: number, height: number): void {
    indices.forEach((i) => {
      const win = this.windows.get(i)
      if (win && !win.isDestroyed()) {
        console.info(`[OffscreenRenderer] resizeIndices - window ${i} -> ${width}x${height}`)
        win.setSize(width, height)
      }
    })
  }

  navigate(index: number, url: string): void {
    const window = this.windows.get(index)
    if (window && !window.isDestroyed()) {
      window.loadURL(url)
    }
  }

  cleanup(): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    })
    this.windows.clear()
    this.paintingEnabled.clear()
    this.pendingFrames.clear()
    this.acknowledgedFirstFrame.clear()
    this.waitingForAck.clear()
    this.lastSentAt.clear()

    this.sendTimers.forEach((timer) => clearTimeout(timer))
    this.sendTimers.clear()

    this.initialAckTimeouts.forEach((timer) => clearTimeout(timer))
    this.initialAckTimeouts.clear()
    this.arrayBufferPostMessageBlocked = false
  }

  getWindows(): Map<number, BrowserWindow> {
    return this.windows
  }
}
