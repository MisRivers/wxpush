<template>
  <el-container class="admin-layout">
    <!-- 桌面端侧边栏 -->
    <el-aside v-if="!isMobile" width="220px" class="sidebar">
      <div class="logo">
        <img src="/logo.png" class="logo-icon" alt="logo" />
        <span>WxPush</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        background-color="#1f2d3d"
        text-color="#cfd5dc"
        active-text-color="#ffffff"
        router
      >
        <el-menu-item v-for="item in menuItems" :key="item.index" :index="item.index">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 移动端抽屉侧边栏 -->
    <el-drawer
      v-if="isMobile"
      v-model="drawerVisible"
      direction="ltr"
      size="220px"
      :with-header="false"
      class="mobile-sidebar-drawer"
    >
      <div class="sidebar mobile-sidebar">
        <div class="logo">
          <img src="/logo.png" class="logo-icon" alt="logo" />
          <span>WxPush</span>
        </div>
        <el-menu
          :default-active="activeMenu"
          background-color="#1f2d3d"
          text-color="#cfd5dc"
          active-text-color="#ffffff"
          router
          @select="onMenuSelect"
        >
          <el-menu-item v-for="item in menuItems" :key="item.index" :index="item.index">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </div>
    </el-drawer>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-button v-if="isMobile" class="menu-toggle" text @click="drawerVisible = true">
            <el-icon size="20"><Menu /></el-icon>
          </el-button>
          <span class="page-title">{{ currentTitle }}</span>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click" @command="handleUserCommand">
            <span class="user-trigger">
              {{ auth.user?.username || 'admin' }}
              <el-icon><CaretBottom /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">系统设置</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import {
  Odometer, Connection, ChatLineRound, Key, Document, Promotion, Setting, CaretBottom, Menu, QuestionFilled,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const isMobile = ref(false);
const drawerVisible = ref(false);

const menuItems = [
  { index: '/dashboard', label: '仪表盘', icon: Odometer },
  { index: '/apps', label: '应用管理', icon: Connection },
  { index: '/webhooks', label: '群机器人', icon: ChatLineRound },
  { index: '/tokens', label: 'Token 管理', icon: Key },
  { index: '/logs', label: '推送日志', icon: Document },
  { index: '/debug', label: '调试发送', icon: Promotion },
  { index: '/settings', label: '系统设置', icon: Setting },
  { index: '/help', label: '使用帮助', icon: QuestionFilled },
];

const TITLES = {
  dashboard: '仪表盘',
  apps: '应用管理',
  webhooks: '群机器人管理',
  tokens: 'Token 管理',
  logs: '推送日志',
  debug: '调试发送',
  settings: '系统设置',
  help: '使用帮助',
};

const activeMenu = computed(() => route.path);
const currentTitle = computed(() => TITLES[route.name] || 'WxPush');

function checkMobile() {
  isMobile.value = window.matchMedia('(max-width: 991px)').matches;
}

onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', checkMobile);
});

function onMenuSelect() {
  drawerVisible.value = false;
}

async function handleUserCommand(cmd) {
  if (cmd === 'logout') {
    try {
      await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' });
    } catch { return; }
    auth.logout();
    router.replace({ name: 'login' });
  } else if (cmd === 'settings') {
    router.push({ name: 'settings' });
  }
}
</script>

<style scoped>
.admin-layout { height: 100vh; }
.sidebar {
  background: #1f2d3d;
  overflow-y: auto;
}
.logo {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}
.sidebar :deep(.el-menu) { border-right: none; }
.header {
  background: #fff;
  border-bottom: 1px solid #e6e8eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-title { font-size: 16px; font-weight: 600; }
.user-trigger {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #606266;
}
.main { padding: 20px; background: #f5f7fa; overflow: auto; }

/* 移动端侧边栏 */
.mobile-sidebar { height: 100%; }

.menu-toggle {
  padding: 8px;
}

@media (max-width: 991px) {
  .header { padding: 0 12px; }
  .page-title { font-size: 15px; }
}
</style>
