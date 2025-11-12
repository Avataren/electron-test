import { createRouter, createWebHistory } from 'vue-router'
import ThreeWebview from '@/components/Threewebview.vue'

const router = createRouter({
  // Use root base so SPA route is stable under custom protocols (app://-/)
  history: createWebHistory('/'),
  routes: [
    {
      path: '/',
      name: 'webview',
      component: ThreeWebview,
    },
  ],
})

export default router
