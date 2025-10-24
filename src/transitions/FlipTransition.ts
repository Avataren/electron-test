import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class FlipTransition extends BaseTransition {
  private planeMesh: THREE.Mesh | null = null
  private progress = 0
  private readonly duration = 2.5

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig
    const geometry = new THREE.PlaneGeometry(width, height)

    const texture = this.textures[fromIndex]?.clone() || null
    if (!texture) return

    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.needsUpdate = true

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
    })

    this.planeMesh = new THREE.Mesh(geometry, material)
    this.planeMesh.position.set(planePosition.x, planePosition.y, planePosition.z + 0.01)
    this.scene.add(this.planeMesh)
    this.progress = 0
  }

  update(): boolean {
    if (!this.planeMesh) return true

    this.progress += 1 / 60 / this.duration

    // Create easing function for smooth animation
    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    }

    const easedProgress = easeInOutCubic(this.progress)

    // Rotate the plane in 3D space
    this.planeMesh.rotation.y = easedProgress * Math.PI

    // Scale down slightly during flip for depth effect
    const scale = 1 - easedProgress * 0.2 + (easedProgress > 0.5 ? (easedProgress - 0.5) * 0.4 : 0)
    this.planeMesh.scale.set(scale, scale, 1)

    // Fade out when edge-on
    const material = this.planeMesh.material as THREE.MeshBasicMaterial
    const opacity = Math.abs(Math.cos(easedProgress * Math.PI))
    material.opacity = opacity

    return this.progress >= 1.0
  }

  cleanup(): void {
    if (this.planeMesh) {
      this.scene.remove(this.planeMesh)
      this.planeMesh.geometry.dispose()

      const material = this.planeMesh.material as THREE.MeshBasicMaterial
      if (material.map) {
        material.map.dispose()
      }
      material.dispose()

      this.planeMesh = null
    }
    this.progress = 0
  }
}
