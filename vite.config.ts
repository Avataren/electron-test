import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig(({ mode }) => ({
  // Use relative paths in production so app://-/index.html can resolve assets correctly
  base: mode === 'development' ? '/' : './',

  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Let Electron's <webview> pass through
          isCustomElement: (tag) => tag === 'webview',
        },
      },
    }),

    // Vue DevTools only in dev
    ...(mode === 'development' ? [vueDevTools()] : []),

    // Electron main & preload
    electron([
      // Main process
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            // keep CJS for Electron main
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: '[name].js',
              },
            },
            sourcemap: mode !== 'development',
            target: 'node22',
            minify: false,
            emptyOutDir: false, // don't wipe renderer build
          },
        },
      },
      // Preload
      {
        entry: 'electron/preload.ts',
        onstart({ startup }) {
          // start Electron app in dev
          startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: '[name].js',
              },
            },
            sourcemap: mode !== 'development',
            target: 'node22',
            minify: false,
            emptyOutDir: false,
          },
        },
      },
    ]),

    // Makes Node/Electron APIs available in renderer during dev, keeps deps optimized
    renderer(),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // put hashed assets under ./assets (works with base:'./')
    assetsDir: 'assets',
    sourcemap: mode !== 'development',
    target: 'es2020',
    // optional: raise warning limit or split more aggressively if you want
    // chunkSizeWarningLimit: 1000,
    // rollupOptions: {
    //   output: {
    //     manualChunks: {
    //       vue: ['vue'],
    //     },
    //   },
    // },
  },

  // Dev server tweaks (optional)
  server: {
    port: 5173,
    strictPort: true,
  },
}))
