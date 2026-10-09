import { defineStore } from 'pinia';
import { authApi } from '../api/index.js';
import { getToken, setToken } from '../utils/request.js';
import { hashPassword } from '../utils/crypto.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    initialized: null, // null=未知, true=已初始化, false=未初始化
    token: getToken(),
    user: null, // { id, username, role }
    loading: false,
    turnstileSiteKey: '', // Cloudflare Turnstile site key（空表示未启用）
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin',
    turnstileEnabled: (s) => !!s.turnstileSiteKey,
  },
  actions: {
    async fetchStatus() {
      const r = await authApi.status();
      this.initialized = !!r.data?.initialized;
      this.turnstileSiteKey = r.data?.turnstile_site_key || '';
      return this.initialized;
    },
    async init(payload) {
      // 密码 SHA-256 哈希后再传输
      const hashedPassword = await hashPassword(payload.password);
      const r = await authApi.init({
        ...payload,
        password: hashedPassword,
      });
      this.token = r.token;
      this.user = r.user;
      setToken(r.token);
      this.initialized = true;
      return r;
    },
    async login(payload) {
      // 密码 SHA-256 哈希后再传输
      const hashedPassword = await hashPassword(payload.password);
      const r = await authApi.login({
        ...payload,
        password: hashedPassword,
      });
      this.token = r.token;
      this.user = r.user;
      setToken(r.token);
      return r;
    },
    async fetchMe() {
      const r = await authApi.me();
      this.user = r.user;
      return r.user;
    },
    logout() {
      this.token = '';
      this.user = null;
      setToken('');
    },
  },
});
