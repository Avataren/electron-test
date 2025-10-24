/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue'
import * as THREE from 'three'

// Inline type to avoid import issues
interface WebviewFrame {
  index: number
  buffer: Uint8Array
  size: { width: number; height: number }
}

export function useWebviewFrames(
  textures: THREE.Texture[],
  onTextureUpdate?: (index: number) => void,
) {
  const urls = ref<string[]>([])

  const handleWebviewFrame = (_event: any, data: WebviewFrame) => {
    const { index, buffer } = data

    const texture = textures[index]
    if (!texture) {
      console.warn(`Texture at index ${index} is undefined`)
      return
    }

    // Convert buffer to proper Uint8Array type for Blob
    const bufferArray = new Uint8Array(buffer)
    const blob = new Blob([bufferArray], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.onload = () => {
      // Only update texture when we have valid image data
      texture.image = img
      texture.needsUpdate = true
      URL.revokeObjectURL(url)

      // Notify that texture was updated
      if (onTextureUpdate) {
        onTextureUpdate(index)
      }
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
