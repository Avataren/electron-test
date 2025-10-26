import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class PixelateTransition extends BaseTransition {
  private planeMesh: THREE.Mesh | null = null
  private progress = 0
  private readonly duration = 2.5

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig
    const geometry = new THREE.PlaneGeometry(width, height)

  const texture = this.textures[fromIndex]
  if (!texture) return

  // Use the shared texture reference from the main textures array so it
  // stays up-to-date with resizes and new frames.
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

    // Custom shader for pixelate and dissolve effect
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: texture },
        progress: { value: 0.0 },
        pixelSize: { value: 1.0 },
        resolution: { value: new THREE.Vector2(width * 100, height * 100) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
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
      side: THREE.DoubleSide,
    })

    this.planeMesh = new THREE.Mesh(geometry, material)
    this.planeMesh.position.set(planePosition.x, planePosition.y, planePosition.z + 0.01)
    this.scene.add(this.planeMesh)
    this.progress = 0
  }

  update(): boolean {
    if (!this.planeMesh) return true

    this.progress += 1 / 60 / this.duration

    const material = this.planeMesh.material as THREE.ShaderMaterial
    if (material.uniforms) {
      const progressU = (material.uniforms as any).progress
      if (progressU && typeof progressU.value !== 'undefined') {
        progressU.value = this.progress
      }
    }

    return this.progress >= 1.0
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
    this.progress = 0
  }
}
