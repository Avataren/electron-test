import { shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { calculatePlaneSize } from '../utils/geometry'

// Orthographic camera uses frustum size instead of FOV
const FRUSTUM_HEIGHT = 2
const DISTANCE = 5

export function useThreeScene(canvasRef: Ref<HTMLCanvasElement | null>) {
  const scene = shallowRef<THREE.Scene | null>(null)
  const camera = shallowRef<THREE.OrthographicCamera | null>(null)
  const renderer = shallowRef<THREE.WebGLRenderer | null>(null)

  const initScene = () => {
    if (!canvasRef.value) return

    scene.value = new THREE.Scene()
    scene.value.background = new THREE.Color(0x000000)

    const aspect = window.innerWidth / window.innerHeight
    const frustumWidth = FRUSTUM_HEIGHT * aspect
    const halfWidth = frustumWidth / 2
    const halfHeight = FRUSTUM_HEIGHT / 2

    camera.value = new THREE.OrthographicCamera(
      -halfWidth,  // left
      halfWidth,   // right
      halfHeight,  // top
      -halfHeight, // bottom
      0.1,         // near
      1000,        // far
    )
    camera.value.position.z = DISTANCE
    camera.value.lookAt(0, 0, 0)

    renderer.value = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
    })
    renderer.value.setSize(window.innerWidth, window.innerHeight)
    renderer.value.setPixelRatio(window.devicePixelRatio)
    renderer.value.outputColorSpace = THREE.SRGBColorSpace
  }

  const onResize = (contentAspect?: number) => {
    if (!camera.value || !renderer.value) return

    const aspect = window.innerWidth / window.innerHeight
    const frustumWidth = FRUSTUM_HEIGHT * aspect
    const halfWidth = frustumWidth / 2
    const halfHeight = FRUSTUM_HEIGHT / 2

    camera.value.left = -halfWidth
    camera.value.right = halfWidth
    camera.value.top = halfHeight
    camera.value.bottom = -halfHeight
    camera.value.updateProjectionMatrix()

    // Ensure renderer size and devicePixelRatio stay in sync with the window.
    // This is critical when moving the window between monitors with different
    // scale factors to avoid subtle texture-to-page misalignment.
    renderer.value.setSize(window.innerWidth, window.innerHeight)
    renderer.value.setPixelRatio(window.devicePixelRatio)

    return calculatePlaneSize(
      {
        frustumHeight: FRUSTUM_HEIGHT,
        distance: DISTANCE,
        aspect: aspect,
      },
      contentAspect,
    )
  }

  const dispose = () => {
    if (renderer.value) {
      renderer.value.dispose()
    }
  }

  return {
    scene,
    camera,
    renderer,
    initScene,
    onResize,
    dispose,
    FRUSTUM_HEIGHT,
    DISTANCE,
  }
}
