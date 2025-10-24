/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three'

export interface WebviewFrame {
  index: number
  buffer: Uint8Array
  size: { width: number; height: number }
}

export interface Fragment {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  rotationSpeed: THREE.Vector3
}

export interface Slice {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  direction: number
}

export interface PlaneConfig {
  width: number
  height: number
}

export interface CameraConfig {
  fov: number
  distance: number
  aspect: number
}

export interface TransitionConfig {
  duration: number
  type: 'rain' | 'slice' | 'pixelate' | 'ripple' | 'flip' | 'glitch' | 'swirl'
}

export type TransitionType = 'rain' | 'slice' | 'pixelate' | 'ripple' | 'flip' | 'glitch' | 'swirl'

export interface IPCRenderer {
  on: (channel: string, callback: (...args: any[]) => void) => void
  off: (channel: string, callback: (...args: any[]) => void) => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

declare global {
  interface Window {
    ipcRenderer: IPCRenderer
  }
}
