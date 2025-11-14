<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { useWebviewStore } from '../stores/modules/webview'
import { useThreeScene } from '../composables/useThreeScene'
import { useWebviewFrames } from '../composables/useWebviewFrames'
import { useRotationTimer } from '../composables/useRotationTimer'
import { TransitionManager } from '../transitions/TransitionManager'
import type { TransitionType } from '../types'
import { calculatePlaneSize } from '../utils/geometry'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const store = useWebviewStore()
const loadedTextures = ref<Set<number>>(new Set())
const allTexturesLoaded = ref(false)
const loadingProgress = ref(0)
const textureUpdateTimestamps = ref<Map<number, number>>(new Map())
const isInitialLoading = ref(true) // NEW: Track if we're in initial loading phase
const showCanvas = ref(false)
const performanceMode = ref(false)

interface TransitionConfig {
  name: string
  enabled: boolean
}

const transitionConfig = ref<TransitionConfig[]>([])

const planes: THREE.Mesh[] = []
const textures: THREE.Texture[] = []
let transitionManager: TransitionManager | null = null
const win: any = window
let renderStatCounter = 0
let animationFrameId: number | null = null
let needsRender = false
// Resize overlay state to prevent visible BrowserView flicker during window resize
let resizeOverlayActive = false
let resizeSettleTimer: number | null = null

// Default transition duration if none provided by main (seconds)
let transitionDurationSeconds = 1

const transitionsEnabled = true

const { scene, camera, renderer, initScene, onResize, dispose, FRUSTUM_HEIGHT, DISTANCE } =
  useThreeScene(canvasRef)

const pageAspect = ref<number | null>(null)

  const { urls, loadUrls, setupListeners, removeListeners, applyFrameToTexture, getFrameFingerprint } = useWebviewFrames(
  textures,
  async (index: number, size?: { width: number; height: number; backingWidth?: number; backingHeight?: number }) => {
    // Update timestamp when texture receives new frame
    textureUpdateTimestamps.value.set(index, Date.now())

    const texture = textures[index]
    const plane = planes[index]
    if (plane && texture && plane.material instanceof THREE.MeshBasicMaterial) {
      plane.material.map = texture
      plane.material.needsUpdate = true
      plane.visible = plane.visible || index === store.currentIndex
      scheduleRender()

      const image = texture.image as { width?: number; height?: number } | undefined
      try {
        win.ipcRenderer?.send('plane-state', {
          index,
          currentIndex: store.currentIndex,
          visible: plane.visible,
          setupMode: store.setupMode,
          allTexturesLoaded: allTexturesLoaded.value,
          materialHasMap: Boolean(plane.material.map),
          textureNeedsUpdate: texture.needsUpdate,
          imageWidth: image?.width ?? null,
          imageHeight: image?.height ?? null,
        })
      } catch (err) {
        console.debug('[Threewebview] failed to send plane-state', err)
      }
    }

    // FIXED: Mark texture as loaded when we receive first frame (during initial loading)
    if (isInitialLoading.value && !store.setupMode && !loadedTextures.value.has(index)) {
      console.log(`✅ Texture ${index} received first frame and applied to THREE.Texture`)

      // DEBUG: Verify texture actually has an image
      const tex = textures[index]
      if (tex && tex.image) {
        const img = tex.image as HTMLCanvasElement
        console.log(`   → Texture ${index} image: ${img.width}x${img.height}`)
        console.log(`   → Texture ${index} needsUpdate: ${tex.needsUpdate}`)
      } else {
        console.error(`   ❌ Texture ${index} has no image despite being marked loaded!`)
      }

      loadedTextures.value.add(index)
      checkAllTexturesLoaded()
      // Continue to skip resize operations during initial loading
      return
    }

    // Skip resize operations during initial loading to prevent interrupting texture load
    if (isInitialLoading.value) {
      console.debug('[Threewebview] Skipping resize during initial loading', { index })
      return
    }

    // If we have a reported page size, compute its aspect and ensure planes
    // and planeConfig match that aspect. Update whenever the reported page
    // aspect changes significantly so the final rendered plane always maps
    // 1:1 with the source.
    if (size && camera.value && planes.length > 0) {
      const reportedAspect = size.width / size.height

      // If the backing/device size exceeds GPU max texture size, request a
      // capped resize from the main process to avoid GL copy/overflow errors.
      try {
        const dpr = window.devicePixelRatio || 1
        const backingW = size.backingWidth ?? Math.max(1, Math.round(size.width * dpr))
        const backingH = size.backingHeight ?? Math.max(1, Math.round(size.height * dpr))
        const maxTex = renderer.value?.capabilities?.maxTextureSize || 8192
        if (backingW > maxTex || backingH > maxTex) {
          console.warn('[Threewebview] backing size exceeds GPU maxTextureSize, requesting capped resize', { index, backingW, backingH, maxTex })

          const scale = maxTex / Math.max(backingW, backingH)
          const targetBackingW = Math.max(1, Math.floor(backingW * scale))
          const targetBackingH = Math.max(1, Math.floor(backingH * scale))
          const cssTargetW = Math.max(1, Math.round(targetBackingW / dpr))
          const cssTargetH = Math.max(1, Math.round(targetBackingH / dpr))

          const active = [
            store.currentIndex,
            (store.currentIndex + 1) % planes.length,
            (store.currentIndex + 2) % planes.length,
          ]

          // Disable painting for the active set while we resize their backing
          // surfaces to avoid races and GL copy overflows.
          await disablePaintingForIndices(active)
          await window.ipcRenderer.invoke('resize-active-offscreen-windows', active, cssTargetW, cssTargetH)
          // Re-enable painting and allow a short warmup for paints to begin.
          await enablePaintingForIndices(active)
          await new Promise((res) => setTimeout(res, 200))

          // Skip applying this frame — a new correctly-sized frame should arrive.
          return
        }
      } catch (err) {
        console.warn('[Threewebview] Failed to check/cap backing size', err)
      }

      // Update if we haven't sized yet or aspect changed by more than 0.5%
      const shouldUpdate =
        !pageAspect.value || Math.abs((reportedAspect - pageAspect.value) / (pageAspect.value || 1)) > 0.005

      if (shouldUpdate) {
        pageAspect.value = reportedAspect

        const aspect = window.innerWidth / window.innerHeight
        const newPlaneConfig = calculatePlaneSize(
          {
            frustumHeight: FRUSTUM_HEIGHT,
            distance: DISTANCE,
            aspect: aspect,
          },
          pageAspect.value,
        )

        planes.forEach((plane) => {
          plane.geometry.dispose()
          plane.geometry = new THREE.PlaneGeometry(newPlaneConfig.width, newPlaneConfig.height)
        })

        if (transitionManager) {
          transitionManager.updatePlaneConfig(newPlaneConfig)
        }

        // If not transitioning, ensure only the active plane is visible to
        // avoid double images when sizes change (maximize/restore races).
        if (!store.isTransitioning) {
          planes.forEach((plane, i) => {
            plane.visible = i === store.currentIndex
          })
        }

        scheduleRender()
      }
    }
  },
)

const showSetupView = async (index: number) => {
  store.setSetupIndex(index)
  if (performanceMode.value) {
    // In performance mode we only have a single BrowserView.
    // Navigate that view to the selected URL for login/setup.
    const targetUrl = urls.value?.[index]
    if (typeof targetUrl === 'string') {
      await window.ipcRenderer.invoke('navigate-browser-view', 0, targetUrl)
      await window.ipcRenderer.invoke('show-browser-view', 0)
    }
    return
  }
  await window.ipcRenderer.invoke('show-setup-view', index)
}

const showBrowserView = async (index: number) => {
  try {
    await window.ipcRenderer.invoke('show-browser-view', index)
  } catch (err) {
    console.warn('[Threewebview] Failed to show browser view', err)
  }
}

const hideBrowserViews = async () => {
  try {
    await window.ipcRenderer.invoke('hide-browser-views')
  } catch (err) {
    console.warn('[Threewebview] Failed to hide browser views', err)
  }
}

const nextSetupPage = () => {
  const nextIdx = (store.setupIndex + 1) % urls.value.length
  showSetupView(nextIdx)
}

const prevSetupPage = () => {
  const prevIdx = (store.setupIndex - 1 + urls.value.length) % urls.value.length
  showSetupView(prevIdx)
}

const finishSetup = async () => {
  store.setSetupMode(false)
  // Reset loading state
  loadedTextures.value.clear()
  allTexturesLoaded.value = false
  loadingProgress.value = 0
  isInitialLoading.value = true // FIXED: Reset initial loading flag
  await window.ipcRenderer.invoke('finish-setup')
  if (performanceMode.value) {
    // Nothing else to do; the main process will continue showing the single view
    // and we'll just rotate by navigating it.
    await showBrowserView(0)
  } else {
    void showBrowserView(store.currentIndex)
    scheduleRender()
  }
}

const createPlanes = () => {
  if (!scene.value || !camera.value) return

  const aspect = window.innerWidth / window.innerHeight
  const planeConfig = calculatePlaneSize({
    frustumHeight: FRUSTUM_HEIGHT,
    distance: DISTANCE,
    aspect: aspect,
  })

 const planeGeometry = new THREE.PlaneGeometry(planeConfig.width, planeConfig.height)

  urls.value.forEach((_, index) => {
    // Seed texture with opaque pixel data (DataTexture avoids canvas upload races).
    const placeholderData = new Uint8Array([0, 0, 0, 255])
    const texture = new THREE.DataTexture(
      placeholderData,
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = true
    texture.needsUpdate = true
    texture.userData.isPlaceholder = true
    textures.push(texture)

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    const plane = new THREE.Mesh(planeGeometry, material)
    plane.position.set(0, 0, 0)
    plane.renderOrder = index
    plane.visible = index === 0

    planes.push(plane)
    scene.value?.add(plane)
  })

  transitionManager = transitionsEnabled
    ? new TransitionManager(
        scene.value,
        textures,
        planeConfig,
        transitionConfig.value,
        transitionDurationSeconds,
      )
    : null
  console.log(`[Threewebview] Transition duration (s): ${transitionDurationSeconds}`)

  scheduleRender()
}

// const validateTextureSize = (width: number, height: number, maxSize: number) => {
//   if (width > maxSize || height > maxSize) {
//     const scale = maxSize / Math.max(width, height)
//     return {
//       width: Math.max(1, Math.floor(width * scale)),
//       height: Math.max(1, Math.floor(height * scale))
//     }
//   }
//   return { width, height }
// }

// Track if resize operation is in progress
const isResizing = ref(false)

const handleResize = async () => {
  console.log(`[Threewebview] ==================== RESIZE EVENT ====================`)
  console.log(`[Threewebview] Window size: ${window.innerWidth}x${window.innerHeight}`)
  console.log(`[Threewebview] isResizing: ${isResizing.value}, isTransitioning: ${store.isTransitioning}, isInitialLoading: ${isInitialLoading.value}`)

  // Prevent concurrent resize operations
  if (isResizing.value || store.isTransitioning || isInitialLoading.value) {
    console.log('[Threewebview] ⚠️  SKIPPING RESIZE: ' +
      (isResizing.value ? 'resize in progress' :
       store.isTransitioning ? 'transition in progress' :
       'initial loading in progress'))
    return
  }

  isResizing.value = true

  // Show a stable canvas overlay and hide BrowserViews while resizing to
  // prevent rapid page flicker. Overlay is removed after resize settles.
  try {
    if (!resizeOverlayActive && !store.setupMode) {
      resizeOverlayActive = true
      // Ensure current plane is visible under the overlay
      planes.forEach((plane, i) => (plane.visible = i === store.currentIndex))
      showCanvas.value = true
      if (renderer.value && scene.value && camera.value) {
        renderer.value.render(scene.value, camera.value)
      }
      await hideBrowserViews()
    }
  } catch (err) {
    console.warn('[Threewebview] Failed to activate resize overlay', err)
  }

  try {
    const newPlaneConfig = onResize(pageAspect.value ?? undefined)
    if (!newPlaneConfig) {
      console.log('[Threewebview] ⚠️  onResize returned null')
      return
    }

    console.log(`[Threewebview] Resize: New plane config ${newPlaneConfig.width.toFixed(2)}x${newPlaneConfig.height.toFixed(2)}`)
    if (renderer.value) {
      console.log(`[Threewebview] Renderer after onResize: ${renderer.value.domElement.width}x${renderer.value.domElement.height}`)
    }

    planes.forEach((plane) => {
      plane.geometry.dispose()
      plane.geometry = new THREE.PlaneGeometry(newPlaneConfig.width, newPlaneConfig.height)
    })

    if (transitionManager) {
      transitionManager.updatePlaneConfig(newPlaneConfig)
    }

    // Do NOT attach BrowserViews during resize (prevents visible flicker).
    // Offscreen windows are resized in main and will stream new frames
    // that update DataTextures via webview-frame events.
    // Force a render so the resized planes/camera are shown immediately,
    // and rely on incoming frames to refine texture resolution.
    textures.forEach((texture) => {
      texture.needsUpdate = true
    })
  } catch (err) {
    console.error('[Threewebview] Fatal resize error:', err)
  } finally {
    isResizing.value = false
    scheduleRender()

    // Debounce removal of the overlay until resize settles
    if (resizeSettleTimer) {
      clearTimeout(resizeSettleTimer)
    }
    resizeSettleTimer = window.setTimeout(async () => {
      try {
        await showBrowserView(store.currentIndex)
        await new Promise((r) => setTimeout(r, 64))
      } catch (err) {
        console.warn('[Threewebview] Failed restoring BrowserView after resize', err)
      } finally {
        showCanvas.value = false
        resizeOverlayActive = false
      }
    }, 200)
  }
}

function runRenderLoop() {
  animationFrameId = null

  let shouldContinue = false

  if (transitionManager && transitionManager.hasActiveTransition()) {
    shouldContinue = true
    const isComplete = transitionManager.update()
    needsRender = true
    if (isComplete) {
      console.log(
        `Transition complete. Current: ${store.currentIndex}. Offscreen painting remains disabled until next capture.`,
      )
    }
  }

  const hasRenderContext = Boolean(renderer.value && scene.value && camera.value)

  if (needsRender && hasRenderContext) {
    try {
      renderer.value!.render(scene.value!, camera.value!)
      renderStatCounter++
      if (renderStatCounter === 1 || renderStatCounter % 60 === 0) {
        const info = renderer.value!.info
        try {
          win.ipcRenderer?.send('render-stats', {
            frame: Date.now(),
            renderCalls: info.render.calls,
            renderTriangles: info.render.triangles,
            renderLines: info.render.lines,
            renderPoints: info.render.points,
            memoryGeometries: info.memory.geometries,
            memoryTextures: info.memory.textures,
            sceneChildren: scene.value!.children.length,
            setupMode: store.setupMode,
            allTexturesLoaded: allTexturesLoaded.value,
          })
        } catch (err) {
          console.debug('[Threewebview] failed to send render-stats', err)
        }
      }
      needsRender = false
    } catch (err) {
      console.error('[Threewebview] WebGL render error — will continue animation loop', err)
    }
  }

  if (!hasRenderContext) {
    shouldContinue = true
  }

  if (shouldContinue || needsRender) {
    animationFrameId = requestAnimationFrame(runRenderLoop)
  }
}

const scheduleRender = () => {
  needsRender = true
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(runRenderLoop)
  }
}

const disablePaintingForIndices = async (indices: number[]) => {
  // Disable painting individually to avoid races while resizing the backing
  // surface. We call disable for each index and wait for the main process
  // to stop painting before resizing.
  for (const idx of indices) {
    try {
      await window.ipcRenderer.invoke('disable-painting', idx)
      console.info(`[Threewebview] disabled painting for window ${idx}`)
    } catch (err) {
      console.warn(`[Threewebview] failed to disable painting for ${idx}`, err)
    }
  }
}

const enablePaintingForIndices = async (indices: number[]) => {
  for (const idx of indices) {
    try {
      await window.ipcRenderer.invoke('enable-painting', idx)
      console.info(`[Threewebview] enabled painting for window ${idx}`)
    } catch (err) {
      console.warn(`[Threewebview] failed to enable painting for ${idx}`, err)
    }
  }
}

const waitForTextureUpdates = async (
  indices: number[],
  previousTimestamps: Map<number, number>,
  timeoutMs = 3000,
  pollIntervalMs = 30,
) => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const allUpdated = indices.every((index) => {
      const prev = previousTimestamps.get(index) ?? 0
      const current = textureUpdateTimestamps.value.get(index) ?? 0
      return current > prev
    })

    if (allUpdated) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return false
}

// Wait until pages produce a couple of similar consecutive frames after being enabled,
// indicating the UI has largely settled (fonts loaded, widgets sized, etc.).
const waitForStableFrames = async (
  indices: number[],
  baselineTimestamps?: Map<number, number>,
  {
    timeoutMs = 2000,
    pollIntervalMs = 60,
    minStableFrames = 3,
    checksumEpsilon = 1500,
    maxHamming = 6,
    requireNewFrames = true,
  }: { timeoutMs?: number; pollIntervalMs?: number; minStableFrames?: number; checksumEpsilon?: number; maxHamming?: number; requireNewFrames?: boolean } = {}
) => {
  const start = Date.now()
  const stableCounts = new Map<number, number>()
  const lastFp = new Map<number, { w: number; h: number; sum: number; hi: number; lo: number }>()

  const popcount32 = (x: number) => {
    x >>>= 0
    let c = 0
    while (x) {
      c += x & 1
      x >>>= 1
    }
    return c
  }
  const hamming64 = (aHi: number, aLo: number, bHi: number, bLo: number) => {
    const xHi = (aHi ^ bHi) >>> 0
    const xLo = (aLo ^ bLo) >>> 0
    return popcount32(xHi) + popcount32(xLo)
  }

  while (Date.now() - start < timeoutMs) {
    let allStable = true
    for (const idx of indices) {
      const fp = getFrameFingerprint(idx)
      if (!fp) {
        allStable = false
        continue
      }
      // Require that the fingerprint reflects a frame newer than when we enabled
      // painting for this index (prevents instantly declaring stability using stale frames).
      if (requireNewFrames) {
        const baseTs = baselineTimestamps?.get(idx) ?? start
        if (!fp.updatedAt || fp.updatedAt <= baseTs) {
          allStable = false
          continue
        }
      }
      const prev = lastFp.get(idx)
      if (!prev) {
        lastFp.set(idx, { w: fp.width, h: fp.height, sum: fp.checksum, hi: fp.hashHi, lo: fp.hashLo })
        stableCounts.set(idx, 0)
        allStable = false
      } else {
        const sameDims = prev.w === fp.width && prev.h === fp.height
        const closeSum = Math.abs((fp.checksum >>> 0) - (prev.sum >>> 0)) <= checksumEpsilon
        const ham = hamming64(prev.hi >>> 0, prev.lo >>> 0, fp.hashHi >>> 0, fp.hashLo >>> 0)
        if (sameDims && closeSum && ham <= maxHamming) {
          const c = (stableCounts.get(idx) || 0) + 1
          stableCounts.set(idx, c)
        } else {
          lastFp.set(idx, { w: fp.width, h: fp.height, sum: fp.checksum, hi: fp.hashHi, lo: fp.hashLo })
          stableCounts.set(idx, 0)
          allStable = false
        }
      }
    }

    if (allStable && indices.every((i) => (stableCounts.get(i) || 0) >= minStableFrames)) {
      return true
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return false
}

// Compute a simple 64-bit aHash over BGRA pixels
function computeAhash64BGRA(buf: Uint8Array, width: number, height: number) {
  const cols = 8
  const rows = 8
  const stepX = Math.max(1, Math.floor(width / cols))
  const stepY = Math.max(1, Math.floor(height / rows))
  const samples: number[] = new Array(cols * rows)
  let k = 0
  for (let ry = 0; ry < rows; ry++) {
    const y = Math.min(height - 1, Math.floor(ry * stepY + stepY / 2))
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.min(width - 1, Math.floor(cx * stepX + stepX / 2))
      const idx = (y * width + x) * 4
      const b = buf[idx + 0] || 0
      const g = buf[idx + 1] || 0
      const r = buf[idx + 2] || 0
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
    if (i < 32) hi = ((hi << 1) | bit) >>> 0
    else lo = ((lo << 1) | bit) >>> 0
  }
  return { hi, lo }
}

function hamming64(aHi: number, aLo: number, bHi: number, bLo: number) {
  const popcount32 = (x: number) => {
    x >>>= 0
    let c = 0
    while (x) {
      c += x & 1
      x >>>= 1
    }
    return c
  }
  return popcount32((aHi ^ bHi) >>> 0) + popcount32((aLo ^ bLo) >>> 0)
}

// After attaching the BrowserView, ensure the visible content matches the
// offscreen texture we intend to show. Keep the canvas visible until match.
async function waitForBrowserViewSync(index: number, {
  timeoutMs = 800,
  pollIntervalMs = 80,
  maxHamming = 6,
}: { timeoutMs?: number; pollIntervalMs?: number; maxHamming?: number } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const fp = getFrameFingerprint(index)
      if (!fp) break
      const capture = await window.ipcRenderer.invoke('capture-browser-view', index)
      if (capture && capture.buffer && capture.size) {
        const size = capture.size as any
        const backingW = size.backingWidth || size.width
        const backingH = size.backingHeight || size.height
        const buf = capture.buffer instanceof Uint8Array ? capture.buffer : new Uint8Array(capture.buffer)
        const { hi, lo } = computeAhash64BGRA(buf, backingW, backingH)
        const ham = hamming64(fp.hashHi >>> 0, fp.hashLo >>> 0, hi >>> 0, lo >>> 0)
        const sameDims = fp.width === backingW && fp.height === backingH
        if (sameDims && ham <= maxHamming) {
          return true
        }
      }
    } catch (err) {
      console.debug('[Threewebview] waitForBrowserViewSync capture failed', err)
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return false
}

const captureTexturesForTransition = async (indices: number[]): Promise<boolean> => {
  if (!indices.length || store.setupMode) {
    return true
  }

  const unique = Array.from(new Set(indices))

  console.log(`[Threewebview] Using offscreen window textures for transition:`, unique)

  // Use textures that are already continuously updated by offscreen windows
  // This avoids IPC calls that can hang and cause stuck transitions
  const expectedWidth = canvasRef.value?.clientWidth || window.innerWidth
  const expectedHeight = canvasRef.value?.clientHeight || window.innerHeight
  const dpr = renderer.value?.getPixelRatio?.() || window.devicePixelRatio || 1

  for (const index of unique) {
    const texture = textures[index] as THREE.DataTexture | undefined
    if (!texture) {
      console.error(`[Threewebview] Texture ${index} is missing - blocking transition`)
      return false
    }

    if (texture.userData?.isPlaceholder) {
      console.error(`[Threewebview] Texture ${index} is still a placeholder - blocking transition`)
      return false
    }

    const image = texture.image as { width?: number; height?: number; data?: Uint8Array } | undefined
    if (!image?.data || !image.width || !image.height) {
      console.error(`[Threewebview] Texture ${index} has invalid image data - blocking transition`)
      return false
    }

    // Ensure backing size matches current viewport * DPR to avoid scale pop
    const expectedBackingW = Math.max(1, Math.round(expectedWidth * dpr))
    const expectedBackingH = Math.max(1, Math.round(expectedHeight * dpr))

    if (image.width !== expectedBackingW || image.height !== expectedBackingH) {
      console.warn(`[Threewebview] Texture ${index} size mismatch before transition. Waiting for correct size...`, {
        current: { w: image.width, h: image.height },
        expected: { w: expectedBackingW, h: expectedBackingH },
        dpr
      })

      const start = Date.now()
      const timeoutMs = 1000
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 32))
        const img = texture.image as { width?: number; height?: number } | undefined
        if (img?.width === expectedBackingW && img?.height === expectedBackingH) break
      }
    }

    // Final check after wait
    if (image.width !== expectedBackingW || image.height !== expectedBackingH) {
      console.warn(`[Threewebview] Proceeding with suboptimal texture size for index ${index}`, {
        current: { w: image.width, h: image.height },
        expected: { w: expectedBackingW, h: expectedBackingH }
      })
    } else {
      console.log(`[Threewebview] ✓ Texture ${index} ready for transition`, {
        textureWidth: image.width,
        textureHeight: image.height,
        expectedBackingW,
        expectedBackingH,
        dpr
      })
    }
  }

  console.log(`[Threewebview] ✓ All textures ready for transition`)
  return true
}

const transition = async (targetIndex: number, type: TransitionType) => {
  // Log current state before transition
  console.log(`[Threewebview] ==================== STARTING TRANSITION ====================`)
  console.log(`[Threewebview] Window size: ${window.innerWidth}x${window.innerHeight}`)
  console.log(`[Threewebview] Canvas size: ${canvasRef.value?.width}x${canvasRef.value?.height}`)
  console.log(`[Threewebview] Canvas client size: ${canvasRef.value?.clientWidth}x${canvasRef.value?.clientHeight}`)
  if (renderer.value) {
    console.log(`[Threewebview] Renderer size: ${renderer.value.domElement.width}x${renderer.value.domElement.height}`)
    console.log(`[Threewebview] Renderer pixel ratio: ${renderer.value.getPixelRatio()}`)
  }
  if (camera.value) {
    console.log(`[Threewebview] Camera frustum: left=${camera.value.left}, right=${camera.value.right}, top=${camera.value.top}, bottom=${camera.value.bottom}`)
  }
  console.log(`[Threewebview] ================================================================`)

  // Guard against multiple transitions, resize operations, and transitioning to current page
  if (store.isTransitioning || isResizing.value || targetIndex === store.currentIndex) {
    if (isResizing.value) {
      console.log('Skipping transition: resize in progress')
    }
    return
  }

  // Guard against invalid indices
  if (
    targetIndex < 0 ||
    targetIndex >= urls.value.length ||
    !planes[targetIndex] ||
    !planes[store.currentIndex]
  ) {
    console.error(
      `Invalid transition indices: target=${targetIndex}, current=${store.currentIndex}`,
    )
    return
  }

  console.log(`Starting transition from ${store.currentIndex} to ${targetIndex}`)

  store.setTransitioning(true)
  const fromIndex = store.currentIndex

  // CRITICAL: Verify fromIndex before capture
  console.log(`[Threewebview] Transition indices: fromIndex=${fromIndex}, targetIndex=${targetIndex}`)
  if (fromIndex === targetIndex) {
    console.error(`[Threewebview] ❌ CRITICAL: fromIndex equals targetIndex! This should never happen!`)
    store.setTransitioning(false)
    return
  }

  // Get plane references early
  const targetPlane = planes[targetIndex]
  const fromPlane = planes[fromIndex]

  if (!targetPlane || !fromPlane) {
    console.error('Planes not available for transition')
    await showBrowserView(fromIndex)
    store.setCurrentIndex(fromIndex)
    store.setTransitioning(false)
    return
  }

  const shouldRunVisualTransition = transitionsEnabled && Boolean(transitionManager)
  let shouldRestoreBrowserView = false

  try {
    // CRITICAL: Enable painting at 10fps for both source and target pages before transition
    // This ensures we capture fresh, up-to-date textures for the transition
    console.log(`[Threewebview] Enabling painting for transition pages: ${fromIndex}, ${targetIndex}`)
    const prevTimestamps = new Map<number, number>(textureUpdateTimestamps.value)
    await enablePaintingForIndices([fromIndex, targetIndex])
    // Wait for both textures to receive at least one fresh frame
    const gotUpdates = await waitForTextureUpdates([fromIndex, targetIndex], prevTimestamps, 3000, 30)

    // Always attempt stability wait; require frames newer than prevTimestamps
    const settled = await waitForStableFrames(
      [fromIndex, targetIndex],
      prevTimestamps,
      { timeoutMs: 1500, pollIntervalMs: 60, minStableFrames: 2, requireNewFrames: true },
    )
    if (!settled) {
      console.warn('[Threewebview] Proceeding without stability consensus (timeout)')
    } else {
      console.log('[Threewebview] ✓ Source and target pages appear visually stable')
    }

    // If no fresh offscreen frame arrived (common when pages are visually idle),
    // fall back to a direct capture of the currently visible BrowserView for the
    // source page to ensure the FROM texture is current.
    if (!gotUpdates) {
      console.warn('[Threewebview] No fresh offscreen frames detected; capturing visible BrowserView for source')
      try {
        const capture = await window.ipcRenderer.invoke('capture-browser-view', fromIndex)
        if (capture && capture.buffer) {
          applyFrameToTexture(capture)
          textureUpdateTimestamps.value.set(fromIndex, Date.now())
          console.log('[Threewebview] Applied BrowserView capture to source texture')
        } else {
          console.warn('[Threewebview] BrowserView capture returned no data; proceeding with existing texture')
        }
      } catch (err) {
        console.warn('[Threewebview] Failed to capture BrowserView for source', err)
      }
    }

    // Validate SOURCE texture - using continuously updated offscreen window texture
    console.log(`[Threewebview] Validating source texture from offscreen window ${fromIndex}`)
    const sourceCapture = await captureTexturesForTransition([fromIndex])

    if (!sourceCapture) {
      console.error('[Threewebview] Failed to capture source texture')
      store.setTransitioning(false)
      return
    }

    if (shouldRunVisualTransition) {
      shouldRestoreBrowserView = true

      // Show and prepare canvas to provide smooth visual transition BEFORE hiding BrowserViews
      if (renderer.value && canvasRef.value) {
        const currentWidth = window.innerWidth
        const currentHeight = window.innerHeight
        const dpr = window.devicePixelRatio || 1
        const canvasWidth = renderer.value.domElement.width
        const canvasHeight = renderer.value.domElement.height
        const expectedWidth = Math.round(currentWidth * dpr)
        const expectedHeight = Math.round(currentHeight * dpr)

        if (canvasWidth !== expectedWidth || canvasHeight !== expectedHeight) {
          console.warn(`[Threewebview] ⚠️  RENDERER SIZE MISMATCH BEFORE TRANSITION!`)
          console.warn(`  - Renderer canvas: ${canvasWidth}x${canvasHeight}`)
          console.warn(`  - Window size: ${currentWidth}x${currentHeight}`)
          console.warn(`  - Expected (window * ${dpr}): ${expectedWidth}x${expectedHeight}`)
          console.warn(`  - FORCING IMMEDIATE RESIZE...`)

          // Force immediate resize of renderer
          renderer.value.setSize(currentWidth, currentHeight)
          renderer.value.setPixelRatio(dpr)

          // Update camera frustum
          if (camera.value) {
            const aspect = currentWidth / currentHeight
            const frustumWidth = FRUSTUM_HEIGHT * aspect
            const halfWidth = frustumWidth / 2
            const halfHeight = FRUSTUM_HEIGHT / 2
            camera.value.left = -halfWidth
            camera.value.right = halfWidth
            camera.value.top = halfHeight
            camera.value.bottom = -halfHeight
            camera.value.updateProjectionMatrix()
            console.warn(`  - Camera frustum updated for aspect ${aspect.toFixed(2)}`)
          }

          // Update plane geometries
          const newPlaneConfig = calculatePlaneSize({
            frustumHeight: FRUSTUM_HEIGHT,
            distance: DISTANCE,
            aspect: currentWidth / currentHeight
          })
          planes.forEach((plane) => {
            plane.geometry.dispose()
            plane.geometry = new THREE.PlaneGeometry(newPlaneConfig.width, newPlaneConfig.height)
          })
          if (transitionManager) {
            transitionManager.updatePlaneConfig(newPlaneConfig)
          }

          console.warn(`  - Resize complete: canvas now ${renderer.value.domElement.width}x${renderer.value.domElement.height}`)
        } else {
          console.log(`[Threewebview] Renderer size OK: ${canvasWidth}x${canvasHeight}`)
        }
      }

      // Show canvas with source content to hide any browser view flashing
      // Show fromPlane with already-captured source texture
      fromPlane.visible = true
      targetPlane.visible = false
      showCanvas.value = true

      // Force immediate render to ensure canvas is visible and opaque
      if (renderer.value && scene.value && camera.value) {
        renderer.value.render(scene.value, camera.value)
      }

      // Small delay to ensure canvas is painted
      await new Promise(resolve => setTimeout(resolve, 64))

      // Now that the canvas is visibly presenting the source content, hide BrowserViews
      await hideBrowserViews()
    }

    // Validate TARGET texture - using continuously updated offscreen window texture
    console.log(`[Threewebview] Validating target texture ${targetIndex} from offscreen window`)
    const targetCapture = await captureTexturesForTransition([targetIndex])

    if (!targetCapture) {
      console.error('[Threewebview] Failed to capture target texture')
      store.setTransitioning(false)
      return
    }

    // Freeze painting for the two pages participating in this transition so
    // their textures don't change mid-animation (e.g., due to live content or
    // late DPR adjustments). We'll re-enable/leave disabled according to the
    // normal post-transition flow below.
    try {
      await disablePaintingForIndices([fromIndex, targetIndex])
      console.info(
        `[Threewebview] Frozen offscreen painting for transition indices: ${fromIndex}, ${targetIndex}`,
      )
    } catch (err) {
      console.warn('[Threewebview] Failed to freeze offscreen painting before transition', err)
    }

    if (shouldRunVisualTransition) {
      // Canvas is already visible from earlier, now setup the transition scene
    }

    // Setup scene atomically to prevent rendering intermediate states
    if (shouldRunVisualTransition && transitionManager) {
      // CRITICAL: Temporarily stop the render loop to prevent race conditions
      // during scene setup. Cancel any pending animation frame.
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      needsRender = false

      // Update currentIndex before overlay creation to restore previous working flow
      store.setCurrentIndex(targetIndex)
      // Create transition overlay (shows FROM texture at renderOrder 1000)
      transitionManager.startTransition(type, fromIndex, fromPlane.position)
      // NOW make target visible (it will be underneath the overlay)
      targetPlane.visible = true

      // Hide the source plane (overlay now shows the FROM texture)
      fromPlane.visible = false

      // Force immediate synchronous render to ensure overlay is rendered
      // This prevents any intermediate state from being visible
      if (renderer.value && scene.value && camera.value) {
        renderer.value.render(scene.value, camera.value)
      }

      // Keep BrowserViews hidden during the overlay animation as before; they
      // are reattached in the finally block after transition completes.

      // CRITICAL: NOW schedule renders to animate the transition
      // The render loop will call transitionManager.update() on each frame
      scheduleRender()
    } else {
      // Non-transition path
      targetPlane.visible = true
      fromPlane.visible = false
      scheduleRender()
    }

    if (!shouldRunVisualTransition) {
      await showBrowserView(store.currentIndex)
      return
    }

    // Wait for the visual transition to complete.
    // Previously we used a fixed 2.5s timeout which could desync with the
    // actual transition duration (framerate drops or different transition
    // timings) and leave residues on the destination image. Instead poll
    // the TransitionManager for completion with a sensible fallback timeout.
    await new Promise<void>((resolve) => {
      const maxWait = 10000 // restore prior 10s fallback
      const interval = 100
      let waited = 0

      const check = () => {
        // If transitionManager is missing for some reason, stop waiting
        if (!transitionManager) return resolve()

        if (!transitionManager.hasActiveTransition()) {
          return resolve()
        }

        waited += interval
        if (waited >= maxWait) {
          console.warn('Transition wait timed out after', maxWait, 'ms')
          return resolve()
        }

        setTimeout(check, interval)
      }

      check()
    })
  } finally {
    if (shouldRestoreBrowserView) {
      // Reattach BrowserView first so there's always content underneath the canvas
      await showBrowserView(store.currentIndex)
      // Give the BrowserView a moment to attach and paint, then ensure it visually
      // matches the offscreen texture before hiding the canvas.
      await new Promise((resolve) => setTimeout(resolve, 64))
      const synced = await waitForBrowserViewSync(store.currentIndex, { timeoutMs: 900, pollIntervalMs: 80, maxHamming: 6 })
      if (!synced) {
        console.warn('[Threewebview] BrowserView did not fully sync to offscreen texture before timeout')
      }
      // Now hide the canvas to avoid a black gap between layers
      showCanvas.value = false
    }

    // NOW set transitioning to false - after everything is truly complete
    store.setTransitioning(false)

    // CRITICAL: Check if window was resized during transition
    // If so, we need to update the renderer/camera/planes now
    if (canvasRef.value && renderer.value) {
      const currentRendererSize = { width: renderer.value.domElement.width, height: renderer.value.domElement.height }
      const actualWindowSize = { width: window.innerWidth, height: window.innerHeight }
      const dpr = window.devicePixelRatio || 1
      const expectedRendererSize = {
        width: Math.round(actualWindowSize.width * dpr),
        height: Math.round(actualWindowSize.height * dpr)
      }

      if (currentRendererSize.width !== expectedRendererSize.width ||
          currentRendererSize.height !== expectedRendererSize.height) {
        console.log(`[Threewebview] ⚠️  Renderer size mismatch after transition!`)
        console.log(`  - Renderer: ${currentRendererSize.width}x${currentRendererSize.height}`)
        console.log(`  - Expected: ${expectedRendererSize.width}x${expectedRendererSize.height}`)
        console.log(`  - Triggering resize to fix...`)
        await handleResize()
      }
    }

    // Reduce offscreen work between transitions by disabling painting
    // for the pages we temporarily enabled for this transition.
    // They will be re-enabled right before the next transition.
    try {
      await disablePaintingForIndices([fromIndex, targetIndex])
      console.info(
        `[Threewebview] Disabled offscreen painting after transition for indices: ${fromIndex}, ${targetIndex}`,
      )
    } catch (err) {
      console.warn('[Threewebview] Failed to disable offscreen painting after transition', err)
    }
  }
}

const rotateWebview = () => {
  if (!allTexturesLoaded.value) {
    console.log('Skipping rotation: textures not loaded')
    return
  }

  if (store.isTransitioning) {
    console.log('Skipping rotation: transition in progress')
    return
  }

  const nextIndex = (store.currentIndex + 1) % urls.value.length
  const nextType = transitionManager?.getNextType() || 'rain'

  console.log(`Rotate: current=${store.currentIndex}, next=${nextIndex}, type=${nextType}`)

  transition(nextIndex, nextType)
  if (transitionsEnabled) {
    store.toggleTransitionType()
  }
}

const refreshWebviews = async () => {
  if (store.isTransitioning || isResizing.value || !allTexturesLoaded.value) {
    console.log('Skipping refresh: busy or not ready')
    return
  }
  console.log('Refreshing all webviews')
  for (let i = 0; i < urls.value.length; i++) {
    await window.ipcRenderer.invoke('reload-webview', i)
  }
}

const checkAllTexturesLoaded = () => {
  if (loadedTextures.value.size === urls.value.length && !allTexturesLoaded.value) {
    allTexturesLoaded.value = true
    isInitialLoading.value = false
    console.log('🎉 All textures loaded, starting slideshow')
    scheduleRender()

    // CRITICAL: Check if window was resized during initial loading
    // If so, we need to update the renderer/camera/planes now
    if (canvasRef.value && renderer.value) {
      const currentRendererSize = { width: renderer.value.domElement.width, height: renderer.value.domElement.height }
      const actualWindowSize = { width: window.innerWidth, height: window.innerHeight }
      const dpr = window.devicePixelRatio || 1
      const expectedRendererSize = {
        width: Math.round(actualWindowSize.width * dpr),
        height: Math.round(actualWindowSize.height * dpr)
      }

      if (currentRendererSize.width !== expectedRendererSize.width ||
          currentRendererSize.height !== expectedRendererSize.height) {
        console.log(`[Threewebview] ⚠️  Renderer size mismatch after initial loading!`)
        console.log(`  - Renderer: ${currentRendererSize.width}x${currentRendererSize.height}`)
        console.log(`  - Expected: ${expectedRendererSize.width}x${expectedRendererSize.height}`)
        console.log(`  - Triggering resize to fix...`)
        // Use setTimeout to avoid async issues in this function
        setTimeout(() => handleResize(), 100)
      }
    }

    // CRITICAL: Disable ALL painting so we stop pushing textures until the
    // slideshow actually needs a new snapshot.
    const allIndices = Array.from({ length: urls.value.length }, (_, i) => i)
    allIndices.forEach(i => window.ipcRenderer.invoke('disable-painting', i))

    // Give the BrowserViews a moment to settle before starting the rotation
    // timers. New textures will be captured on-demand right before each
    // transition.
    setTimeout(() => startTimers(), 2000)

    showCanvas.value = false
    void showBrowserView(store.currentIndex)
  }
  loadingProgress.value = Math.round((loadedTextures.value.size / urls.value.length) * 100)
}

const handleSetupComplete = async () => {
  console.log('Setup complete, loading all textures...')
  // Enable painting for ALL windows initially to load textures
  const allIndices = Array.from({ length: urls.value.length }, (_, i) => i)
  await enablePaintingForIndices(allIndices)
  void showBrowserView(store.currentIndex)
}

const handleWebviewLoaded = (_event: any, data: { index: number; url: string }) => {
  console.log(`Webview ${data.index} page loaded: ${data.url}`)
}

const { startTimers, stopTimers } = useRotationTimer(rotateWebview, refreshWebviews)

// Simple rotation for performance mode: just navigate the single BrowserView
const rotatePerf = async () => {
  if (!urls.value?.length) return
  const nextIndex = (store.currentIndex + 1) % urls.value.length
  const targetUrl = urls.value[nextIndex]
  try {
    await window.ipcRenderer.invoke('navigate-browser-view', 0, targetUrl)
    store.setCurrentIndex(nextIndex)
  } catch (err) {
    console.warn('[Threewebview] Failed to navigate in performance mode', err)
  }
}

const refreshPerf = async () => {
  try {
    await window.ipcRenderer.invoke('reload-browser-view', 0)
  } catch (err) {
    console.warn('[Threewebview] Failed to reload in performance mode', err)
  }
}

const { startTimers: startPerfTimers, stopTimers: stopPerfTimers } = useRotationTimer(rotatePerf, refreshPerf, { enableRefresh: false })

const handleDotClick = (index: number) => {
  if (!allTexturesLoaded.value) return

  if (store.isTransitioning) {
    console.log('Skipping dot click: transition in progress')
    return
  }

  const nextType = transitionManager?.getNextType() || 'rain'
  transition(index, nextType)
  if (transitionsEnabled) {
    store.toggleTransitionType()
  }
}

onMounted(async () => {
  // Detect performance mode first
  try {
    const perf = await window.ipcRenderer.invoke('get-performance-mode')
    performanceMode.value = !!perf
  } catch {
    performanceMode.value = false
  }

  await loadUrls()

  if (performanceMode.value) {
    // Minimal path: show a single BrowserView and rotate by navigation
    try {
      await window.ipcRenderer.invoke('show-browser-view', 0)
    } catch (err) {
      console.warn('[Threewebview] Failed to show initial BrowserView in performance mode', err)
    }

    // Start timers after setup is finished
    const handleSetupCompletePerf = async () => {
      startPerfTimers()
    }
    ;(window as any).__handleSetupCompletePerf = handleSetupCompletePerf
    window.ipcRenderer.on('setup-complete', handleSetupCompletePerf)

    // Also respond to direct page loaded logs
    window.ipcRenderer.on('webview-loaded', handleWebviewLoaded)

    // Do not init Three/Offscreen listeners in performance mode
    return
  }

  // Normal (non-performance) path
  // Load transition configuration
  try {
    const config = await window.ipcRenderer.invoke('get-transition-config')
    if (config && Array.isArray(config)) {
      transitionConfig.value = config
      console.log('[Threewebview] Loaded transition config:', config)
    }
  } catch (error) {
    console.error('[Threewebview] Failed to load transition config:', error)
  }

  // Load timing config to get transition duration (ms)
  try {
    const timing = await window.ipcRenderer.invoke('get-timing-config')
    const ms = Number(timing?.transitionDuration)
    if (Number.isFinite(ms) && ms > 0) {
      transitionDurationSeconds = ms / 1000
    }
  } catch (err) {
    // Ignore and use default
  }

  initScene()
  createPlanes()
  scheduleRender()
  const win = window as any
  win.__debugFrames = false  // Disabled to prevent texture scale mismatch
  win.__dumpThreewebview = () => {
    return {
      currentIndex: store.currentIndex,
      planes: planes.map((plane, idx) => {
        const material = plane.material as THREE.MeshBasicMaterial
        const map = material?.map as THREE.Texture | undefined
        const image = map?.image as { width?: number; height?: number } | undefined
        return {
          index: idx,
          visible: plane.visible,
          materialHasMap: Boolean(map),
          mapNeedsUpdate: map?.needsUpdate ?? false,
          imageSize: image ? { width: image.width ?? null, height: image.height ?? null } : null,
        }
      }),
      textures: textures.map((texture, idx) => {
        const image = texture.image as { width?: number; height?: number } | undefined
        return {
          index: idx,
          hasImage: Boolean(image),
          imageSize: image ? { width: image.width ?? null, height: image.height ?? null } : null,
          needsUpdate: texture.needsUpdate,
        }
      }),
    }
  }

  // Only register the webview-loaded handler here
  // webview-frame is handled by the composable via setupListeners()
  window.ipcRenderer.on('webview-loaded', handleWebviewLoaded)
  setupListeners()

  window.addEventListener('resize', handleResize)

  // Listen for main window resize events from main process
  window.ipcRenderer.on('main-window-resized', () => {
    console.log('[Threewebview] Received main-window-resized event, triggering handleResize')
    handleResize()
  })

  window.ipcRenderer.on('setup-complete', async () => {
    await handleSetupComplete()
    // Texture loading and timer starting now handled by checkAllTexturesLoaded()
  })
})

onUnmounted(() => {
  // Stop whichever timers are active
  try { stopPerfTimers() } catch {}
  try { stopTimers() } catch {}

  // Cleanup listeners based on mode
  window.ipcRenderer.off('webview-loaded', handleWebviewLoaded)
  // Remove whichever setup-complete listener we attached
  try {
    const perfHandler = (window as any).__handleSetupCompletePerf
    if (perfHandler) window.ipcRenderer.off('setup-complete', perfHandler)
  } catch {}
  window.ipcRenderer.off('setup-complete', handleSetupComplete)
  if (!performanceMode.value) {
    // webview-frame is cleaned up by removeListeners()
    try { removeListeners() } catch {}
    window.removeEventListener('resize', handleResize)
    window.ipcRenderer.off('main-window-resized', handleResize)

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    needsRender = false

    if (transitionManager) {
      transitionManager.cleanup()
    }

    dispose()
    textures.forEach((texture) => texture.dispose())
    planes.forEach((plane) => {
      plane.geometry.dispose()
      if (plane.material instanceof THREE.Material) {
        plane.material.dispose()
      }
    })
  }
})
</script>

<template>

  <div class="webview-3d-container">
    <div v-if="store.setupMode" class="setup-control-bar">
      <div class="setup-content">
        <div class="setup-info">
          <h2>Setup Mode</h2>
          <p v-if="urls.length > 0">Page {{ store.setupIndex + 1 }} of {{ urls.length }} - Log in to your pages above</p>
          <p v-else>No pages configured. Using defaults or empty list.</p>
        </div>
        <div class="setup-controls">
          <button class="control-btn" @click="prevSetupPage" title="Previous page" :disabled="urls.length === 0">
            <span>←</span>
          </button>
          <button class="control-btn finish-btn" @click="finishSetup">Start Slideshow</button>
          <button class="control-btn" @click="nextSetupPage" title="Next page" :disabled="urls.length === 0">
            <span>→</span>
          </button>
        </div>
        <div class="setup-dots" v-if="urls.length > 0">
          <div
            v-for="(_, index) in urls.length"
            :key="index"
            class="setup-dot"
            :class="{ active: store.setupIndex === index }"
            @click="showSetupView(index)"
          ></div>
        </div>
      </div>
    </div>

    <!-- Loading overlay -->
    <div v-if="!performanceMode && !store.setupMode && !allTexturesLoaded" class="loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading pages...</div>
        <div class="loading-progress">{{ loadingProgress }}%</div>
        <div class="loading-bar">
          <div class="loading-bar-fill" :style="{ width: loadingProgress + '%' }"></div>
        </div>
      </div>
    </div>

    <canvas
      ref="canvasRef"
      class="three-canvas"
      :class="[{ 'setup-hidden': store.setupMode }, { visible: showCanvas }, { 'no-transition': store.isTransitioning } ]"
    ></canvas>

    <!-- Indicator dots hidden during slideshow to avoid texture scale mismatch -->
    <!-- <div v-if="!store.setupMode && allTexturesLoaded" class="indicator">
      <div
        v-for="(_, index) in urls.length"
        :key="index"
        class="dot"
        :class="{ active: store.currentIndex === index }"
        @click="handleDotClick(index)"
      ></div>
    </div> -->

    <!-- Transition indicator hidden during slideshow to avoid texture scale mismatch -->
    <!-- <div
      v-if="transitionsEnabled && store.isTransitioning && !store.setupMode && allTexturesLoaded"
      class="transition-indicator"
    >
      Transition {{ store.currentTransitionType === 'rain' ? '1: Rain' : '2: Slices' }}
    </div> -->
  </div>
</template>

<style scoped>
.webview-3d-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #000;
}

.three-canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.three-canvas.visible {
  opacity: 1;
}

.three-canvas.no-transition {
  transition: none !important;
}

.three-canvas.setup-hidden {
  display: none;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.loading-content {
  text-align: center;
  color: white;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 20px;
  margin-bottom: 10px;
  color: rgba(255, 255, 255, 0.8);
}

.loading-progress {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 15px;
}

.loading-bar {
  width: 200px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  margin: 0 auto;
  overflow: hidden;
}

.loading-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.setup-control-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 120px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0.85));
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.setup-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 1400px;
  padding: 0 40px;
  gap: 40px;
}

.setup-info {
  flex: 0 0 auto;
  color: white;
  min-width: 300px;
}

.setup-info h2 {
  font-size: 20px;
  font-weight: 500;
  margin-bottom: 5px;
  color: #fff;
}

.setup-info p {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
}

.setup-controls {
  display: flex;
  gap: 15px;
  align-items: center;
  flex: 0 0 auto;
}

.control-btn {
  padding: 12px 24px;
  font-size: 16px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 500;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

.control-btn span {
  font-size: 20px;
  display: block;
}

.finish-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  padding: 12px 32px;
  font-size: 16px;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.finish-btn:hover {
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
  transform: translateY(-2px);
}

.setup-dots {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 15px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 20px;
}

.setup-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.3);
  transition: all 0.3s ease;
  cursor: pointer;
}

.setup-dot:hover {
  background-color: rgba(255, 255, 255, 0.6);
  transform: scale(1.2);
}

.setup-dot.active {
  background-color: rgba(255, 255, 255, 1);
  transform: scale(1.3);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
}

.indicator {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  background-color: rgba(0, 0, 0, 0.5);
  padding: 10px 20px;
  border-radius: 20px;
  z-index: 10;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.5);
  transition:
    background-color 0.3s ease,
    transform 0.3s ease;
  cursor: pointer;
}

.dot:hover {
  background-color: rgba(255, 255, 255, 0.8);
  transform: scale(1.2);
}

.dot.active {
  background-color: rgba(255, 255, 255, 1);
  transform: scale(1.3);
}

.transition-indicator {
  position: absolute;
  top: 20px;
  right: 20px;
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 14px;
  z-index: 10;
}
</style>
