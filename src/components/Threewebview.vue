<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'

// Define the IPC renderer type
declare global {
  interface Window {
    ipcRenderer: {
      on: (channel: string, callback: (...args: any[]) => void) => void
      off: (channel: string, callback: (...args: any[]) => void) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}

interface WebviewFrame {
  index: number
  buffer: Uint8Array
  size: { width: number; height: number }
}

interface Fragment {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  rotationSpeed: THREE.Vector3
}

interface Slice {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  direction: number // 1 for right, -1 for left
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentIndex = ref(0)
const isTransitioning = ref(false)
const setupMode = ref(true)
const setupIndex = ref(0)

// Three.js objects
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
const planes: THREE.Mesh[] = []
const textures: THREE.Texture[] = []
let urls: string[] = []

// Fragment system for transition 1 (rain effect)
const fragments: Fragment[] = []
const GRID_COLS = 20
const GRID_ROWS = 10

// Slice system for transition 2 (horizontal slices)
const slices: Slice[] = []
const NUM_SLICES = 8
let currentTransitionType: 'rain' | 'slice' = 'rain'

// Timing
const ROTATION_INTERVAL = 10000
const TRANSITION_DURATION = 2500
let rotationTimer: number | null = null

// Refresh webviews periodically (every 30 seconds)
const REFRESH_INTERVAL = 30000
let refreshTimer: number | null = null

const showSetupView = async (index: number) => {
  setupIndex.value = index
  await window.ipcRenderer.invoke('show-setup-view', index)
}

const nextSetupPage = () => {
  const nextIndex = (setupIndex.value + 1) % urls.length
  showSetupView(nextIndex)
}

const prevSetupPage = () => {
  const prevIndex = (setupIndex.value - 1 + urls.length) % urls.length
  showSetupView(prevIndex)
}

const finishSetup = async () => {
  setupMode.value = false
  await window.ipcRenderer.invoke('finish-setup')
}

const initThreeJS = () => {
  if (!canvasRef.value) return

  // Setup scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  // Setup camera
  const fov = 75
  const distance = 5
  camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.z = distance

  // Setup renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
  })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace

  // Calculate plane size to fit viewport while maintaining 16:9 aspect ratio (1920x1080)
  const webpageAspect = 16 / 9
  const vFOV = (fov * Math.PI) / 180
  const viewportHeight = 2 * Math.tan(vFOV / 2) * distance
  const viewportWidth = viewportHeight * camera.aspect

  let planeWidth: number
  let planeHeight: number

  if (camera.aspect > webpageAspect) {
    // Viewport is wider than 16:9 - use pillarboxing (fit to height)
    planeHeight = viewportHeight
    planeWidth = planeHeight * webpageAspect
  } else {
    // Viewport is taller than 16:9 - use letterboxing (fit to width)
    planeWidth = viewportWidth
    planeHeight = planeWidth / webpageAspect
  }

  const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight)

  // Create fullscreen planes for each webview (stacked at same position)
  urls.forEach((url, index) => {
    // Create texture
    const texture = new THREE.Texture()
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.LinearSRGBColorSpace
    textures.push(texture)

    // Create material with texture
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
    })

    // Create mesh - all at same position, stacked
    const plane = new THREE.Mesh(planeGeometry, material)
    plane.position.set(0, 0, -index * 0.01) // Slight z offset to prevent z-fighting
    plane.visible = index === 0 // Only show first plane initially

    planes.push(plane)
    scene.add(plane)
  })

  // Start animation loop
  animate()

  // Handle window resize
  window.addEventListener('resize', onWindowResize)
}

const onWindowResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)

  // Recalculate plane sizes to maintain 16:9 aspect ratio with letterboxing/pillarboxing
  const fov = 75
  const distance = 5
  const webpageAspect = 16 / 9
  const vFOV = (fov * Math.PI) / 180
  const viewportHeight = 2 * Math.tan(vFOV / 2) * distance
  const viewportWidth = viewportHeight * camera.aspect

  let planeWidth: number
  let planeHeight: number

  if (camera.aspect > webpageAspect) {
    // Viewport is wider than 16:9 - use pillarboxing (fit to height)
    planeHeight = viewportHeight
    planeWidth = planeHeight * webpageAspect
  } else {
    // Viewport is taller than 16:9 - use letterboxing (fit to width)
    planeWidth = viewportWidth
    planeHeight = planeWidth / webpageAspect
  }

  planes.forEach((plane) => {
    plane.geometry.dispose()
    plane.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight)
  })
}

const animate = () => {
  requestAnimationFrame(animate)

  if (isTransitioning.value && fragments.length > 0) {
    // Animate fragments falling (rain transition)
    fragments.forEach((fragment) => {
      // Apply gravity
      fragment.velocity.y -= 0.015

      // Update position
      fragment.mesh.position.add(fragment.velocity)

      // Update rotation
      fragment.mesh.rotation.x += fragment.rotationSpeed.x
      fragment.mesh.rotation.y += fragment.rotationSpeed.y
      fragment.mesh.rotation.z += fragment.rotationSpeed.z

      // Fade out as they fall
      if (fragment.mesh.position.y < -3) {
        const fadeStart = -3
        const fadeEnd = -8
        const fadeProgress = Math.max(
          0,
          Math.min(1, (fragment.mesh.position.y - fadeStart) / (fadeEnd - fadeStart)),
        )
        ;(fragment.mesh.material as THREE.MeshBasicMaterial).opacity = fadeProgress
      }
    })

    // Check if transition is complete (all fragments off screen)
    const allOffScreen = fragments.every((f) => f.mesh.position.y < -8)
    if (allOffScreen) {
      cleanupFragments()
      isTransitioning.value = false
    }
  }

  if (isTransitioning.value && slices.length > 0) {
    // Animate slices moving horizontally
    slices.forEach((slice) => {
      slice.mesh.position.x += slice.velocity.x * slice.direction
    })

    // Check if all slices are off screen (beyond ±15 units)
    const allOffScreen = slices.every((s) => Math.abs(s.mesh.position.x) > 15)
    if (allOffScreen) {
      cleanupSlices()
      isTransitioning.value = false
    }
  }

  renderer.render(scene, camera)
}

const handleWebviewFrame = (_event: any, data: WebviewFrame) => {
  const { index, buffer } = data

  if (!textures[index]) return

  // Create image from buffer
  const blob = new Blob([buffer], { type: 'image/jpeg' })
  const url = URL.createObjectURL(blob)

  const img = new Image()
  img.onload = () => {
    textures[index].image = img
    textures[index].needsUpdate = true
    URL.revokeObjectURL(url)
  }
  img.src = url
}

const createFragments = (fromIndex: number) => {
  const fromPlane = planes[fromIndex]

  // Calculate plane dimensions using same method as initialization (16:9 aspect)
  const fov = 75
  const distance = 5
  const webpageAspect = 16 / 9
  const vFOV = (fov * Math.PI) / 180
  const viewportHeight = 2 * Math.tan(vFOV / 2) * distance
  const viewportWidth = viewportHeight * camera.aspect

  let planeWidth: number
  let planeHeight: number

  if (camera.aspect > webpageAspect) {
    // Viewport is wider than 16:9 - use pillarboxing (fit to height)
    planeHeight = viewportHeight
    planeWidth = planeHeight * webpageAspect
  } else {
    // Viewport is taller than 16:9 - use letterboxing (fit to width)
    planeWidth = viewportWidth
    planeHeight = planeWidth / webpageAspect
  }

  const fragmentWidth = planeWidth / GRID_COLS
  const fragmentHeight = planeHeight / GRID_ROWS

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      // Create fragment geometry
      const geometry = new THREE.PlaneGeometry(fragmentWidth, fragmentHeight)

      // Calculate UV coordinates for this fragment
      const uvAttribute = geometry.attributes.uv
      const uStart = col / GRID_COLS
      const uEnd = (col + 1) / GRID_COLS
      const vStart = 1 - (row + 1) / GRID_ROWS // Flip V coordinate
      const vEnd = 1 - row / GRID_ROWS

      uvAttribute.setXY(0, uStart, vEnd)
      uvAttribute.setXY(1, uEnd, vEnd)
      uvAttribute.setXY(2, uStart, vStart)
      uvAttribute.setXY(3, uEnd, vStart)

      // Clone material and texture for fragment
      const material = new THREE.MeshBasicMaterial({
        map: textures[fromIndex].clone(),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
      })
      material.map!.colorSpace = THREE.LinearSRGBColorSpace
      material.map!.needsUpdate = true

      // Create fragment mesh
      const fragment = new THREE.Mesh(geometry, material)

      // Position fragment at correct grid location
      const x = -planeWidth / 2 + fragmentWidth / 2 + col * fragmentWidth
      const y = planeHeight / 2 - fragmentHeight / 2 - row * fragmentHeight
      fragment.position.set(x, y, fromPlane.position.z + 0.01)

      // Random initial velocity
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.02, // Small horizontal drift
        Math.random() * -0.01, // Initial downward velocity (small)
        (Math.random() - 0.5) * 0.01, // Small depth variation
      )

      // Random rotation speeds
      const rotationSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 0.05,
        (Math.random() - 0.5) * 0.05,
        (Math.random() - 0.5) * 0.05,
      )

      scene.add(fragment)
      fragments.push({ mesh: fragment, velocity, rotationSpeed })
    }
  }
}

const cleanupFragments = () => {
  fragments.forEach((fragment) => {
    scene.remove(fragment.mesh)
    fragment.mesh.geometry.dispose()
    if (fragment.mesh.material instanceof THREE.Material) {
      if (fragment.mesh.material.map) {
        fragment.mesh.material.map.dispose()
      }
      fragment.mesh.material.dispose()
    }
  })
  fragments.length = 0
}

const createSlices = (fromIndex: number) => {
  const fromPlane = planes[fromIndex]

  const fov = 75
  const distance = 5
  const webpageAspect = 16 / 9
  const vFOV = (fov * Math.PI) / 180
  const viewportHeight = 2 * Math.tan(vFOV / 2) * distance
  const viewportWidth = viewportHeight * camera.aspect

  let planeWidth: number
  let planeHeight: number

  if (camera.aspect > webpageAspect) {
    planeHeight = viewportHeight
    planeWidth = planeHeight * webpageAspect
  } else {
    planeWidth = viewportWidth
    planeHeight = planeWidth / webpageAspect
  }

  const sliceHeight = planeHeight / NUM_SLICES

  for (let i = 0; i < NUM_SLICES; i++) {
    const geometry = new THREE.PlaneGeometry(planeWidth, sliceHeight)

    // Calculate UV coordinates for this slice
    const uvAttribute = geometry.attributes.uv
    const vStart = 1 - (i + 1) / NUM_SLICES
    const vEnd = 1 - i / NUM_SLICES

    uvAttribute.setXY(0, 0, vEnd)
    uvAttribute.setXY(1, 1, vEnd)
    uvAttribute.setXY(2, 0, vStart)
    uvAttribute.setXY(3, 1, vStart)

    const material = new THREE.MeshBasicMaterial({
      map: textures[fromIndex].clone(),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    })
    material.map!.colorSpace = THREE.LinearSRGBColorSpace
    material.map!.needsUpdate = true

    const slice = new THREE.Mesh(geometry, material)

    // Position slice at correct vertical location
    const y = planeHeight / 2 - sliceHeight / 2 - i * sliceHeight
    slice.position.set(0, y, fromPlane.position.z + 0.01)

    // Alternate direction: even rows go right, odd rows go left
    const direction = i % 2 === 0 ? 1 : -1
    const velocity = new THREE.Vector3(0.15, 0, 0)

    scene.add(slice)
    slices.push({ mesh: slice, velocity, direction })
  }
}

const cleanupSlices = () => {
  slices.forEach((slice) => {
    scene.remove(slice.mesh)
    slice.mesh.geometry.dispose()
    if (slice.mesh.material instanceof THREE.Material) {
      if (slice.mesh.material.map) {
        slice.mesh.material.map.dispose()
      }
      slice.mesh.material.dispose()
    }
  })
  slices.length = 0
}

const transitionRain = async (targetIndex: number) => {
  if (isTransitioning.value || targetIndex === currentIndex.value) return

  isTransitioning.value = true
  const fromIndex = currentIndex.value

  // Show the target plane behind
  planes[targetIndex].visible = true

  // Create fragments from current plane
  createFragments(fromIndex)

  // Hide the original plane
  planes[fromIndex].visible = false

  // Update current index immediately
  currentIndex.value = targetIndex

  // Animation happens in the animate loop
  // Transition will complete when fragments are off screen
}

const transitionSlice = async (targetIndex: number) => {
  if (isTransitioning.value || targetIndex === currentIndex.value) return

  isTransitioning.value = true
  const fromIndex = currentIndex.value

  planes[targetIndex].visible = true
  createSlices(fromIndex)
  planes[fromIndex].visible = false
  currentIndex.value = targetIndex
}

const rotateWebview = () => {
  const nextIndex = (currentIndex.value + 1) % urls.length

  // Alternate between transition types
  if (currentTransitionType === 'rain') {
    transitionSlice(nextIndex)
    currentTransitionType = 'slice'
  } else {
    transitionRain(nextIndex)
    currentTransitionType = 'rain'
  }
}

const refreshWebviews = async () => {
  // Reload all offscreen webviews
  for (let i = 0; i < urls.length; i++) {
    await window.ipcRenderer.invoke('reload-webview', i)
  }
}

const handleSetupComplete = () => {
  // Start timers after setup is complete
  rotationTimer = window.setInterval(rotateWebview, ROTATION_INTERVAL)
  refreshTimer = window.setInterval(refreshWebviews, REFRESH_INTERVAL)
}

onMounted(async () => {
  // Get URLs from main process
  urls = await window.ipcRenderer.invoke('get-webview-urls')

  // Initialize Three.js
  initThreeJS()

  // Listen for webview frames
  window.ipcRenderer.on('webview-frame', handleWebviewFrame)

  // Listen for webview loaded events
  window.ipcRenderer.on('webview-loaded', (_event: any, data: { index: number; url: string }) => {
    console.log(`Webview ${data.index} loaded: ${data.url}`)
  })

  // Listen for setup complete
  window.ipcRenderer.on('setup-complete', handleSetupComplete)
})

onUnmounted(() => {
  // Clear timers
  if (rotationTimer !== null) {
    clearInterval(rotationTimer)
  }
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
  }

  // Remove event listeners
  window.ipcRenderer.off('webview-frame', handleWebviewFrame)
  window.ipcRenderer.off('setup-complete', handleSetupComplete)
  window.removeEventListener('resize', onWindowResize)

  // Cleanup fragments and slices
  cleanupFragments()
  cleanupSlices()

  // Cleanup Three.js
  if (renderer) {
    renderer.dispose()
  }
  textures.forEach((texture) => texture.dispose())
  planes.forEach((plane) => {
    plane.geometry.dispose()
    if (plane.material instanceof THREE.Material) {
      plane.material.dispose()
    }
  })
})

const handleDotClick = (index: number) => {
  // Use current transition type for manual clicks
  if (currentTransitionType === 'rain') {
    transitionRain(index)
    currentTransitionType = 'slice'
  } else {
    transitionSlice(index)
    currentTransitionType = 'rain'
  }
}
</script>

<template>
  <div class="webview-3d-container">
    <!-- Setup Mode Control Bar (at bottom) -->
    <div v-if="setupMode" class="setup-control-bar">
      <div class="setup-content">
        <div class="setup-info">
          <h2>Setup Mode</h2>
          <p>Page {{ setupIndex + 1 }} of {{ urls.length }} - Log in to your pages above</p>
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
            :class="{ active: setupIndex === index }"
            @click="showSetupView(index)"
          ></div>
        </div>
      </div>
    </div>

    <canvas ref="canvasRef" class="three-canvas" :class="{ hidden: setupMode }"></canvas>

    <!-- Display current page indicator -->
    <div v-if="!setupMode" class="indicator">
      <div
        v-for="(_, index) in urls.length"
        :key="index"
        class="dot"
        :class="{ active: currentIndex === index }"
        @click="handleDotClick(index)"
      ></div>
    </div>

    <!-- Transition indicator -->
    <div v-if="isTransitioning && !setupMode" class="transition-indicator">
      Transition {{ currentTransitionType === 'rain' ? '1: Rain' : '2: Slices' }}
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
  padding: 0 40px;
}

.setup-info {
  flex: 1;
  color: white;
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
