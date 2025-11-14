/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue'
import * as THREE from 'three'

// Inline type to avoid import issues
interface WebviewFrame {
  index: number
  buffer: ArrayBuffer | Uint8Array
  size?: {
    width: number          // CSS/logical width
    height: number         // CSS/logical height
    backingWidth?: number  // Physical pixel width (optional)
    backingHeight?: number // Physical pixel height (optional)
  }
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
  type IncomingFrame = WebviewFrame & { format?: string }

  const pendingFrames = new Map<number, IncomingFrame>()
  const pendingFrameRafs = new Map<number, number>()
  const frameStatsLogged = new Set<number>()

  // Lightweight per-index fingerprint of the last applied frame. This lets
  // callers wait for a short period of visual stability before using the
  // texture in a transition.
  type FrameFingerprint = {
    width: number
    height: number
    checksum: number
    updatedAt: number
    hashHi: number
    hashLo: number
  }
  const frameFingerprints = new Map<number, FrameFingerprint>()

  // Compute a simple 64-bit average hash (aHash) over an 8x8 grid by sampling
  // one pixel per cell. Returns two 32-bit parts {hi, lo}.
  const computeAhash64BGRA = (src: Uint8Array, width: number, height: number) => {
    const cols = 8, rows = 8
    const stepX = Math.max(1, Math.floor(width / cols))
    const stepY = Math.max(1, Math.floor(height / rows))
    const samples: number[] = new Array(cols * rows)
    let k = 0
    for (let ry = 0; ry < rows; ry++) {
      const y = Math.min(height - 1, Math.floor(ry * stepY + stepY / 2))
      for (let cx = 0; cx < cols; cx++) {
        const x = Math.min(width - 1, Math.floor(cx * stepX + stepX / 2))
        const idx = (y * width + x) * 4
        const b = src[idx + 0] || 0
        const g = src[idx + 1] || 0
        const r = src[idx + 2] || 0
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0
        samples[k++] = lum
      }
    }
    let avg = 0
    for (let i = 0; i < samples.length; i++) avg += samples[i]
    avg = Math.max(1, Math.floor(avg / samples.length))
    let hi = 0 >>> 0
    let lo = 0 >>> 0
    for (let i = 0; i < samples.length; i++) {
      const bit = samples[i] > avg ? 1 : 0
      if (i < 32) {
        hi = ((hi << 1) | bit) >>> 0
      } else {
        lo = ((lo << 1) | bit) >>> 0
      }
    }
    return { hi, lo }
  }

  const computeAhash64RGBA = (src: Uint8Array, width: number, height: number) => {
    const cols = 8, rows = 8
    const stepX = Math.max(1, Math.floor(width / cols))
    const stepY = Math.max(1, Math.floor(height / rows))
    const samples: number[] = new Array(cols * rows)
    let k = 0
    for (let ry = 0; ry < rows; ry++) {
      const y = Math.min(height - 1, Math.floor(ry * stepY + stepY / 2))
      for (let cx = 0; cx < cols; cx++) {
        const x = Math.min(width - 1, Math.floor(cx * stepX + stepX / 2))
        const idx = (y * width + x) * 4
        const r = src[idx + 0] || 0
        const g = src[idx + 1] || 0
        const b = src[idx + 2] || 0
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0
        samples[k++] = lum
      }
    }
    let avg = 0
    for (let i = 0; i < samples.length; i++) avg += samples[i]
    avg = Math.max(1, Math.floor(avg / samples.length))
    let hi = 0 >>> 0
    let lo = 0 >>> 0
    for (let i = 0; i < samples.length; i++) {
      const bit = samples[i] > avg ? 1 : 0
      if (i < 32) {
        hi = ((hi << 1) | bit) >>> 0
      } else {
        lo = ((lo << 1) | bit) >>> 0
      }
    }
    return { hi, lo }
  }

  // Historically we cloned incoming buffers to decouple lifetimes.
  // With SAB/transfer support and one-RAF queuing, we can safely
  // reuse the provided ArrayBuffer/Uint8Array without copying.
  const cloneToUint8Array = (buffer: ArrayBuffer | Uint8Array) => {
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  }

  const logFrameStats = (
    index: number,
    srcArr: Uint8Array,
    reportedWidth: number,
    reportedHeight: number,
    format?: string,
  ) => {
    if (frameStatsLogged.has(index)) return
    frameStatsLogged.add(index)

    let min = 255
    let max = 0
    let sampleSum = 0
    let sampleCount = 0
    const stride = Math.max(1, Math.floor(srcArr.length / 4096))

    for (let i = 0; i < srcArr.length; i += stride) {
      const val: number = srcArr[i] ?? 0
      if (val < min) min = val
      if (val > max) max = val
      sampleSum += val
      sampleCount++
    }

    const avg = sampleCount > 0 ? Math.round(sampleSum / sampleCount) : 0
    const firstBytes = Array.from(srcArr.slice(0, 32))

    console.log(`[useWebviewFrames] 🔍 Frame stats for ${index}`, {
      format,
      length: srcArr.length,
      reportedWidth,
      reportedHeight,
      min,
      max,
      avg,
      firstBytes,
    })

    try {
      _win.ipcRenderer?.send('frame-stats', {
        index,
        format,
        length: srcArr.length,
        reportedWidth,
        reportedHeight,
        min,
        max,
        avg,
        firstBytes,
      })
    } catch (err) {
      console.debug('[useWebviewFrames] failed to send frame-stats to main process', err)
    }
  }

  const flushPendingFrame = (index: number) => {
    const frame = pendingFrames.get(index)
    if (!frame) return
    if (applyFrameToTexture(frame)) {
      pendingFrames.delete(index)
      pendingFrameRafs.delete(index)
    } else {
      schedulePendingFrame(index)
    }
  }

  const schedulePendingFrame = (index: number) => {
    const existing = pendingFrameRafs.get(index)
    if (typeof existing === 'number') {
      cancelAnimationFrame(existing)
    }
    const raf = window.requestAnimationFrame(() => flushPendingFrame(index))
    pendingFrameRafs.set(index, raf)
  }

  const ensureDataTexture = (
    texIndex: number,
    width: number,
    height: number,
  ): THREE.DataTexture => {
    const expectedLength = width * height * 4
    let target = textures[texIndex] as THREE.DataTexture | undefined

    const needsRebuild =
      !target ||
      !(target instanceof THREE.DataTexture) ||
      !(target.image && (target.image as any).data) ||
      Boolean(target.userData?.isPlaceholder) ||
      (target.image as any).width !== width ||
      (target.image as any).height !== height

    if (needsRebuild) {
      if (target) {
        try {
          target.dispose()
        } catch (err) {
          console.debug('[useWebviewFrames] Failed to dispose existing texture before rebuild', err)
        }
      }

      const data = new Uint8Array(expectedLength)
      const rebuilt = new THREE.DataTexture(
        data,
        width,
        height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      )
      rebuilt.minFilter = THREE.NearestFilter
      rebuilt.magFilter = THREE.NearestFilter
      rebuilt.generateMipmaps = false
      rebuilt.colorSpace = THREE.SRGBColorSpace
      rebuilt.flipY = true
      rebuilt.needsUpdate = false
      rebuilt.userData = rebuilt.userData || {}
      rebuilt.userData.isPlaceholder = false
      textures[texIndex] = rebuilt
      return rebuilt
    }

    const image = target.image as { data: Uint8Array; width: number; height: number }
    if (!(image.data instanceof Uint8Array) || image.data.length !== expectedLength) {
      image.data = new Uint8Array(expectedLength)
    }

    image.width = width
    image.height = height

    target.minFilter = THREE.NearestFilter
    target.magFilter = THREE.NearestFilter
    target.generateMipmaps = false
    target.colorSpace = THREE.SRGBColorSpace
    target.flipY = true
    target.userData = target.userData || {}
    target.userData.isPlaceholder = false

    return target
  }

  const writeBGRAIntoTexture = (
    texture: THREE.DataTexture,
    src: Uint8Array,
    forceOpaque = true,
    sampler?: { stride: number; sum: number; count: number }
  ): void => {
    const image = texture.image as { data: Uint8Array; width: number; height: number }
    const dest = image.data
    const pixelCount = image.width * image.height

    for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
      const bi = i * 4
      dest[j] = src[bi + 2] ?? 0
      dest[j + 1] = src[bi + 1] ?? 0
      dest[j + 2] = src[bi + 0] ?? 0
      dest[j + 3] = forceOpaque ? 255 : src[bi + 3] ?? 255

      if (sampler && sampler.stride > 0 && (i % sampler.stride) === 0) {
        // Use pre-conversion BGRA for checksum to avoid extra math; include alpha
        const b = src[bi + 0] ?? 0
        const g = src[bi + 1] ?? 0
        const r = src[bi + 2] ?? 0
        const a = forceOpaque ? 255 : (src[bi + 3] ?? 255)
        // Simple rolling sum; callers only use relative stability, not cryptographic integrity
        sampler.sum = (sampler.sum + r + g + b + a) >>> 0
        sampler.count++
      }
    }
  }

  const updateDebugPreview = (
    index: number,
    width: number,
    height: number,
    rgbaBuffer: Uint8Array,
  ) => {
    if (!_win.__debugFrames) return
    try {
      const clamped = new Uint8ClampedArray(rgbaBuffer.length)
      clamped.set(rgbaBuffer)
      const imageData = new ImageData(clamped, width, height)

      let preview = document.getElementById(`debug-frame-${index}`) as HTMLCanvasElement | null
      if (!preview) {
        preview = document.createElement('canvas')
        preview.id = `debug-frame-${index}`
        preview.style.position = 'fixed'
        preview.style.right = '20px'
        preview.style.zIndex = '9999'
        preview.style.border = '1px solid rgba(255,255,255,0.3)'
        preview.style.background = '#000'
        document.body.appendChild(preview)
      }

      preview.width = width
      preview.height = height
      const ctx = preview.getContext('2d')
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        ctx.putImageData(imageData, 0, 0)
      }

      const maxPreviewWidth = 320
      const aspect = width > 0 && height > 0 ? width / height : 1
      const displayWidth = Math.min(maxPreviewWidth, width)
      const displayHeight = Math.max(1, Math.round(displayWidth / aspect))
      preview.style.width = `${displayWidth}px`
      preview.style.height = `${displayHeight}px`
      preview.style.bottom = `${20 + index * (displayHeight + 12)}px`
    } catch (err) {
      console.debug('[useWebviewFrames] failed to update debug preview', err)
    }
  }

  const applyFrameToTexture = (data: IncomingFrame): boolean => {
    const { index, buffer, size, format } = data as any

    if (!textures[index]) {
      console.warn(`[useWebviewFrames] ⚠️ Texture ${index} not ready; queuing incoming frame`)
      return false
    }

    const getMaxTextureSize = () => {
      try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl')
        if (!gl) return 8192

        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
        return maxSize > 0 && maxSize <= 16384 ? maxSize : 8192
      } catch (err) {
        console.warn('Failed to get MAX_TEXTURE_SIZE, using default', err)
        return 8192
      }
    }

    const getSafeDimensions = (width: number, height: number) => {
      const maxSize = getMaxTextureSize()
      if (width <= maxSize && height <= maxSize) {
        return { width, height }
      }
      const scale = maxSize / Math.max(width, height)
      return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
      }
    }

    if (format === 'raw' || !format) {
      try {
        const reportedWidth = size?.width || 1
        const reportedHeight = size?.height || 1

        const srcArr = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
        const byteLength = srcArr.length
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        const reportedScale = (size as any)?.scaleFactor
        if (
          typeof reportedScale === 'number' && isFinite(reportedScale) &&
          Math.abs(reportedScale - dpr) > 0.01
        ) {
          console.warn('[useWebviewFrames] ⚠️ DPR mismatch: offscreen scale', reportedScale, 'renderer DPR', dpr)
        }

        logFrameStats(index, srcArr, reportedWidth, reportedHeight, format)

        let initialWidth = 0
        let initialHeight = 0

        // If backingWidth/backingHeight are provided, use them directly
        if (size?.backingWidth && size?.backingHeight) {
          console.log(`[useWebviewFrames] Using provided backing dimensions for ${index}: ${size.backingWidth}x${size.backingHeight}`)
          initialWidth = size.backingWidth
          initialHeight = size.backingHeight

          // Verify the dimensions match the buffer size
          const expectedBytes = initialWidth * initialHeight * 4
          if (byteLength !== expectedBytes) {
            console.warn(`[useWebviewFrames] ⚠️  Buffer size mismatch for ${index}: expected ${expectedBytes} bytes, got ${byteLength}`)
            // Try to infer correct dimensions as fallback
            const inferredHeight = Math.max(1, Math.round(byteLength / (initialWidth * 4)))
            if (inferredHeight * initialWidth * 4 === byteLength) {
              console.warn(`[useWebviewFrames] Using inferred height: ${inferredHeight}`)
              initialHeight = inferredHeight
            }
          }
        } else {
          // Fallback to old inference logic when backing dimensions not provided
          const reportedBytes = reportedWidth * reportedHeight * 4
          const dprWidth = Math.max(1, Math.round(reportedWidth * dpr))
          const dprHeight = Math.max(1, Math.round(reportedHeight * dpr))
          const dprBytes = dprWidth * dprHeight * 4

          if (byteLength === reportedBytes) {
            initialWidth = reportedWidth
            initialHeight = reportedHeight
          } else if (byteLength === dprBytes) {
            initialWidth = dprWidth
            initialHeight = dprHeight
          } else {
            const inferredHeight = Math.max(1, Math.round(byteLength / (reportedWidth * 4)))
            if (inferredHeight * reportedWidth * 4 === byteLength) {
              initialWidth = reportedWidth
              initialHeight = inferredHeight
            } else {
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
              return true
            }
          }
        }

        const { width: pageWidth, height: pageHeight } = getSafeDimensions(
          initialWidth,
          initialHeight,
        )

        const dataTexture = ensureDataTexture(index, pageWidth, pageHeight)
        // Subsample roughly ~2k pixels for a quick checksum
        const sample = { stride: Math.max(1, Math.floor((pageWidth * pageHeight) / 2048)), sum: 0, count: 0 }
        writeBGRAIntoTexture(dataTexture, srcArr, true, sample)
        dataTexture.needsUpdate = true

        // Use reported CSS dimensions when backing dimensions are provided
        // Otherwise calculate from DPI as before
        let cssWidth: number
        let cssHeight: number

        if (size?.backingWidth && size?.backingHeight) {
          // Use the explicitly provided CSS dimensions
          cssWidth = reportedWidth
          cssHeight = reportedHeight
          console.log(`[useWebviewFrames] Texture ${index} applied: CSS ${cssWidth}x${cssHeight}, backing ${pageWidth}x${pageHeight}`)
        } else {
          // Fallback to old calculation
          const dprBytes = Math.max(1, Math.round(reportedWidth * dpr)) * Math.max(1, Math.round(reportedHeight * dpr)) * 4
          cssWidth = byteLength === dprBytes ? Math.max(1, Math.round(pageWidth / dpr)) : pageWidth
          cssHeight = byteLength === dprBytes ? Math.max(1, Math.round(pageHeight / dpr)) : pageHeight
        }

        if (onTextureUpdate) {
          onTextureUpdate(index, {
            width: cssWidth,
            height: cssHeight,
            backingWidth: pageWidth,
            backingHeight: pageHeight,
          })
        }

        try {
          _win.ipcRenderer?.send('texture-applied', {
            index,
            format,
            width: cssWidth,
            height: cssHeight,
            backingWidth: pageWidth,
            backingHeight: pageHeight,
          })
        } catch (err) {
          console.debug('[useWebviewFrames] failed to send texture-applied event', err)
        }

        try {
          if (!_win.__initialAckSent) _win.__initialAckSent = new Set<number>()
          if (!_win.__initialAckSent.has(index)) {
            _win.__initialAckSent.add(index)
            _win.ipcRenderer.send('initial-frame-ack', { index })
          }
        } catch (err) {
          console.debug('[useWebviewFrames] failed to send initial-frame-ack', err)
        }

        // Update per-index fingerprint for stability checks (checksum + aHash64)
        try {
          const checksum = (sample.sum ^ (pageWidth << 12) ^ pageHeight) >>> 0
          const { hi, lo } = computeAhash64BGRA(srcArr, pageWidth, pageHeight)
          frameFingerprints.set(index, {
            width: pageWidth,
            height: pageHeight,
            checksum,
            updatedAt: Date.now(),
            hashHi: hi >>> 0,
            hashLo: lo >>> 0,
          })
        } catch {}

        const image = dataTexture.image as { data: Uint8Array }
        updateDebugPreview(index, pageWidth, pageHeight, image.data)
      } catch (err) {
        console.error(`[useWebviewFrames] ❌ Error processing raw frame for ${index}:`, err)
        return true
      }

      return true
    }

    console.log(`[useWebviewFrames] 🖼️ Processing encoded image for ${index}`)
    const bufferArray = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    const blob = new Blob([bufferArray], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.onload = () => {
      try {
        const intrinsicWidth = img.naturalWidth || img.width
        const intrinsicHeight = img.naturalHeight || img.height

        let targetWidth = size?.width || intrinsicWidth
        let targetHeight = size?.height || intrinsicHeight

        const { width: safeWidth, height: safeHeight } = getSafeDimensions(
          targetWidth,
          targetHeight,
        )

        if (safeWidth !== targetWidth || safeHeight !== targetHeight) {
          console.warn('[useWebviewFrames] Scaling texture to safe dimensions', {
            original: { width: targetWidth, height: targetHeight },
            safe: { width: safeWidth, height: safeHeight },
          })
        }

        targetWidth = safeWidth
        targetHeight = safeHeight

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          console.error('[useWebviewFrames] Unable to obtain 2D context for encoded frame')
          URL.revokeObjectURL(url)
          return
        }

        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, targetWidth, targetHeight)
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight)
        const dataTexture = ensureDataTexture(index, targetWidth, targetHeight)
        const image = dataTexture.image as { data: Uint8Array }
        image.data.set(imageData.data)
        dataTexture.needsUpdate = true

        if (onTextureUpdate) {
          onTextureUpdate(index, {
            width: targetWidth,
            height: targetHeight,
            backingWidth: targetWidth,
            backingHeight: targetHeight,
          })
        }

        try {
          _win.ipcRenderer?.send('texture-applied', {
            index,
            format: 'jpeg',
            width: targetWidth,
            height: targetHeight,
            backingWidth: targetWidth,
            backingHeight: targetHeight,
          })
        } catch (err) {
          console.debug('[useWebviewFrames] failed to send texture-applied event (encoded path)', err)
        }

        // Update fingerprint for encoded path too (subsample RGBA data)
        try {
          const pxCount = targetWidth * targetHeight
          const stride = Math.max(1, Math.floor(pxCount / 2048))
          let sum = 0
          let cnt = 0
          for (let i = 0; i < pxCount; i += stride) {
            const j = i * 4
            sum = (sum + image.data[j] + image.data[j + 1] + image.data[j + 2] + image.data[j + 3]) >>> 0
            cnt++
          }
          const checksum = (sum ^ (targetWidth << 12) ^ targetHeight) >>> 0
          const { hi, lo } = computeAhash64RGBA(image.data, targetWidth, targetHeight)
          frameFingerprints.set(index, {
            width: targetWidth,
            height: targetHeight,
            checksum,
            updatedAt: Date.now(),
            hashHi: hi >>> 0,
            hashLo: lo >>> 0,
          })
        } catch {}

        updateDebugPreview(index, targetWidth, targetHeight, image.data)
      } catch (err) {
        console.error('Error updating texture from webview frame', err)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      console.error(`Failed to load image for texture ${index}`)
      URL.revokeObjectURL(url)
    }
    img.src = url
    return true
  }

  const handleWebviewFrame = (_event: any, data: IncomingFrame) => {
    if (applyFrameToTexture(data)) {
      return
    }

    try {
      const clonedSize = data.size ? { ...data.size } : undefined
      // Avoid copying the large pixel buffer; retain the provided view.
      const queued: IncomingFrame = {
        index: data.index,
        buffer: data.buffer,
        size: clonedSize,
        format: (data as any).format,
      }
      pendingFrames.set(data.index, queued)
      schedulePendingFrame(data.index)
    } catch (err) {
      console.error('[useWebviewFrames] Failed to queue pending frame', err)
    }
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
    applyFrameToTexture,
    getFrameFingerprint: (index: number) => frameFingerprints.get(index),
  }
}
