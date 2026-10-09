<template>
  <div v-loading="loading">
    <!-- 顶部 4 个指标卡 -->
    <el-row :gutter="16" class="metric-row">
      <el-col :xs="12" :sm="12" :md="6">
        <el-card class="metric-card">
          <div class="metric-label">今日推送总数</div>
          <div class="metric-value">{{ data.today.total || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <el-card class="metric-card">
          <div class="metric-label">成功率</div>
          <div class="metric-value text-success">{{ data.today.success_rate ?? 0 }}%</div>

        </el-card>
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <el-card class="metric-card">
          <div class="metric-label">失败数</div>
          <div class="metric-value text-danger">{{ data.today.failed || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <el-card class="metric-card">
          <div class="metric-label">活跃 Token</div>
          <div class="metric-value">{{ data.active_tokens || 0 }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 告警区 -->
    <el-card v-if="alerts.length" class="alert-row card-shadow" body-style="padding: 12px 16px">
      <div v-for="a in alerts" :key="a.key" class="alert-item">
        <el-badge is-dot type="danger">
          <span class="alert-text">{{ a.text }}</span>
        </el-badge>
      </div>
    </el-card>

    <!-- 7 天趋势 -->
    <el-card class="chart-card card-shadow">
      <template #header>
        <div class="card-header">
          <span>7 天推送趋势</span>
          <el-button size="small" @click="loadData">刷新</el-button>
        </div>
      </template>
      <div ref="chartRef" class="chart-container"></div>
    </el-card>

    <!-- access_token 状态 -->
    <el-card class="card-shadow mt-16">
      <template #header>
        <span>access_token 缓存状态</span>
      </template>
    <div class="table-scroll">
      <el-table :data="data.access_tokens" size="small" empty-text="暂无应用消息渠道">
        <el-table-column prop="app_name" label="应用" min-width="160" />
        <el-table-column label="剩余有效期" min-width="160">
          <template #default="{ row }">
            <span v-if="row.is_expired" class="text-danger">已过期 / 未初始化</span>
            <span v-else>{{ expireCountdown(row.expires_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="120">
          <template #default="{ row }">
            <el-tag v-if="row.refresh_fail_count > 0" type="danger" size="small">刷新失败 {{ row.refresh_fail_count }}</el-tag>
            <el-tag v-else-if="row.is_expired" type="warning" size="small">已过期</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :loading="refreshing === row.app_id" @click="refreshAccessToken(row.app_id)">手动刷新</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    </el-card>

    <!-- 活跃 token Top10 -->
    <el-card class="card-shadow mt-16">
      <template #header><span>活跃 Token Top10（今日）</span></template>
      <div class="table-scroll">
      <el-table :data="data.top_tokens" size="small" empty-text="今日暂无推送记录">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="name" label="Token 备注" min-width="180" />
        <el-table-column prop="total" label="调用次数" width="120" sortable />
        <el-table-column prop="success" label="成功次数" width="120" />
        <el-table-column label="成功率" width="120">
          <template #default="{ row }">
            {{ row.total ? Math.round((row.success / row.total) * 10000) / 100 : 0 }}%
          </template>
        </el-table-column>
      </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import * as echarts from 'echarts';
import { statsApi, settingsApi } from '../api/index.js';

const loading = ref(false);
const refreshing = ref(null);
const chartRef = ref(null);
let chart = null;

const data = reactive({
  today: { total: 0, success: 0, failed: 0, success_rate: 0 },
  trend_7d: [],
  active_tokens: 0,
  access_tokens: [],
  top_tokens: [],
  alerts: { access_token_failures: [], rate_limited_today: 0 },
});

const alerts = ref([]);

onMounted(async () => {
  await loadData();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  chart?.dispose();
});

function onResize() { chart?.resize(); }

async function loadData() {
  loading.value = true;
  try {
    const r = await statsApi.dashboard();
    Object.assign(data, r.data);
    buildAlerts();
    await nextTick();
    renderChart();
  } finally {
    loading.value = false;
  }
}

function buildAlerts() {
  const out = [];
  for (const f of (data.alerts?.access_token_failures || [])) {
    out.push({ key: `at_${f.app_id}`, text: `应用 #${f.app_id} access_token 连续刷新失败 ${f.refresh_fail_count} 次，请检查 corp_secret` });
  }
  if (data.alerts?.rate_limited_today > 0) {
    out.push({ key: 'rate_limit', text: `今日触发限流 ${data.alerts.rate_limited_today} 次` });
  }
  alerts.value = out;
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);
  const trend = data.trend_7d || [];
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['成功', '失败'], top: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: trend.map(t => t.date) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: '成功', type: 'line', smooth: true, data: trend.map(t => t.success), areaStyle: { opacity: 0.1 }, itemStyle: { color: '#67c23a' } },
      { name: '失败', type: 'line', smooth: true, data: trend.map(t => t.failed), areaStyle: { opacity: 0.1 }, itemStyle: { color: '#f56c6c' } },
    ],
  });
}

function expireCountdown(expiresAt) {
  const ms = expiresAt * 1000 - Date.now();
  if (ms <= 0) return '已过期';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

async function refreshAccessToken(appId) {
  refreshing.value = appId;
  try {
    await settingsApi.refreshToken(appId);
    ElMessage.success('刷新请求已发送');
    await loadData();
  } finally {
    refreshing.value = null;
  }
}
</script>

<style scoped>
.metric-row { margin-bottom: 16px; }
.metric-card { text-align: center; min-height: 110px; display: flex; flex-direction: column; justify-content: center; }
.metric-label { color: #909399; font-size: 13px; }
.metric-value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.metric-sub { color: #909399; font-size: 12px; margin-top: 4px; min-height: 16px; }
.alert-row { margin-bottom: 16px; }
.alert-item { line-height: 1.8; }
.alert-text { font-size: 13px; }
.chart-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.chart-container { height: 280px; }

@media (max-width: 991px) {
  .metric-value { font-size: 20px; }
  .metric-card { margin-bottom: 12px; }
  .chart-container { height: 200px; }
}
</style>
