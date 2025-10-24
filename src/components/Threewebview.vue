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

const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentIndex = ref(0)
const isTransitioning = ref(false)

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

// Timing
const ROTATION_INTERVAL = 10000
const TRANSITION_DURATION = 2500
let rotationTimer: number | null = null

// Refresh webviews periodically (every 30 seconds)
const REFRESH_INTERVAL = 30000
let refreshTimer: number | null = null

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
    // Animate fragments falling
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

const rotateWebview = () => {
  const nextIndex = (currentIndex.value + 1) % urls.length
  transitionRain(nextIndex)
}

const refreshWebviews = async () => {
  // Reload all offscreen webviews
  for (let i = 0; i < urls.length; i++) {
    await window.ipcRenderer.invoke('reload-webview', i)
  }
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

  // Start rotation timer
  rotationTimer = window.setInterval(rotateWebview, ROTATION_INTERVAL)

  // Start refresh timer
  refreshTimer = window.setInterval(refreshWebviews, REFRESH_INTERVAL)
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
  window.removeEventListener('resize', onWindowResize)

  // Cleanup fragments
  cleanupFragments()

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
  transitionRain(index)
}
</script>

<template>
  <div class="webview-3d-container">
    <canvas ref="canvasRef" class="three-canvas"></canvas>

    <!-- Display current page indicator -->
    <div class="indicator">
      <div
        v-for="(_, index) in urls.length"
        :key="index"
        class="dot"
        :class="{ active: currentIndex === index }"
        @click="handleDotClick(index)"
      ></div>
    </div>

    <!-- Transition indicator -->
    <div v-if="isTransitioning" class="transition-indicator">Transition 1: Rain</div>
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
