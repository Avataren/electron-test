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

interface TransitionConfig {
  name: string
  enabled: boolean
}

export class TransitionManager {
  private currentTransition: BaseTransition | null = null
  private currentType: TransitionType = 'pixelate'
  private currentTypeIndex = 0
  private readonly scene: THREE.Scene
  private readonly textures: THREE.Texture[]
  private readonly planeConfig: PlaneConfig
  private readonly transitionTypes: TransitionType[]
  private readonly durationSeconds: number

  constructor(
    scene: THREE.Scene,
    textures: THREE.Texture[],
    planeConfig: PlaneConfig,
    transitionConfig?: TransitionConfig[],
    durationSeconds?: number,
  ) {
    this.scene = scene
    this.textures = textures
    this.planeConfig = planeConfig
    this.durationSeconds = typeof durationSeconds === 'number' && isFinite(durationSeconds)
      ? Math.max(0.000001, durationSeconds)
      : 1

    // Build list of enabled transitions from config
    if (transitionConfig && transitionConfig.length > 0) {
      this.transitionTypes = transitionConfig
        .filter((t) => t.enabled)
        .map((t) => t.name as TransitionType)
    } else {
      // Default to pixelate if no config provided
      this.transitionTypes = ['pixelate']
    }

    // Ensure we have at least one transition
    if (this.transitionTypes.length === 0) {
      console.warn('[TransitionManager] No enabled transitions, defaulting to pixelate')
      this.transitionTypes = ['pixelate']
    }

    // Set initial type to first enabled transition (guaranteed to exist after the check above)
    this.currentType = this.transitionTypes[0] as TransitionType

    console.log('[TransitionManager] Enabled transitions:', this.transitionTypes)
  }

  startTransition(type: TransitionType, fromIndex: number, planePosition: THREE.Vector3): void {
    this.cleanup()

    switch (type) {
      case 'rain':
        this.currentTransition = new RainTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      case 'slice':
        this.currentTransition = new SliceTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      case 'pixelate':
        this.currentTransition = new PixelateTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      case 'ripple':
        this.currentTransition = new RippleTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      case 'flip':
        this.currentTransition = new FlipTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      case 'glitch':
        this.currentTransition = new GlitchTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      case 'swirl':
        this.currentTransition = new SwirlTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
        break
      default:
        // Fall back to pixelate if unknown type
        this.currentTransition = new PixelateTransition(this.scene, this.textures, this.planeConfig, this.durationSeconds)
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
    return this.transitionTypes[this.currentTypeIndex] as TransitionType
  }

  hasActiveTransition(): boolean {
    return this.currentTransition !== null
  }

  updatePlaneConfig(config: PlaneConfig): void {
    this.planeConfig.width = config.width
    this.planeConfig.height = config.height

    // If there's an active transition, notify it about the dimension change
    // We need to get the actual texture dimensions, not plane dimensions
    if (this.currentTransition && this.currentTransition.updateResolution) {
      // Get texture dimensions from the first texture in the array
      // (all textures should have the same dimensions after a resize)
      const firstTexture = this.textures[0]
      if (firstTexture) {
        const textureImage = (firstTexture as any).image
        if (textureImage?.width && textureImage?.height) {
          const texWidth = textureImage.width
          const texHeight = textureImage.height
          console.log(`[TransitionManager] Propagating texture dimensions to active transition: ${texWidth}x${texHeight}`)
          this.currentTransition.updateResolution(texWidth, texHeight)
        }
      }
    }
  }

  getAllTransitionTypes(): TransitionType[] {
    return [...this.transitionTypes]
  }
}
