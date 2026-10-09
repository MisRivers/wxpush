import request from '../utils/request.js';

// ====== 鉴权 ======
export const authApi = {
  status: () => request.get('/api/admin/auth/status'),
  init: (data) => request.post('/api/admin/auth/init', data),
  login: (data) => request.post('/api/admin/auth/login', data),
  me: () => request.get('/api/admin/auth/me'),
};

// ====== 仪表盘 ======
export const statsApi = {
  dashboard: () => request.get('/api/admin/stats/dashboard'),
};

// ====== 应用 ======
export const appsApi = {
  list: () => request.get('/api/admin/apps'),
  create: (data) => request.post('/api/admin/apps', data),
  update: (id, data) => request.put(`/api/admin/apps/${id}`, data),
  remove: (id) => request.delete(`/api/admin/apps/${id}`),
  test: (id, data) => request.post(`/api/admin/apps/${id}/test`, data),
};

// ====== 群机器人 ======
export const webhooksApi = {
  list: () => request.get('/api/admin/webhooks'),
  create: (data) => request.post('/api/admin/webhooks', data),
  update: (id, data) => request.put(`/api/admin/webhooks/${id}`, data),
  remove: (id) => request.delete(`/api/admin/webhooks/${id}`),
  test: (id, data) => request.post(`/api/admin/webhooks/${id}/test`, data),
};

// ====== Token ======
export const tokensApi = {
  list: () => request.get('/api/admin/tokens'),
  create: (data) => request.post('/api/admin/tokens', data),
  update: (id, data) => request.put(`/api/admin/tokens/${id}`, data),
  remove: (id) => request.delete(`/api/admin/tokens/${id}`),
  regenerate: (id) => request.post(`/api/admin/tokens/${id}/regenerate`),
  recipients: (id) => request.get(`/api/admin/tokens/${id}/recipients`),
  addRecipient: (id, data) => request.post(`/api/admin/tokens/${id}/recipients`, data),
  removeRecipient: (id, recipientId) => request.delete(`/api/admin/tokens/${id}/recipients/${recipientId}`),
};

// ====== 日志 ======
export const logsApi = {
  list: (params) => request.get('/api/admin/logs', { params }),
  detail: (id) => request.get(`/api/admin/logs/${id}`),
  exportCsv: (params) => request.get('/api/admin/logs/export', { params, responseType: 'blob' }),
};

// ====== 设置 ======
export const settingsApi = {
  get: () => request.get('/api/admin/settings'),
  update: (data) => request.put('/api/admin/settings', data),
  changePassword: (data) => request.post('/api/admin/settings/password', data),
  refreshToken: (appId) => request.post('/api/admin/settings/refresh-token', { app_id: appId }),
  cleanLogs: (data) => request.post('/api/admin/settings/clean-logs', data),
  exportDB: () => request.get('/api/admin/settings/db-export'),
  rotateMasterKey: (data) => request.post('/api/admin/settings/rotate-master-key', data),
};

// ====== 调试发送 ======
export const debugApi = {
  send: (data) => request.post('/api/admin/debug/send', data),
};

export default { authApi, statsApi, appsApi, webhooksApi, tokensApi, logsApi, settingsApi, debugApi };
