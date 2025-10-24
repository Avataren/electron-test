import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

export class GlitchTransition extends BaseTransition {
  private planeMesh: THREE.Mesh | null = null
  private progress = 0
  private readonly duration = 2.5

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig
    const geometry = new THREE.PlaneGeometry(width, height)

  const texture = this.textures[fromIndex]
  if (!texture) return

  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.needsUpdate = true

    // Custom shader for glitch effect
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: texture },
        progress: { value: 0.0 },
        time: { value: 0.0 },
        glitchStrength: { value: 0.3 },
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
        uniform float time;
        uniform float glitchStrength;
        varying vec2 vUv;

        // Random function
        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        // Noise function
        float noise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          float a = random(i);
          float b = random(i + vec2(1.0, 0.0));
          float c = random(i + vec2(0.0, 1.0));
          float d = random(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          vec2 uv = vUv;
          float strength = progress * glitchStrength;

          // Horizontal glitch lines
          float lineNoise = noise(vec2(0.0, uv.y * 20.0 + time * 5.0));
          if (lineNoise > 0.6 && progress > 0.2 && progress < 0.9) {
            float offset = (random(vec2(uv.y, time)) - 0.5) * strength * 2.0;
            uv.x += offset;
          }

          // RGB channel separation
          float separation = progress * 0.05;
          vec2 rOffset = uv + vec2(separation, 0.0);
          vec2 gOffset = uv;
          vec2 bOffset = uv - vec2(separation, 0.0);

          float r = texture2D(tDiffuse, rOffset).r;
          float g = texture2D(tDiffuse, gOffset).g;
          float b = texture2D(tDiffuse, bOffset).b;

          vec4 color = vec4(r, g, b, 1.0);

          // Add random blocks
          vec2 blockUV = floor(uv * vec2(20.0, 15.0)) / vec2(20.0, 15.0);
          float blockNoise = random(blockUV + time);

          if (blockNoise > 0.95 && progress > 0.3) {
            color.rgb = vec3(random(blockUV), random(blockUV + 0.1), random(blockUV + 0.2));
          }

          // Scanlines
          float scanline = sin(uv.y * 800.0 + time * 10.0) * 0.1;
          color.rgb += scanline * progress;

          // Fade out
          float alpha = 1.0 - progress;

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
    material.uniforms.progress.value = this.progress
    material.uniforms.time.value += 0.016 // Approx 60fps

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
