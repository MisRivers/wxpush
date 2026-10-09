<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <img src="/logo.png" class="auth-logo" alt="WxPush" />
      <h2 class="auth-title">系统初始化</h2>
      <p class="auth-sub">此操作仅在首次部署时可用。完成后该接口将永久关闭。</p>

      <el-alert type="warning" :closable="false" show-icon class="mb-16">
        <div style="line-height: 1.6">
          主密钥（<code>MASTER_KEY</code>）与 JWT 密钥（<code>JWT_SECRET</code>）丢失将导致
          <b>全部加密存储的 secret 失效</b>，且无法恢复。请务必提前备份。
        </div>
      </el-alert>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent
      >
        <el-form-item label="管理员用户名" prop="username">
          <el-input v-model="form.username" placeholder="3-32 字符，字母开头，仅字母数字下划线" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="≥8 字符，必须含字母与数字" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="form.confirm" type="password" placeholder="再次输入密码" show-password autocomplete="new-password" />
        </el-form-item>

        <!-- Turnstile 配置（可选） -->
        <el-divider>Cloudflare Turnstile（可选）</el-divider>
        <el-form-item label="Turnstile Site Key">
          <el-input v-model="form.turnstile_site_key" placeholder="留空表示暂不启用人机验证" />
        </el-form-item>
        <el-form-item label="Turnstile Secret Key">
          <el-input v-model="form.turnstile_secret_key" type="password" show-password placeholder="与 Site Key 配对的 Secret Key" />
        </el-form-item>
        <div class="text-muted" style="font-size: 12px; margin-bottom: 16px">
          获取地址：<a href="https://dash.cloudflare.com" target="_blank" rel="noopener">dash.cloudflare.com</a> → Turnstile。
          也可部署后在「系统设置」中配置。
        </div>

        <el-form-item>
          <el-button type="primary" :loading="loading" style="width: 100%" @click="submit">完成初始化</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();
const formRef = ref(null);
const loading = ref(false);

const form = reactive({
  username: '', password: '', confirm: '',
  turnstile_site_key: '', turnstile_secret_key: '',
});

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[A-Za-z][A-Za-z0-9_]{2,31}$/, message: '3-32 字符，字母开头，仅字母数字下划线', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { validator: (_, v, cb) => {
      if (!v) return cb(new Error('请输入密码'));
      if (v.length < 8) return cb(new Error('密码至少 8 字符'));
      if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return cb(new Error('密码必须同时含字母与数字'));
      cb();
    }, trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    { validator: (_, v, cb) => v === form.password ? cb() : cb(new Error('两次输入的密码不一致')), trigger: 'blur' },
  ],
};

async function submit() {
  loading.value = true;
  try {
    await formRef.value.validate();
    await auth.init({
      username: form.username,
      password: form.password,
      turnstile_site_key: form.turnstile_site_key || undefined,
      turnstile_secret_key: form.turnstile_secret_key || undefined,
    });
    ElMessage.success('初始化成功');
    router.replace({ name: 'dashboard' });
  } catch (e) {
    // 错误信息已由 request 拦截器弹出
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
  max-width: 420px;
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
.auth-title { margin: 0 0 8px; font-size: 22px; text-align: center; }
.auth-sub { color: #909399; margin: 0 0 20px; font-size: 13px; text-align: center; }
code {
  background: #f5f7fa;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #d63384;
}

@media (max-width: 480px) {
  .auth-card { padding: 24px 20px; }
}
</style>
