import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'
import { RainTransition } from './RainTransition'
import { SliceTransition } from './SliceTransition'
import { PixelateTransition } from './PixelateTransition'
import { RippleTransition } from './RippleTransition'
import { FlipTransition } from './FlipTransition'
import { GlitchTransition } from './GlitchTransition'
import { SwirlTransition } from './SwirlTransition'
import type { PlaneConfig } from '../utils/geometry'

// Inline type to avoid import issues
type TransitionType = 'rain' | 'slice' | 'pixelate' | 'ripple' | 'flip' | 'glitch' | 'swirl'

export class TransitionManager {
  private currentTransition: BaseTransition | null = null
  private currentType: TransitionType = 'rain'
  private currentTypeIndex = 0
  private readonly scene: THREE.Scene
  private readonly textures: THREE.Texture[]
  private readonly planeConfig: PlaneConfig
  private readonly transitionTypes: TransitionType[] = [
    'rain',
    'slice',
    'pixelate',
    'ripple',
    'flip',
    'glitch',
    'swirl',
  ]

  constructor(scene: THREE.Scene, textures: THREE.Texture[], planeConfig: PlaneConfig) {
    this.scene = scene
    this.textures = textures
    this.planeConfig = planeConfig
  }

  startTransition(type: TransitionType, fromIndex: number, planePosition: THREE.Vector3): void {
    this.cleanup()

    switch (type) {
      case 'rain':
        this.currentTransition = new RainTransition(this.scene, this.textures, this.planeConfig)
        break
      case 'slice':
        this.currentTransition = new SliceTransition(this.scene, this.textures, this.planeConfig)
        break
      case 'pixelate':
        this.currentTransition = new PixelateTransition(this.scene, this.textures, this.planeConfig)
        break
      case 'ripple':
        this.currentTransition = new RippleTransition(this.scene, this.textures, this.planeConfig)
        break
      case 'flip':
        this.currentTransition = new FlipTransition(this.scene, this.textures, this.planeConfig)
        break
      case 'glitch':
        this.currentTransition = new GlitchTransition(this.scene, this.textures, this.planeConfig)
        break
      case 'swirl':
        this.currentTransition = new SwirlTransition(this.scene, this.textures, this.planeConfig)
        break
    }

    if (this.currentTransition) {
      this.currentTransition.create(fromIndex, planePosition)
      this.currentType = type
    }
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
    this.currentTypeIndex = (this.currentTypeIndex + 1) % this.transitionTypes.length
    return this.transitionTypes[this.currentTypeIndex]
  }

  hasActiveTransition(): boolean {
    return this.currentTransition !== null
  }

  updatePlaneConfig(config: PlaneConfig): void {
    this.planeConfig.width = config.width
    this.planeConfig.height = config.height
  }

  getAllTransitionTypes(): TransitionType[] {
    return [...this.transitionTypes]
  }
}
