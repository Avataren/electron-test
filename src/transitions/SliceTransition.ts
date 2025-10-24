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

    // Clone texture once for entire transition instead of 8 times
    this.sharedTexture = this.textures[fromIndex]?.clone() || null
    if (this.sharedTexture) {
      this.sharedTexture.colorSpace = THREE.LinearSRGBColorSpace
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
      })

      const slice = new THREE.Mesh(geometry, material)

      const y = planeHeight / 2 - sliceHeight / 2 - i * sliceHeight
      slice.position.set(0, y, planePosition.z + 0.01)

      const direction = i % 2 === 0 ? 1 : -1
      const velocity = new THREE.Vector3(0.15, 0, 0)

      this.scene.add(slice)
      this.slices.push({ mesh: slice, velocity, direction })
    }
  }

  update(): boolean {
    this.slices.forEach((slice) => {
      slice.mesh.position.x += slice.velocity.x * slice.direction
    })

    return this.slices.every((s) => Math.abs(s.mesh.position.x) > 15)
  }

  cleanup(): void {
    this.slices.forEach((slice) => {
      this.scene.remove(slice.mesh)
      slice.mesh.geometry.dispose()
      if (slice.mesh.material instanceof THREE.Material) {
        // Don't dispose the shared texture here - we'll do it once below
        slice.mesh.material.dispose()
      }
    })
    this.slices.length = 0

    // Dispose the shared texture once
    if (this.sharedTexture) {
      this.sharedTexture.dispose()
      this.sharedTexture = null
    }
  }
}
