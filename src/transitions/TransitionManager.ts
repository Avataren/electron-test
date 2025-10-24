import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'
import { RainTransition } from './RainTransition'
import { SliceTransition } from './SliceTransition'
import type { PlaneConfig } from '../utils/geometry'

// Inline type to avoid import issues
type TransitionType = 'rain' | 'slice'

export class TransitionManager {
  private currentTransition: BaseTransition | null = null
  private currentType: TransitionType = 'rain'
  private readonly scene: THREE.Scene
  private readonly textures: THREE.Texture[]
  private readonly planeConfig: PlaneConfig

  constructor(scene: THREE.Scene, textures: THREE.Texture[], planeConfig: PlaneConfig) {
    this.scene = scene
    this.textures = textures
    this.planeConfig = planeConfig
  }

  startTransition(type: TransitionType, fromIndex: number, planePosition: THREE.Vector3): void {
    this.cleanup()

    if (type === 'rain') {
      this.currentTransition = new RainTransition(this.scene, this.textures, this.planeConfig)
    } else {
      this.currentTransition = new SliceTransition(this.scene, this.textures, this.planeConfig)
    }

    this.currentTransition.create(fromIndex, planePosition)
    this.currentType = type
  }

  update(): boolean {
    if (!this.currentTransition) return true

    const isComplete = this.currentTransition.update()

    if (isComplete) {
      this.cleanup()
    }

    return isComplete
  }

  cleanup(): void {
    if (this.currentTransition) {
      this.currentTransition.cleanup()
      this.currentTransition = null
    }
  }

  getCurrentType(): TransitionType {
    return this.currentType
  }

  getNextType(): TransitionType {
    return this.currentType === 'rain' ? 'slice' : 'rain'
  }

  hasActiveTransition(): boolean {
    return this.currentTransition !== null
  }

  updatePlaneConfig(config: PlaneConfig): void {
    this.planeConfig.width = config.width
    this.planeConfig.height = config.height
  }
}
