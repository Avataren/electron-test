/* eslint-disable @typescript-eslint/no-require-imports */
const { ipcRenderer, contextBridge } = require('electron')

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (...args: any[]) => void) {
    return ipcRenderer.on(channel, (event: any, ...args: any[]) => listener(event, ...args))
  },
  off(channel: string, listener?: (...args: any[]) => void) {
    return ipcRenderer.off(channel, ...(listener ? [listener] : []))
  },
  send(channel: string, ...args: any[]) {
    return ipcRenderer.send(channel, ...args)
  },
  invoke(channel: string, ...args: any[]) {
    return ipcRenderer.invoke(channel, ...args)
  },
})

// Forward window.postMessage events (from webContents.postMessage) into the
// same ipcRenderer-style handlers exposed above. This allows the main
// process to use postMessage with transfer lists while renderer code can
// continue using `window.ipcRenderer.on(channel, handler)`.
window.addEventListener('message', (ev: any) => {
  try {
    const payload = (ev as any).data
    if (!payload) return

    // If webContents.postMessage was used the payload might be shaped as
    // { channel, message } or could be the message directly. Normalize it.
    const channel = payload.channel || 'webview-frame'
    const message = payload.message ?? payload

    // Re-emit via the underlying ipcRenderer so previously-registered
    // listeners (through contextBridge) receive the message.
    try {
      ipcRenderer.emit(channel, null, message)
    } catch (err) {
      // Best-effort: if emit fails, ignore.
      // eslint-disable-next-line no-console
      console.warn('[preload] failed to emit postMessage payload to ipcRenderer', err)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[preload] error handling postMessage event', err)
  }
})
