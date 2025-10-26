const { ipcRenderer, contextBridge } = require('electron')

const handlers = new Map()

const forwardRendererError = (payload) => {
  try {
    ipcRenderer.send('renderer-error', payload)
  } catch (err) {
    // Intentionally swallow errors to avoid recursive failure loops.
  }
}

const serializeArg = (arg) => {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    }
  }

  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg)
    } catch (_err) {
      return String(arg)
    }
  }

  return String(arg)
}

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel, listener) {
    console.log('[preload] Registering handler for:', channel)
    if (!handlers.has(channel)) handlers.set(channel, new Set())
    handlers.get(channel).add(listener)
    return ipcRenderer.on(channel, (e, ...args) => listener(e, ...args))
  },
  off(channel, listener) {
    if (listener && handlers.has(channel)) handlers.get(channel).delete(listener)
    return ipcRenderer.off(channel, listener || undefined)
  },
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
})

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
  const reason = event.reason
  forwardRendererError({
    type: 'unhandledrejection',
    message:
      (reason && reason.message) ||
      (typeof reason === 'string' ? reason : undefined) ||
      'Unhandled promise rejection',
    stack: reason && reason.stack ? reason.stack : null,
  })
})

const originalConsoleError = console.error.bind(console)
console.error = (...args) => {
  forwardRendererError({
    type: 'console-error',
    arguments: args.map(serializeArg),
  })
  originalConsoleError(...args)
}

window.addEventListener('message', (ev) => {
  console.log('[preload] Received message event:', ev.data ? 'has data' : 'no data')
  const data = ev.data
  if (!data) return
  const channel = data.channel || 'webview-frame'
  const msg = data.message ?? data
  console.log('[preload] Forwarding to channel:', channel, 'handlers:', handlers.has(channel) ? handlers.get(channel).size : 0)
  const h = handlers.get(channel)
  if (h) h.forEach(fn => fn(null, msg))
})

console.log('[preload] Initialized')
