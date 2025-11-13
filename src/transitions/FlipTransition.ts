import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class FlipTransition extends BaseTransition {
  private pivotGroup: THREE.Group | null = null
  private planeMesh: THREE.Mesh | null = null
  private progress = 0

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig
    const geometry = new THREE.PlaneGeometry(width, height)

    const texture = this.textures[fromIndex]
    if (!texture) return

    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true

    // Only render the front face so the old page disappears past 90°.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    // Create a pivot at the LEFT edge of the page to mimic a page turn.
    // The incoming plane is centered at planePosition; its left edge is at x - width/2.
    this.pivotGroup = new THREE.Group()
    this.pivotGroup.position.set(planePosition.x - width / 2, planePosition.y, planePosition.z + 0.001)
    this.pivotGroup.renderOrder = 1000
    this.scene.add(this.pivotGroup)

    this.planeMesh = new THREE.Mesh(geometry, material)
    // Offset the page so its LEFT edge sits at the group's origin (hinge).
    this.planeMesh.position.set(width / 2, 0, 0)
    this.planeMesh.renderOrder = 1001
    this.pivotGroup.add(this.planeMesh)
    this.progress = 0
  }

  update(): boolean {
    if (!this.pivotGroup || !this.planeMesh) return true

    // Create easing function for smooth animation
    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    }

    // Clamp progress to 1.0 for rendering
    const renderProgress = Math.min(this.progress, 1.0)
    const eased = easeInOutCubic(renderProgress)

    // Rotate the page around the hinge (left edge).
    const angle = eased * Math.PI
    this.pivotGroup.rotation.y = angle

    // Subtle shading to enhance the ortho look: darken slightly as the page turns.
    const material = this.planeMesh.material as THREE.MeshBasicMaterial
    const darken = 0.15 + 0.85 * Math.abs(Math.cos(angle))
    material.opacity = darken

    // Increment progress after applying transformations
    this.progress += 1 / 60 / this.durationSeconds

    return this.progress >= 1.0
  }

  cleanup(): void {
    if (this.pivotGroup && this.planeMesh) {
      this.scene.remove(this.pivotGroup)
      this.planeMesh.geometry.dispose()

      const material = this.planeMesh.material as THREE.MeshBasicMaterial
      // Do not dispose the shared texture (material.map). Only dispose the material.
      material.dispose()

      this.planeMesh = null
      this.pivotGroup.clear()
      this.pivotGroup = null
    }
    this.progress = 0
  }
}
