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

// Rotation interval
const ROTATION_INTERVAL = 10000
const TRANSITION_DURATION = 1500
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
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.z = 5

  // Setup renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
  })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)

  // Create planes for each webview
  const planeGeometry = new THREE.PlaneGeometry(6, 3.375) // 16:9 aspect ratio

  urls.forEach((url, index) => {
    // Create texture
    const texture = new THREE.Texture()
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    textures.push(texture)

    // Create material with texture
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    })

    // Create mesh
    const plane = new THREE.Mesh(planeGeometry, material)
    plane.position.x = index * 10 // Space them out
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
}

const animate = () => {
  requestAnimationFrame(animate)
  renderer.render(scene, camera)
}

const handleWebviewFrame = (_event: any, data: WebviewFrame) => {
  const { index, buffer, size } = data

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

const transitionToIndex = async (targetIndex: number) => {
  if (isTransitioning.value || targetIndex === currentIndex.value) return

  isTransitioning.value = true
  const fromIndex = currentIndex.value
  const fromPlane = planes[fromIndex]
  const toPlane = planes[targetIndex]

  // Make both planes visible
  toPlane.visible = true

  // Position the target plane
  toPlane.position.set(10, 0, 0)
  toPlane.rotation.set(0, 0, 0)

  // Animate transition
  const startTime = Date.now()
  const animate = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / TRANSITION_DURATION, 1)

    // Easing function (ease-in-out)
    const eased =
      progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2

    // Slide and rotate transition
    fromPlane.position.x = -10 * eased
    fromPlane.rotation.y = -Math.PI * 0.5 * eased

    toPlane.position.x = 10 - 10 * eased
    toPlane.rotation.y = Math.PI * 0.5 - Math.PI * 0.5 * eased

    if (progress < 1) {
      requestAnimationFrame(animate)
    } else {
      // Hide the old plane
      fromPlane.visible = false
      fromPlane.position.set(0, 0, 0)
      fromPlane.rotation.set(0, 0, 0)

      toPlane.position.set(0, 0, 0)
      toPlane.rotation.set(0, 0, 0)

      currentIndex.value = targetIndex
      isTransitioning.value = false
    }
  }

  animate()
}

const rotateWebview = () => {
  const nextIndex = (currentIndex.value + 1) % urls.length
  transitionToIndex(nextIndex)
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
  transitionToIndex(index)
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

    <!-- Loading indicator -->
    <div v-if="isTransitioning" class="transition-indicator">Transitioning...</div>
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
