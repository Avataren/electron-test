<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { useWebviewStore } from '../stores/modules/webview'
import { useThreeScene } from '../composables/useThreeScene'
import { useWebviewFrames } from '../composables/useWebviewFrames'
import { useRotationTimer } from '../composables/useRotationTimer'
import { TransitionManager } from '../transitions/TransitionManager'
import { calculatePlaneSize } from '../utils/geometry'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const store = useWebviewStore()
const loadedTextures = ref<Set<number>>(new Set())
const allTexturesLoaded = ref(false)
const loadingProgress = ref(0)

const planes: THREE.Mesh[] = []
const textures: THREE.Texture[] = []
let transitionManager: TransitionManager | null = null

const { scene, camera, renderer, initScene, onResize, dispose, FOV, DISTANCE } =
  useThreeScene(canvasRef)

const { urls, loadUrls, setupListeners, removeListeners } = useWebviewFrames(textures)

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

  urls.value.forEach((url, index) => {
    const texture = new THREE.Texture()
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.LinearSRGBColorSpace
    // Don't mark as needing update until we have image data
    textures.push(texture)

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
    })

    const plane = new THREE.Mesh(planeGeometry, material)
    plane.position.set(0, 0, -index * 0.01)
    plane.visible = index === 0

    planes.push(plane)
    scene.value.add(plane)
  })

  transitionManager = new TransitionManager(scene.value, textures, planeConfig)
}

const handleResize = () => {
  const newPlaneConfig = onResize()
  if (!newPlaneConfig) return

  planes.forEach((plane) => {
    plane.geometry.dispose()
    plane.geometry = new THREE.PlaneGeometry(newPlaneConfig.width, newPlaneConfig.height)
  })

  if (transitionManager) {
    transitionManager.updatePlaneConfig(newPlaneConfig)
  }
}

const animate = () => {
  requestAnimationFrame(animate)

  if (store.isTransitioning && transitionManager) {
    const isComplete = transitionManager.update()
    if (isComplete) {
      store.setTransitioning(false)
      // After transition, only paint the current window
      updateActivePaintingWindows([store.currentIndex])
    }
  }

  if (renderer.value && scene.value && camera.value) {
    renderer.value.render(scene.value, camera.value)
  }
}

const updateActivePaintingWindows = async (indices: number[]) => {
  await window.ipcRenderer.invoke('set-active-painting-windows', indices)
}

const transition = async (targetIndex: number, type: 'rain' | 'slice') => {
  if (store.isTransitioning || targetIndex === store.currentIndex) return

  store.setTransitioning(true)
  const fromIndex = store.currentIndex

  // Enable painting for both current and target windows during transition
  await updateActivePaintingWindows([fromIndex, targetIndex])

  planes[targetIndex].visible = true

  if (transitionManager) {
    transitionManager.startTransition(type, fromIndex, planes[fromIndex].position)
  }

  planes[fromIndex].visible = false
  store.setCurrentIndex(targetIndex)
}

const rotateWebview = () => {
  if (!allTexturesLoaded.value) return // Don't rotate until all textures are loaded

  const nextIndex = (store.currentIndex + 1) % urls.value.length
  const nextType = transitionManager?.getNextType() || 'rain'

  transition(nextIndex, nextType)
  store.toggleTransitionType()
}

const refreshWebviews = async () => {
  for (let i = 0; i < urls.value.length; i++) {
    await window.ipcRenderer.invoke('reload-webview', i)
  }
}

const checkAllTexturesLoaded = () => {
  if (loadedTextures.value.size === urls.value.length && !allTexturesLoaded.value) {
    allTexturesLoaded.value = true
    console.log('All textures loaded, starting slideshow')
    // Now only enable painting for the first window
    updateActivePaintingWindows([0])
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
  console.log(`Webview ${data.index} loaded: ${data.url}`)
  if (!store.setupMode) {
    loadedTextures.value.add(data.index)
    checkAllTexturesLoaded()
  }
}

const handleWebviewFrame = (_event: any, data: any) => {
  const { index } = data
  if (!store.setupMode && !loadedTextures.value.has(index)) {
    loadedTextures.value.add(index)
    checkAllTexturesLoaded()
  }
}

const { startTimers, stopTimers } = useRotationTimer(rotateWebview, refreshWebviews)

const handleDotClick = (index: number) => {
  if (!allTexturesLoaded.value) return // Don't allow transitions until loaded

  const nextType = transitionManager?.getNextType() || 'rain'
  transition(index, nextType)
  store.toggleTransitionType()
}

onMounted(async () => {
  await loadUrls()
  initScene()
  createPlanes()
  animate()

  // Set up custom frame listener first
  window.ipcRenderer.on('webview-frame', handleWebviewFrame)
  window.ipcRenderer.on('webview-loaded', handleWebviewLoaded)
  setupListeners()

  window.addEventListener('resize', handleResize)
  window.ipcRenderer.on('setup-complete', async () => {
    await handleSetupComplete()
    // Wait for all textures to load before starting timers
    const checkInterval = setInterval(() => {
      if (allTexturesLoaded.value) {
        clearInterval(checkInterval)
        startTimers()
      }
    }, 100)

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval)
      if (!allTexturesLoaded.value) {
        console.warn('Timeout waiting for textures, starting anyway')
        allTexturesLoaded.value = true
        startTimers()
      }
    }, 10000)
  })
})

onUnmounted(() => {
  stopTimers()
  window.ipcRenderer.off('webview-frame', handleWebviewFrame)
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
