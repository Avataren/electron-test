import { shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { calculatePlaneSize } from '../utils/geometry'

const FOV = 75
const DISTANCE = 5

export function useThreeScene(canvasRef: Ref<HTMLCanvasElement | null>) {
  const scene = shallowRef<THREE.Scene | null>(null) // Change ref to shallowRef
  const camera = shallowRef<THREE.PerspectiveCamera | null>(null) // Change ref to shallowRef
  const renderer = shallowRef<THREE.WebGLRenderer | null>(null) // Change ref to shallowRef

  const initScene = () => {
    if (!canvasRef.value) return

    scene.value = new THREE.Scene()
    scene.value.background = new THREE.Color(0x000000)

    camera.value = new THREE.PerspectiveCamera(
      FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    )
    camera.value.position.z = DISTANCE

    renderer.value = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
    })
    renderer.value.setSize(window.innerWidth, window.innerHeight)
    renderer.value.setPixelRatio(window.devicePixelRatio)
    renderer.value.outputColorSpace = THREE.LinearSRGBColorSpace
  }

  const onResize = () => {
    if (!camera.value || !renderer.value) return

    camera.value.aspect = window.innerWidth / window.innerHeight
    camera.value.updateProjectionMatrix()
    renderer.value.setSize(window.innerWidth, window.innerHeight)

    return calculatePlaneSize({
      fov: FOV,
      distance: DISTANCE,
      aspect: camera.value.aspect,
    })
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
    FOV,
    DISTANCE,
  }
}
