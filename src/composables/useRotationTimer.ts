import { ref, onUnmounted } from 'vue'

const ROTATION_INTERVAL = 10000
const REFRESH_INTERVAL = 30000

export function useRotationTimer(onRotate: () => void, onRefresh: () => void) {
  const rotationTimer = ref<number | null>(null)
  const refreshTimer = ref<number | null>(null)

  const startTimers = () => {
    rotationTimer.value = window.setInterval(onRotate, ROTATION_INTERVAL)
    refreshTimer.value = window.setInterval(onRefresh, REFRESH_INTERVAL)
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
