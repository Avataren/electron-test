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
  'slideshow-page-duration'?: number
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
  'slideshow-page-duration': 10000,
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
    // Use slideshow-config.json value if provided
    rotationInterval:
      (slideshowConfig['slideshow-page-duration'] &&
        Math.max(0, Number(slideshowConfig['slideshow-page-duration']))) || 10000,
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
}
