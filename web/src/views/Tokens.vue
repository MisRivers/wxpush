<template>
  <div>
    <div class="page-toolbar">
      <el-button type="primary" @click="openCreate">新增 Token</el-button>
      <el-button @click="loadData">刷新</el-button>
    </div>

    <el-card class="card-shadow" body-style="padding: 0">
      <div class="table-scroll">
        <el-table :data="pagedRows" v-loading="loading" size="default" empty-text="暂无 Token" max-height="calc(100vh - 220px)">
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="name" label="备注" min-width="140" />
          <el-table-column label="渠道" width="180" class-name="desktop-only">
            <template #default="{ row }">
              <el-tag size="small" :type="row.channel_type === 'app' ? 'warning' : 'success'">
                {{ row.channel_type === 'app' ? '应用消息' : '群机器人' }}
              </el-tag>
              <span style="margin-left: 6px">{{ row.channel_name || `#${row.channel_id}` }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag v-if="!row.enabled" type="info" size="small">已禁用</el-tag>
              <el-tag v-else-if="row.expires_at && row.expires_at * 1000 < Date.now()" type="danger" size="small">已过期</el-tag>
              <el-tag v-else type="success" size="small">活跃</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="rate_limit_per_min" label="限流/分" width="100" class-name="desktop-only" />
          <el-table-column label="允许类型" min-width="180" class-name="desktop-only">
            <template #default="{ row }">
              <el-tag v-for="t in (row.allowed_msg_types || [])" :key="t" size="small" style="margin-right: 4px">{{ t }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" link type="primary" @click="toggleEnabled(row)">
                {{ row.enabled ? '禁用' : '启用' }}
              </el-button>
              <el-button size="small" link type="primary" @click="regenerate(row)">重新生成</el-button>
              <el-button size="small" link type="danger" @click="remove(row)">删除</el-button>
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

    <!-- 创建/编辑 -->
    <el-drawer v-model="drawerVisible" :title="drawerTitle" :size="drawerSize" :close-on-click-modal="false">
      <el-steps :active="step" finish-status="success" align-center>
        <el-step title="选择渠道" />
        <el-step title="配置参数" />
      </el-steps>

      <div v-if="step === 0" class="step-content">
        <el-form ref="step1FormRef" :model="form" :rules="rules" label-position="top">
          <el-form-item label="备注（名称）" prop="name">
            <el-input v-model="form.name" placeholder="如：CI 告警 token" />
          </el-form-item>
          <el-form-item label="渠道类型" prop="channel_type">
            <el-radio-group v-model="form.channel_type" @change="onChannelChange">
              <el-radio value="app">应用消息</el-radio>
              <el-radio value="webhook">群机器人</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.channel_type === 'app'" label="应用" prop="app_id">
            <el-select v-model="form.app_id" placeholder="选择应用" style="width: 100%">
              <el-option v-for="a in apps" :key="a.id" :label="`${a.name} (${a.corp_id})`" :value="a.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.channel_type === 'webhook'" label="群机器人" prop="webhook_id">
            <el-select v-model="form.webhook_id" placeholder="选择群机器人" style="width: 100%">
              <el-option v-for="w in webhooks" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-form>
        <div class="step-actions">
          <el-button type="primary" @click="nextStep">下一步</el-button>
        </div>
      </div>

      <div v-if="step === 1" class="step-content">
        <el-form label-position="top">
          <template v-if="form.channel_type === 'app'">
            <el-form-item label="接收人列表">
              <div v-for="(r, i) in form.recipients" :key="i" class="recipient-row">
                <el-select v-model="r.recv_type" style="width: 100px">
                  <el-option label="user" value="user" />
                  <el-option label="party" value="department" />
                  <el-option label="tag" value="tag" />
                </el-select>
                <el-input v-model="r.recv_value" placeholder="多个用 | 分隔（如 user1|user2）" style="flex: 1" />
                <el-button link type="danger" @click="form.recipients.splice(i, 1)">删除</el-button>
              </div>
              <el-button size="small" @click="form.recipients.push({ recv_type: 'user', recv_value: '' })">+ 添加接收人</el-button>
              <div class="text-muted" style="font-size: 12px; margin-top: 4px">
                不填接收人时，调用时必须传 toUser，且必须是绑定接收人的子集
              </div>
            </el-form-item>
          </template>
          <el-form-item label="限流配额（次/分钟）">
            <el-input-number v-model="form.rate_limit_per_min" :min="0" :max="10000" />
          </el-form-item>
          <el-form-item label="IP 白名单（CIDR，每行一条，留空表示不限制）">
            <el-input v-model="ipWhitelistText" type="textarea" :rows="3" placeholder="如 10.0.0.0/8" />
          </el-form-item>
          <el-form-item label="过期时间（留空表示永久）">
            <el-date-picker
              v-model="form.expires_at"
              type="datetime"
              placeholder="选择过期时间"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="允许的消息类型">
            <el-checkbox-group v-model="form.allowed_msg_types">
              <el-checkbox value="text">text</el-checkbox>
              <el-checkbox value="markdown">markdown</el-checkbox>
              <el-checkbox value="textcard">textcard</el-checkbox>
              <el-checkbox value="image">image</el-checkbox>
              <el-checkbox value="news">news</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="备注（可选）">
            <el-input v-model="form.note" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>
        <div class="step-actions">
          <el-button @click="step = 0">上一步</el-button>
          <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 创建后展示 token 值 -->
    <el-dialog v-model="tokenResultVisible" title="Token 创建成功" :width="dialogWidth" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon>
        此 Token 仅展示一次，请立即复制并妥善保管。
      </el-alert>
      <el-form label-position="top" class="mt-16">
        <el-form-item label="X-API-Key">
          <el-input :model-value="newTokenValue" readonly>
            <template #append>
              <el-button @click="copyText(newTokenValue)">复制</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="URL 调用格式">
          <el-input :model-value="`${baseUrl}/${newTokenValue}.send`" readonly>
            <template #append>
              <el-button @click="copyText(`${baseUrl}/${newTokenValue}.send`)">复制</el-button>
            </template>
          </el-input>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="tokenResultVisible = false">我已保存</el-button>
      </template>
    </el-dialog>

    <!-- 重新生成后展示 -->
    <el-dialog v-model="regenResultVisible" title="Token 已重新生成" :width="dialogWidth2">
      <el-alert type="warning" :closable="false" show-icon>旧 Token 已失效，请立即复制新值并更新调用方。</el-alert>
      <el-input :model-value="regenTokenValue" readonly class="mt-16">
        <template #append><el-button @click="copyText(regenTokenValue)">复制</el-button></template>
      </el-input>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tokensApi, appsApi, webhooksApi } from '../api/index.js';
import { usePageSize } from '../composables/useTablePrefs.js';

const rows = ref([]);
const { pageSize } = usePageSize('tokens_page_size');
const currentPage = ref(1);
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});
const apps = ref([]);
const webhooks = ref([]);
const loading = ref(false);

const drawerVisible = ref(false);
const submitting = ref(false);
const drawerTitle = ref('新增 Token');
const step = ref(0);
const step1FormRef = ref(null);

const tokenResultVisible = ref(false);
const newTokenValue = ref('');

const regenResultVisible = ref(false);
const regenTokenValue = ref('');

const baseUrl = computed(() => window.location.origin);

const isMobile = ref(window.matchMedia('(max-width: 991px)').matches);
const onResize = () => { isMobile.value = window.matchMedia('(max-width: 991px)').matches; };
const drawerSize = computed(() => isMobile.value ? '90%' : 560);
const dialogWidth = computed(() => isMobile.value ? '92%' : '560');
const dialogWidth2 = computed(() => isMobile.value ? '92%' : '500');

const form = reactive({
  id: null,
  name: '',
  channel_type: 'app',
  app_id: null,
  webhook_id: null,
  recipients: [],
  rate_limit_per_min: 60,
  expires_at: null,
  allowed_msg_types: ['text', 'markdown', 'textcard', 'image', 'news'],
  enabled: true,
  note: '',
});

const ipWhitelistText = ref('');

const rules = {
  name: [{ required: true, message: '请输入备注', trigger: 'blur' }],
  channel_type: [{ required: true, message: '请选择渠道类型', trigger: 'change' }],
  app_id: [{ required: true, message: '请选择应用', trigger: 'change' }],
  webhook_id: [{ required: true, message: '请选择群机器人', trigger: 'change' }],
};

onMounted(() => { window.addEventListener('resize', onResize); loadData(); });
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); });

async function loadData() {
  loading.value = true;
  try {
    const [r1, r2, r3] = await Promise.all([tokensApi.list(), appsApi.list(), webhooksApi.list()]);
    rows.value = r1.data || [];
    currentPage.value = 1;
    apps.value = r2.data || [];
    webhooks.value = r3.data || [];
  } finally { loading.value = false; }
}

function onChannelChange() {
  form.app_id = null;
  form.webhook_id = null;
  form.recipients = [];
}

function openCreate() {
  drawerTitle.value = '新增 Token';
  Object.assign(form, {
    id: null, name: '', channel_type: 'app', app_id: null, webhook_id: null,
    recipients: [], rate_limit_per_min: 60, expires_at: null,
    allowed_msg_types: ['text', 'markdown', 'textcard', 'image', 'news'],
    enabled: true, note: '',
  });
  ipWhitelistText.value = '';
  step.value = 0;
  drawerVisible.value = true;
}

async function openEdit(row) {
  drawerTitle.value = '编辑 Token';
  Object.assign(form, {
    id: row.id,
    name: row.name,
    channel_type: row.channel_type,
    app_id: row.app_id,
    webhook_id: row.webhook_id,
    recipients: [],
    rate_limit_per_min: row.rate_limit_per_min ?? 60,
    expires_at: row.expires_at ? new Date(row.expires_at * 1000) : null,
    allowed_msg_types: [...(row.allowed_msg_types || [])],
    enabled: row.enabled === 1 || row.enabled === true,
    note: row.note || '',
  });
  ipWhitelistText.value = (row.ip_whitelist || []).join('\n');
  step.value = 1;
  drawerVisible.value = true;
  // 异步加载接收人列表（仅 app 渠道）
  if (row.channel_type === 'app') {
    try {
      const r = await tokensApi.recipients(row.id);
      form.recipients = (r.data || []).map(item => ({
        recv_type: item.recv_type,
        recv_value: item.recv_value,
      }));
    } catch {
      // 加载失败时静默，用户可重新添加
    }
  }
}

async function nextStep() {
  await step1FormRef.value.validate();
  step.value = 1;
}

async function submitForm() {
  submitting.value = true;
  try {
    const ipWhitelist = ipWhitelistText.value
      .split('\n').map(s => s.trim()).filter(Boolean);
    const payload = {
      name: form.name,
      allowed_msg_types: form.allowed_msg_types,
      rate_limit_per_min: form.rate_limit_per_min,
      ip_whitelist: ipWhitelist.length ? ipWhitelist : null,
      expires_at: form.expires_at ? Math.floor(new Date(form.expires_at).getTime() / 1000) : null,
      note: form.note || null,
    };
    if (form.id) {
      // 编辑：更新 token 自身字段
      await tokensApi.update(form.id, payload);
      // 同步 recipients（仅 app 渠道，先删后增）
      if (form.channel_type === 'app') {
        const newRecipients = form.recipients
          .filter(r => r.recv_value)
          .map(r => ({ recv_type: r.recv_type, recv_value: r.recv_value }));
        const oldList = await tokensApi.recipients(form.id);
        const oldArr = oldList.data || [];
        // 删除旧的
        await Promise.all(oldArr.map(item => tokensApi.removeRecipient(form.id, item.id)));
        // 添加新的
        if (newRecipients.length) {
          await Promise.all(newRecipients.map(r => tokensApi.addRecipient(form.id, r)));
        }
      }
      ElMessage.success('已更新');
      drawerVisible.value = false;
    } else {
      // 新增：包含渠道与 recipients
      payload.channel_type = form.channel_type;
      if (form.channel_type === 'app') {
        payload.app_id = form.app_id;
        payload.recipients = form.recipients.filter(r => r.recv_value).map(r => ({ recv_type: r.recv_type, recv_value: r.recv_value }));
      } else {
        payload.webhook_id = form.webhook_id;
      }
      const r = await tokensApi.create(payload);
      newTokenValue.value = r.token;
      drawerVisible.value = false;
      tokenResultVisible.value = true;
    }
    await loadData();
  } finally { submitting.value = false; }
}

async function toggleEnabled(row) {
  try {
    await tokensApi.update(row.id, { enabled: !row.enabled });
    ElMessage.success(row.enabled ? '已禁用' : '已启用');
    await loadData();
  } catch {}
}

async function regenerate(row) {
  try {
    await ElMessageBox.confirm(`重新生成「${row.name}」的 token 值？旧 token 将立即失效。`, '提示', { type: 'warning' });
  } catch { return; }
  try {
    const r = await tokensApi.regenerate(row.id);
    regenTokenValue.value = r.token;
    regenResultVisible.value = true;
    await loadData();
  } catch {}
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除 Token「${row.name}」？`, '提示', { type: 'warning' });
  } catch { return; }
  try {
    await tokensApi.remove(row.id);
    ElMessage.success('已删除');
    await loadData();
  } catch {}
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => ElMessage.success('已复制到剪贴板')).catch(() => ElMessage.warning('复制失败，请手动选择'));
}
</script>

<style scoped>
.step-content { margin-top: 24px; }
.step-actions { margin-top: 16px; text-align: right; }
.recipient-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
@media (max-width: 991px) {
  .recipient-row .el-select { width: 80px !important; }
}
</style>
