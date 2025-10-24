<script setup lang="ts">
import { ref, onMounted } from 'vue'

const url = ref('https://example.com')
const webviewRef = ref<HTMLElement | null>(null)
const isLoading = ref(true)
const canGoBack = ref(false)
const canGoForward = ref(false)

const loadUrl = () => {
  if (webviewRef.value) {
    const webview = webviewRef.value as any
    webview.loadURL(url.value)
  }
}

const goBack = () => {
  if (webviewRef.value) {
    const webview = webviewRef.value as any
    webview.goBack()
  }
}

const goForward = () => {
  if (webviewRef.value) {
    const webview = webviewRef.value as any
    webview.goForward()
  }
}

const reload = () => {
  if (webviewRef.value) {
    const webview = webviewRef.value as any
    webview.reload()
  }
}

onMounted(() => {
  const webview = webviewRef.value as any
  if (webview) {
    webview.addEventListener('did-start-loading', () => {
      isLoading.value = true
    })

    webview.addEventListener('did-stop-loading', () => {
      isLoading.value = false
      canGoBack.value = webview.canGoBack()
      canGoForward.value = webview.canGoForward()
    })

    webview.addEventListener('did-fail-load', (event: any) => {
      console.error('Failed to load:', event.errorDescription)
      isLoading.value = false
    })

    // Load initial URL
    webview.src = url.value
  }
})
</script>

<template>
  <div class="webview-container">
    <div class="toolbar">
      <button @click="goBack" :disabled="!canGoBack" class="nav-btn">←</button>
      <button @click="goForward" :disabled="!canGoForward" class="nav-btn">→</button>
      <button @click="reload" class="nav-btn">⟳</button>
      <input
        v-model="url"
        @keyup.enter="loadUrl"
        type="text"
        placeholder="Enter URL..."
        class="url-input"
      />
      <button @click="loadUrl" class="go-btn">Go</button>
      <span v-if="isLoading" class="loading">Loading...</span>
    </div>
    <webview ref="webviewRef" class="webview"></webview>
  </div>
</template>

<style scoped>
.webview-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  padding: 10px;
  background-color: #f5f5f5;
  border-bottom: 1px solid #ddd;
  gap: 8px;
}

.nav-btn {
  padding: 8px 12px;
  background-color: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

.nav-btn:hover:not(:disabled) {
  background-color: #e9e9e9;
}

.nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.url-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.go-btn {
  padding: 8px 16px;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.go-btn:hover {
  background-color: #45a049;
}

.loading {
  font-size: 12px;
  color: #666;
}

.webview {
  flex: 1;
  width: 100%;
}
</style>
