import type { IpcRenderer, IpcRendererEvent } from 'electron'

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

type SerializableConsoleArg =
  | string
  | {
      name: string
      message: string
      stack?: string
    }

type RendererErrorPayload =
  | {
      type: 'error'
      message: string
      source: string
      lineno: number
      colno: number
      stack: string | null
    }
  | {
      type: 'unhandledrejection'
      message: string
      stack: string | null
    }
  | {
      type: 'console-error'
      arguments: SerializableConsoleArg[]
    }

type IpcRendererListener = (event: IpcRendererEvent, ...args: unknown[]) => void

const handlers = new Map<string, Map<IpcRendererListener, IpcRendererListener>>()

const forwardRendererError = (payload: RendererErrorPayload) => {
  try {
    ipcRenderer.send('renderer-error', payload)
  } catch (err) {
    // Intentionally swallow errors to avoid recursive failure loops.
    console.debug('[preload] Failed to forward renderer error', err)
  }
}

const serializeArg = (arg: unknown): SerializableConsoleArg => {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    }
  }

  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg)
    } catch (_err) {
      return String(arg)
    }
  }

  return String(arg)
}

const exposedIpcRenderer: Pick<
  IpcRenderer,
  'on' | 'off' | 'send' | 'invoke'
> = {
  on(channel: string, listener: IpcRendererListener) {
    console.log('[preload] Registering handler for:', channel)
    if (!handlers.has(channel)) handlers.set(channel, new Map())
    const channelHandlers = handlers.get(channel)!
    const existingWrapper = channelHandlers.get(listener)
    if (existingWrapper) {
      ipcRenderer.off(channel, existingWrapper)
    }
    const wrapper: IpcRendererListener = (event, ...args) => listener(event, ...args)
    channelHandlers.set(listener, wrapper)
    return ipcRenderer.on(channel, wrapper)
  },
  off(channel: string, listener?: IpcRendererListener) {
    if (listener) {
      const channelHandlers = handlers.get(channel)
      const wrapper = channelHandlers?.get(listener)
      if (channelHandlers) {
        channelHandlers.delete(listener)
        if (channelHandlers.size === 0) handlers.delete(channel)
      }
      if (wrapper) {
        return ipcRenderer.off(channel, wrapper)
      }
      return ipcRenderer
    }

    const channelHandlers = handlers.get(channel)
    if (channelHandlers) {
      channelHandlers.clear()
      handlers.delete(channel)
    }
    ipcRenderer.removeAllListeners(channel)
    return ipcRenderer
  },
  send(channel: string, ...args: unknown[]) {
    ipcRenderer.send(channel, ...args)
  },
  invoke(channel: string, ...args: unknown[]) {
    return ipcRenderer.invoke(channel, ...args)
  },
}

contextBridge.exposeInMainWorld('ipcRenderer', exposedIpcRenderer)

window.addEventListener('error', (event) => {
  forwardRendererError({
    type: 'error',
    message: event.message,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack ?? null,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { message?: string; stack?: string } | string | undefined
  const stack =
    typeof reason === 'object' && reason !== null
      ? reason.stack ?? null
      : null
  forwardRendererError({
    type: 'unhandledrejection',
    message:
      (typeof reason === 'object' && reason?.message) ||
      (typeof reason === 'string' ? reason : undefined) ||
      'Unhandled promise rejection',
    stack,
  })
})

const originalConsoleError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  forwardRendererError({
    type: 'console-error',
    arguments: args.map(serializeArg),
  })
  originalConsoleError(...args)
}

window.addEventListener('message', (ev: MessageEvent<{ channel?: string; message?: unknown } | undefined>) => {
  console.log('[preload] Received message event:', ev.data ? 'has data' : 'no data')
  const data = ev.data
  if (!data) return
  const channel = data.channel || 'webview-frame'
  const msg = data.message ?? data
  console.log(
    '[preload] Forwarding to channel:',
    channel,
    'handlers:',
    handlers.has(channel) ? handlers.get(channel)!.size : 0,
  )
  const registered = handlers.get(channel)
  if (registered) {
    registered.forEach((_wrapper, originalListener) => originalListener({} as IpcRendererEvent, msg))
  }
})

console.log('[preload] Initialized')
