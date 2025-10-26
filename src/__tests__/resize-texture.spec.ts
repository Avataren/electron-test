import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'
import { useWebviewFrames } from '../composables/useWebviewFrames'

describe('useWebviewFrames resize handling', () => {
  let originalCreateElement: any
  let originalImage: any
  let originalURL: any
  let originalWindow: any

  beforeEach(() => {
    // Mock document.createElement('canvas') to return a simple canvas-like object
    originalCreateElement = document.createElement
    document.createElement = (tag: string) => {
      if (tag === 'canvas') {
        const canvas: any = {
          width: 0,
          height: 0,
          getContext: (ctx: string) => {
            if (ctx === '2d') {
              return {
                imageSmoothingEnabled: true,
                clearRect: () => {},
                drawImage: () => {},
                putImageData: () => {},
              }
            }
            return null
          },
        }
        return canvas as unknown as HTMLElement
      }
      return originalCreateElement.call(document, tag)
    }

    // Mock Image to call onload synchronously and provide natural sizes
    originalImage = (global as any).Image
    class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 1024
      naturalHeight = 768
      set src(_s: string) {
        // simulate load
        if (this.onload) this.onload()
      }
    }
    ;(global as any).Image = MockImage

    // Mock URL.createObjectURL / revokeObjectURL
    originalURL = (global as any).URL
    ;(global as any).URL = {
      createObjectURL: (_: any) => 'blob:mock',
      revokeObjectURL: (_: any) => {},
    }

    // Mock window.ipcRenderer to capture handlers
    originalWindow = (global as any).window
    ;(global as any).window = {
      ipcRenderer: {
        handlers: new Map<string, Function>(),
        on: function (name: string, cb: Function) {
          this.handlers.set(name, cb)
        },
        off: function (name: string, cb: Function) {
          this.handlers.delete(name)
        },
        invoke: vi.fn(),
        send: vi.fn(),
      },
    }
  })

  afterEach(() => {
    document.createElement = originalCreateElement
    ;(global as any).Image = originalImage
    ;(global as any).URL = originalURL
    ;(global as any).window = originalWindow
    vi.restoreAllMocks()
  })

  it('creates a canvas-matched texture image and sets nearest filtering', async () => {
    const textures: THREE.Texture[] = []
    const tex = new THREE.Texture()
    textures.push(tex)

    let callbackCalled = false
    const onTextureUpdate = (index: number, size?: { width: number; height: number }) => {
      callbackCalled = true
      expect(index).toBe(0)
      expect(size).toBeDefined()
      expect(size?.width).toBe(800)
      expect(size?.height).toBe(600)
    }

    const { setupListeners } = useWebviewFrames(textures, onTextureUpdate)
    setupListeners()

    // Simulate sending a 'webview-frame' event from main with a size
    const handler = (window as any).ipcRenderer.handlers.get('webview-frame')
    expect(handler).toBeDefined()

    // Create a fake raw BGRA buffer matching 800x600
    const width = 800
    const height = 600
    const raw = new Uint8Array(width * height * 4)
    // fill with a simple pattern (opaque)
    for (let i = 0; i < raw.length; i += 4) {
      raw[i + 0] = 0 // B
      raw[i + 1] = 128 // G
      raw[i + 2] = 255 // R
      raw[i + 3] = 255 // A
    }

    // Call the handler as a raw frame
    handler(null, { index: 0, buffer: raw, size: { width, height }, format: 'raw' })

    // After handler runs, texture.image should be a DataTexture image block
    expect(callbackCalled).toBe(true)
    expect(textures[0]).toBeInstanceOf(THREE.DataTexture)
    const image = (textures[0] as THREE.DataTexture).image as {
      data: Uint8Array
      width: number
      height: number
    }
    expect(image.width).toBe(800)
    expect(image.height).toBe(600)
    expect(image.data).toBeInstanceOf(Uint8Array)
    expect(image.data.length).toBe(width * height * 4)

    // Check texture filtering
    expect((textures[0] as any)?.minFilter).toBe(THREE.NearestFilter)
    expect((textures[0] as any)?.magFilter).toBe(THREE.NearestFilter)
    expect((textures[0] as any)?.generateMipmaps).toBe(false)
    expect((textures[0] as any)?.flipY).toBe(true)
  })
})
