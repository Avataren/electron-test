import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'

export interface TransitionConfig {
  name: string
  enabled: boolean
}

export interface SlideshowConfig {
  urls: string[]
  transitions: TransitionConfig[]
  // Optional advanced settings loaded from slideshow-config.json
  // Hyphenated keys match the JSON file exactly
  'transition-webpage-fps'?: number
  'slideshow-page-duration'?: number | string
  // When true, automatically open DevTools for views in dev.
  // Default is false to avoid spawning extra windows during transitions.
  'auto-open-devtools'?: boolean
}

export interface AppConfig {
  urls: string[]
  transitions: TransitionConfig[]
  window: {
    width: number
    height: number
    controlBarHeight: number
  }
  timing: {
    rotationInterval: number
    refreshInterval: number
    transitionDuration: number
  }
  rendering: {
    frameRate: number
    jpegQuality: number
  }
  devtools?: {
    /** If true (and in dev), auto-open DevTools for BrowserViews */
    autoOpen: boolean
  }
}

// Parse human-readable duration strings into milliseconds.
// Supports examples like: '10s', '500ms', '2m', '1h', '1m30s', '00:10', '01:02:03'.
function parseHumanDuration(input: unknown, fallbackMs: number): number {
  try {
    if (typeof input === 'number' && isFinite(input)) {
      return Math.max(0, Math.floor(input))
    }

    if (typeof input === 'string') {
      const raw = input.trim()
      if (!raw) return fallbackMs

      // Timecode format HH:MM:SS or MM:SS
      if (raw.includes(':')) {
        const parts = raw.split(':').map((p) => Number(p))
        if (parts.every((n) => Number.isFinite(n))) {
          let seconds = 0
          if (parts.length === 3) {
            const h = parts[0] ?? 0
            const m = parts[1] ?? 0
            const s = parts[2] ?? 0
            seconds = h * 3600 + m * 60 + s
          } else if (parts.length === 2) {
            const m = parts[0] ?? 0
            const s = parts[1] ?? 0
            seconds = m * 60 + s
          } else {
            // Single-part with colon present is unexpected; fallback
            return fallbackMs
          }
          return Math.max(0, Math.floor(seconds * 1000))
        }
      }

      // Token format like "1h30m10s500ms"
      const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h)/gi
      let match: RegExpExecArray | null
      let totalMs = 0
      let matched = false
      while ((match = re.exec(raw))) {
        matched = true
        const valueStr = match[1]
        const unitStr = match[2]
        if (valueStr == null || unitStr == null) continue
        const value = parseFloat(valueStr)
        const unit = unitStr.toLowerCase()
        if (!isFinite(value)) continue
        if (unit === 'ms') totalMs += value
        else if (unit === 's') totalMs += value * 1000
        else if (unit === 'm') totalMs += value * 60_000
        else if (unit === 'h') totalMs += value * 3_600_000
      }
      if (matched) {
        return Math.max(0, Math.floor(totalMs))
      }

      // Bare numeric string — treat as milliseconds for backward compatibility
      if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const ms = Number(raw)
        if (Number.isFinite(ms)) return Math.max(0, Math.floor(ms))
      }
    }
  } catch (_err) {
    // ignore and use fallback
  }

  return fallbackMs
}

// Default slideshow configuration
const defaultSlideshowConfig: SlideshowConfig = {
  urls: [
    'https://www.testufo.com/',
    'https://cubed.no',
    'https://www.github.com',
    'https://www.wikipedia.org',
    'https://news.ycombinator.com',
  ],
  transitions: [
    { name: 'pixelate', enabled: true },
    { name: 'rain', enabled: false },
    { name: 'slice', enabled: false },
    { name: 'ripple', enabled: false },
    { name: 'flip', enabled: false },
    { name: 'glitch', enabled: false },
    { name: 'swirl', enabled: false },
  ],
  // Sensible defaults when not provided in user config
  'transition-webpage-fps': 10,
  'slideshow-page-duration': '10s',
}

// Load slideshow config from file or use defaults
function loadSlideshowConfig(): SlideshowConfig {
  try {
    // Try to load from user data directory first (for packaged app)
    const userDataPath = app.getPath('userData')
    const userConfigPath = join(userDataPath, 'slideshow-config.json')

    if (existsSync(userConfigPath)) {
      console.log(`[Config] Loading slideshow config from: ${userConfigPath}`)
      const configData = readFileSync(userConfigPath, 'utf-8')
      return JSON.parse(configData) as SlideshowConfig
    }

    // Next, look for a file placed in the installed app root (next to the executable)
    // This is populated via electron-builder extraFiles
    if (app.isPackaged) {
      const appRoot = dirname(app.getPath('exe'))
      const packagedRootConfig = join(appRoot, 'slideshow-config.json')
      if (existsSync(packagedRootConfig)) {
        console.log(`[Config] Loading slideshow config from app root: ${packagedRootConfig}`)
        const configData = readFileSync(packagedRootConfig, 'utf-8')
        return JSON.parse(configData) as SlideshowConfig
      }
    }

    // Fall back to project root (for development)
    const projectConfigPath = join(process.cwd(), 'slideshow-config.json')
    if (existsSync(projectConfigPath)) {
      console.log(`[Config] Loading slideshow config from: ${projectConfigPath}`)
      const configData = readFileSync(projectConfigPath, 'utf-8')
      return JSON.parse(configData) as SlideshowConfig
    }

    console.log('[Config] No slideshow-config.json found, using defaults')
    return defaultSlideshowConfig
  } catch (error) {
    console.error('[Config] Error loading slideshow config:', error)
    console.log('[Config] Using default configuration')
    return defaultSlideshowConfig
  }
}

const slideshowConfig = loadSlideshowConfig()

export const defaultConfig: AppConfig = {
  urls: slideshowConfig.urls,
  transitions: slideshowConfig.transitions,
  window: {
    width: 1920,
    height: 1080,
    controlBarHeight: 120,
  },
  timing: {
    // Use slideshow-config.json value if provided (supports human-readable strings)
    rotationInterval: parseHumanDuration(
      slideshowConfig['slideshow-page-duration'],
      10000,
    ),
    refreshInterval: 30000,
    transitionDuration: 2500,
  },
  rendering: {
    // Use slideshow-config.json value if provided
    frameRate:
      (slideshowConfig['transition-webpage-fps'] &&
        Math.max(0, Number(slideshowConfig['transition-webpage-fps']))) || 10,
    jpegQuality: 85,
  },
  devtools: {
    autoOpen: Boolean(slideshowConfig['auto-open-devtools']) || false,
  },
}
