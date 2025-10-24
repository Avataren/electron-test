import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Treat webview as a custom element (Electron webview tag)
          // Note: We're not using webview anymore, but keeping this for backwards compatibility
          isCustomElement: (tag) => tag === 'webview',
        },
      },
    }),
    vueDevTools(),
    electron([
      {
        // Main process entry point
        entry: 'electron/main.ts',
      },
      {
        // Preload script - use ES module format
        entry: 'electron/preload.ts',
        onstart({ startup }) {
          startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                format: 'es', // Use ES module format for preload
                entryFileNames: '[name].mjs', // Output as .mjs
              },
            },
          },
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
