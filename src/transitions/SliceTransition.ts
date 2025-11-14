import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

// Inline type to avoid import issues
interface Slice {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  direction: number
  startX?: number
  targetX?: number
}

export class SliceTransition extends BaseTransition {
  private slices: Slice[] = []
  private readonly numSlices = 8
  private sharedTexture: THREE.Texture | null = null
  private sharedMaterial: THREE.MeshBasicMaterial | null = null
  private elapsedSeconds = 0

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width: planeWidth, height: planeHeight } = this.planeConfig
    const sliceHeight = planeHeight / this.numSlices

    // Use existing texture reference to keep it in sync with the source
    this.sharedTexture = this.textures[fromIndex] || null
    if (this.sharedTexture) {
      this.sharedTexture.colorSpace = THREE.SRGBColorSpace
      this.sharedTexture.needsUpdate = true
      // Use a single shared material across all slices
      this.sharedMaterial = new THREE.MeshBasicMaterial({
        map: this.sharedTexture,
        side: THREE.FrontSide,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    }

    for (let i = 0; i < this.numSlices; i++) {
      const geometry = new THREE.PlaneGeometry(planeWidth, sliceHeight)
      const uvAttribute = geometry.attributes.uv

      const vStart = 1 - (i + 1) / this.numSlices
      const vEnd = 1 - i / this.numSlices

      uvAttribute?.setXY(0, 0, vEnd)
      uvAttribute?.setXY(1, 1, vEnd)
      uvAttribute?.setXY(2, 0, vStart)
      uvAttribute?.setXY(3, 1, vStart)

      // Share a single material across all slices for fewer draw state changes
      const material = this.sharedMaterial as THREE.MeshBasicMaterial

      const slice = new THREE.Mesh(geometry, material)

      const y = planeHeight / 2 - sliceHeight / 2 - i * sliceHeight
      slice.position.set(0, y, planePosition.z)
      slice.renderOrder = 1000

      const direction = i % 2 === 0 ? 1 : -1
      const velocity = new THREE.Vector3(0.15, 0, 0)

      this.scene.add(slice)
      // Precompute travel distance so that slice is well off-screen by the end
      const totalDistance = 16 // should pass the 15 threshold used previously
      const startX = 0
      const targetX = direction * totalDistance
      this.slices.push({ mesh: slice, velocity, direction, startX, targetX })
    }
  }

  update(): boolean {
    // Advance elapsed time and compute normalized progress [0,1]
    this.elapsedSeconds += 1 / 60
    const t = Math.min(1, this.elapsedSeconds / this.durationSeconds)

    // Smooth ease to start/stop nicely
    const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
    const p = easeInOutCubic(t)

    this.slices.forEach((slice) => {
      const startX = slice.startX ?? 0
      const targetX = slice.targetX ?? slice.direction * 16
      slice.mesh.position.x = startX + (targetX - startX) * p
    })
    // Fade out uniformly over time (shared material)
    if (this.sharedMaterial) this.sharedMaterial.opacity = 1.0 - t

    return t >= 1
  }

  cleanup(): void {
    this.slices.forEach((slice) => {
      this.scene.remove(slice.mesh)
      slice.mesh.geometry.dispose()
    })
    this.slices.length = 0

    // Do not dispose sharedTexture; it's managed by the main application.
    this.sharedTexture = null
    if (this.sharedMaterial) {
      this.sharedMaterial.dispose()
      this.sharedMaterial = null
    }
  }
}
