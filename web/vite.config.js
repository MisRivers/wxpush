import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 后端默认监听 127.0.0.1:8401
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8401';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 8431,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/healthz': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
