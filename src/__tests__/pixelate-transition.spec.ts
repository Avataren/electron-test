import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'
import { PixelateTransition } from '../transitions/PixelateTransition'

describe('PixelateTransition texture dimension handling', () => {
  let scene: THREE.Scene
  let textures: THREE.Texture[]
  let planeConfig: { width: number; height: number }

  beforeEach(() => {
    scene = new THREE.Scene()
    textures = []
    planeConfig = { width: 1.6, height: 0.9 }

    // Mock console.log to suppress output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('should use texture dimensions for resolution uniform, not plane dimensions', () => {
    // Create a mock DataTexture with specific dimensions
    const textureWidth = 1920
    const textureHeight = 1080
    const data = new Uint8Array(textureWidth * textureHeight * 4)
    const texture = new THREE.DataTexture(
      data,
      textureWidth,
      textureHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    )
    textures.push(texture)

    // Create transition
    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    // Get the transition mesh from the scene
    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh

    expect(transitionMesh).toBeDefined()
    const material = transitionMesh.material as THREE.ShaderMaterial
    expect(material.uniforms.resolution).toBeDefined()

    // Resolution uniform should match TEXTURE dimensions (1920x1080)
    // NOT plane dimensions (1.6x0.9 * 100 = 160x90)
    expect(material.uniforms.resolution.value.x).toBe(textureWidth)
    expect(material.uniforms.resolution.value.y).toBe(textureHeight)

    // Cleanup
    transition.cleanup()
  })

  it('should fallback to plane dimensions if texture has no dimensions', () => {
    // Create a texture without proper image dimensions
    const texture = new THREE.Texture()
    textures.push(texture)

    // Create transition
    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    // Get the transition mesh from the scene
    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh

    expect(transitionMesh).toBeDefined()
    const material = transitionMesh.material as THREE.ShaderMaterial

    // Should fallback to plane dimensions * 100
    expect(material.uniforms.resolution.value.x).toBe(planeConfig.width * 100)
    expect(material.uniforms.resolution.value.y).toBe(planeConfig.height * 100)

    // Cleanup
    transition.cleanup()
  })

  it('should detect texture dimension changes during update', () => {
    // Start with one set of dimensions
    const initialWidth = 800
    const initialHeight = 600
    const data1 = new Uint8Array(initialWidth * initialHeight * 4)
    const texture = new THREE.DataTexture(
      data1,
      initialWidth,
      initialHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    )
    textures.push(texture)

    // Create transition
    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    // Get the transition mesh
    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh
    const material = transitionMesh.material as THREE.ShaderMaterial

    // Initial resolution should match initial dimensions
    expect(material.uniforms.resolution.value.x).toBe(initialWidth)
    expect(material.uniforms.resolution.value.y).toBe(initialHeight)

    // Simulate a resize by changing texture dimensions
    const newWidth = 1920
    const newHeight = 1080
    const data2 = new Uint8Array(newWidth * newHeight * 4)
    ;(texture as any).image = {
      data: data2,
      width: newWidth,
      height: newHeight,
    }

    // Call update() - it should detect the dimension change
    const isComplete = transition.update()
    expect(isComplete).toBe(false) // Transition not complete yet

    // Resolution uniform should be updated
    expect(material.uniforms.resolution.value.x).toBe(newWidth)
    expect(material.uniforms.resolution.value.y).toBe(newHeight)

    // Cleanup
    transition.cleanup()
  })

  it('should update resolution via updateResolution method', () => {
    // Create texture and transition
    const data = new Uint8Array(800 * 600 * 4)
    const texture = new THREE.DataTexture(data, 800, 600, THREE.RGBAFormat, THREE.UnsignedByteType)
    textures.push(texture)

    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    // Get the transition mesh
    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh
    const material = transitionMesh.material as THREE.ShaderMaterial

    // Initial resolution
    expect(material.uniforms.resolution.value.x).toBe(800)
    expect(material.uniforms.resolution.value.y).toBe(600)

    // Call updateResolution with new dimensions
    transition.updateResolution!(1920, 1080)

    // Resolution should be updated
    expect(material.uniforms.resolution.value.x).toBe(1920)
    expect(material.uniforms.resolution.value.y).toBe(1080)

    // Cleanup
    transition.cleanup()
  })

  it('should reset dimension tracking on cleanup', () => {
    // Create texture and transition
    const data = new Uint8Array(1920 * 1080 * 4)
    const texture = new THREE.DataTexture(data, 1920, 1080, THREE.RGBAFormat, THREE.UnsignedByteType)
    textures.push(texture)

    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    // Verify transition was created
    expect(scene.children.length).toBeGreaterThan(0)

    // Cleanup
    transition.cleanup()

    // Scene should be cleaned up
    expect(scene.children.length).toBe(0)

    // Create another transition - should start fresh
    transition.create(0, position)
    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh
    const material = transitionMesh.material as THREE.ShaderMaterial

    // Should use texture dimensions again
    expect(material.uniforms.resolution.value.x).toBe(1920)
    expect(material.uniforms.resolution.value.y).toBe(1080)

    // Cleanup
    transition.cleanup()
  })

  it('should log dimension information when creating transition', () => {
    const logSpy = vi.spyOn(console, 'log')

    const data = new Uint8Array(1920 * 1080 * 4)
    const texture = new THREE.DataTexture(data, 1920, 1080, THREE.RGBAFormat, THREE.UnsignedByteType)
    textures.push(texture)

    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    // Should log the resolution and plane dimensions
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PixelateTransition] Creating transition with resolution: 1920x1080')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('plane: 1.60x0.90')
    )

    transition.cleanup()
  })

  it('should handle multiple dimension updates during transition lifecycle', () => {
    // Create texture
    const data1 = new Uint8Array(800 * 600 * 4)
    const texture = new THREE.DataTexture(data1, 800, 600, THREE.RGBAFormat, THREE.UnsignedByteType)
    textures.push(texture)

    const transition = new PixelateTransition(scene, textures, planeConfig)
    const position = new THREE.Vector3(0, 0, 0)
    transition.create(0, position)

    const transitionMesh = scene.children.find(
      (child) => child instanceof THREE.Mesh
    ) as THREE.Mesh
    const material = transitionMesh.material as THREE.ShaderMaterial

    // First resize
    transition.updateResolution!(1024, 768)
    expect(material.uniforms.resolution.value.x).toBe(1024)
    expect(material.uniforms.resolution.value.y).toBe(768)

    // Second resize
    transition.updateResolution!(1920, 1080)
    expect(material.uniforms.resolution.value.x).toBe(1920)
    expect(material.uniforms.resolution.value.y).toBe(1080)

    // Third resize
    transition.updateResolution!(3840, 2160)
    expect(material.uniforms.resolution.value.x).toBe(3840)
    expect(material.uniforms.resolution.value.y).toBe(2160)

    transition.cleanup()
  })
})
