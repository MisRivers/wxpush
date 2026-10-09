<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <img src="/logo.png" class="auth-logo" alt="WxPush" />
      <h2 class="auth-title">管理员登录</h2>
      <p class="auth-sub">WxPush 管理后台</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="用户名" autocomplete="username" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" show-password autocomplete="current-password" @keyup.enter="submit" />
        </el-form-item>

        <!-- Cloudflare Turnstile 人机验证 -->
        <div v-if="auth.turnstileEnabled" ref="turnstileContainer" class="turnstile-wrap mb-16"></div>

        <el-alert v-if="locked" type="error" :closable="false" show-icon class="mb-16">
          登录失败次数过多，已锁定。剩余 {{ lockCountdown }} 后可重试。
        </el-alert>

        <el-form-item>
          <el-button type="primary" :loading="loading" :disabled="locked || (auth.turnstileEnabled && !turnstileToken)" style="width: 100%" @click="submit">登录</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onBeforeUnmount, computed, onMounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();
const formRef = ref(null);
const loading = ref(false);

const form = reactive({ username: '', password: '' });
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

// Turnstile
const turnstileContainer = ref(null);
const turnstileToken = ref('');
const turnstileWidgetId = ref(null);

// 锁定倒计时（响应头 retry-after 启动）
const lockUntil = ref(0);
const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => {
  clearInterval(timer);
  removeTurnstile();
});

const locked = computed(() => lockUntil.value > now.value);
const lockCountdown = computed(() => {
  const sec = Math.max(0, Math.ceil((lockUntil.value - now.value) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} 分 ${s} 秒`;
});

onMounted(() => {
  // 确保已获取 status（含 turnstile 配置）
  if (auth.initialized === null) {
    auth.fetchStatus().then(() => {
      nextTick(() => renderTurnstile());
    });
  } else {
    nextTick(() => renderTurnstile());
  }
});

watch(() => auth.turnstileSiteKey, () => {
  nextTick(() => renderTurnstile());
});

function loadTurnstileScript() {
  return new Promise((resolve) => {
    if (window.turnstile) { resolve(); return; }
    const existing = document.getElementById('cf-turnstile-script');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

async function renderTurnstile() {
  if (!auth.turnstileEnabled || !turnstileContainer.value) return;
  await loadTurnstileScript();
  if (!window.turnstile) return;
  // 先移除旧的
  if (turnstileWidgetId.value !== null) {
    try { window.turnstile.remove(turnstileWidgetId.value); } catch {}
  }
  turnstileToken.value = '';
  turnstileWidgetId.value = window.turnstile.render(turnstileContainer.value, {
    sitekey: auth.turnstileSiteKey,
    callback: (token) => { turnstileToken.value = token; },
    'expired-callback': () => { turnstileToken.value = ''; },
    'error-callback': () => { turnstileToken.value = ''; },
  });
}

function removeTurnstile() {
  if (turnstileWidgetId.value !== null && window.turnstile) {
    try { window.turnstile.remove(turnstileWidgetId.value); } catch {}
    turnstileWidgetId.value = null;
  }
}

async function submit() {
  await formRef.value.validate().catch(() => null);
  loading.value = true;
  try {
    await formRef.value.validate();
    const payload = { username: form.username, password: form.password };
    if (auth.turnstileEnabled) {
      payload.turnstile_token = turnstileToken.value;
    }
    await auth.login(payload);
    ElMessage.success('登录成功');
    router.replace({ name: 'dashboard' });
  } catch (e) {
    // 429：锁定
    if (e?.response?.status === 429) {
      const retry = parseInt(e.response.headers?.['retry-after'] || '900', 10);
      lockUntil.value = Date.now() + retry * 1000;
    }
    // Turnstile token 过期后重新渲染
    if (auth.turnstileEnabled) {
      turnstileToken.value = '';
      nextTick(() => renderTurnstile());
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
  padding: 16px;
}
.auth-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  padding: 32px;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
}
.auth-logo {
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  display: block;
}
.auth-title { margin: 0 0 6px; font-size: 22px; text-align: center; }
.auth-sub { color: #909399; margin: 0 0 24px; font-size: 13px; text-align: center; }
.turnstile-wrap { min-height: 65px; }

@media (max-width: 480px) {
  .auth-card { padding: 24px 20px; }
}
</style>
