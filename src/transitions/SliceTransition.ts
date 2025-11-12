import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

// Inline type to avoid import issues
interface Slice {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  direction: number
}

export class SliceTransition extends BaseTransition {
  private slices: Slice[] = []
  private readonly numSlices = 8
  private sharedTexture: THREE.Texture | null = null

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width: planeWidth, height: planeHeight } = this.planeConfig
    const sliceHeight = planeHeight / this.numSlices

    // Use existing texture reference to keep it in sync with the source
    this.sharedTexture = this.textures[fromIndex] || null
    if (this.sharedTexture) {
      this.sharedTexture.colorSpace = THREE.SRGBColorSpace
      this.sharedTexture.needsUpdate = true
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

      // Share the same texture across all slices
      const material = new THREE.MeshBasicMaterial({
        map: this.sharedTexture,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      })

      const slice = new THREE.Mesh(geometry, material)

      const y = planeHeight / 2 - sliceHeight / 2 - i * sliceHeight
      slice.position.set(0, y, planePosition.z)
      slice.renderOrder = 1000

      const direction = i % 2 === 0 ? 1 : -1
      const velocity = new THREE.Vector3(0.15, 0, 0)

      this.scene.add(slice)
      this.slices.push({ mesh: slice, velocity, direction })
    }
  }

  update(): boolean {
    this.slices.forEach((slice) => {
      slice.mesh.position.x += slice.velocity.x * slice.direction

      // Fade out as slices move off-screen (start fading at x=12, fully transparent at x=15)
      const absX = Math.abs(slice.mesh.position.x)
      if (absX > 12) {
        const fadeStart = 12
        const fadeEnd = 15
        const fadeProgress = Math.min(1, (absX - fadeStart) / (fadeEnd - fadeStart))
        ;(slice.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0 - fadeProgress
      }
    })

    return this.slices.every((s) => Math.abs(s.mesh.position.x) > 15)
  }

  cleanup(): void {
    this.slices.forEach((slice) => {
      this.scene.remove(slice.mesh)
      slice.mesh.geometry.dispose()
      if (slice.mesh.material instanceof THREE.Material) {
        // Dispose only the material/geometry. Do NOT dispose the shared
        // texture because it's owned by the main textures array.
        slice.mesh.material.dispose()
      }
    })
    this.slices.length = 0

    // Do not dispose sharedTexture; it's managed by the main application.
    this.sharedTexture = null
  }
}
