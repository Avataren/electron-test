import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class SwirlTransition extends BaseTransition {
  private planeMesh: THREE.Mesh | null = null
  private progress = 0
  private readonly duration = 2.5

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig
    const geometry = new THREE.PlaneGeometry(width, height, 100, 100)

  const texture = this.textures[fromIndex]
  if (!texture) return

  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

    // Custom shader for swirl/vortex effect
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: texture },
        progress: { value: 0.0 },
        center: { value: new THREE.Vector2(0.5, 0.5) },
        strength: { value: 3.0 },
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
        uniform vec2 center;
        uniform float strength;
        varying vec2 vUv;

        void main() {
          vec2 uv = vUv;
          vec2 toCenter = center - uv;
          float dist = length(toCenter);

          // Create swirl effect
          float angle = progress * strength * (1.0 - dist);
          float s = sin(angle);
          float c = cos(angle);

          vec2 rotated = vec2(
            toCenter.x * c - toCenter.y * s,
            toCenter.x * s + toCenter.y * c
          );

          vec2 swirlUV = center - rotated;

          // Sample texture
          vec4 color = texture2D(tDiffuse, swirlUV);

          // Fade and scale effect
          float fadeOut = 1.0 - progress;
          float scale = 1.0 - progress * dist;

          // Add some darkness at center as it collapses
          float darkness = 1.0 - (progress * dist * 0.5);
          color.rgb *= darkness;

          gl_FragColor = vec4(color.rgb, fadeOut * scale);
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

    // Scale down as it swirls
    const scale = 1 - this.progress * 0.3
    this.planeMesh.scale.set(scale, scale, 1)

    return this.progress >= 1.0
  }

  cleanup(): void {
    if (this.planeMesh) {
      this.scene.remove(this.planeMesh)
      this.planeMesh.geometry.dispose()

      const material = this.planeMesh.material as THREE.ShaderMaterial
      // Don't dispose shared texture. Only dispose material.
      material.dispose()

      this.planeMesh = null
    }
    this.progress = 0
  }
}
