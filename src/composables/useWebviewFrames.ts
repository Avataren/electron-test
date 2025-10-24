/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue'
import * as THREE from 'three'

// Inline type to avoid import issues
interface WebviewFrame {
  index: number
  buffer: Uint8Array
  size: { width: number; height: number }
}

export function useWebviewFrames(textures: THREE.Texture[]) {
  const urls = ref<string[]>([])

  const handleWebviewFrame = (_event: any, data: WebviewFrame) => {
    const { index, buffer } = data

    if (!textures[index]) return

    const blob = new Blob([buffer], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.onload = () => {
      // Only update texture when we have valid image data
      textures[index].image = img
      textures[index].needsUpdate = true
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      console.error(`Failed to load image for texture ${index}`)
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  const handleWebviewLoaded = (_event: any, data: { index: number; url: string }) => {
    console.log(`Webview ${data.index} loaded: ${data.url}`)
  }

  const loadUrls = async () => {
    urls.value = await window.ipcRenderer.invoke('get-webview-urls')
  }

  const setupListeners = () => {
    window.ipcRenderer.on('webview-frame', handleWebviewFrame)
    window.ipcRenderer.on('webview-loaded', handleWebviewLoaded)
  }

  const removeListeners = () => {
    window.ipcRenderer.off('webview-frame', handleWebviewFrame)
    window.ipcRenderer.off('webview-loaded', handleWebviewLoaded)
  }

  return {
    urls,
    loadUrls,
    setupListeners,
    removeListeners,
  }
}
