import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'
import { TransitionManager } from '../transitions/TransitionManager'

describe('TransitionManager dimension propagation', () => {
  let scene: THREE.Scene
  let textures: THREE.Texture[]
  let planeConfig: { width: number; height: number }
  let transitionManager: TransitionManager

  beforeEach(() => {
    scene = new THREE.Scene()
    textures = []
    planeConfig = { width: 1.6, height: 0.9 }

    // Create textures with smaller initial dimensions to avoid memory issues
    const width = 320
    const height = 180
    const data = new Uint8Array(width * height * 4)
    const texture1 = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
    const texture2 = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
    textures.push(texture1, texture2)

    transitionManager = new TransitionManager(scene, textures, planeConfig)

    // Mock console.log to suppress output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('should update plane config dimensions', () => {
    const newConfig = { width: 2.0, height: 1.125 }
    transitionManager.updatePlaneConfig(newConfig)

    // The internal planeConfig should be updated
    // (We can verify this indirectly by creating a new transition and checking its geometry)
    const position = new THREE.Vector3(0, 0, 0)
    transitionManager.startTransition('pixelate', 0, position)

    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh

    expect(transitionMesh).toBeDefined()
    const geometry = transitionMesh.geometry as THREE.PlaneGeometry

    // The geometry should use the new plane dimensions
    // PlaneGeometry stores width and height in parameters
    expect(geometry.parameters.width).toBe(newConfig.width)
    expect(geometry.parameters.height).toBe(newConfig.height)

    transitionManager.cleanup()
  })

  it('should propagate texture dimensions to active transition when plane config is updated', () => {
    // Start a transition
    const position = new THREE.Vector3(0, 0, 0)
    transitionManager.startTransition('pixelate', 0, position)

    expect(transitionManager.hasActiveTransition()).toBe(true)

    // Get the transition mesh
    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh
    const material = transitionMesh.material as THREE.ShaderMaterial

    // Initial resolution should match texture dimensions
    expect(material.uniforms.resolution.value.x).toBe(320)
    expect(material.uniforms.resolution.value.y).toBe(180)

    // Simulate a resize: update texture dimensions
    const newWidth = 640
    const newHeight = 360
    const newData = new Uint8Array(newWidth * newHeight * 4)
    textures.forEach((texture) => {
      ;(texture as any).image = {
        data: newData,
        width: newWidth,
        height: newHeight,
      }
    })

    // Update plane config - this should propagate to the active transition
    const newConfig = { width: 2.0, height: 1.125 }
    transitionManager.updatePlaneConfig(newConfig)

    // Resolution uniform should be updated to match new texture dimensions
    expect(material.uniforms.resolution.value.x).toBe(newWidth)
    expect(material.uniforms.resolution.value.y).toBe(newHeight)

    transitionManager.cleanup()
  })

  it('should not crash when updating plane config with no active transition', () => {
    expect(transitionManager.hasActiveTransition()).toBe(false)

    // This should not throw
    expect(() => {
      transitionManager.updatePlaneConfig({ width: 2.0, height: 1.125 })
    }).not.toThrow()
  })

  it('should handle updatePlaneConfig when texture has no dimensions', () => {
    // Create textures without proper image data
    const emptyTextures: THREE.Texture[] = [new THREE.Texture(), new THREE.Texture()]
    const emptyTransitionManager = new TransitionManager(scene, emptyTextures, planeConfig)

    const position = new THREE.Vector3(0, 0, 0)
    emptyTransitionManager.startTransition('pixelate', 0, position)

    // This should not throw even though textures have no dimensions
    expect(() => {
      emptyTransitionManager.updatePlaneConfig({ width: 2.0, height: 1.125 })
    }).not.toThrow()

    emptyTransitionManager.cleanup()
  })

  it('should log when propagating texture dimensions to active transition', () => {
    const logSpy = vi.spyOn(console, 'log')

    // Start a transition
    const position = new THREE.Vector3(0, 0, 0)
    transitionManager.startTransition('pixelate', 0, position)

    // Update plane config
    transitionManager.updatePlaneConfig({ width: 2.0, height: 1.125 })

    // Should log the propagation
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TransitionManager] Propagating texture dimensions to active transition')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('320x180')
    )

    transitionManager.cleanup()
  })

  it('should update transition at every step during animation', () => {
    const position = new THREE.Vector3(0, 0, 0)
    transitionManager.startTransition('pixelate', 0, position)

    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh
    const material = transitionMesh.material as THREE.ShaderMaterial

    // Initial progress should be 0
    expect(material.uniforms.progress.value).toBe(0)

    // Update multiple times
    let isComplete = false
    for (let i = 0; i < 10 && !isComplete; i++) {
      isComplete = transitionManager.update()
      // Progress should increase
      expect(material.uniforms.progress.value).toBeGreaterThan(0)
    }

    transitionManager.cleanup()
  })

  it('should cleanup transition and remove from scene', () => {
    const position = new THREE.Vector3(0, 0, 0)
    transitionManager.startTransition('pixelate', 0, position)

    expect(scene.children.length).toBeGreaterThan(0)
    expect(transitionManager.hasActiveTransition()).toBe(true)

    transitionManager.cleanup()

    expect(scene.children.length).toBe(0)
    expect(transitionManager.hasActiveTransition()).toBe(false)
  })

  it('should handle multiple transitions sequentially', () => {
    const position = new THREE.Vector3(0, 0, 0)

    // First transition
    transitionManager.startTransition('pixelate', 0, position)
    expect(transitionManager.hasActiveTransition()).toBe(true)
    const firstMesh = scene.children[0]
    transitionManager.cleanup()

    // Second transition
    transitionManager.startTransition('pixelate', 1, position)
    expect(transitionManager.hasActiveTransition()).toBe(true)
    const secondMesh = scene.children[0]

    // Should be different mesh instances
    expect(firstMesh).not.toBe(secondMesh)

    transitionManager.cleanup()
  })

  it('should cleanup previous transition when starting a new one', () => {
    const position = new THREE.Vector3(0, 0, 0)

    // First transition
    transitionManager.startTransition('pixelate', 0, position)
    const firstMesh = scene.children[0]

    // Start second transition without manually cleaning up first
    transitionManager.startTransition('pixelate', 1, position)
    const secondMesh = scene.children[0]

    // Should only have one mesh (the new one)
    expect(scene.children.length).toBe(1)
    expect(firstMesh).not.toBe(secondMesh)

    transitionManager.cleanup()
  })
})
