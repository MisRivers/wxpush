import { ref, watch } from 'vue';

/**
 * 表格分页偏好（每页条数），缓存在 localStorage
 * @param {string} key 存储键名（如 'apps_page_size'）
 * @returns {{ pageSize: import('vue').Ref<number> }}
 */
export function usePageSize(key) {
  const STORAGE_KEY = `wxpush:${key}`;
  const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '10', 10);
  const pageSize = ref([10, 20, 50, 100].includes(saved) ? saved : 10);

  watch(pageSize, (v) => {
    localStorage.setItem(STORAGE_KEY, String(v));
  });

  return { pageSize };
}
