import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'
import { calculateUVCoordinates, calculateFragmentPosition } from '../utils/geometry'

// Inline type to avoid import issues
interface Fragment {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  rotationSpeed: THREE.Vector3
  startY: number
  targetY: number
}

export class RainTransition extends BaseTransition {
  private fragments: Fragment[] = []
  private readonly gridCols = 20
  private readonly gridRows = 10
  private sharedTexture: THREE.Texture | null = null
  private elapsedSeconds = 0

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width: planeWidth, height: planeHeight } = this.planeConfig
    const fragmentWidth = planeWidth / this.gridCols
    const fragmentHeight = planeHeight / this.gridRows

    // Use the existing texture reference for accuracy and to avoid
    // duplicating the image. Cloning textures can cause stale image
    // data when the source texture is resized.
    this.sharedTexture = this.textures[fromIndex] || null
    if (this.sharedTexture) {
      this.sharedTexture.colorSpace = THREE.SRGBColorSpace
      this.sharedTexture.needsUpdate = true
    }

    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        const geometry = new THREE.PlaneGeometry(fragmentWidth, fragmentHeight)
        const uvAttribute = geometry.attributes.uv

        const { uStart, uEnd, vStart, vEnd } = calculateUVCoordinates(
          row,
          col,
          this.gridRows,
          this.gridCols,
        )

        uvAttribute?.setXY(0, uStart, vEnd)
        uvAttribute?.setXY(1, uEnd, vEnd)
        uvAttribute?.setXY(2, uStart, vStart)
        uvAttribute?.setXY(3, uEnd, vStart)

        // Share the same texture across all fragments
        const material = new THREE.MeshBasicMaterial({
          map: this.sharedTexture,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
        })

        const fragment = new THREE.Mesh(geometry, material)

        const { x, y } = calculateFragmentPosition(
          row,
          col,
          planeWidth,
          planeHeight,
          fragmentWidth,
          fragmentHeight,
        )
        fragment.position.set(x, y, planePosition.z)
        fragment.renderOrder = 1000

        const velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 0.02,
          Math.random() * -0.01,
          (Math.random() - 0.5) * 0.01,
        )

        const rotationSpeed = new THREE.Vector3(
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05,
        )

        this.scene.add(fragment)
        const startY = fragment.position.y
        // Ensure each fragment ends well below the view by t=1; vary slightly for natural look
        const overshoot = 2 + Math.random() * 3 // 2..5 units past threshold
        const targetY = -8 - overshoot
        this.fragments.push({ mesh: fragment, velocity, rotationSpeed, startY, targetY })
      }
    }
  }

  update(): boolean {
    // Advance elapsed time and compute normalized progress [0,1]
    this.elapsedSeconds += 1 / 60
    const t = Math.min(1, this.elapsedSeconds / this.durationSeconds)

    // Ease for natural acceleration: accelerate downwards at start
    const easeInCubic = (x: number) => x * x * x
    const p = easeInCubic(t)

    this.fragments.forEach((fragment) => {
      // Interpolate Y towards the target by eased progress
      const newY = fragment.startY + (fragment.targetY - fragment.startY) * p
      fragment.mesh.position.y = newY

      // Simple rotation evolution over time for organic feel
      fragment.mesh.rotation.x += fragment.rotationSpeed.x
      fragment.mesh.rotation.y += fragment.rotationSpeed.y
      fragment.mesh.rotation.z += fragment.rotationSpeed.z

      // Fade out over the duration
      ;(fragment.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0 - t
    })

    return t >= 1
  }

  cleanup(): void {
    this.fragments.forEach((fragment) => {
      this.scene.remove(fragment.mesh)
      fragment.mesh.geometry.dispose()
      if (fragment.mesh.material instanceof THREE.Material) {
        // Dispose only the material/geometry. Do NOT dispose the shared
        // texture because it's owned by the main textures array.
        fragment.mesh.material.dispose()
      }
    })
    this.fragments.length = 0

    // Do not dispose sharedTexture; it's managed by the main application.
    this.sharedTexture = null
  }
}
