<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// Define interface for Electron webview element
interface WebviewElement extends HTMLElement {
  src: string
  addEventListener: (event: string, callback: (event?: Event) => void) => void
}

interface DidFailLoadEvent extends Event {
  errorDescription: string
}

// List of URLs to rotate through
const urls = [
  'https://cubed.no',
  'https://www.github.com',
  'https://www.wikipedia.org',
  'https://news.ycombinator.com',
]

// Rotation interval in milliseconds (10 seconds)
const ROTATION_INTERVAL = 10000

const currentIndex = ref(0)
const webviewRefs = ref<(WebviewElement | null)[]>([])
const loadingStates = ref<boolean[]>(urls.map(() => true))
let rotationTimer: number | null = null

const setWebviewRef = (index: number) => (el: unknown) => {
  webviewRefs.value[index] = el as WebviewElement | null
}

const rotateWebview = () => {
  currentIndex.value = (currentIndex.value + 1) % urls.length
}

onMounted(() => {
  // Set up event listeners for all webviews
  webviewRefs.value.forEach((webview, index) => {
    if (webview) {
      webview.addEventListener('did-start-loading', () => {
        console.log(`Webview ${index} started loading`)
        loadingStates.value[index] = true
      })

      webview.addEventListener('did-stop-loading', () => {
        console.log(`Webview ${index} finished loading`)
        loadingStates.value[index] = false
      })

      webview.addEventListener('did-fail-load', (event?: Event) => {
        const failEvent = event as DidFailLoadEvent
        console.error(`Webview ${index} failed to load:`, failEvent.errorDescription)
        loadingStates.value[index] = false
      })
    }
  })

  // Start rotation timer
  rotationTimer = window.setInterval(rotateWebview, ROTATION_INTERVAL)
})

onUnmounted(() => {
  // Clear rotation timer
  if (rotationTimer !== null) {
    clearInterval(rotationTimer)
  }
})
</script>

<template>
  <div class="webview-container">
    <div
      v-for="(url, index) in urls"
      :key="index"
      class="webview-wrapper"
      :class="{ active: currentIndex === index }"
    >
      <!-- Set src directly in template for immediate loading -->
      <webview
        :ref="setWebviewRef(index)"
        :src="url"
        class="webview"
        webpreferences="backgroundThrottling=false"
      ></webview>

      <!-- Optional: Loading indicator -->
      <div v-if="loadingStates[index] && currentIndex === index" class="loading-indicator">
        Loading...
      </div>
    </div>

    <!-- Display current page indicator -->
    <div class="indicator">
      <div
        v-for="(url, index) in urls"
        :key="index"
        class="dot"
        :class="{ active: currentIndex === index }"
        @click="currentIndex = index"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.webview-container {
  position: relative;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

.webview-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.5s ease-in-out;
}

.webview-wrapper.active {
  opacity: 1;
  visibility: visible;
  z-index: 1;
}

.webview {
  width: 100%;
  height: 100%;
}

.loading-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 20px 40px;
  border-radius: 10px;
  font-size: 18px;
  z-index: 2;
}

.indicator {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  background-color: rgba(0, 0, 0, 0.5);
  padding: 10px 20px;
  border-radius: 20px;
  z-index: 10;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.5);
  transition: background-color 0.3s ease;
  cursor: pointer;
}

.dot.active {
  background-color: rgba(255, 255, 255, 1);
}
</style>
