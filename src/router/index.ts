import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('../views/SearchView.vue'),
    },
    {
      path: '/search-extension',
      name: 'extension-search',
      component: () => import('../views/ExtensionSearchView.vue'),
    },
    {
      path: '/favorites/:type?',
      name: 'favorites',
      component: () => import('../views/FavoritesView.vue'),
      props: true,
    },
    {
      path: '/extensions',
      name: 'extensions',
      component: () => import('../views/ExtensionsView.vue'),
    },
    {
      path: '/extensions/repo',
      name: 'extension-repo',
      component: () => import('../views/ExtensionRepoView.vue'),
    },
    {
      path: '/extensions/:package/settings',
      name: 'extension-settings',
      component: () => import('../views/ExtensionSettingsView.vue'),
      props: true,
    },
    {
      path: '/extensions/:package/code',
      name: 'extension-code',
      component: () => import('../views/CodeEditView.vue'),
      props: true,
    },
    {
      path: '/detail',
      name: 'detail',
      component: () => import('../views/DetailView.vue'),
    },
    {
      path: '/watch',
      name: 'watch',
      component: () => import('../views/watch/WatchView.vue'),
      meta: { immersive: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/settings/anilist',
      name: 'anilist',
      component: () => import('../views/AnilistView.vue'),
    },
    {
      path: '/settings/anilist/more',
      name: 'anilist-more',
      component: () => import('../views/AnilistMoreView.vue'),
    },
    {
      path: '/debug',
      name: 'debug',
      component: () => import('../views/DebugView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

export default router;
