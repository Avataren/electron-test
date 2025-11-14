import * as THREE from 'three'
import { BaseTransition } from './BaseTransition'

/**
 * CurtainTransition
 * A shader-based fold/curtain effect that rotates the source texture around the Y axis
 * with a per-column progression, plus subtle fake shading. This gives a strong 3D vibe
 * even under an orthographic camera.
 */
export class CurtainTransition extends BaseTransition {
  private planeMesh: THREE.Mesh | null = null
  private progress = 0

  create(fromIndex: number, planePosition: THREE.Vector3): void {
    const { width, height } = this.planeConfig

    // Reduce segments along X to ease load on low-power GPUs while keeping curl fidelity
    const geometry = new THREE.PlaneGeometry(width, height, 96, 2)

    const texture = this.textures[fromIndex]
    if (!texture) return

    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: texture },
        progress: { value: 0.0 },
        uWidth: { value: width },
        uHeight: { value: height },
      },
      vertexShader: `
        precision mediump float;
        precision mediump int;
        uniform float progress;
        uniform float uWidth;
        uniform float uHeight;
        varying vec2 vUv;
        varying float vShade;

        // Smooth cubic easing helpers
        float easeInOutCubic(float t) {
          return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
        }
        float easeOutCubic(float t) {
          return 1.0 - pow(1.0 - t, 3.0);
        }

        void main() {
          vUv = uv;

          // Column-based rotation amount: later columns rotate more/earlier
          float u = vUv.x;
          float prog = clamp(progress, 0.0, 1.0);
          // Curl should start promptly and progress faster initially
          float curlPhase = easeOutCubic(prog);

          // Rotate up to ~180 degrees at the far right, slightly less on the left
          float maxAngle = 3.14159265; // PI
          float angle = curlPhase * maxAngle * pow(u, 0.85);

          // Base position
          vec3 pos = position;

          // Y-axis rotation around the origin (plane is centered)
          float s = sin(angle);
          float c = cos(angle);
          float x = pos.x * c + pos.z * s;
          float z = -pos.x * s + pos.z * c;

          // Add a subtle accordion depth to emphasize 3D feel
          float waveAmp = uWidth * 0.02; // slightly stronger to enhance curl
          float wave = sin(u * 10.0 * 3.14159265) * waveAmp * curlPhase;
          z += wave;

          // Pull the curtain out of view towards the end of the transition,
          // so it curls first, then slides away.
          // Start pull later and ramp it more gently so it feels slower
          float pullPhase = smoothstep(0.65, 0.98, prog);
          pullPhase = pow(pullPhase, 1.25);
          float pull = uWidth * 1.2 * pullPhase;
          // Slide to the LEFT so direction matches the curl
          x -= pull;

          // Fake shading term: brighter when facing camera, darker when turned
          // Approximates n.z via rotation around Y (without real lighting)
          float shade = clamp(0.25 + 0.75 * abs(c), 0.0, 1.0);
          vShade = shade;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(x, pos.y, z, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        precision mediump int;
        uniform sampler2D tDiffuse;
        uniform float progress;
        varying vec2 vUv;
        varying float vShade;

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);

          // Apply fake shading for a 3D look
          color.rgb *= vShade;

          // Keep fully opaque; geometry exits view instead of fading
          gl_FragColor = vec4(color.rgb, 1.0);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })

    material.depthTest = false
    material.depthWrite = false

    this.planeMesh = new THREE.Mesh(geometry, material)
    this.planeMesh.position.set(planePosition.x, planePosition.y, planePosition.z + 0.001)
    this.planeMesh.renderOrder = 2000
    this.scene.add(this.planeMesh)
    this.progress = 0
  }

  update(): boolean {
    if (!this.planeMesh) return true

    const material = this.planeMesh.material as THREE.ShaderMaterial
    if (material.uniforms) {
      const progressU = (material.uniforms as any).progress
      if (progressU && typeof progressU.value !== 'undefined') {
        progressU.value = Math.min(this.progress, 1.0)
      }
    }

    // Advance after uniforms set
    this.progress += 1 / 60 / this.durationSeconds
    
    return this.progress >= 1.0
  }

  cleanup(): void {
    if (this.planeMesh) {
      this.scene.remove(this.planeMesh)
      this.planeMesh.geometry.dispose()
      const material = this.planeMesh.material as THREE.ShaderMaterial
      material.dispose()
      this.planeMesh = null
    }
    this.progress = 0
  }
}
