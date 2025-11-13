import { ref, onUnmounted } from 'vue'

// Fallback defaults used if timing config is not available
const ROTATION_INTERVAL = 10000
const REFRESH_INTERVAL = 30000

export function useRotationTimer(
  onRotate: () => void,
  onRefresh: () => void,
  opts?: { enableRefresh?: boolean }
) {
  const rotationTimer = ref<number | null>(null)
  const refreshTimer = ref<number | null>(null)

  let rotationInterval = ROTATION_INTERVAL
  let refreshInterval = REFRESH_INTERVAL

  const options = opts || {}

  const applyTimers = () => {
    // Clear any existing timers before starting new ones
    if (rotationTimer.value !== null) clearInterval(rotationTimer.value)
    if (refreshTimer.value !== null) {
      clearInterval(refreshTimer.value)
      refreshTimer.value = null
    }

    rotationTimer.value = window.setInterval(onRotate, rotationInterval)
    if (options.enableRefresh !== false) {
      refreshTimer.value = window.setInterval(onRefresh, refreshInterval)
    }
  }

  const startTimers = () => {
    try {
      // Attempt to load timing config from main process; fall back on defaults
      // Do not make this function async to preserve call sites
      ;(window as any).ipcRenderer
        ?.invoke('get-timing-config')
        .then((timing: { rotationInterval?: number; refreshInterval?: number } | undefined) => {
          if (timing && typeof timing.rotationInterval === 'number') {
            rotationInterval = Math.max(0, Math.floor(timing.rotationInterval))
          }
          if (timing && typeof timing.refreshInterval === 'number') {
            refreshInterval = Math.max(0, Math.floor(timing.refreshInterval))
          }
        })
        .catch(() => {
          // Ignore and use defaults
        })
        .finally(() => {
          applyTimers()
        })
    } catch {
      // If ipcRenderer is unavailable, just start with defaults
      applyTimers()
    }
  }

  const stopTimers = () => {
    if (rotationTimer.value !== null) {
      clearInterval(rotationTimer.value)
      rotationTimer.value = null
    }
    if (refreshTimer.value !== null) {
      clearInterval(refreshTimer.value)
      refreshTimer.value = null
    }
  }

  onUnmounted(stopTimers)

  return {
    startTimers,
    stopTimers,
  }
}
