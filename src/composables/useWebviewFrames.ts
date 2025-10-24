/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue'
import * as THREE from 'three'

// Inline type to avoid import issues
interface WebviewFrame {
  index: number
  buffer: Uint8Array
  size: { width: number; height: number }
}

// Shape reported to onTextureUpdate: include both logical (css) and backing sizes
export interface TextureUpdateSize {
  width: number // CSS/logical width
  height: number // CSS/logical height
  backingWidth?: number // backing/device pixel width (optional)
  backingHeight?: number // backing/device pixel height (optional)
}

export function useWebviewFrames(
  textures: THREE.Texture[],
  // called with index and the reported page size (css/backing)
  onTextureUpdate?: (index: number, size?: TextureUpdateSize) => void,
) {
  const urls = ref<string[]>([])
  const _win: any = window

  const handleWebviewFrame = (_event: any, data: WebviewFrame & { format?: string }) => {
    const { index, buffer, size, format } = data as any

    // ENHANCED DEBUG: Show incoming IPC payload shape
    try {
      const approxLen = (buffer && ((buffer as any).byteLength || (buffer as any).length)) || 0
      console.log(`[useWebviewFrames] 📥 Received frame ${index}:`, {
        format,
        bufferBytes: approxLen,
        reportedSize: size,
        bufferType: Object.prototype.toString.call(buffer)
      })
    } catch (err) {
      console.error('[useWebviewFrames] Failed to inspect buffer:', err)
    }

    const texture = textures[index]
    if (!texture) {
      console.error(`❌ Texture at index ${index} is undefined`)
      return
    }

    // Helper function to get maximum texture size
    const getMaxTextureSize = () => {
      try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl')
        if (!gl) return 8192

        // Get max size and validate it's reasonable
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
        return maxSize > 0 && maxSize <= 16384 ? maxSize : 8192
      } catch (err) {
        console.warn('Failed to get MAX_TEXTURE_SIZE, using default', err)
        return 8192
      }
    }

    // Helper function to calculate safe dimensions
    const getSafeDimensions = (width: number, height: number) => {
      const maxSize = getMaxTextureSize()
      if (width <= maxSize && height <= maxSize) {
        return { width, height }
      }
      const scale = maxSize / Math.max(width, height)
      return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale))
      }
    }

    // If the main process sent raw pixel data (Buffer), convert BGRA -> RGBA
    if (format === 'sabs' || format === 'raw') {
      try {
        console.log(`[useWebviewFrames] 🎨 Processing raw/sabs frame for index ${index}`)

        const reportedWidth = size?.width || 1
        const reportedHeight = size?.height || 1

        const srcArr = format === 'sabs' ? new Uint8Array(buffer as SharedArrayBuffer) : new Uint8Array(buffer)
        const byteLength = srcArr.length

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

        const reportedBytes = reportedWidth * reportedHeight * 4
        const dprWidth = Math.max(1, Math.round(reportedWidth * dpr))
        const dprHeight = Math.max(1, Math.round(reportedHeight * dpr))
        const dprBytes = dprWidth * dprHeight * 4

        // Determine initial dimensions based on buffer size
        let initialDims = { width: 0, height: 0 }
        if (byteLength === reportedBytes) {
          initialDims = { width: reportedWidth, height: reportedHeight }
          console.log(`[useWebviewFrames] ✓ Buffer matches CSS size for ${index}:`, initialDims)
        } else if (byteLength === dprBytes) {
          initialDims = { width: dprWidth, height: dprHeight }
          console.log(`[useWebviewFrames] ✓ Buffer matches DPR size for ${index}:`, initialDims, `(dpr=${dpr})`)
        } else {
          // Unknown sizing: try to infer width from reportedWidth and buffer size
          const inferredHeight = Math.max(1, Math.round(byteLength / (reportedWidth * 4)))
          if (inferredHeight * reportedWidth * 4 === byteLength) {
            initialDims = { width: reportedWidth, height: inferredHeight }
            console.warn(`[useWebviewFrames] ⚠️ Inferred size for ${index}:`, initialDims)
          } else {
            console.error(`[useWebviewFrames] ❌ Ignoring frame ${index} - size mismatch:`, {
              reportedWidth,
              reportedHeight,
              reportedBytes,
              dprBytes,
              actualBytes: byteLength,
              dpr
            })
            try {
              _win.ipcRenderer?.send('frame-rejected', {
                index,
                reportedWidth,
                reportedHeight,
                byteLength,
                dpr,
              })
            } catch (err) {
              console.debug('[useWebviewFrames] failed to send frame-rejected ipc', err)
            }
            return
          }
        }

        // Get safe dimensions that respect GPU limits
        const { width: pageWidth, height: pageHeight } = getSafeDimensions(initialDims.width, initialDims.height)
        console.log(`[useWebviewFrames] 🖼️ Creating canvas for ${index}: ${pageWidth}x${pageHeight}`)

        const canvas = document.createElement('canvas')
        canvas.width = pageWidth
        canvas.height = pageHeight
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          console.error('❌ 2D context not available for canvas')
          return
        }

        const pixelCount = pageWidth * pageHeight
        const out = new Uint8ClampedArray(pixelCount * 4)

        // Convert BGRA -> RGBA
        console.log(`[useWebviewFrames] 🔄 Converting BGRA to RGBA for ${index}...`)
        for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
          const bi = i * 4
          const b = srcArr[bi + 0] ?? 0
          const g = srcArr[bi + 1] ?? 0
          const r = srcArr[bi + 2] ?? 0
          const a = srcArr[bi + 3] ?? 255
          out[j] = r
          out[j + 1] = g
          out[j + 2] = b
          out[j + 3] = a
        }

        let imageData: ImageData
        if (typeof ImageData !== 'undefined') {
          imageData = new ImageData(out, pageWidth, pageHeight)
        } else {
          imageData = { data: out, width: pageWidth, height: pageHeight } as unknown as ImageData
        }

        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.putImageData(imageData, 0, 0)

        console.log(`[useWebviewFrames] ✏️ Drew image data to canvas for ${index}`)

        // Setup texture properties first
        texture.minFilter = THREE.NearestFilter
        texture.magFilter = THREE.NearestFilter
        texture.generateMipmaps = false

        // Handle texture resizing if needed
        if (texture.image) {
          const oldImage = texture.image as HTMLCanvasElement
          if (oldImage.width !== canvas.width || oldImage.height !== canvas.height) {
            console.log(`[useWebviewFrames] 🔄 Resizing texture ${index} from ${oldImage.width}x${oldImage.height} to ${canvas.width}x${canvas.height}`)
            texture.dispose()
          }
        }

        // Assign the canvas
        texture.image = canvas as any
        console.log(`[useWebviewFrames] ✅ Assigned canvas to texture ${index}`)

        // Ensure dimensions are correct
        if (texture.source?.data) {
          texture.source.data.width = canvas.width
          texture.source.data.height = canvas.height
        }

        // Mark for update
        texture.needsUpdate = true
        console.log(`[useWebviewFrames] 🔔 Set needsUpdate=true for texture ${index}`)

        if (onTextureUpdate) {
          // Report both CSS/logical pixel dimensions and backing/device dimensions
          const cssWidth = byteLength === dprBytes ? Math.max(1, Math.round(pageWidth / dpr)) : pageWidth
          const cssHeight = byteLength === dprBytes ? Math.max(1, Math.round(pageHeight / dpr)) : pageHeight
          console.log(`[useWebviewFrames] 📞 Calling onTextureUpdate for ${index}:`, {
            cssWidth,
            cssHeight,
            backingWidth: pageWidth,
            backingHeight: pageHeight
          })
          onTextureUpdate(index, { width: cssWidth, height: cssHeight, backingWidth: pageWidth, backingHeight: pageHeight })

          // Send initial-frame ACK
          try {
            if (!_win.__initialAckSent) _win.__initialAckSent = new Set<number>()
            if (!_win.__initialAckSent.has(index)) {
              _win.__initialAckSent.add(index)
              _win.ipcRenderer.send('initial-frame-ack', { index })
              console.log(`[useWebviewFrames] 📤 Sent initial-frame-ack for ${index}`)
            }
          } catch (err) {
            console.debug('[useWebviewFrames] failed to send initial-frame-ack', err)
          }
        }
      } catch (err) {
        console.error(`[useWebviewFrames] ❌ Error processing raw frame for ${index}:`, err)
      }

      return
    }

    // Fallback: treat buffer as an encoded image (jpeg/png)
    console.log(`[useWebviewFrames] 🖼️ Processing encoded image for ${index}`)
    const bufferArray = new Uint8Array(buffer)
    const blob = new Blob([bufferArray], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.onload = () => {
      try {
        let pageWidth = size?.width || img.naturalWidth || img.width
        let pageHeight = size?.height || img.naturalHeight || img.height

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

        // Get safe dimensions that respect GPU limits
        const { width: safeWidth, height: safeHeight } = getSafeDimensions(pageWidth, pageHeight)

        // Only scale if dimensions changed
        if (safeWidth !== pageWidth || safeHeight !== pageHeight) {
          console.warn('[useWebviewFrames] Scaling texture to safe dimensions', {
            original: { width: pageWidth, height: pageHeight },
            safe: { width: safeWidth, height: safeHeight }
          })

          const safeCanvas = document.createElement('canvas')
          safeCanvas.width = safeWidth
          safeCanvas.height = safeHeight
          const safeCtx = safeCanvas.getContext('2d')

          if (safeCtx && ctx) {
            safeCtx.imageSmoothingEnabled = false
            safeCtx.clearRect(0, 0, safeWidth, safeHeight)
            safeCtx.drawImage(canvas, 0, 0, safeWidth, safeHeight)

            canvas.width = safeWidth
            canvas.height = safeHeight
            ctx.imageSmoothingEnabled = false
            ctx.clearRect(0, 0, safeWidth, safeHeight)
            ctx.drawImage(safeCanvas, 0, 0)

            pageWidth = safeWidth
            pageHeight = safeHeight
          }
        }

        texture.minFilter = THREE.NearestFilter
        texture.magFilter = THREE.NearestFilter
        texture.generateMipmaps = false
        texture.needsUpdate = true

        URL.revokeObjectURL(url)

        if (onTextureUpdate) {
          onTextureUpdate(index, { width: pageWidth, height: pageHeight, backingWidth: pageWidth, backingHeight: pageHeight })
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
    urls.value = await _win.ipcRenderer.invoke('get-webview-urls')
  }

  const setupListeners = () => {
    _win.ipcRenderer.on('webview-frame', handleWebviewFrame)
    _win.ipcRenderer.on('webview-loaded', handleWebviewLoaded)
  }

  const removeListeners = () => {
    _win.ipcRenderer.off('webview-frame', handleWebviewFrame)
    _win.ipcRenderer.off('webview-loaded', handleWebviewLoaded)
  }

  return {
    urls,
    loadUrls,
    setupListeners,
    removeListeners,
  }
}
