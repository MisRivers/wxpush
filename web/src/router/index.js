import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes = [
  { path: '/init', name: 'init', component: () => import('../views/Init.vue'), meta: { public: true } },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layouts/AdminLayout.vue'),
    meta: { requiresAuth: true },
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue') },
      { path: 'apps', name: 'apps', component: () => import('../views/Apps.vue') },
      { path: 'webhooks', name: 'webhooks', component: () => import('../views/Webhooks.vue') },
      { path: 'tokens', name: 'tokens', component: () => import('../views/Tokens.vue') },
      { path: 'logs', name: 'logs', component: () => import('../views/Logs.vue') },
      { path: 'debug', name: 'debug', component: () => import('../views/Debug.vue') },
      { path: 'settings', name: 'settings', component: () => import('../views/Settings.vue') },
      { path: 'help', name: 'help', component: () => import('../views/Help.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  // 初始化状态未知时先探测一次
  if (auth.initialized === null) {
    try { await auth.fetchStatus(); } catch { /* 探测失败按已初始化处理，进入登录 */ }
  }

  if (auth.initialized === false && to.name !== 'init') {
    return { name: 'init' };
  }
  if (auth.initialized === true && to.name === 'init') {
    return { name: 'login' };
  }
  if (auth.initialized === true && !auth.isLoggedIn && to.meta.requiresAuth) {
    return { name: 'login' };
  }
  if (auth.isLoggedIn && (to.name === 'login' || to.name === 'init')) {
    return { name: 'dashboard' };
  }
});

export default router;
