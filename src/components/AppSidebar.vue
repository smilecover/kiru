<script setup lang="ts">
import { computed } from 'vue';
import type { Component } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Bug,
  Heart,
  House,
  Puzzle,
  Search,
  Settings,
  Store,
} from 'lucide-vue-next';
import { useUiStore } from '../stores/ui';
import { useExtensionsStore } from '../stores/extensions';

const route = useRoute();
const ui = useUiStore();
const extensions = useExtensionsStore();
const { t } = useI18n();

interface NavItem {
  path: string;
  label: string;
  icon: Component;
  exact?: boolean;
  badge?: boolean;
  section?: string;
}

const items = computed<NavItem[]>(() => [
  { path: '/', label: t('common.home'), icon: House, exact: true, section: 'nav.browse' },
  { path: '/search', label: t('common.search'), icon: Search, section: 'nav.browse' },
  { path: '/favorites', label: t('common.favorites'), icon: Heart, section: 'nav.browse' },
  { path: '/extensions', label: t('common.extension'), icon: Puzzle, badge: true, section: 'nav.manage' },
  { path: '/extensions/repo', label: t('common.extension-repo'), icon: Store, section: 'nav.manage' },
  { path: '/debug', label: t('debug.title'), icon: Bug, section: 'nav.manage' },
]);

const sections = computed(() => {
  const result: { label: string; items: NavItem[] }[] = [];
  for (const item of items.value) {
    const label = item.section ?? '';
    let group = result.find((entry) => entry.label === label);
    if (!group) {
      group = { label, items: [] };
      result.push(group);
    }
    group.items.push(item);
  }
  return result;
});

function isActive(item: NavItem): boolean {
  if (item.exact) return route.path === item.path;
  if (item.path === '/extensions') {
    return route.path.startsWith('/extensions') && !route.path.startsWith('/extensions/repo');
  }
  return route.path === item.path || route.path.startsWith(`${item.path}/`);
}

const extensionCount = computed(() => extensions.visibleExtensions.length);

const sectionLabels = computed<Record<string, string>>(() => ({
  'nav.browse': t('nav.browse'),
  'nav.manage': t('nav.manage'),
}));
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed }">
    <nav class="sidebar-nav">
      <template v-for="section in sections" :key="section.label">
        <div v-if="section.label" class="nav-section-title">
          <span v-if="!ui.sidebarCollapsed">{{ sectionLabels[section.label] ?? section.label }}</span>
          <span v-else class="section-dot" />
        </div>
        <RouterLink
          v-for="item in section.items"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item) }"
          :title="ui.sidebarCollapsed ? item.label : undefined"
        >
          <span class="nav-icon">
            <component :is="item.icon" :size="18" :stroke-width="1.9" />
          </span>
          <span v-if="!ui.sidebarCollapsed" class="nav-label">{{ item.label }}</span>
          <span
            v-if="item.badge && extensionCount > 0"
            class="nav-badge"
            :class="{ dot: ui.sidebarCollapsed }"
          >
            {{ ui.sidebarCollapsed ? '' : extensionCount }}
          </span>
        </RouterLink>
      </template>
    </nav>
    <div class="sidebar-footer">
      <RouterLink
        to="/settings"
        class="nav-item"
        :class="{ active: route.path.startsWith('/settings') }"
        :title="ui.sidebarCollapsed ? t('common.settings') : undefined"
      >
        <span class="nav-icon"><Settings :size="18" :stroke-width="1.9" /></span>
        <span v-if="!ui.sidebarCollapsed" class="nav-label">{{ t('common.settings') }}</span>
      </RouterLink>
      <div v-if="!ui.sidebarCollapsed" class="sidebar-meta">
        <span>Kiru</span>
        <span>0.1.0</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex: 0 0 var(--sidebar-width);
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  transition: width 0.2s ease, flex-basis 0.2s ease;
  overflow: hidden;
}

.sidebar.collapsed {
  width: var(--sidebar-width-collapsed);
  flex-basis: var(--sidebar-width-collapsed);
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
}

.nav-section-title {
  height: 28px;
  padding: 10px 10px 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  align-items: center;
}

.collapsed .nav-section-title {
  justify-content: center;
  padding: 8px 0;
}

.section-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-strong);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  height: 38px;
  margin-bottom: 2px;
  padding: 0 11px;
  border-radius: 9px;
  color: var(--text-secondary);
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.14s ease, color 0.14s ease;
  overflow: hidden;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}

.nav-icon {
  display: grid;
  place-items: center;
  width: 22px;
  flex: 0 0 22px;
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-badge {
  min-width: 20px;
  height: 19px;
  padding: 0 6px;
  border-radius: 99px;
  background: var(--surface-3);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.nav-item.active .nav-badge {
  background: var(--accent);
  color: var(--accent-contrast);
}

.nav-badge.dot {
  position: absolute;
  right: 7px;
  top: 7px;
  min-width: 7px;
  width: 7px;
  height: 7px;
  padding: 0;
  font-size: 0;
}

.collapsed .nav-item {
  justify-content: center;
  padding: 0;
  gap: 0;
}

.collapsed .sidebar-nav {
  padding: 12px 9px;
}

.sidebar-footer {
  padding: 8px 10px 12px;
  border-top: 1px solid var(--border);
}

.sidebar-meta {
  display: flex;
  justify-content: space-between;
  padding: 10px 10px 0;
  color: var(--muted);
  font-size: 10.5px;
}
</style>
