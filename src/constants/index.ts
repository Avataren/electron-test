export const CAMERA_CONFIG = {
  FOV: 75,
  DISTANCE: 5,
  NEAR: 0.1,
  FAR: 1000,
} as const

export const VIEWPORT = {
  ASPECT_RATIO: 16 / 9,
} as const

export const TIMING = {
  ROTATION_INTERVAL: 10000,
  REFRESH_INTERVAL: 30000,
  TRANSITION_DURATION: 2500,
} as const

export const TRANSITION_CONFIG = {
  RAIN: {
    GRID_COLS: 20,
    GRID_ROWS: 10,
    GRAVITY: 0.015,
    FADE_START: -3,
    FADE_END: -8,
    OFF_SCREEN_THRESHOLD: -8,
  },
  SLICE: {
    NUM_SLICES: 8,
    VELOCITY: 0.15,
    OFF_SCREEN_THRESHOLD: 15,
  },
} as const

export const RENDERING = {
  JPEG_QUALITY: 85,
  FRAME_RATE: 30,
} as const
