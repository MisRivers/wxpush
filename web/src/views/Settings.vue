<template>
  <div>
    <!-- 全局配置 -->
    <el-card class="card-shadow">
      <template #header><span>全局配置</span></template>
      <el-form :model="globalForm" label-position="top" v-loading="loading">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12">
            <el-form-item label="默认限流（次/分钟，0-10000）">
              <el-input-number v-model="globalForm.default_rate_limit" :min="0" :max="10000" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="日志保留天数（1-365）">
              <el-input-number v-model="globalForm.log_retention_days" :min="1" :max="365" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item>
          <el-button type="primary" :loading="savingGlobal" @click="saveGlobal">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 人机验证（Turnstile） -->
    <el-card class="card-shadow mt-16">
      <template #header><span>人机验证（Cloudflare Turnstile）</span></template>
      <el-alert type="info" :closable="false" show-icon class="mb-16">
        配置后登录页将显示人机验证组件，防止暴力登录。留空表示不启用。
        获取地址：<a href="https://dash.cloudflare.com" target="_blank" rel="noopener">dash.cloudflare.com</a> → Turnstile
      </el-alert>
      <el-form :model="turnstileForm" label-position="top">
        <el-form-item label="Site Key（公开，前端使用）">
          <el-input v-model="turnstileForm.turnstile_site_key" placeholder="Turnstile Site Key" />
        </el-form-item>
        <el-form-item label="Secret Key（私密，后端验证）">
          <el-input v-model="turnstileForm.turnstile_secret_key" type="password" show-password placeholder="留空表示不修改现有 Secret Key" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingTurnstile" @click="saveTurnstile">保存配置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 修改密码 -->
    <el-card class="card-shadow mt-16">
      <template #header><span>修改密码</span></template>
      <el-form :model="pwdForm" :rules="pwdRules" ref="pwdFormRef" label-position="top">
        <el-form-item label="原密码" prop="old_password">
          <el-input v-model="pwdForm.old_password" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="new_password">
          <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="≥8 字符，含字母+数字" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm">
          <el-input v-model="pwdForm.confirm" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="changingPwd" @click="changePassword">修改</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- access_token 手动刷新 -->
    <el-card class="card-shadow mt-16">
      <template #header><span>access_token 手动刷新</span></template>
      <el-form label-position="top">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="16">
            <el-form-item label="选择应用">
              <el-select v-model="refreshAppId" placeholder="选择应用" style="width: 100%" filterable>
                <el-option v-for="a in apps" :key="a.id" :label="a.name" :value="a.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="8" class="refresh-btn-col">
            <el-form-item label="&nbsp;">
              <el-button type="primary" :loading="refreshing" :disabled="!refreshAppId" @click="refreshToken">刷新</el-button>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <!-- 日志清理 -->
    <el-card class="card-shadow mt-16">
      <template #header><span>日志清理</span></template>
      <el-form label-position="top">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="16">
            <el-form-item label="清理 N 天前的日志">
              <el-input-number v-model="cleanDays" :min="1" :max="365" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="8" class="refresh-btn-col">
            <el-form-item label="&nbsp;">
              <el-button type="danger" :loading="cleaning" @click="cleanLogs">立即清理</el-button>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <div class="text-muted" style="font-size: 12px; margin-top: 4px">
        清理操作将分批删除（每批 1000 行），不会阻塞推送。
      </div>
    </el-card>

    <!-- 数据库导出 -->
    <el-card class="card-shadow mt-16">
      <template #header><span>数据库导出</span></template>
      <el-button type="primary" :loading="exporting" @click="exportDB">导出 SQLite 备份</el-button>
      <div class="text-muted" style="font-size: 12px; margin-top: 8px">
        含全部表与配置数据，secret 字段仍以加密形式存储。
      </div>
    </el-card>

    <!-- MASTER_KEY 轮换 -->
    <el-card class="card-shadow mt-16">
      <template #header><span>MASTER_KEY 轮换</span></template>
      <el-alert type="warning" :closable="false" show-icon class="mb-16">
        轮换流程：服务侧同时持有新/旧密钥；调用此接口需提供旧密钥（验证身份）与新密钥。
        服务将在轮换后用新密钥重新加密所有 secret 字段。请务必提前备份新密钥。
      </el-alert>
      <el-form :model="keyForm" label-position="top">
        <el-form-item label="旧 MASTER_KEY">
          <el-input v-model="keyForm.old_key" type="password" show-password placeholder="当前 MASTER_KEY（base64）" />
        </el-form-item>
        <el-form-item label="新 MASTER_KEY">
          <el-input v-model="keyForm.new_key" type="password" show-password placeholder="新 MASTER_KEY（base64，32 字节解码）" />
        </el-form-item>
        <el-form-item>
          <el-button type="danger" :loading="rotating" @click="rotateKey">开始轮换</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { settingsApi, appsApi } from '../api/index.js';
import { hashPassword } from '../utils/crypto.js';

const loading = ref(false);
const savingGlobal = ref(false);
const savingTurnstile = ref(false);
const changingPwd = ref(false);
const refreshing = ref(false);
const cleaning = ref(false);
const exporting = ref(false);
const rotating = ref(false);

const globalForm = reactive({ default_rate_limit: 60, log_retention_days: 30 });
const turnstileForm = reactive({ turnstile_site_key: '', turnstile_secret_key: '' });
const pwdForm = reactive({ old_password: '', new_password: '', confirm: '' });
const pwdFormRef = ref(null);
const apps = ref([]);
const refreshAppId = ref(null);
const cleanDays = ref(30);
const keyForm = reactive({ old_key: '', new_key: '' });

const pwdRules = {
  old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { validator: (_, v, cb) => {
      if (!v) return cb();
      if (v.length < 8) return cb(new Error('密码至少 8 字符'));
      if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return cb(new Error('必须含字母与数字'));
      cb();
    }, trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入', trigger: 'blur' },
    { validator: (_, v, cb) => v === pwdForm.new_password ? cb() : cb(new Error('两次输入不一致')), trigger: 'blur' },
  ],
};

onMounted(async () => {
  loading.value = true;
  try {
    const [s, a] = await Promise.all([settingsApi.get(), appsApi.list()]);
    if (s.data) {
      globalForm.default_rate_limit = Number(s.data.default_rate_limit ?? 60);
      globalForm.log_retention_days = Number(s.data.log_retention_days ?? 30);
      turnstileForm.turnstile_site_key = s.data.turnstile_site_key || '';
    }
    apps.value = a.data || [];
  } finally { loading.value = false; }
});

async function saveGlobal() {
  savingGlobal.value = true;
  try {
    await settingsApi.update({
      default_rate_limit: globalForm.default_rate_limit,
      log_retention_days: globalForm.log_retention_days,
    });
    ElMessage.success('已保存');
  } finally { savingGlobal.value = false; }
}

async function saveTurnstile() {
  savingTurnstile.value = true;
  try {
    const payload = { turnstile_site_key: turnstileForm.turnstile_site_key };
    if (turnstileForm.turnstile_secret_key) {
      payload.turnstile_secret_key = turnstileForm.turnstile_secret_key;
    }
    await settingsApi.update(payload);
    ElMessage.success('Turnstile 配置已保存');
    turnstileForm.turnstile_secret_key = '';
  } finally { savingTurnstile.value = false; }
}

async function changePassword() {
  await pwdFormRef.value.validate();
  changingPwd.value = true;
  try {
    // 密码 SHA-256 哈希后再传输
    const [oldHash, newHash] = await Promise.all([
      hashPassword(pwdForm.old_password),
      hashPassword(pwdForm.new_password),
    ]);
    await settingsApi.changePassword({
      old_password: oldHash,
      new_password: newHash,
    });
    ElMessage.success('密码已修改，请重新登录');
    pwdForm.old_password = ''; pwdForm.new_password = ''; pwdForm.confirm = '';
  } finally { changingPwd.value = false; }
}

async function refreshToken() {
  refreshing.value = true;
  try {
    const r = await settingsApi.refreshToken(refreshAppId.value);
    ElMessage.success(`刷新成功，过期时间：${new Date(r.expires_at * 1000).toLocaleString()}`);
  } finally { refreshing.value = false; }
}

async function cleanLogs() {
  try {
    await ElMessageBox.confirm(`确定清理 ${cleanDays.value} 天前的日志？此操作不可撤销。`, '提示', { type: 'warning' });
  } catch { return; }
  cleaning.value = true;
  try {
    const r = await settingsApi.cleanLogs({ days: cleanDays.value });
    ElMessage.success(`已清理 ${r.deleted || 0} 条`);
  } finally { cleaning.value = false; }
}

async function exportDB() {
  exporting.value = true;
  try {
    const r = await settingsApi.exportDB();
    ElMessageBox.alert(
      `备份已生成，文件路径：${r.path}`,
      '数据库备份完成',
      { type: 'success' }
    );
  } finally { exporting.value = false; }
}

async function rotateKey() {
  if (!keyForm.old_key || !keyForm.new_key) {
    ElMessage.warning('请填写旧密钥与新密钥');
    return;
  }
  try {
    await ElMessageBox.confirm('确认开始轮换？轮换后需更新 .env 并重启服务。', '提示', { type: 'warning' });
  } catch { return; }
  rotating.value = true;
  try {
    const r = await settingsApi.rotateMasterKey({
      old_master_key: keyForm.old_key,
      new_master_key: keyForm.new_key,
    });
    ElMessageBox.alert(r.warning || r.message, '轮换请求已提交', { type: 'warning' });
    keyForm.old_key = ''; keyForm.new_key = '';
  } finally { rotating.value = false; }
}
</script>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.mt-16 { margin-top: 16px; }
.refresh-btn-col { display: flex; align-items: flex-end; }
</style>
