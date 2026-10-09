<template>
  <div>
    <div class="page-toolbar">
      <el-form :inline="true" :model="filter" size="default" class="filter-form">
        <el-form-item label="Token">
          <el-select v-model="filter.token_id" clearable placeholder="全部" class="filter-select" filterable>
            <el-option v-for="t in tokens" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filter.status" clearable placeholder="全部" class="filter-select-sm">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failed" />
            <el-option label="错误" value="error" />
            <el-option label="限流" value="rate_limited" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间区间">
          <el-date-picker
            v-model="filter.range"
            type="datetimerange"
            range-separator="-"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="x"
            class="filter-daterange"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="resetAndLoad">查询</el-button>
          <el-button @click="exportCsv" :loading="exporting">导出 CSV</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-card class="card-shadow" body-style="padding: 0">
      <div class="table-scroll">
      <el-table :data="rows" v-loading="loading" size="default" empty-text="暂无日志" row-key="id" max-height="calc(100vh - 220px)">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="token_value" label="token" min-width="180" show-overflow-tooltip class-name="desktop-only">
          <template #default="{ row }">
            <span class="text-muted">{{ maskToken(row.token_value) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="channel_type" label="渠道" width="100" class-name="desktop-only" />
        <el-table-column prop="msg_type" label="类型" width="100" class-name="desktop-only" />
        <el-table-column prop="error_code" label="错误码" width="100" class-name="desktop-only">
          <template #default="{ row }">{{ row.error_code ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="client_ip" label="来源 IP" width="140" class-name="desktop-only" />
        <el-table-column prop="duration_ms" label="耗时(ms)" width="100" class-name="desktop-only" />
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openDetail(row)">详情</el-button>
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
        :total="total"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="loadPage"
        @size-change="onSizeChange"
      />
    </div>

    <el-drawer v-model="detailVisible" title="日志详情" size="640">
      <div v-if="detail" class="detail-block">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="ID">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(detail.status)" size="small">{{ statusLabel(detail.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="token_id">{{ detail.token_id || '-' }}</el-descriptions-item>
          <el-descriptions-item label="渠道">{{ detail.channel_type }} #{{ detail.channel_id }}</el-descriptions-item>
          <el-descriptions-item label="消息类型">{{ detail.msg_type }}</el-descriptions-item>
          <el-descriptions-item label="错误码">{{ detail.error_code ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="错误信息" :span="2">{{ detail.error_message || '-' }}</el-descriptions-item>
          <el-descriptions-item label="来源 IP">{{ detail.client_ip || '-' }}</el-descriptions-item>
          <el-descriptions-item label="耗时">{{ detail.duration_ms }} ms</el-descriptions-item>
          <el-descriptions-item label="request_id" :span="2">{{ detail.request_id || '-' }}</el-descriptions-item>
          <el-descriptions-item label="时间" :span="2">{{ formatTime(detail.created_at) }}</el-descriptions-item>
        </el-descriptions>
        <h4 class="mt-16">请求体</h4>
        <pre class="code-block">{{ detail.request_body }}</pre>
        <h4 class="mt-16">响应体</h4>
        <pre class="code-block">{{ detail.response_body }}</pre>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { logsApi, tokensApi } from '../api/index.js';

const rows = ref([]);
const tokens = ref([]);
const loading = ref(false);
const currentPage = ref(1);
const total = ref(0);

// 每页条数，缓存到 localStorage
const PAGE_SIZE_KEY = 'wxpush:logs_page_size';
const savedSize = parseInt(localStorage.getItem(PAGE_SIZE_KEY) || '10', 10);
const pageSize = ref([10, 20, 50, 100].includes(savedSize) ? savedSize : 10);
watch(pageSize, (v) => { localStorage.setItem(PAGE_SIZE_KEY, String(v)); });

const filter = reactive({ token_id: null, status: null, range: null });
const exporting = ref(false);

const detailVisible = ref(false);
const detail = ref(null);

onMounted(async () => {
  const r = await tokensApi.list();
  tokens.value = r.data || [];
  await resetAndLoad();
});

async function resetAndLoad() {
  currentPage.value = 1;
  await loadPage();
}

async function loadPage() {
  loading.value = true;
  try {
    const params = { page: currentPage.value, limit: pageSize.value };
    if (filter.token_id) params.token_id = filter.token_id;
    if (filter.status) params.status = filter.status;
    if (filter.range && filter.range.length === 2) {
      params.start = Math.floor(Number(filter.range[0]) / 1000);
      params.end = Math.floor(Number(filter.range[1]) / 1000);
    }
    const r = await logsApi.list(params);
    rows.value = r.data || [];
    total.value = r.pagination?.total || 0;
  } finally { loading.value = false; }
}

async function onSizeChange() {
  currentPage.value = 1;
  await loadPage();
}

function statusTagType(s) { return { success: 'success', failed: 'danger', error: 'danger', rate_limited: 'warning' }[s] || 'info'; }
function statusLabel(s) { return { success: '成功', failed: '失败', error: '错误', rate_limited: '限流' }[s] || s; }
function formatTime(t) { return new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }); }
function maskToken(v) { if (!v) return '-'; return v.slice(0, 6) + '****' + v.slice(-4); }

async function openDetail(row) {
  detail.value = null;
  detailVisible.value = true;
  const r = await logsApi.detail(row.id);
  detail.value = r.data;
}

async function exportCsv() {
  exporting.value = true;
  try {
    const params = {};
    if (filter.token_id) params.token_id = filter.token_id;
    if (filter.status) params.status = filter.status;
    if (filter.range && filter.range.length === 2) {
      params.start = Math.floor(Number(filter.range[0]) / 1000);
      params.end = Math.floor(Number(filter.range[1]) / 1000);
    }
    const blob = await logsApi.exportCsv(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `push-logs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    // 已弹错
  } finally { exporting.value = false; }
}
</script>

<style scoped>
.filter-select { width: 200px; }
.filter-select-sm { width: 140px; }
.filter-daterange { width: 380px; }
.detail-block { padding: 0 4px; }
.code-block {
  background: #1f2d3d;
  color: #e6e8eb;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
}

@media (max-width: 991px) {
  .filter-form :deep(.el-form-item) { display: block; margin-right: 0; margin-bottom: 12px; }
  .filter-select, .filter-select-sm, .filter-daterange { width: 100% !important; }
  .detail-block :deep(.el-descriptions) { --el-descriptions-item-bordered-label-padding: 8px; }
}
</style>
