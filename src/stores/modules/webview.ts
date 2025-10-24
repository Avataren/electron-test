import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

// Define TransitionType locally to avoid import issues
type TransitionType = 'rain' | 'slice' | 'pixelate' | 'ripple' | 'flip' | 'glitch' | 'swirl'

export const useWebviewStore = defineStore('webview', () => {
  const currentIndex = ref(0)
  const isTransitioning = ref(false)
  const setupMode = ref(true)
  const setupIndex = ref(0)
  const currentTransitionType = ref<TransitionType>('rain')
  const currentTransitionIndex = ref(0)

  // All available transition types
  const transitionTypes: TransitionType[] = [
    'rain',
    'slice',
    'pixelate',
    'ripple',
    'flip',
    'glitch',
    'swirl',
  ]

  const nextIndex = computed(() => (index: number, total: number) => (index + 1) % total)
  const prevIndex = computed(() => (index: number, total: number) => (index - 1 + total) % total)

  function setCurrentIndex(index: number) {
    currentIndex.value = index
  }

  function setTransitioning(value: boolean) {
    isTransitioning.value = value
  }

  function setSetupMode(value: boolean) {
    setupMode.value = value
  }

  function setSetupIndex(index: number) {
    setupIndex.value = index
  }

  function toggleTransitionType() {
    currentTransitionIndex.value = (currentTransitionIndex.value + 1) % transitionTypes.length
    currentTransitionType.value = transitionTypes[currentTransitionIndex.value]
  }

  function getNextTransitionType(): TransitionType {
    const nextIdx = (currentTransitionIndex.value + 1) % transitionTypes.length
    return transitionTypes[nextIdx]
  }

  function nextSetupPage(totalPages: number) {
    setupIndex.value = (setupIndex.value + 1) % totalPages
  }

  function prevSetupPage(totalPages: number) {
    setupIndex.value = (setupIndex.value - 1 + totalPages) % totalPages
  }

  return {
    currentIndex,
    isTransitioning,
    setupMode,
    setupIndex,
    currentTransitionType,
    nextIndex,
    prevIndex,
    setCurrentIndex,
    setTransitioning,
    setSetupMode,
    setSetupIndex,
    toggleTransitionType,
    getNextTransitionType,
    nextSetupPage,
    prevSetupPage,
  }
})
