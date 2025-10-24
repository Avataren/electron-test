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
let cube: THREE.Group
const textures: THREE.Texture[] = []
let urls: string[] = []

// Rotation interval
const ROTATION_INTERVAL = 10000
const TRANSITION_DURATION = 2000
let rotationTimer: number | null = null

// Refresh webviews periodically (every 30 seconds)
const REFRESH_INTERVAL = 30000
let refreshTimer: number | null = null

// Current rotation state
const targetRotation = { x: 0, y: 0 }
const currentRotation = { x: 0, y: 0 }

const initThreeJS = () => {
  if (!canvasRef.value) return

  // Setup scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  // Setup camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.z = 8

  // Setup renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
  })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)

  // Add ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  // Add directional light
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4)
  directionalLight.position.set(5, 5, 5)
  scene.add(directionalLight)

  // Create cube group
  cube = new THREE.Group()
  scene.add(cube)

  // Create materials with textures for cube faces
  const boxSize = 5
  const materials: THREE.Material[] = []

  // Initialize 4 textures (we'll use 4 faces of the cube)
  for (let i = 0; i < 4; i++) {
    const texture = new THREE.Texture()
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    textures.push(texture)

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0.2,
    })
    materials.push(material)
  }

  // Fill remaining faces with solid colors
  materials.push(
    new THREE.MeshStandardMaterial({ color: 0x16213e }), // top
    new THREE.MeshStandardMaterial({ color: 0x16213e }), // bottom
  )

  // Create cube with materials
  const geometry = new THREE.BoxGeometry(boxSize, boxSize * 0.5625, boxSize) // 16:9 aspect for sides
  const cubeMesh = new THREE.Mesh(geometry, materials)
  cube.add(cubeMesh)

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

  // Smooth rotation interpolation
  if (isTransitioning.value) {
    currentRotation.x += (targetRotation.x - currentRotation.x) * 0.05
    currentRotation.y += (targetRotation.y - currentRotation.y) * 0.05

    cube.rotation.x = currentRotation.x
    cube.rotation.y = currentRotation.y

    // Check if we're close enough to target
    const diffX = Math.abs(targetRotation.x - currentRotation.x)
    const diffY = Math.abs(targetRotation.y - currentRotation.y)
    if (diffX < 0.01 && diffY < 0.01) {
      isTransitioning.value = false
    }
  } else {
    // Gentle idle rotation when not transitioning
    cube.rotation.x += 0.001
    cube.rotation.y += 0.001
  }

  renderer.render(scene, camera)
}

const handleWebviewFrame = (_event: any, data: WebviewFrame) => {
  const { index, buffer } = data

  if (!textures[index]) return

  const tex = textures[index]

  // Create image from buffer
  // Cast to any to allow ArrayBuffer|SharedArrayBuffer union at runtime
  const blob = new Blob([buffer as any], { type: 'image/jpeg' })
  const url = URL.createObjectURL(blob)

  const img = new Image()
  img.onload = () => {
    if (!tex) return
    tex.image = img
    tex.needsUpdate = true
    URL.revokeObjectURL(url)
  }
  img.src = url
}

const transitionToIndex = (targetIndex: number) => {
  if (isTransitioning.value || targetIndex === currentIndex.value) return

  isTransitioning.value = true
  currentIndex.value = targetIndex

  // Calculate rotation to show the correct face
  // Front face (0): y=0
  // Right face (1): y=-PI/2
  // Back face (2): y=-PI
  // Left face (3): y=-3PI/2 or PI/2

  targetRotation.y = -(Math.PI / 2) * targetIndex
  targetRotation.x = 0
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
  cube.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose())
      } else {
        object.material.dispose()
      }
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

    <!-- Title overlay -->
    <div class="title-overlay">3D Cube Dashboard</div>

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

    <!-- Instructions -->
    <div class="instructions">Click dots or wait for auto-rotation</div>
  </div>
</template>

<style scoped>
.webview-3d-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.three-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.title-overlay {
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.9);
  font-size: 32px;
  font-weight: 300;
  letter-spacing: 2px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  z-index: 10;
  pointer-events: none;
}

.indicator {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  background-color: rgba(0, 0, 0, 0.6);
  padding: 12px 24px;
  border-radius: 25px;
  backdrop-filter: blur(10px);
  z-index: 10;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.4);
  transition: all 0.3s ease;
  cursor: pointer;
  border: 2px solid transparent;
}

.dot:hover {
  background-color: rgba(255, 255, 255, 0.7);
  transform: scale(1.3);
  border-color: rgba(255, 255, 255, 0.5);
}

.dot.active {
  background-color: #4ecca3;
  transform: scale(1.4);
  box-shadow: 0 0 15px rgba(78, 204, 163, 0.6);
}

.instructions {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  letter-spacing: 1px;
  z-index: 10;
  pointer-events: none;
}
</style>
