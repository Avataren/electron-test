// Inline types to avoid import issues
export interface PlaneConfig {
  width: number
  height: number
}

export interface CameraConfig {
  frustumHeight: number
  distance: number
  aspect: number
}

export const VIEWPORT_ASPECT = 16 / 9

export function calculatePlaneSize(camera: CameraConfig, _contentAspect?: number): PlaneConfig {
  // Fill the entire frustum to match BrowserView bounds exactly.
  // This avoids scale mismatches and popping when the BrowserView is shown.
  const { frustumHeight, aspect } = camera
  const frustumWidth = frustumHeight * aspect

  return {
    width: frustumWidth,
    height: frustumHeight,
  }
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
