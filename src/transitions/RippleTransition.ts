import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class RippleTransition extends BaseTransition {
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

    // Custom shader for ripple wave effect
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: texture },
        progress: { value: 0.0 },
        center: { value: new THREE.Vector2(0.5, 0.5) },
        waveStrength: { value: 0.3 },
        frequency: { value: 20.0 },
      },
      vertexShader: `
        uniform float progress;
        uniform vec2 center;
        uniform float waveStrength;
        uniform float frequency;
        varying vec2 vUv;
        varying float vWave;

        void main() {
          vUv = uv;

          // Calculate distance from center
          vec2 diff = uv - center;
          float dist = length(diff);

          // Create expanding ripple wave
          float wave = sin((dist - progress * 2.0) * frequency) * waveStrength;
          wave *= smoothstep(0.0, 0.3, progress) * (1.0 - progress);

          vWave = wave;

          // Apply wave displacement
          vec3 newPosition = position;
          newPosition.z += wave * 2.0;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float progress;
        varying vec2 vUv;
        varying float vWave;

        void main() {
          // Distort UV coordinates based on wave
          vec2 distortedUV = vUv + vec2(vWave * 0.1);
          vec4 color = texture2D(tDiffuse, distortedUV);

          // Fade out as ripples expand
          float alpha = 1.0 - progress;
          alpha *= smoothstep(0.0, 0.2, progress); // Fade in quickly

          gl_FragColor = vec4(color.rgb, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
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
      // Don't dispose the shared texture here. Just dispose the material.
      material.dispose()

      this.planeMesh = null
    }
    this.progress = 0
  }
}
