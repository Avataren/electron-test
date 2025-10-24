import { createRouter, createWebHistory } from 'vue-router'
import ThreeWebview from '@/components/Threewebview.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'webview',
      component: ThreeWebview,
    },
  ],
})

export default router
