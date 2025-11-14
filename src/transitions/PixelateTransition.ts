import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class PixelateTransition extends BaseTransition {
  private planeMesh: THREE.Mesh | null = null
  private progress = 0
  private lastTextureWidth = 0
  private lastTextureHeight = 0
  private textureRef: THREE.Texture | null = null
  private prevMagFilter: number | null = null

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig
    const geometry = new THREE.PlaneGeometry(width, height)

  const texture = this.textures[fromIndex]
  if (!texture) {
    // Texture not available; nothing to render
    return
  }

  // Use the shared texture reference from the main textures array so it
  // stays up-to-date with resizes and new frames.
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  // For the pixelate look, nearest filtering on magnification is cheaper and matches style.
  // Remember previous filter to restore on cleanup to avoid side effects.
  this.textureRef = texture
  this.prevMagFilter = texture.magFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true

  // DEBUG: Log texture info to verify we're using the correct one
  // Get resolution from actual texture dimensions, not plane dimensions
  // This ensures shader calculations match the texture data exactly
  const textureImage = texture.image as any
  const texWidth = textureImage?.width || width * 100
  const texHeight = textureImage?.height || height * 100

    this.lastTextureWidth = texWidth
    this.lastTextureHeight = texHeight

    // Custom shader for pixelate and dissolve effect
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: texture },
        progress: { value: 0.0 },
        pixelSize: { value: 1.0 },
        resolution: { value: new THREE.Vector2(texWidth, texHeight) },
      },
      vertexShader: `
        precision mediump float;
        precision mediump int;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        precision mediump int;
        uniform sampler2D tDiffuse;
        uniform float progress;
        uniform float pixelSize;
        uniform vec2 resolution;
        varying vec2 vUv;

        // Random function for noise
        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        void main() {
          // Calculate pixelation based on progress
          float pixels = pixelSize * (1.0 + progress * 50.0);
          vec2 pixelatedUV = floor(vUv * resolution / pixels) * pixels / resolution;

          // Sample texture with pixelated UV
          vec4 color = texture2D(tDiffuse, pixelatedUV);

          // Add dissolve effect
          float noise = random(vUv * 10.0 + progress);
          float threshold = progress * 1.2 - 0.1;
          float alpha = smoothstep(threshold, threshold + 0.1, noise);

          // Fade out
          alpha *= (1.0 - progress);

          gl_FragColor = vec4(color.rgb, alpha);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      toneMapped: false,
    })

    material.depthTest = false
    material.depthWrite = false

    this.planeMesh = new THREE.Mesh(geometry, material)
    this.planeMesh.position.set(planePosition.x, planePosition.y, planePosition.z)
    this.planeMesh.renderOrder = 1000
    this.scene.add(this.planeMesh)
    this.progress = 0
  }

  update(): boolean {
    if (!this.planeMesh) return true

    const material = this.planeMesh.material as THREE.ShaderMaterial
    if (material.uniforms) {
      // Check for texture dimension changes and update resolution uniform if needed
      const texture = material.uniforms.tDiffuse?.value as THREE.Texture
      if (texture) {
        const textureImage = texture.image as any
        const currentWidth = textureImage?.width || 0
        const currentHeight = textureImage?.height || 0

        if (currentWidth > 0 && currentHeight > 0 &&
            (currentWidth !== this.lastTextureWidth || currentHeight !== this.lastTextureHeight)) {
          this.lastTextureWidth = currentWidth
          this.lastTextureHeight = currentHeight
          if (material.uniforms.resolution) {
            material.uniforms.resolution.value.set(currentWidth, currentHeight)
          }
        }
      }

      // CRITICAL: Clamp progress to 1.0 to ensure the final frame renders with alpha=0
      // This prevents flicker by making the transition fully transparent before cleanup
      const progressU = (material.uniforms as any).progress
      if (progressU && typeof progressU.value !== 'undefined') {
        progressU.value = Math.min(this.progress, 1.0)
      }
    }

    // Increment progress AFTER setting the uniform
    this.progress += 1 / 60 / this.durationSeconds

    return this.progress >= 1.0
  }

  /**
   * Update the resolution uniform when textures are resized.
   * This is called by TransitionManager when the window is resized.
   */
  updateResolution(width: number, height: number): void {
    if (!this.planeMesh) return

    const material = this.planeMesh.material as THREE.ShaderMaterial
    if (material.uniforms?.resolution) {
      material.uniforms.resolution.value.set(width, height)
      this.lastTextureWidth = width
      this.lastTextureHeight = height
    }
  }

  cleanup(): void {
    if (this.planeMesh) {
      this.scene.remove(this.planeMesh)
      this.planeMesh.geometry.dispose()

      const material = this.planeMesh.material as THREE.ShaderMaterial
      // Don't dispose the shared texture (material.uniforms.tDiffuse.value)
      // since it's managed by the main application. Just dispose the material.
      material.dispose()

      this.planeMesh = null
    }
    // Restore texture filtering if we changed it
    if (this.textureRef) {
      if (this.prevMagFilter !== null) {
        this.textureRef.magFilter = this.prevMagFilter
        this.textureRef.needsUpdate = true
      }
    }
    this.textureRef = null
    this.prevMagFilter = null
    this.progress = 0
    this.lastTextureWidth = 0
    this.lastTextureHeight = 0
  }
}
