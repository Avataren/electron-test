import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    electron([
      {
        // Main process entry point
        entry: 'src/main.ts',
      },
      {
        // Preload script
        entry: 'src/preload.ts',
        onstart({ startup }) {
          // Only start Electron app once
          startup()
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
