import { describe, expect, it, beforeEach, vi } from 'vitest'

type Listener = (...args: any[]) => void
type Rect = { x: number; y: number; width: number; height: number }
type Size = { width: number; height: number }

class SimpleEventEmitter {
  private listeners = new Map<string | symbol, Set<Listener>>()

  on(event: string | symbol, listener: Listener): this {
    const existing = this.listeners.get(event)
    if (existing) {
      existing.add(listener)
    } else {
      this.listeners.set(event, new Set([listener]))
    }
    return this
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      this.removeListener(event, wrapper)
      listener(...args)
    }
    return this.on(event, wrapper)
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    const listeners = this.listeners.get(event)
    if (!listeners || listeners.size === 0) {
      return false
    }
    for (const listener of Array.from(listeners)) {
      listener(...args)
    }
    return true
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(event)
      }
    }
    return this
  }
}

class FakeDevToolsWindow {
  private bounds: Rect

  constructor(bounds: Rect) {
    this.bounds = bounds
  }

  getBounds(): Rect {
    return this.bounds
  }

  setBounds(bounds: Rect): void {
    this.bounds = bounds
  }
}

class FakeDevToolsWebContents extends SimpleEventEmitter {
  private ownerWindow: FakeDevToolsWindow | null = null

  getPreferredSize(): Size {
    const bounds = this.ownerWindow?.getBounds()
    return bounds
      ? { width: bounds.width, height: bounds.height }
      : { width: 0, height: 0 }
  }

  getOwnerBrowserWindow(): FakeDevToolsWindow | null {
    return this.ownerWindow
  }

  setOwnerBrowserWindow(window: FakeDevToolsWindow | null): void {
    this.ownerWindow = window
  }
}

class FakeViewWebContents extends SimpleEventEmitter {
  private devtoolsOpen = false
  public devToolsWebContents: FakeDevToolsWebContents | null

  constructor(devToolsWebContents: FakeDevToolsWebContents | null) {
    super()
    this.devToolsWebContents = devToolsWebContents
  }

  loadURL(): void {
    // no-op for tests
  }

  openDevTools(): void {
    this.devtoolsOpen = true
  }

  isDevToolsOpened(): boolean {
    return this.devtoolsOpen
  }
}

class FakeBrowserView {
  static instances: FakeBrowserView[] = []
  public webContents: FakeViewWebContents
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(devToolsWebContents: FakeDevToolsWebContents | null = null) {
    this.webContents = new FakeViewWebContents(devToolsWebContents)
    FakeBrowserView.instances.push(this)
  }

  setBounds(bounds: Rect): void {
    this.bounds = bounds
  }

  getBounds(): Rect {
    return this.bounds
  }

  setBackgroundColor(): void {
    // no-op
  }

  setAutoResize(): void {
    // no-op
  }
}

class FakeMainWebContents extends SimpleEventEmitter {
  public devToolsWebContents: FakeDevToolsWebContents | null = null
  private devToolsOpen = false

  constructor(devToolsWebContents: FakeDevToolsWebContents | null) {
    super()
    this.devToolsWebContents = devToolsWebContents
  }

  override emit(eventName: string | symbol, ...args: any[]): boolean {
    if (eventName === 'devtools-opened') {
      this.devToolsOpen = true
    } else if (eventName === 'devtools-closed') {
      this.devToolsOpen = false
    }
    return super.emit(eventName, ...args)
  }

  openDevTools(): void {
    // no-op
  }

  isDevToolsOpened(): boolean {
    return this.devToolsOpen
  }
}

class FakeBrowserWindow extends SimpleEventEmitter {
  public webContents: FakeMainWebContents
  private contentBounds: Rect
  private bounds: Rect
  private destroyed = false

  constructor(
    bounds: Rect,
    devToolsWebContents: FakeDevToolsWebContents | null,
  ) {
    super()
    this.contentBounds = { ...bounds }
    this.bounds = { ...bounds }
    this.webContents = new FakeMainWebContents(devToolsWebContents)
  }

  addBrowserView(): void {
    // no-op for tests
  }

  removeBrowserView(): void {
    // no-op for tests
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
  }

  getContentBounds(): Rect {
    return { ...this.contentBounds }
  }

  setContentBounds(bounds: Rect): void {
    this.contentBounds = { ...bounds }
  }

  getBounds(): Rect {
    return { ...this.bounds }
  }

  setBounds(bounds: Rect): void {
    this.bounds = { ...bounds }
  }
}

vi.mock('electron', () => ({
  BrowserView: class {
    public inner: FakeBrowserView

    constructor(..._args: any[]) {
      this.inner = new FakeBrowserView()
      return this.inner as unknown as any
    }
  },
  BrowserWindow: class {},
}))

import { ViewManager } from './ViewManager'
import type { AppConfig } from '../config'

describe('ViewManager devtools handling', () => {
  beforeEach(() => {
    FakeBrowserView.instances = []
  })

  it('resizes BrowserViews when docked devtools consume window space', () => {
  const config: AppConfig = {
    urls: ['https://example.com'],
    window: { width: 800, height: 600, controlBarHeight: 0 },
    timing: { rotationInterval: 10000, refreshInterval: 60000, transitionDuration: 300 },
    rendering: { frameRate: 30, jpegQuality: 0.8 },
    transitions: [],
  }


    const devToolsContents = new FakeDevToolsWebContents()
    const mainBounds = { x: 0, y: 0, width: 1000, height: 800 }
    const mainWindow = new FakeBrowserWindow(mainBounds, devToolsContents)

    const manager = new ViewManager(config)
    manager.setMainWindow(mainWindow as unknown as Electron.BrowserWindow)

    // Use the real BrowserView class from the module (which is mocked above)
    manager.createViews(config.urls)

    const createdView = FakeBrowserView.instances[0]
    expect(createdView.getBounds()).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
    })

    const devToolsWindow = new FakeDevToolsWindow({
      x: 0,
      y: 600,
      width: 1000,
      height: 200,
    })
    devToolsContents.setOwnerBrowserWindow(devToolsWindow)

    mainWindow.webContents.emit('devtools-opened')

    expect(createdView.getBounds()).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 500,
    })

    mainWindow.webContents.emit('devtools-closed')

    expect(createdView.getBounds()).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
    })
  })
})
