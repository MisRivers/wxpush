import axios from 'axios';
import { ElMessage } from 'element-plus';

const TOKEN_KEY = 'wxpush_admin_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const request = axios.create({
  baseURL: '/',
  timeout: 30000,
});

request.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

request.interceptors.response.use(
  (resp) => {
    const data = resp.data;
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code === 0) return data;
      // 业务错误
      const msg = data.message || '请求失败';
      ElMessage.error(msg);
      return Promise.reject(new Error(msg));
    }
    return data;
  },
  (err) => {
    const status = err.response?.status;
    const data = err.response?.data;
    const msg = data?.message || err.message || '网络错误';
    if (status === 401) {
      // 未登录或 token 失效
      setToken('');
      const fullPath = location.pathname + location.hash;
      if (!fullPath.startsWith('/#/login') && !fullPath.startsWith('/#/init')) {
        ElMessage.warning('登录已失效，请重新登录');
      }
      // 轻量跳转：避免循环依赖 router
      if (!location.hash.includes('/login') && !location.hash.includes('/init')) {
        location.hash = '#/login';
      }
    } else {
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  }
);

export default request;
