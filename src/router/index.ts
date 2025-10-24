import { createRouter, createWebHistory } from 'vue-router'
import WebviewPage from '@/components/WebviewPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'webview',
      component: WebviewPage,
    },
  ],
})

export default router
