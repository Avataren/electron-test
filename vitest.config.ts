// vitest.config.ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'   // <-- correct import
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',     // or 'node' if you prefer
    globals: true,
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    setupFiles: [],                // add your setup file if you have one
  },
})
