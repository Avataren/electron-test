import * as THREE from 'three'
import type { PlaneConfig } from '../utils/geometry'

export abstract class BaseTransition {
  protected scene: THREE.Scene
  protected textures: THREE.Texture[]
  protected planeConfig: PlaneConfig

  constructor(scene: THREE.Scene, textures: THREE.Texture[], planeConfig: PlaneConfig) {
    this.scene = scene
    this.textures = textures
    this.planeConfig = planeConfig
  }

  abstract create(fromIndex: number, planePosition: THREE.Vector3): void
  abstract update(): boolean
  abstract cleanup(): void

  /**
   * Optional method for transitions that need to respond to texture dimension changes.
   * Called when the window is resized and textures are recaptured at new dimensions.
   * @param width - New texture width in pixels
   * @param height - New texture height in pixels
   */
  updateResolution?(width: number, height: number): void
}
