<template>
  <div>
    <div class="page-toolbar">
      <el-button type="primary" @click="openCreate">新增应用</el-button>
      <el-button @click="loadData">刷新</el-button>
    </div>

    <el-card class="card-shadow" body-style="padding: 0">
      <div class="table-scroll">
      <el-table :data="pagedRows" v-loading="loading" size="default" empty-text="暂无应用" max-height="calc(100vh - 220px)">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="name" label="备注" min-width="140" />
        <el-table-column prop="corp_id" label="corp_id" min-width="180" show-overflow-tooltip class-name="desktop-only" />
        <el-table-column prop="agent_id" label="agent_id" width="100" class-name="desktop-only" />
        <el-table-column label="@all" width="120" class-name="desktop-only">
          <template #default="{ row }">
            <el-tag v-if="row.allow_at_all" type="success" size="small">允许 {{ row.at_all_daily_limit }}/天</el-tag>
            <el-tag v-else type="info" size="small">禁止</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="token_count" label="绑定 Token" width="100" />
        <el-table-column label="验证" width="100" class-name="desktop-only">
          <template #default="{ row }">
            <el-tag v-if="row.verify_file_name" type="success" size="small">域名</el-tag>
            <el-tag v-else-if="row.callback_configured" type="warning" size="small">回调</el-tag>
            <el-tag v-else type="info" size="small">未配置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" link type="primary" @click="testApp(row)">测试发送</el-button>
            <el-button size="small" link type="danger" @click="removeApp(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
    </el-card>

    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="rows.length"
        layout="total, sizes, prev, pager, next"
        background
        small
        @size-change="currentPage = 1"
      />
    </div>

    <el-drawer v-model="drawerVisible" :title="drawerTitle" :size="drawerSize" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="备注（名称）" prop="name">
          <el-input v-model="form.name" placeholder="如：监控告警应用" />
        </el-form-item>
        <el-form-item label="企业ID（corp_id）" prop="corp_id">
          <el-input v-model="form.corp_id" placeholder="企业微信后台 → 我的企业 → 企业ID" />
        </el-form-item>
        <el-form-item label="应用ID（agent_id）" prop="agent_id">
          <el-input-number v-model="form.agent_id" :min="1" :controls="false" style="width: 100%" placeholder="企业微信后台 → 应用管理 → AgentId" />
        </el-form-item>
        <el-form-item label="应用Secret（corp_secret）" prop="corp_secret" :rules="form.id ? [] : [{ required: true, message: '请输入应用Secret', trigger: 'blur' }]">
          <el-input v-model="form.corp_secret" type="password" show-password placeholder="编辑时留空表示不修改" />
        </el-form-item>
        <el-form-item label="是否允许 @all">
          <el-switch v-model="form.allow_at_all" />
          <span class="text-muted" style="margin-left: 12px; font-size: 12px">关闭后该应用所有推送都不使用 @all</span>
        </el-form-item>
        <el-form-item label="@all 每日上限" v-if="form.allow_at_all">
          <el-input-number v-model="form.at_all_daily_limit" :min="0" :max="1000" />
        </el-form-item>
        <el-form-item label="备注（可选）">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>

        <!-- ====== 企业微信验证配置（可选） ====== -->
        <el-divider content-position="left">企业微信验证配置（可选）</el-divider>

        <el-form-item label="验证方式">
          <el-radio-group v-model="form.verify_mode">
            <el-radio value="none">不配置</el-radio>
            <el-radio value="domain">可信域名验证</el-radio>
            <el-radio value="callback">接收消息服务器</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 方式一：可信域名验证 -->
        <template v-if="form.verify_mode === 'domain'">
          <el-form-item label="验证文件">
            <el-upload
              :auto-upload="false"
              :show-file-list="true"
              :limit="1"
              accept=".txt"
              :on-change="onVerifyFileChange"
              :on-remove="onVerifyFileRemove"
              :file-list="verifyFileList"
            >
              <el-button type="primary" plain>选择 WW_verify_*.txt 文件</el-button>
            </el-upload>
          </el-form-item>
          <el-alert type="info" :closable="false" show-icon class="verify-guide">
            <div class="guide-title">操作指引</div>
            <ol class="guide-list">
              <li>登录 <a href="https://work.weixin.qq.com" target="_blank" rel="noopener">企业微信管理后台</a> → 应用管理 → 你的应用 → 可信域名</li>
              <li>点击「下载文件」，获取 <code>WW_verify_xxx.txt</code> 验证文件</li>
              <li>在此处上传该文件，系统会自动在域名根目录提供访问</li>
              <li>回到企业微信后台，填写可信域名并保存即可完成验证</li>
            </ol>
            <div class="guide-url" v-if="form.verify_file_name">
              验证文件访问地址：<code>{{ verifyFileUrl }}</code>
            </div>
          </el-alert>
        </template>

        <!-- 方式二：接收消息服务器 -->
        <template v-if="form.verify_mode === 'callback'">
          <el-form-item label="回调 URL">
            <el-input :model-value="callbackUrl" readonly>
              <template #append>
                <el-button @click="copyText(callbackUrl)">复制</el-button>
              </template>
            </el-input>
            <div class="text-muted" style="font-size: 12px; margin-top: 4px">系统自动生成，无需手动填写</div>
          </el-form-item>
          <el-form-item label="Token">
            <el-input v-model="form.callback_token" placeholder="用于签名验证">
              <template #append>
                <el-button @click="form.callback_token = generateToken()">随机生成</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="EncodingAESKey">
            <el-input v-model="form.callback_aes_key" placeholder="43 字符，用于消息加解密（编辑时留空表示不修改）">
              <template #append>
                <el-button @click="form.callback_aes_key = generateAESKey()">随机生成</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-alert type="info" :closable="false" show-icon class="verify-guide">
            <div class="guide-title">操作指引</div>
            <ol class="guide-list">
              <li>复制上方的 <b>回调 URL</b>、<b>Token</b>、<b>EncodingAESKey</b> 三个值</li>
              <li>登录企业微信管理后台 → 应用管理 → 你的应用 → 接收消息 → 设置 API</li>
              <li>将三个值填入对应字段，消息加密模式选择「安全模式」</li>
              <li>点击「保存」，企业微信会向你的 URL 发送验证请求，系统自动响应</li>
              <li>验证通过后即可接收企业微信推送的消息和事件</li>
            </ol>
          </el-alert>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { appsApi } from '../api/index.js';
import { usePageSize } from '../composables/useTablePrefs.js';

const rows = ref([]);
const { pageSize } = usePageSize('apps_page_size');
const currentPage = ref(1);
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});
const loading = ref(false);
const drawerVisible = ref(false);
const submitting = ref(false);
const formRef = ref(null);

const form = reactive({
  id: null, name: '', corp_id: '', agent_id: null, corp_secret: '',
  allow_at_all: true, at_all_daily_limit: 5, note: '',
  // 企业微信验证配置
  verify_mode: 'none',
  verify_file_name: null,
  verify_file_content: null,
  callback_token: '',
  callback_aes_key: '',
});

const verifyFileList = ref([]);

const rules = {
  name: [{ required: true, message: '请输入备注', trigger: 'blur' }],
  corp_id: [{ required: true, message: '请输入企业ID（corp_id）', trigger: 'blur' }],
  agent_id: [{ required: true, message: '请输入应用ID（agent_id）', trigger: 'blur' }],
};

const drawerTitle = ref('新增应用');

const isMobile = ref(window.matchMedia('(max-width: 991px)').matches);
const onResize = () => { isMobile.value = window.matchMedia('(max-width: 991px)').matches; };
onMounted(() => { window.addEventListener('resize', onResize); loadData(); });
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); });
const drawerSize = computed(() => isMobile.value ? '90%' : 560);

// 自动生成回调 URL
const callbackUrl = computed(() => {
  const base = window.location.origin;
  return form.id ? `${base}/api/wx/callback/${form.id}` : `${base}/api/wx/callback/{应用ID}`;
});

// 验证文件访问 URL
const verifyFileUrl = computed(() => {
  if (!form.verify_file_name) return '';
  return `${window.location.origin}/${form.verify_file_name}`;
});

// 随机生成 Token（32 字符 hex）
function generateToken() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 随机生成 EncodingAESKey（43 字符 base64 无填充）
function generateAESKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 43; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 复制到剪贴板
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('已复制到剪贴板');
  });
}

// 验证文件上传处理
function onVerifyFileChange(file) {
  const raw = file.raw;
  if (!raw) return;
  const reader = new FileReader();
  reader.onload = () => {
    form.verify_file_name = raw.name;
    form.verify_file_content = reader.result;
    ElMessage.success(`已加载 ${raw.name}`);
  };
  reader.readAsText(raw);
}

function onVerifyFileRemove() {
  form.verify_file_name = null;
  form.verify_file_content = null;
}

async function loadData() {
  loading.value = true;
  try {
    const r = await appsApi.list();
    rows.value = r.data || [];
    currentPage.value = 1;
  } finally { loading.value = false; }
}

function openCreate() {
  drawerTitle.value = '新增应用';
  Object.assign(form, {
    id: null, name: '', corp_id: '', agent_id: null, corp_secret: '',
    allow_at_all: true, at_all_daily_limit: 5, note: '',
    verify_mode: 'none',
    verify_file_name: null, verify_file_content: null,
    callback_token: '', callback_aes_key: '',
  });
  verifyFileList.value = [];
  drawerVisible.value = true;
}

function openEdit(row) {
  drawerTitle.value = '编辑应用';
  let mode = 'none';
  if (row.verify_file_name) mode = 'domain';
  else if (row.callback_configured || row.callback_token) mode = 'callback';
  Object.assign(form, {
    id: row.id, name: row.name, corp_id: row.corp_id, agent_id: row.agent_id,
    corp_secret: '',
    allow_at_all: row.allow_at_all === 1 || row.allow_at_all === true,
    at_all_daily_limit: row.at_all_daily_limit ?? 5,
    note: row.note || '',
    verify_mode: mode,
    verify_file_name: row.verify_file_name || null,
    verify_file_content: null,
    callback_token: row.callback_token || '',
    callback_aes_key: '',
  });
  verifyFileList.value = row.verify_file_name ? [{ name: row.verify_file_name }] : [];
  drawerVisible.value = true;
}

async function submitForm() {
  await formRef.value.validate();
  submitting.value = true;
  try {
    const payload = {
      name: form.name,
      corp_id: form.corp_id,
      agent_id: form.agent_id,
      allow_at_all: form.allow_at_all ? 1 : 0,
      at_all_daily_limit: form.at_all_daily_limit,
      note: form.note || null,
    };
    if (form.corp_secret) payload.corp_secret = form.corp_secret;

    // 验证配置
    if (form.verify_mode === 'domain') {
      payload.verify_file_name = form.verify_file_name;
      payload.verify_file_content = form.verify_file_content;
      // 清除 callback 配置
      payload.callback_token = null;
      payload.callback_aes_key = null;
    } else if (form.verify_mode === 'callback') {
      payload.callback_token = form.callback_token || null;
      // 编辑时若未输入新的 AES key，则不发送（保留原值）
      if (form.callback_aes_key) {
        payload.callback_aes_key = form.callback_aes_key;
      }
      // 清除域名验证文件
      payload.verify_file_name = null;
      payload.verify_file_content = null;
    } else {
      // 不配置：清除所有验证配置
      payload.verify_file_name = null;
      payload.verify_file_content = null;
      payload.callback_token = null;
      payload.callback_aes_key = null;
    }

    if (form.id) await appsApi.update(form.id, payload);
    else await appsApi.create(payload);
    ElMessage.success(form.id ? '已更新' : '已创建');
    drawerVisible.value = false;
    await loadData();
  } finally { submitting.value = false; }
}

async function testApp(row) {
  try {
    const r = await appsApi.test(row.id, {});
    ElMessage.success(`access_token 刷新成功，过期 ${new Date(r.expires_at * 1000).toLocaleString()}`);
  } catch (e) {
    // 已弹错
  }
}

async function removeApp(row) {
  try {
    await ElMessageBox.confirm(`确定删除应用「${row.name}」？`, '提示', { type: 'warning' });
  } catch { return; }
  try {
    await appsApi.remove(row.id);
    ElMessage.success('已删除');
    await loadData();
  } catch (e) {
    // 错误已弹
  }
}
</script>

<style scoped>
.verify-guide { margin: 12px 0; }
.guide-title { font-weight: 700; margin-bottom: 6px; }
.guide-list { padding-left: 18px; line-height: 1.8; font-size: 13px; }
.guide-url { margin-top: 8px; font-size: 13px; word-break: break-all; }
.guide-url code, .guide-list code {
  background: #f5f7fa;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #d63384;
}
</style>
