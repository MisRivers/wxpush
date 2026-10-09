<template>
  <div>
    <el-card class="card-shadow">
      <template #header><span>调试发送</span></template>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
        <el-form-item label="选择 Token" prop="token_id">
          <el-select v-model="form.token_id" filterable placeholder="选择 Token" style="width: 100%" @change="onTokenChange">
            <el-option
              v-for="t in tokens"
              :key="t.id"
              :label="`${t.name}（${t.channel_type === 'app' ? '应用消息' : '群机器人'} → ${t.channel_name || ''}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="消息类型" prop="msg_type">
          <el-radio-group v-model="form.msg_type">
            <el-radio v-for="t in allowedTypes" :key="t" :value="t">{{ t }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="form.msg_type === 'text'">
          <el-form-item label="正文" prop="content.text">
            <el-input v-model="form.content.text" type="textarea" :rows="3" placeholder="必填" />
          </el-form-item>
        </template>

        <template v-else-if="form.msg_type === 'markdown'">
          <el-form-item label="Markdown 正文" prop="content.desp">
            <el-input v-model="form.content.desp" type="textarea" :rows="6" placeholder="# 标题&#10;**正文**" />
          </el-form-item>
        </template>

        <template v-else-if="form.msg_type === 'textcard'">
          <el-form-item label="标题" prop="content.title">
            <el-input v-model="form.content.title" placeholder="卡片标题" />
          </el-form-item>
          <el-form-item label="描述" prop="content.description">
            <el-input v-model="form.content.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="URL">
            <el-input v-model="form.content.url" placeholder="点击跳转 URL" />
          </el-form-item>
          <el-form-item label="按钮文字">
            <el-input v-model="form.content.btntxt" placeholder="如：详情" />
          </el-form-item>
        </template>

        <template v-else-if="form.msg_type === 'image'">
          <el-form-item label="图片 base64 / URL">
            <el-input v-model="form.content.image_base64" type="textarea" :rows="3" placeholder="支持 http(s):// 链接，或 raw base64（不带前缀）" />
          </el-form-item>
        </template>

        <template v-else-if="form.msg_type === 'news'">
          <el-form-item label="文章标题">
            <el-input v-model="form.content.title" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.content.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="URL">
            <el-input v-model="form.content.url" />
          </el-form-item>
          <el-form-item label="图片 URL">
            <el-input v-model="form.content.picurl" />
          </el-form-item>
        </template>

        <el-form-item>
          <el-button type="primary" :loading="sending" @click="send">立即发送</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="result" class="card-shadow mt-16">
      <template #header><span>响应结果</span></template>
      <el-descriptions :column="descColumn" border size="small">
        <el-descriptions-item label="状态">
          <el-tag :type="result.success ? 'success' : 'danger'" size="small">
            {{ result.success ? '成功' : '失败' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="msgid">{{ result.msgid || '-' }}</el-descriptions-item>
        <el-descriptions-item label="message" :span="2">{{ result.message }}</el-descriptions-item>
      </el-descriptions>
      <h4 class="mt-16">请求体</h4>
      <pre class="code-block">{{ JSON.stringify(result.request, null, 2) }}</pre>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import { debugApi, tokensApi } from '../api/index.js';

const tokens = ref([]);
const sending = ref(false);
const formRef = ref(null);
const isMobile = ref(window.matchMedia('(max-width: 991px)').matches);
const onResize = () => { isMobile.value = window.matchMedia('(max-width: 991px)').matches; };
onMounted(() => { window.addEventListener('resize', onResize); });
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); });
const descColumn = computed(() => isMobile.value ? 1 : 2);

const form = reactive({
  token_id: null,
  msg_type: 'text',
  content: {
    text: '', desp: '', title: '', description: '', url: '', btntxt: '',
    image_base64: '', picurl: '',
  },
});

const rules = {
  token_id: [{ required: true, message: '请选择 Token', trigger: 'change' }],
  msg_type: [{ required: true, message: '请选择类型', trigger: 'change' }],
};

const selectedToken = computed(() => tokens.value.find(t => t.id === form.token_id));
const allowedTypes = computed(() => {
  const t = selectedToken.value;
  return t?.allowed_msg_types?.length ? t.allowed_msg_types : ['text', 'markdown', 'textcard', 'image', 'news'];
});

const result = ref(null);

onMounted(async () => {
  const r = await tokensApi.list();
  tokens.value = r.data || [];
});

function onTokenChange() {
  const t = selectedToken.value;
  if (t && Array.isArray(t.allowed_msg_types) && !t.allowed_msg_types.includes(form.msg_type)) {
    form.msg_type = t.allowed_msg_types[0] || 'text';
  }
  result.value = null;
}

async function send() {
  await formRef.value.validate();
  sending.value = true;
  result.value = null;
  try {
    const payload = {
      token_id: form.token_id,
      msg_type: form.msg_type,
      content: { ...form.content },
    };
    // 清理空字段
    Object.keys(payload.content).forEach(k => {
      if (!payload.content[k]) delete payload.content[k];
    });
    const r = await debugApi.send(payload);
    result.value = r;
    if (r.success) ElMessage.success('发送成功');
    else ElMessage.error(r.message || '发送失败');
  } finally { sending.value = false; }
}
</script>

<style scoped>
.code-block {
  background: #1f2d3d;
  color: #e6e8eb;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow: auto;
}

@media (max-width: 991px) {
  .code-block { max-height: 180px; font-size: 11px; }
}
</style>
