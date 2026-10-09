<template>
  <div>
    <div class="page-toolbar">
      <el-button type="primary" @click="openCreate">新增群机器人</el-button>
      <el-button @click="loadData">刷新</el-button>
    </div>

    <el-card class="card-shadow" body-style="padding: 0">
      <div class="table-scroll">
        <el-table :data="pagedRows" v-loading="loading" size="default" empty-text="暂无群机器人" max-height="calc(100vh - 220px)">
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="name" label="备注" min-width="140" />
          <el-table-column label="安全模式" width="160" class-name="desktop-only">
            <template #default="{ row }">
              <el-tag size="small" :type="secTagType(row.security_mode)">
                {{ secLabel(row.security_mode) }}
              </el-tag>
              <span v-if="row.security_mode === 'keyword'" class="text-muted" style="font-size: 12px; margin-left: 6px">
                关键词: {{ row.keyword }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="token_count" label="绑定 Token" width="100" class-name="desktop-only" />
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
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

    <el-drawer v-model="drawerVisible" :title="drawerTitle" :size="drawerSize" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="备注（名称）" prop="name">
          <el-input v-model="form.name" placeholder="如：值班群机器人" />
        </el-form-item>
        <el-form-item label="webhook URL" prop="webhook_url">
          <el-input v-model="form.webhook_url" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx" />
        </el-form-item>
        <el-form-item label="安全模式" prop="security_mode">
          <el-radio-group v-model="form.security_mode">
            <el-radio value="none">不用安全设置</el-radio>
            <el-radio value="keyword">自定义关键词</el-radio>
            <el-radio value="sign">加签</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.security_mode === 'keyword'" label="关键词" prop="keyword">
          <el-input v-model="form.keyword" placeholder="消息内容必须包含此关键词" />
        </el-form-item>
        <el-form-item v-if="form.security_mode === 'sign'" label="加签 secret" prop="sign_secret">
          <el-input v-model="form.sign_secret" type="password" show-password placeholder="编辑时留空表示不修改" />
        </el-form-item>
        <el-form-item label="备注（可选）">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
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
import { webhooksApi } from '../api/index.js';
import { usePageSize } from '../composables/useTablePrefs.js';

const rows = ref([]);
const { pageSize } = usePageSize('webhooks_page_size');
const currentPage = ref(1);
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});
const loading = ref(false);
const drawerVisible = ref(false);
const submitting = ref(false);
const formRef = ref(null);
const drawerTitle = ref('新增群机器人');

const form = reactive({
  id: null, name: '', webhook_url: '',
  security_mode: 'none', keyword: '', sign_secret: '', note: '',
});

const rules = {
  name: [{ required: true, message: '请输入备注', trigger: 'blur' }],
  webhook_url: [{ required: true, message: '请输入 webhook URL', trigger: 'blur' }],
  security_mode: [{ required: true, message: '请选择安全模式', trigger: 'change' }],
};

function secLabel(m) { return { none: '无', keyword: '关键词', sign: '加签' }[m] || m; }
function secTagType(m) { return { none: 'info', keyword: 'warning', sign: 'danger' }[m] || 'info'; }

const isMobile = ref(window.matchMedia('(max-width: 991px)').matches);
const onResize = () => { isMobile.value = window.matchMedia('(max-width: 991px)').matches; };
onMounted(() => { window.addEventListener('resize', onResize); loadData(); });
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); });
const drawerSize = computed(() => isMobile.value ? '90%' : 500);

async function loadData() {
  loading.value = true;
  try {
    const r = await webhooksApi.list();
    rows.value = r.data || [];
    currentPage.value = 1;
  } finally { loading.value = false; }
}

function resetForm() {
  Object.assign(form, {
    id: null, name: '', webhook_url: '',
    security_mode: 'none', keyword: '', sign_secret: '', note: '',
  });
}

function openCreate() {
  drawerTitle.value = '新增群机器人';
  resetForm();
  drawerVisible.value = true;
}

function openEdit(row) {
  drawerTitle.value = '编辑群机器人';
  Object.assign(form, {
    id: row.id, name: row.name, webhook_url: '',
    security_mode: row.security_mode, keyword: row.keyword || '',
    sign_secret: '', note: row.note || '',
  });
  drawerVisible.value = true;
}

async function submitForm() {
  await formRef.value.validate();
  submitting.value = true;
  try {
    const payload = {
      name: form.name,
      security_mode: form.security_mode,
      note: form.note || null,
    };
    if (form.webhook_url) payload.webhook_url = form.webhook_url;
    if (form.security_mode === 'keyword' && form.keyword) payload.keyword = form.keyword;
    if (form.security_mode === 'sign' && form.sign_secret) payload.sign_secret = form.sign_secret;
    if (form.id) await webhooksApi.update(form.id, payload);
    else await webhooksApi.create(payload);
    ElMessage.success(form.id ? '已更新' : '已创建');
    drawerVisible.value = false;
    await loadData();
  } finally { submitting.value = false; }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除群机器人「${row.name}」？`, '提示', { type: 'warning' });
  } catch { return; }
  try {
    await webhooksApi.remove(row.id);
    ElMessage.success('已删除');
    await loadData();
  } catch (e) {}
}
</script>

<style scoped>
</style>
