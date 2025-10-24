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
  // called with index and the reported page size {width,height}
  onTextureUpdate?: (index: number, size?: { width: number; height: number }) => void,
) {
  const urls = ref<string[]>([])

  const handleWebviewFrame = (_event: any, data: WebviewFrame) => {
    const { index, buffer, size } = data

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
      try {
        // Create a canvas exactly the size of the webpage to ensure the
        // texture has the same dimensions as the source page.
        const pageWidth = size?.width || img.naturalWidth || img.width
        const pageHeight = size?.height || img.naturalHeight || img.height

        const canvas = document.createElement('canvas')
        canvas.width = pageWidth
        canvas.height = pageHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          // Draw the loaded image into the canvas at full size
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          // Assign the canvas as the texture image so the texture has exact page dims
          texture.image = canvas as any
        } else {
          // Fallback: use the Image directly
          texture.image = img as any
        }

        // Use nearest filtering to keep pixels exact and disable mipmaps
        texture.minFilter = THREE.NearestFilter
        texture.magFilter = THREE.NearestFilter
        texture.generateMipmaps = false
        texture.needsUpdate = true

        URL.revokeObjectURL(url)

        // Notify that texture was updated and provide page size
        if (onTextureUpdate) {
          onTextureUpdate(index, { width: pageWidth, height: pageHeight })
        }
      } catch (err) {
        console.error('Error updating texture from webview frame', err)
        URL.revokeObjectURL(url)
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
