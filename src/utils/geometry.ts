import { PlaneConfig, CameraConfig } from '../types'

export const VIEWPORT_ASPECT = 16 / 9

export function calculatePlaneSize(camera: CameraConfig): PlaneConfig {
  const { fov, distance, aspect } = camera
  const vFOV = (fov * Math.PI) / 180
  const viewportHeight = 2 * Math.tan(vFOV / 2) * distance
  const viewportWidth = viewportHeight * aspect

  let planeWidth: number
  let planeHeight: number

  if (aspect > VIEWPORT_ASPECT) {
    // Pillarboxing (fit to height)
    planeHeight = viewportHeight
    planeWidth = planeHeight * VIEWPORT_ASPECT
  } else {
    // Letterboxing (fit to width)
    planeWidth = viewportWidth
    planeHeight = planeWidth / VIEWPORT_ASPECT
  }

  return { width: planeWidth, height: planeHeight }
}

export function calculateUVCoordinates(
  row: number,
  col: number,
  totalRows: number,
  totalCols: number,
): { uStart: number; uEnd: number; vStart: number; vEnd: number } {
  const uStart = col / totalCols
  const uEnd = (col + 1) / totalCols
  const vStart = 1 - (row + 1) / totalRows
  const vEnd = 1 - row / totalRows

  return { uStart, uEnd, vStart, vEnd }
}

export function calculateFragmentPosition(
  row: number,
  col: number,
  planeWidth: number,
  planeHeight: number,
  fragmentWidth: number,
  fragmentHeight: number,
): { x: number; y: number } {
  const x = -planeWidth / 2 + fragmentWidth / 2 + col * fragmentWidth
  const y = planeHeight / 2 - fragmentHeight / 2 - row * fragmentHeight

  return { x, y }
}
