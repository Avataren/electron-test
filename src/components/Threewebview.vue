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

const planes: THREE.Mesh[] = []
const textures: THREE.Texture[] = []
let transitionManager: TransitionManager | null = null
const win: any = window
let renderStatCounter = 0

const { scene, camera, renderer, initScene, onResize, dispose, FOV, DISTANCE } =
  useThreeScene(canvasRef)

const pageAspect = ref<number | null>(null)

  const { urls, loadUrls, setupListeners, removeListeners } = useWebviewFrames(
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

      const image = texture.image as HTMLCanvasElement | undefined
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

        const newPlaneConfig = calculatePlaneSize(
          {
            fov: FOV,
            distance: DISTANCE,
            aspect: camera.value.aspect,
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
      }
    }
  },
)

const showSetupView = async (index: number) => {
  store.setSetupIndex(index)
  await window.ipcRenderer.invoke('show-setup-view', index)
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
}

const createPlanes = () => {
  if (!scene.value || !camera.value) return

  const planeConfig = calculatePlaneSize({
    fov: FOV,
    distance: DISTANCE,
    aspect: camera.value.aspect,
  })

 const planeGeometry = new THREE.PlaneGeometry(planeConfig.width, planeConfig.height)

  urls.value.forEach((_, index) => {
    // Seed texture with a tiny canvas so WebGL never sees a zero-sized attachment.
    const placeholder = document.createElement('canvas')
    placeholder.width = 2
    placeholder.height = 2
    const phCtx = placeholder.getContext('2d')
    if (phCtx) {
      phCtx.fillStyle = '#000'
      phCtx.fillRect(0, 0, placeholder.width, placeholder.height)
    }

    const texture = new THREE.CanvasTexture(placeholder)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.needsUpdate = false
    texture.userData.isPlaceholder = true
    textures.push(texture)

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
    })

    const plane = new THREE.Mesh(planeGeometry, material)
    plane.position.set(0, 0, -index * 0.01)
    plane.visible = index === 0

    planes.push(plane)
    scene.value?.add(plane)
  })

  transitionManager = new TransitionManager(scene.value, textures, planeConfig)
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
  // Prevent concurrent resize operations
  if (isResizing.value || store.isTransitioning || isInitialLoading.value) {
    console.log('Skipping resize: ' +
      (isResizing.value ? 'resize in progress' :
       store.isTransitioning ? 'transition in progress' :
       'initial loading in progress'))
    return
  }

  isResizing.value = true

  try {
    const newPlaneConfig = onResize(pageAspect.value ?? undefined)
    if (!newPlaneConfig) return

    planes.forEach((plane) => {
      plane.geometry.dispose()
      plane.geometry = new THREE.PlaneGeometry(newPlaneConfig.width, newPlaneConfig.height)
    })

    if (transitionManager) {
      transitionManager.updatePlaneConfig(newPlaneConfig)
    }

    // Clear existing textures before resize
    textures.forEach(texture => {
      texture.dispose()
    })

    // Ensure offscreen windows are resized
    try {
      const cssWidth = canvasRef.value?.clientWidth || window.innerWidth
      const cssHeight = canvasRef.value?.clientHeight || window.innerHeight
      const dpr = window.devicePixelRatio || 1
      const maxTex = renderer.value?.capabilities?.maxTextureSize || 8192

      // Calculate safe dimensions that respect GPU limits
      const backingWidth = Math.round(cssWidth * dpr)
      const backingHeight = Math.round(cssHeight * dpr)

      let pixelWidth = cssWidth
      let pixelHeight = cssHeight

      if (backingWidth > maxTex || backingHeight > maxTex) {
        const scale = maxTex / Math.max(backingWidth, backingHeight)
        pixelWidth = Math.max(1, Math.round(cssWidth * scale))
        pixelHeight = Math.max(1, Math.round(cssHeight * scale))
        console.warn('[Threewebview] Scaling down window size to respect GPU limits',
          { original: { cssWidth, cssHeight, backingWidth, backingHeight },
            scaled: { pixelWidth, pixelHeight, maxTex }
          })
      }

      // Resize only active windows
      const active = [
        store.currentIndex,
        (store.currentIndex + 1) % planes.length,
        (store.currentIndex + 2) % planes.length,
      ]

      await disablePaintingForIndices(active)
      await window.ipcRenderer.invoke('resize-active-offscreen-windows', active, pixelWidth, pixelHeight)
      await new Promise(res => setTimeout(res, 100))
      await enablePaintingForIndices(active)
      await new Promise(res => setTimeout(res, 500))

      // Force texture updates
      textures.forEach(texture => {
        texture.needsUpdate = true
      })

    } catch (err) {
      console.warn('[Threewebview] Resize error:', err)
    }
  } catch (err) {
    console.error('[Threewebview] Fatal resize error:', err)
  } finally {
    isResizing.value = false
  }
}

const animate = () => {
  requestAnimationFrame(animate)

  if (store.isTransitioning && transitionManager) {
    const isComplete = transitionManager.update()
    if (isComplete) {
      // Visual transition is complete, but DON'T set isTransitioning to false here
      // It will be set to false at the end of the transition() function
      const nextIdx = (store.currentIndex + 1) % urls.value.length
      const nextNextIdx = (store.currentIndex + 2) % urls.value.length
      console.log(
        `Transition complete. Current: ${store.currentIndex}, keeping painting for: ${store.currentIndex}, ${nextIdx}, ${nextNextIdx}`,
      )
      updateActivePaintingWindows([store.currentIndex, nextIdx, nextNextIdx])
    }
  }

  if (renderer.value && scene.value && camera.value) {
    try {
      renderer.value.render(scene.value, camera.value)
      renderStatCounter++
      const info = renderer.value.info
      if (renderStatCounter === 1 || renderStatCounter % 60 === 0) {
        const info = renderer.value.info
        try {
          win.ipcRenderer?.send('render-stats', {
            frame: Date.now(),
            renderCalls: info.render.calls,
            renderTriangles: info.render.triangles,
            renderLines: info.render.lines,
            renderPoints: info.render.points,
            memoryGeometries: info.memory.geometries,
            memoryTextures: info.memory.textures,
            sceneChildren: scene.value.children.length,
            setupMode: store.setupMode,
            allTexturesLoaded: allTexturesLoaded.value,
          })
        } catch (err) {
          console.debug('[Threewebview] failed to send render-stats', err)
        }
      }
    } catch (err) {
      console.error('[Threewebview] WebGL render error — will continue animation loop', err)
    }
  }
}

const updateActivePaintingWindows = async (indices: number[]) => {
  console.log(`Setting active painting windows: ${indices.join(', ')}`)
  await window.ipcRenderer.invoke('set-active-painting-windows', indices)
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

const transition = async (targetIndex: number, type: TransitionType) => {
  // Guard against multiple transitions and transitioning to current page
  if (store.isTransitioning || targetIndex === store.currentIndex) {
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

  // Update currentIndex IMMEDIATELY to prevent race conditions with timer
  store.setCurrentIndex(targetIndex)

  // Enable painting for: from (for transition), target (to transition to), and next (to preload)
  const nextAfterTarget = (targetIndex + 1) % urls.value.length
  await updateActivePaintingWindows([fromIndex, targetIndex, nextAfterTarget])

  // Give Electron 100ms to ensure painting is active
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Make target plane visible
  const targetPlane = planes[targetIndex]
  const fromPlane = planes[fromIndex]

  if (!targetPlane || !fromPlane) {
    console.error('Planes not available for transition')
    store.setTransitioning(false)
    return
  }

  targetPlane.visible = true

  // Start the visual transition effect
  if (transitionManager) {
    transitionManager.startTransition(type, fromIndex, fromPlane.position)
  }

  // Hide the old plane
  fromPlane.visible = false

  // Wait for the visual transition to complete.
  // Previously we used a fixed 2.5s timeout which could desync with the
  // actual transition duration (framerate drops or different transition
  // timings) and leave residues on the destination image. Instead poll
  // the TransitionManager for completion with a sensible fallback timeout.
  await new Promise<void>((resolve) => {
    const maxWait = 10000 // 10s fallback to avoid hanging forever
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

  // NOW set transitioning to false - after everything is truly complete
  store.setTransitioning(false)
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
  store.toggleTransitionType()
}

const refreshWebviews = async () => {
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

    // CRITICAL: Disable ALL painting first, then only enable what we need
    const allIndices = Array.from({ length: urls.value.length }, (_, i) => i)
    allIndices.forEach(i => window.ipcRenderer.invoke('disable-painting', i))

    // Small delay, then enable only first 3
    setTimeout(() => {
      updateActivePaintingWindows([0, 1, 2])
      setTimeout(() => startTimers(), 2000)
    }, 100)
  }
  loadingProgress.value = Math.round((loadedTextures.value.size / urls.value.length) * 100)
}

const handleSetupComplete = async () => {
  console.log('Setup complete, loading all textures...')
  // Enable painting for ALL windows initially to load textures
  const allIndices = Array.from({ length: urls.value.length }, (_, i) => i)
  await updateActivePaintingWindows(allIndices)
}

const handleWebviewLoaded = (_event: any, data: { index: number; url: string }) => {
  console.log(`Webview ${data.index} page loaded: ${data.url}`)
}

const { startTimers, stopTimers } = useRotationTimer(rotateWebview, refreshWebviews)

const handleDotClick = (index: number) => {
  if (!allTexturesLoaded.value) return

  if (store.isTransitioning) {
    console.log('Skipping dot click: transition in progress')
    return
  }

  const nextType = transitionManager?.getNextType() || 'rain'
  transition(index, nextType)
  store.toggleTransitionType()
}

onMounted(async () => {
  await loadUrls()
  initScene()
  createPlanes()
  animate()
  const win = window as any
  win.__debugFrames = true
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
  window.ipcRenderer.on('setup-complete', async () => {
    await handleSetupComplete()
    // Texture loading and timer starting now handled by checkAllTexturesLoaded()
  })
})

onUnmounted(() => {
  stopTimers()
  // webview-frame is cleaned up by removeListeners()
  window.ipcRenderer.off('webview-loaded', handleWebviewLoaded)
  removeListeners()
  window.removeEventListener('resize', handleResize)
  window.ipcRenderer.off('setup-complete', handleSetupComplete)

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
})
</script>

<template>

  <div class="webview-3d-container">
    <div v-if="store.setupMode && urls.length > 0" class="setup-control-bar">
      <div class="setup-content">
        <div class="setup-info">
          <h2>Setup Mode</h2>
          <p>Page {{ store.setupIndex + 1 }} of {{ urls.length }} - Log in to your pages above</p>
        </div>
        <div class="setup-controls">
          <button class="control-btn" @click="prevSetupPage" title="Previous page">
            <span>←</span>
          </button>
          <button class="control-btn finish-btn" @click="finishSetup">Start Slideshow</button>
          <button class="control-btn" @click="nextSetupPage" title="Next page">
            <span>→</span>
          </button>
        </div>
        <div class="setup-dots">
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
    <div v-if="!store.setupMode && !allTexturesLoaded" class="loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading pages...</div>
        <div class="loading-progress">{{ loadingProgress }}%</div>
        <div class="loading-bar">
          <div class="loading-bar-fill" :style="{ width: loadingProgress + '%' }"></div>
        </div>
      </div>
    </div>

    <canvas ref="canvasRef" class="three-canvas" :class="{ hidden: store.setupMode }"></canvas>

    <div v-if="!store.setupMode && allTexturesLoaded" class="indicator">
      <div
        v-for="(_, index) in urls.length"
        :key="index"
        class="dot"
        :class="{ active: store.currentIndex === index }"
        @click="handleDotClick(index)"
      ></div>
    </div>

    <div
      v-if="store.isTransitioning && !store.setupMode && allTexturesLoaded"
      class="transition-indicator"
    >
      Transition {{ store.currentTransitionType === 'rain' ? '1: Rain' : '2: Slices' }}
    </div>
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
}

.three-canvas.hidden {
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
