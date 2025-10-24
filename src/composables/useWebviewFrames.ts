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

  const handleWebviewFrame = (_event: any, data: WebviewFrame & { format?: string }) => {
    const { index, buffer, size, format } = data as any

    const texture = textures[index]
    if (!texture) {
      console.warn(`Texture at index ${index} is undefined`)
      return
    }

    // If the main process sent raw pixel data (Buffer), convert BGRA -> RGBA and
    // place into a canvas via putImageData. This avoids JPEG decoding and
    // preserves exact pixels and dimensions. If it sent a SharedArrayBuffer
    // (format === 'sabs') we can read directly from it without extra copy.
    if (format === 'sabs' || format === 'raw') {
      try {
        const pageWidth = size?.width || 1
        const pageHeight = size?.height || 1
        const canvas = document.createElement('canvas')
        canvas.width = pageWidth
        canvas.height = pageHeight
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          console.error('2D context not available for canvas')
          return
        }

        // Convert Buffer/Uint8Array (BGRA) or SharedArrayBuffer (BGRA) to Uint8ClampedArray (RGBA)
        const src = format === 'sabs' ? new Uint8Array(buffer as SharedArrayBuffer) : new Uint8Array(buffer)
        const pixelCount = pageWidth * pageHeight
        const out = new Uint8ClampedArray(pixelCount * 4)

        // BGRA -> RGBA
        for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
          const bi = i * 4
          const b = src[bi + 0] ?? 0
          const g = src[bi + 1] ?? 0
          const r = src[bi + 2] ?? 0
          const a = src[bi + 3] ?? 255
          out[j] = r
          out[j + 1] = g
          out[j + 2] = b
          out[j + 3] = a
        }

  const imageData = new ImageData(out, pageWidth, pageHeight)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.putImageData(imageData, 0, 0)

  // Assign the canvas directly (no further copies)
  texture.image = canvas as any
        texture.minFilter = THREE.NearestFilter
        texture.magFilter = THREE.NearestFilter
        texture.generateMipmaps = false
        texture.needsUpdate = true

        if (onTextureUpdate) {
          onTextureUpdate(index, { width: pageWidth, height: pageHeight })
        }
      } catch (err) {
        console.error('Error updating texture from raw webview frame', err)
      }

      return
    }

    // Fallback: treat buffer as an encoded image (jpeg/png)
    const bufferArray = new Uint8Array(buffer)
    const blob = new Blob([bufferArray], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.onload = () => {
      try {
        const pageWidth = size?.width || img.naturalWidth || img.width
        const pageHeight = size?.height || img.naturalHeight || img.height

        const canvas = document.createElement('canvas')
        canvas.width = pageWidth
        canvas.height = pageHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          texture.image = canvas as any
        } else {
          texture.image = img as any
        }

        texture.minFilter = THREE.NearestFilter
        texture.magFilter = THREE.NearestFilter
        texture.generateMipmaps = false
        texture.needsUpdate = true

        URL.revokeObjectURL(url)

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
