export interface AppConfig {
  urls: string[]
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

export const defaultConfig: AppConfig = {
  urls: [
    'https://www.testufo.com/',
    'https://cubed.no',
    'https://www.github.com',
    'https://www.wikipedia.org',
    'https://news.ycombinator.com',
  ],
  window: {
    width: 1920,
    height: 1080,
    controlBarHeight: 120,
  },
  timing: {
    rotationInterval: 10000,
    refreshInterval: 30000,
    transitionDuration: 2500,
  },
  rendering: {
    frameRate: 10,
    jpegQuality: 85,
  },
}
